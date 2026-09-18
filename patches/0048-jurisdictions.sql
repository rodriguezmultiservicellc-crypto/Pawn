-- ============================================================================
-- PAWN — JURISDICTION RULES (data-driven statutory limits per state/province)
-- File:    patches/0048-jurisdictions.sql
-- Date:    2026-09-18
-- Purpose: Replace hardcoded Florida constants (25% cap, 30-day hold, 30-day
--          grace, 2-year retention, FL ticket text) with a global
--          `jurisdictions` reference table that every tenant points at via
--          `tenants.jurisdiction_code`. The DB enforces the statutory limits
--          so no code path (UI, server action, script) can write a loan or
--          forfeiture that violates them.
--
-- Apply to: existing project AFTER 0047. Append-only.
-- After apply: run `npm run db:types`.
--
-- Design notes:
--   - jurisdictions is GLOBAL reference data (no tenant_id). Readable by any
--     authenticated user; writable only through the service-role client
--     behind requireSuperAdmin() (/admin/jurisdictions). Same pattern as
--     watch_models (0020).
--   - Only US-FL is seeded, verified against the 2026 Florida Statutes
--     s.539.001. Other jurisdictions are added by the operator when a tenant
--     in that state/province signs up — never seeded from unverified data.
--   - Statutory values are FLOORS/CAPS. Tenant settings may be stricter
--     (longer grace, longer hold) but never looser: the effective value is
--     GREATEST(tenant setting, statutory minimum).
--   - min_charge_cap is the MAXIMUM per-period minimum service charge the
--     statute permits (FL: "entitled to receive a minimum ... of $5"). A
--     shop may configure a lower minimum, never a higher one.
--   - Forfeiture eligibility = the day AFTER (due_date + grace_days), with
--     the last redemption day rolled forward to Monday when it lands on a
--     weekend and grace_rolls_to_business_day is set (FL (10): "if the 30th
--     day is not a business day, then the following business day").
--     Public holidays are NOT modelled — the rule only ever makes
--     forfeiture LATER than a weekday-only reading, never earlier.
--   - "Today" is evaluated in the tenant's timezone (tenants.timezone), not
--     UTC, so an evening forfeiture in ET can't land a day early.
--   - Also fixes compliance_log_source_table_check, which rejected every
--     buy-outright row (source_table='inventory_items') since 0001 — buys
--     were silently missing from the police report.
-- ============================================================================

-- ── 1. jurisdictions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jurisdictions (
  code                         TEXT PRIMARY KEY
                               CHECK (code ~ '^(US|CA)-[A-Z]{2}$'),
  country                      TEXT NOT NULL CHECK (country IN ('US','CA')),
  region                       TEXT NOT NULL CHECK (region ~ '^[A-Z]{2}$'),
  name                         TEXT NOT NULL,
  statute                      TEXT,
  default_timezone             TEXT NOT NULL DEFAULT 'America/New_York',

  -- Pawn loan limits
  rate_cap_monthly             NUMERIC(6,4)
                               CHECK (rate_cap_monthly IS NULL OR (rate_cap_monthly > 0 AND rate_cap_monthly <= 1)),
  rate_tiers                   JSONB,
  period_days                  INTEGER NOT NULL DEFAULT 30 CHECK (period_days BETWEEN 1 AND 365),
  min_charge_cap               NUMERIC(18,4) CHECK (min_charge_cap IS NULL OR min_charge_cap >= 0),
  min_term_days                INTEGER CHECK (min_term_days IS NULL OR min_term_days BETWEEN 1 AND 365),
  max_term_days                INTEGER CHECK (max_term_days IS NULL OR max_term_days BETWEEN 1 AND 365),
  grace_days                   INTEGER NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 730),
  grace_rolls_to_business_day  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Buy / repair / records
  buy_hold_days                INTEGER NOT NULL DEFAULT 0 CHECK (buy_hold_days BETWEEN 0 AND 365),
  repair_abandon_days          INTEGER CHECK (repair_abandon_days IS NULL OR repair_abandon_days BETWEEN 1 AND 3650),
  record_retention_years       INTEGER CHECK (record_retention_years IS NULL OR record_retention_years BETWEEN 1 AND 25),
  police_reporting_required    BOOLEAN NOT NULL DEFAULT FALSE,
  police_report_format         police_report_format,

  -- Printed on the pawn ticket. ticket_notices: [{ "bold": bool, "en": text, "es": text }]
  ticket_notices               JSONB NOT NULL DEFAULT '[]'::jsonb,
  ticket_backpage              TEXT,

  notes                        TEXT,
  verified_on                  DATE,
  verified_source              TEXT,
  is_active                    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                   UUID REFERENCES auth.users(id),

  CONSTRAINT jurisdictions_code_shape CHECK (code = country || '-' || region),
  CONSTRAINT jurisdictions_term_range CHECK (
    min_term_days IS NULL OR max_term_days IS NULL OR min_term_days <= max_term_days
  ),
  CONSTRAINT jurisdictions_notices_array CHECK (jsonb_typeof(ticket_notices) = 'array'),
  CONSTRAINT jurisdictions_tiers_array CHECK (rate_tiers IS NULL OR jsonb_typeof(rate_tiers) = 'array')
);

COMMENT ON TABLE  jurisdictions IS 'Global statutory rules per state/province. Superadmin-managed reference data.';
COMMENT ON COLUMN jurisdictions.rate_cap_monthly IS 'Max total pawn service charge per period as a fraction of the amount financed. NULL = no cap on file. Ignored when rate_tiers is set.';
COMMENT ON COLUMN jurisdictions.rate_tiers IS 'Optional tiered cap: [{"up_to": number|null, "rate": number}] ascending; the blended cap for a principal is enforced.';
COMMENT ON COLUMN jurisdictions.min_charge_cap IS 'Maximum per-period MINIMUM service charge a shop may impose (FL = $5).';
COMMENT ON COLUMN jurisdictions.grace_days IS 'Days after maturity during which the pledgor may still redeem. Forfeiture is eligible the following day.';
COMMENT ON COLUMN jurisdictions.buy_hold_days IS 'Statutory minimum hold (calendar days) before purchased goods may be sold.';
COMMENT ON COLUMN jurisdictions.repair_abandon_days IS 'Statutory days after promised pickup before a repair item is abandoned. NULL = no statute on file; tenant setting governs.';
COMMENT ON COLUMN jurisdictions.ticket_notices IS 'Statutory statements printed in the pawn ticket legal block: [{"bold":bool,"en":text,"es":text}].';
COMMENT ON COLUMN jurisdictions.ticket_backpage IS 'Default reverse-side ticket text. settings.pawn_ticket_backpage overrides per tenant.';

DROP TRIGGER IF EXISTS trg_jurisdictions_updated_at ON jurisdictions;
CREATE TRIGGER trg_jurisdictions_updated_at BEFORE UPDATE ON jurisdictions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE jurisdictions ENABLE ROW LEVEL SECURITY;

-- Reference data: any signed-in user may read. No write policy — writes go
-- through the service-role client behind requireSuperAdmin().
DROP POLICY IF EXISTS jurisdictions_read ON jurisdictions;
CREATE POLICY jurisdictions_read ON jurisdictions FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── 2. Seed: Florida (verified 2026-09-18 against 2026 F.S. 539.001) ────────

INSERT INTO jurisdictions (
  code, country, region, name, statute, default_timezone,
  rate_cap_monthly, rate_tiers, period_days, min_charge_cap,
  min_term_days, max_term_days, grace_days, grace_rolls_to_business_day,
  buy_hold_days, repair_abandon_days, record_retention_years,
  police_reporting_required, police_report_format,
  ticket_notices, ticket_backpage, notes, verified_on, verified_source
) VALUES (
  'US-FL', 'US', 'FL', 'Florida', 'Fla. Stat. § 539.001 (Florida Pawnbroking Act)', 'America/New_York',
  0.2500, NULL, 30, 5.0000,
  30, 30, 30, TRUE,
  30, NULL, 3,
  TRUE, 'fl_leadsonline',
  $notices$[
    {"bold": true,
     "en": "The pledgor or seller represents and warrants that the goods are not stolen, have no liens or encumbrances against them, and that the pledgor or seller is the rightful owner of the goods and has the right to enter into this transaction.",
     "es": "El pignorante o vendedor declara y garantiza que los bienes no son robados, que no tienen gravámenes ni cargas, y que el pignorante o vendedor es el legítimo propietario de los bienes y tiene derecho a realizar esta transacción."},
    {"bold": false,
     "en": "Any personal property pledged to a pawnbroker within this state which is not redeemed within 30 days following the maturity date of the pawn, if the 30th day is not a business day, then the following business day, is automatically forfeited to the pawnbroker, and absolute right, title, and interest in and to the property vests in and is deemed conveyed to the pawnbroker by operation of law, and no further notice is necessary.",
     "es": "Todo bien personal pignorado a un prestamista en este estado que no sea rescatado dentro de los 30 días siguientes a la fecha de vencimiento del empeño (o el siguiente día hábil, si el día 30 no es hábil) queda automáticamente perdido a favor del prestamista, y la plena titularidad y derecho sobre el bien se transfieren al prestamista por ministerio de la ley, sin necesidad de aviso adicional."},
    {"bold": false,
     "en": "Any person who knowingly gives false verification of ownership or gives a false or altered identification and who receives money from a pawnbroker for goods sold or pledged commits: (a) if the value of the money received is less than $300, a felony of the third degree; (b) if the value of the money received is $300 or more, a felony of the second degree, punishable as provided in s. 775.082, s. 775.083, or s. 775.084.",
     "es": "Toda persona que a sabiendas dé una verificación falsa de propiedad, o presente una identificación falsa o alterada, y reciba dinero de un prestamista por bienes vendidos o pignorados comete: (a) si el dinero recibido es menor de $300, un delito grave de tercer grado; (b) si el dinero recibido es de $300 o más, un delito grave de segundo grado, sancionable según las secciones 775.082, 775.083 o 775.084."}
  ]$notices$::jsonb,
  $backpage$In consideration of and to secure the amount identified as the Total of Payments, Pledgor hereby deposits with the issuer of this pawn ticket the Pledged Goods described on the reverse hereof.

The Pledgor/Seller represents and warrants that the pledged/sold goods are not stolen, rented, or leased, and that they have no liens or encumbrances against them. Pledgor/Seller also attests to be the rightful owner of the pledged/sold property, and that Pledgor/Seller has the right to pledge/sell the property. Pledgor/Seller attests that the Pledgor/Seller is not in voluntary or involuntary bankruptcy of any type and is at least 18 years of age.

Any personal property pledged to a Pawnbroker within this state which is not redeemed within 30 days following the maturity date of the pawn, if the 30th day is not a business day, then the following business day, is automatically forfeited to the Pawnbroker, and absolute right, title, and interest in and to the property vests in and is deemed conveyed to the Pawnbroker by operation of law, and no further notice is necessary. The Pledgor is not obligated to redeem the pledged goods.

In this pawn transaction a Pawnbroker may contract for and receive a pawn service charge (Finance Charge) of 25 percent of the Amount Financed for each 30 day period, except that the Pawnbroker is entitled to receive a minimum pawn service charge of $5.00 for each such 30 day period. This pawn service charge consists of 2 percent interest charge and the remainder in storage and service fees.

On pledged goods redeemed within the first 30 days from the date of the pawn transaction, a Pawnbroker may collect a 25 percent pawn service charge. On pledged goods redeemed after the first 30 days but before the 61st day after the date of the pawn transaction, a Pawnbroker may collect a pawn service fee equal to twice the amount charged for the first 30 day period.

A pawn may be extended upon mutual agreement of the parties. In this event, the daily pawn service charge for the extension shall be equal to one-thirtieth of the original pawn service charge.

Proper identification required on all redemptions. Firearms only redeemable by the original Pledgor. On other types of loans and during the first 30 days after the original transaction date only the original Pledgor or Pledgor's attorney-in-fact may redeem the pledged goods. After the first 30 days, only the original Pledgor or the Pledgor's authorized representative is entitled to redeem the pledged goods (firearms excluded); however, if the Pawnbroker determines that the person is not the original Pledgor, or the Pledgor's authorized representative, the Pawnbroker is not required to allow the redemption of the pledged goods by such person. The person redeeming the pledged goods must sign the Pledgor's copy of the pawnbroker transaction form, which the pawnbroker will retain as evidence of the person's receipt of the pledged goods. If the person redeeming the pledged goods is the Pledgor's authorized representative, that person must present notarized authorization from the original Pledgor and show identification to the Pawnbroker and the Pawnbroker shall record that person's name, address and identification on the pawnbroker transaction form retained by the pawnshop.

Any person who knowingly gives false verification of ownership or gives a false or altered identification and who receives money from a Pawnbroker for goods sold or pledged commits:
(a) If the value of the money received is less than $300, a felony of the third degree, punishable as provided in s.775.082, s.775.083, or s.775.084.
(b) If the value of the money received is $300 or more, a felony of the second degree, punishable as provided in s.775.082, s.775.083, or s.775.084.

If the pawnbroker transaction form is lost, destroyed, or stolen, the Pledgor must immediately advise the issuing Pawnbroker in writing by certified or registered mail, return receipt requested, or in person evidenced by a signed receipt.

If the pledged goods are lost or damaged while in the Pawnbroker's possession, the Pawnbroker may satisfy the Pledgor's claim by replacing the item with like kind of merchandise of equal value, with which the Pledgor can reasonably replace the goods. Such replacement is a defense to any civil action based upon the loss or damage of the goods.

In the event of litigation or arbitration, the losing party shall be responsible for all the attorney's fees of both parties.

Pledged goods may be redeemed by mail by agreement between the Pledgor and the Pawnbroker. The Pledgor must pay in advance all monies due and a charge by the Pawnbroker to recover the cost and expenses involved in packaging, insuring, and shipping of the pledged goods. The Pawnbroker shall insure the pledged goods in an amount acceptable to the Pledgor. The Pawnbroker's liability for loss or damage in connection with the shipment of such pledged goods is limited to the amount of the insurance coverage obtained.

No oral representation shall in any way change or modify these written conditions, and such oral representations shall in no way be binding upon the issuer of this pawn ticket.

* PROPER IDENTIFICATION REQUIRED ON ALL REDEMPTIONS * FIREARMS ONLY REDEEMABLE BY THE ORIGINAL PLEDGOR *
* NO GOODS SHOWN FOR REDEMPTION UNLESS PAID IN ADVANCE * NO PERSONAL CHECKS ACCEPTED * NO GOODS SENT COD *
* VERBAL AGREEMENTS FOR ADDITIONAL DAYS ARE NON BINDING *
* NOTICE: See Reverse Side *

--

LOST PAWN TICKET STATEMENT

Fee: $2.00                                Date ____________________

My ticket was      lost,      destroyed,      stolen.  (Circle proper word)

Pledgor _______________________________________________

Pledgor's I.D. Type & Number __________________________

Employee/PS ___________________________________________

--

I HEREBY ACKNOWLEDGE RECEIPT OF PLEDGED PROPERTY
LISTED ON THE REVERSE SIDE OF THIS CONTRACT.

X _______________________________________________
   Redeemer's Signature                       Date

REDEEMER'S IDENTIFICATION IF OTHER THAN ORIGINAL PLEDGOR

Name: _________________________________________________

Address: ______________________________________________

ID Number and Type ____________________________________

                                  Right Thumb Print of Pledgor/Seller$backpage$,
  'Service charge ≤ 25% of amount financed per 30-day period, $5 minimum per period (11)(a). Maturity exactly 30 days after the pawn (8)(b)6.b. 30-day grace after maturity, rolled to next business day; forfeiture automatic after (10). Purchased goods held 30 calendar days (9)(c). Transaction forms kept 3 years (12)(c). Daily delivery to law enforcement (9)(a). Extension charge = 1/30 of original charge per day (11)(b). Repair abandonment is not governed by Ch. 539 — tenant setting applies.',
  DATE '2026-09-18',
  'Fla. Stat. § 539.001 (2026), subsections (8)(b), (9)(a), (9)(c), (10), (11)(a)-(b), (12)(c)'
)
ON CONFLICT (code) DO NOTHING;

-- ── 3. tenants.jurisdiction_code + timezone ─────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS jurisdiction_code TEXT REFERENCES jurisdictions(code),
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';

COMMENT ON COLUMN tenants.jurisdiction_code IS 'Statutory rule set this shop operates under. NULL = no jurisdiction on file (no statutory enforcement).';
COMMENT ON COLUMN tenants.timezone IS 'IANA timezone for "today" in date-based rules (forfeiture, holds, reminders).';

CREATE INDEX IF NOT EXISTS idx_tenants_jurisdiction ON tenants(jurisdiction_code);

UPDATE tenants t
   SET jurisdiction_code = 'US-' || upper(t.state)
 WHERE t.jurisdiction_code IS NULL
   AND t.state IS NOT NULL
   AND EXISTS (SELECT 1 FROM jurisdictions j WHERE j.code = 'US-' || upper(t.state));

-- New tenants: default the jurisdiction (and timezone) from the address state
-- when the creator didn't pick one explicitly.
CREATE OR REPLACE FUNCTION tenants_default_jurisdiction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  IF NEW.jurisdiction_code IS NULL AND NEW.state IS NOT NULL THEN
    SELECT code, default_timezone INTO NEW.jurisdiction_code, v_tz
      FROM jurisdictions
     WHERE code = 'US-' || upper(NEW.state) AND is_active;
    IF v_tz IS NOT NULL AND TG_OP = 'INSERT' THEN
      NEW.timezone := v_tz;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_default_jurisdiction ON tenants;
CREATE TRIGGER trg_tenants_default_jurisdiction BEFORE INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION tenants_default_jurisdiction();

-- ── 4. settings.grace_period_days (tenant may extend, never shorten) ────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS grace_period_days INTEGER
    CHECK (grace_period_days IS NULL OR grace_period_days BETWEEN 0 AND 730);

COMMENT ON COLUMN settings.grace_period_days IS 'Tenant grace after maturity. Effective grace = GREATEST(this, jurisdictions.grace_days).';
COMMENT ON COLUMN settings.buy_hold_period_days IS 'Tenant buy hold. Effective hold = GREATEST(this, jurisdictions.buy_hold_days).';
COMMENT ON COLUMN settings.abandoned_repair_days IS 'Tenant repair abandon period. Effective = GREATEST(this, jurisdictions.repair_abandon_days).';

-- ── 5. Rule helpers ─────────────────────────────────────────────────────────

-- Today's date in the tenant's timezone.
CREATE OR REPLACE FUNCTION tenant_today(p_tenant_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (NOW() AT TIME ZONE COALESCE(
            (SELECT timezone FROM tenants WHERE id = p_tenant_id),
            'America/New_York'))::date;
$$;

-- Blended statutory cap (fraction per period) for a principal. NULL = no cap.
CREATE OR REPLACE FUNCTION jurisdiction_max_rate(p_code TEXT, p_principal NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j          jurisdictions%ROWTYPE;
  tier       JSONB;
  v_lower    NUMERIC := 0;
  v_upper    NUMERIC;
  v_slice    NUMERIC;
  v_charge   NUMERIC := 0;
BEGIN
  IF p_code IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO j FROM jurisdictions WHERE code = p_code;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF j.rate_tiers IS NULL OR jsonb_array_length(j.rate_tiers) = 0 THEN
    RETURN j.rate_cap_monthly;
  END IF;
  IF p_principal IS NULL OR p_principal <= 0 THEN
    RETURN (j.rate_tiers -> 0 ->> 'rate')::numeric;
  END IF;

  FOR tier IN SELECT value FROM jsonb_array_elements(j.rate_tiers) LOOP
    v_upper := NULLIF(tier ->> 'up_to', '')::numeric;
    v_slice := LEAST(p_principal, COALESCE(v_upper, p_principal)) - v_lower;
    IF v_slice > 0 THEN
      v_charge := v_charge + v_slice * (tier ->> 'rate')::numeric;
    END IF;
    EXIT WHEN v_upper IS NULL OR v_upper >= p_principal;
    v_lower := v_upper;
  END LOOP;

  RETURN v_charge / p_principal;
END;
$$;

-- Effective grace days for a tenant (tenant setting may extend statute).
CREATE OR REPLACE FUNCTION tenant_grace_days(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
           COALESCE((SELECT grace_period_days FROM settings WHERE tenant_id = p_tenant_id), 0),
           COALESCE((SELECT j.grace_days
                       FROM tenants t JOIN jurisdictions j ON j.code = t.jurisdiction_code
                      WHERE t.id = p_tenant_id), 0));
$$;

-- First date on which a loan may be forfeited.
CREATE OR REPLACE FUNCTION loan_forfeit_eligible_date(p_tenant_id UUID, p_due_date DATE)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last  DATE;
  v_roll  BOOLEAN;
BEGIN
  v_last := p_due_date + tenant_grace_days(p_tenant_id);
  SELECT COALESCE(j.grace_rolls_to_business_day, FALSE) INTO v_roll
    FROM tenants t LEFT JOIN jurisdictions j ON j.code = t.jurisdiction_code
   WHERE t.id = p_tenant_id;
  IF COALESCE(v_roll, FALSE) THEN
    -- ISO dow: 6 = Saturday, 7 = Sunday.
    IF EXTRACT(ISODOW FROM v_last) = 6 THEN v_last := v_last + 2;
    ELSIF EXTRACT(ISODOW FROM v_last) = 7 THEN v_last := v_last + 1;
    END IF;
  END IF;
  RETURN v_last + 1;
END;
$$;

-- Effective statutory buy hold (days) for a tenant.
CREATE OR REPLACE FUNCTION tenant_buy_hold_days(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
           COALESCE((SELECT buy_hold_period_days FROM settings WHERE tenant_id = p_tenant_id), 0),
           COALESCE((SELECT j.buy_hold_days
                       FROM tenants t JOIN jurisdictions j ON j.code = t.jurisdiction_code
                      WHERE t.id = p_tenant_id), 0));
$$;

REVOKE ALL ON FUNCTION tenant_today(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION jurisdiction_max_rate(TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_grace_days(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION loan_forfeit_eligible_date(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_buy_hold_days(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_today(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION jurisdiction_max_rate(TEXT, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION tenant_grace_days(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION loan_forfeit_eligible_date(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION tenant_buy_hold_days(UUID) TO authenticated, service_role;

-- ── 6. Enforcement: loans ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION loans_enforce_jurisdiction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j         jurisdictions%ROWTYPE;
  v_code    TEXT;
  v_cap     NUMERIC;
  v_elig    DATE;
BEGIN
  SELECT jurisdiction_code INTO v_code FROM tenants WHERE id = NEW.tenant_id;

  IF TG_OP = 'INSERT' AND v_code IS NOT NULL THEN
    SELECT * INTO j FROM jurisdictions WHERE code = v_code;

    v_cap := jurisdiction_max_rate(v_code, NEW.principal);
    -- 0.00005 tolerance: rates are stored at 4dp.
    IF v_cap IS NOT NULL AND NEW.interest_rate_monthly > v_cap + 0.00005 THEN
      RAISE EXCEPTION 'jurisdiction_rate_cap:%', round(v_cap, 4)
        USING ERRCODE = 'check_violation';
    END IF;
    IF j.min_charge_cap IS NOT NULL AND COALESCE(NEW.min_monthly_charge, 0) > j.min_charge_cap THEN
      RAISE EXCEPTION 'jurisdiction_min_charge_cap:%', j.min_charge_cap
        USING ERRCODE = 'check_violation';
    END IF;
    IF j.min_term_days IS NOT NULL AND NEW.term_days < j.min_term_days THEN
      RAISE EXCEPTION 'jurisdiction_term_min:%', j.min_term_days
        USING ERRCODE = 'check_violation';
    END IF;
    IF j.max_term_days IS NOT NULL AND NEW.term_days > j.max_term_days THEN
      RAISE EXCEPTION 'jurisdiction_term_max:%', j.max_term_days
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status = 'forfeited'
     AND OLD.status IS DISTINCT FROM 'forfeited' THEN
    v_elig := loan_forfeit_eligible_date(NEW.tenant_id, OLD.due_date);
    IF tenant_today(NEW.tenant_id) < v_elig THEN
      RAISE EXCEPTION 'forfeit_not_eligible_until:%', v_elig
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loans_enforce_jurisdiction ON loans;
CREATE TRIGGER trg_loans_enforce_jurisdiction
BEFORE INSERT OR UPDATE OF status ON loans
FOR EACH ROW EXECUTE FUNCTION loans_enforce_jurisdiction();

-- ── 7. Enforcement: tenant_loan_rates ───────────────────────────────────────

-- The 0.25 ceiling was a Florida constant baked into a CHECK. The statutory
-- cap now comes from the tenant's jurisdiction (trigger below); the CHECK
-- keeps only the physical sanity bound.
ALTER TABLE tenant_loan_rates DROP CONSTRAINT IF EXISTS tenant_loan_rates_rate_monthly_check;
ALTER TABLE tenant_loan_rates ADD CONSTRAINT tenant_loan_rates_rate_monthly_check
  CHECK (rate_monthly >= 0 AND rate_monthly <= 1);

CREATE OR REPLACE FUNCTION tenant_loan_rates_enforce_jurisdiction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j       jurisdictions%ROWTYPE;
  v_cap   NUMERIC;
BEGIN
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  SELECT jj.* INTO j
    FROM tenants t JOIN jurisdictions jj ON jj.code = t.jurisdiction_code
   WHERE t.id = NEW.tenant_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- A menu rate must be legal for at least the smallest loan, i.e. under
  -- the highest (first) tier or the flat cap.
  v_cap := jurisdiction_max_rate(j.code, NULL);
  IF v_cap IS NOT NULL AND NEW.rate_monthly > v_cap + 0.00005 THEN
    RAISE EXCEPTION 'jurisdiction_rate_cap:%', round(v_cap, 4)
      USING ERRCODE = 'check_violation';
  END IF;
  IF j.min_charge_cap IS NOT NULL AND COALESCE(NEW.min_monthly_charge, 0) > j.min_charge_cap THEN
    RAISE EXCEPTION 'jurisdiction_min_charge_cap:%', j.min_charge_cap
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_loan_rates_enforce_jurisdiction ON tenant_loan_rates;
CREATE TRIGGER trg_tenant_loan_rates_enforce_jurisdiction
BEFORE INSERT OR UPDATE OF rate_monthly, min_monthly_charge, is_active ON tenant_loan_rates
FOR EACH ROW EXECUTE FUNCTION tenant_loan_rates_enforce_jurisdiction();

-- ── 8. Enforcement: purchased goods can't leave hold early ──────────────────

CREATE OR REPLACE FUNCTION inventory_items_enforce_buy_hold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'bought'
     AND OLD.status = 'held'
     AND NEW.status IN ('available', 'sold')
     AND OLD.hold_until IS NOT NULL
     AND tenant_today(NEW.tenant_id) < OLD.hold_until THEN
    RAISE EXCEPTION 'buy_hold_active_until:%', OLD.hold_until
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.source = 'bought'
     AND OLD.hold_until IS NOT NULL
     AND NEW.hold_until IS DISTINCT FROM OLD.hold_until
     AND (NEW.hold_until IS NULL OR NEW.hold_until < OLD.hold_until) THEN
    RAISE EXCEPTION 'buy_hold_cannot_shorten'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_enforce_buy_hold ON inventory_items;
CREATE TRIGGER trg_inventory_items_enforce_buy_hold
BEFORE UPDATE OF status, hold_until ON inventory_items
FOR EACH ROW EXECUTE FUNCTION inventory_items_enforce_buy_hold();

-- ── 9. compliance_log: accept buy-outright rows ─────────────────────────────

ALTER TABLE compliance_log DROP CONSTRAINT IF EXISTS compliance_log_source_table_check;
ALTER TABLE compliance_log ADD CONSTRAINT compliance_log_source_table_check
  CHECK (source_table IN ('loans', 'sales', 'inventory_items'));

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0048-jurisdictions.sql
-- ============================================================================
