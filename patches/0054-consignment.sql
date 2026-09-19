-- ───────────────────────────────────────────────────────────────────────────
-- 0054 — consignment (PawnSmarts parity, feature 4 of 4 — part B)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0053 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   consignors (NEW) — a party who leaves goods with the shop to be sold.
--     Always linked to a customers row (one consignor record per customer
--     per tenant) so ID, phone, language and comms preferences are not
--     duplicated. Carries the DEFAULT commission split and payout method;
--     the rate that actually governs a sale is frozen onto the item.
--
--   inventory_items + 4 columns:
--     consignor_id                UUID FK → consignors(id) ON DELETE RESTRICT
--     consignment_commission_pct  NUMERIC(6,4)  -- 0.2000 = shop keeps 20%
--     consignment_min_price       NUMERIC(18,4) -- contractual floor, enforced
--     consignment_expires_on      DATE          -- agreement end; informational
--   CHECK: consignor_id set ⇒ source='consigned' AND commission present.
--
--   consignment_payouts (NEW) — one row per cash-out to a consignor,
--     'CP-' + 6-digit per-tenant number.
--
--   consignment_payables (NEW) — the money ledger. One row per economic
--     event, positive when the shop OWES the consignor, negative when a
--     reversal takes it back:
--       kind='accrual'  — a consigned line sold on a completed sale
--       kind='reversal' — that sale voided, or the line returned
--     A consignor's balance is SUM(payable_amount) WHERE status='open'.
--
--   Why signed rows instead of editing the accrual: a reversal that lands
--   AFTER the shop already paid the consignor is real — it leaves a
--   negative open row, the consignor's balance goes negative, and the next
--   payout nets it off. Mutating the original accrual would silently erase
--   a payment that actually happened.
--
--   settings + 2 columns:
--     consignment_enabled                BOOLEAN NOT NULL DEFAULT FALSE
--     consignment_default_commission_pct NUMERIC(6,4) NOT NULL DEFAULT 0.2
--
-- Triggers (the accounting is the DATABASE's job, not the app's)
--
--   trg_consignment_accrue_on_sale       AFTER UPDATE ON sales
--     status → 'completed' (from anything else): write one accrual per
--     consigned sale_item. Covers retail completion AND layaway payoff,
--     because both flip the sale to 'completed'.
--   trg_consignment_reverse_on_void      AFTER UPDATE ON sales
--     status → 'voided': reverse every accrual on the sale, in full.
--   trg_consignment_reverse_on_return    AFTER INSERT ON return_items
--     reverse the accrual pro-rata to the returned quantity.
--   trg_sale_items_consignment_floor     BEFORE INSERT OR UPDATE ON sale_items
--     refuse an effective unit price below the consigned item's floor. The
--     floor is a contract with the consignor — the shop cannot discount
--     someone else's property below what was agreed.
--   trg_inventory_consignor_same_tenant  BEFORE INSERT OR UPDATE ON inventory_items
--     the consignor must live in the item's tenant.
--
--   Every one is SECURITY DEFINER with a locked search_path (Session 9
--   rule) because they write tables the acting staff user may not hold
--   direct INSERT on under RLS.
--
-- What "gross" means
--
--   The accrual is computed from sale_items.line_total — the amount that
--   line actually realized, after any LINE discount. A cart-level discount
--   (sales.discount_amount, which is also where loyalty redemption lands)
--   is NOT prorated onto consigned lines: it is the shop's own giveaway,
--   and the floor-price trigger guards the same per-line number, so the two
--   rules agree. Discount a consigned item on its line, not on the cart.
--
-- One RPC (service_role only — app guards run first, Rule 10):
--   consignment_pay_out(tenant, consignor, method, reference, performed_by)
--     Settles every open row in one transaction: creates the payout, stamps
--     the rows 'paid', returns the number and amount. Refuses when the net
--     is zero or negative (nothing owed / consignor owes the shop).
--
-- Followups (NOT in this patch)
--   - npm run db:types after applying.
--
-- Rollback
--
--   DROP FUNCTION IF EXISTS consignment_pay_out(UUID, UUID, payment_method, TEXT, UUID);
--   DROP TRIGGER IF EXISTS trg_inventory_consignor_same_tenant ON inventory_items;
--   DROP FUNCTION IF EXISTS inventory_consignor_same_tenant();
--   DROP TRIGGER IF EXISTS trg_sale_items_consignment_floor ON sale_items;
--   DROP FUNCTION IF EXISTS sale_items_consignment_floor();
--   DROP TRIGGER IF EXISTS trg_consignment_reverse_on_return ON return_items;
--   DROP FUNCTION IF EXISTS consignment_reverse_on_return();
--   DROP TRIGGER IF EXISTS trg_consignment_reverse_on_void ON sales;
--   DROP FUNCTION IF EXISTS consignment_reverse_on_void();
--   DROP TRIGGER IF EXISTS trg_consignment_accrue_on_sale ON sales;
--   DROP FUNCTION IF EXISTS consignment_accrue_on_sale();
--   DROP TABLE IF EXISTS consignment_payables;
--   DROP TABLE IF EXISTS consignment_payouts;
--   ALTER TABLE inventory_items
--     DROP CONSTRAINT IF EXISTS inventory_items_consignment_coherent,
--     DROP COLUMN IF EXISTS consignment_expires_on,
--     DROP COLUMN IF EXISTS consignment_min_price,
--     DROP COLUMN IF EXISTS consignment_commission_pct,
--     DROP COLUMN IF EXISTS consignor_id;
--   DROP TABLE IF EXISTS consignors;
--   ALTER TABLE settings
--     DROP COLUMN IF EXISTS consignment_default_commission_pct,
--     DROP COLUMN IF EXISTS consignment_enabled;
-- ============================================================================

-- ── settings columns ──────────────────────────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS consignment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consignment_default_commission_pct NUMERIC(6,4)
    NOT NULL DEFAULT 0.2
    CHECK (consignment_default_commission_pct >= 0
           AND consignment_default_commission_pct <= 1);

COMMENT ON COLUMN settings.consignment_enabled IS
  'Master gate for consignment. When FALSE the Consignors nav entry, the consignment fields on the inventory form and the payout surface all hide. Accrual triggers still fire for items already marked consigned — turning the module off must not silently stop paying people.';
COMMENT ON COLUMN settings.consignment_default_commission_pct IS
  'Shop''s default cut, as a fraction: 0.2000 = shop keeps 20%, consignor gets 80%. Seeds the consignor form; the rate that governs a sale is the one frozen on inventory_items.consignment_commission_pct.';

-- ── consignors ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consignors (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- RESTRICT: a customer with consigned goods or an unsettled balance is
  -- not deletable. Rule 13's canDeleteCustomer reads this too.
  customer_id            UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  consignor_number       TEXT,
  business_name          TEXT,

  default_commission_pct NUMERIC(6,4) NOT NULL DEFAULT 0.2
    CHECK (default_commission_pct >= 0 AND default_commission_pct <= 1),
  default_payout_method  payment_method NOT NULL DEFAULT 'cash',

  status                 TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  notes                  TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ,
  created_by             UUID REFERENCES auth.users(id),
  updated_by             UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, consignor_number)
);

COMMENT ON TABLE consignors IS
  'A party who leaves goods with the shop to be sold on their behalf. Always backed by a customers row — never a second copy of someone''s identity.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_consignors_tenant_customer
  ON consignors (tenant_id, customer_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consignors_tenant_status
  ON consignors (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION consignors_assign_number()
RETURNS TRIGGER AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.consignor_number IS NULL OR NEW.consignor_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'consignor');
    NEW.consignor_number := 'CN-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consignors_number ON consignors;
CREATE TRIGGER trg_consignors_number
BEFORE INSERT ON consignors
FOR EACH ROW EXECUTE FUNCTION consignors_assign_number();

DROP TRIGGER IF EXISTS trg_consignors_updated_at ON consignors;
CREATE TRIGGER trg_consignors_updated_at BEFORE UPDATE ON consignors
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Same-tenant guard: the customer behind a consignor must be in the same
-- tenant. Mirrors trg_customers_referral_same_tenant from 0028.
CREATE OR REPLACE FUNCTION consignors_customer_same_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customers
     WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'consignors.customer_id must belong to the same tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consignors_customer_same_tenant ON consignors;
CREATE TRIGGER trg_consignors_customer_same_tenant
BEFORE INSERT OR UPDATE OF customer_id, tenant_id ON consignors
FOR EACH ROW EXECUTE FUNCTION consignors_customer_same_tenant();

-- ── inventory_items consignment columns ───────────────────────────────────
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS consignor_id UUID
    REFERENCES consignors(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS consignment_commission_pct NUMERIC(6,4)
    CHECK (consignment_commission_pct IS NULL
           OR (consignment_commission_pct >= 0
               AND consignment_commission_pct <= 1)),
  ADD COLUMN IF NOT EXISTS consignment_min_price NUMERIC(18,4)
    CHECK (consignment_min_price IS NULL OR consignment_min_price >= 0),
  ADD COLUMN IF NOT EXISTS consignment_expires_on DATE;

COMMENT ON COLUMN inventory_items.consignor_id IS
  'Set ⇒ this item is NOT the shop''s property. It belongs to the consignor until it sells; the shop keeps only its commission.';
COMMENT ON COLUMN inventory_items.consignment_commission_pct IS
  'The shop''s cut for THIS item, frozen at intake from the consignor default. Changing the consignor default later never re-prices goods already on the floor.';
COMMENT ON COLUMN inventory_items.consignment_min_price IS
  'Contractual floor. trg_sale_items_consignment_floor refuses any sale line whose effective unit price falls below it.';
COMMENT ON COLUMN inventory_items.consignment_expires_on IS
  'When the consignment agreement ends and the goods should go back. Informational — nothing auto-returns, because handing property back is a physical act.';

DO $$ BEGIN
  ALTER TABLE inventory_items
    ADD CONSTRAINT inventory_items_consignment_coherent CHECK (
      consignor_id IS NULL
      OR (source = 'consigned' AND consignment_commission_pct IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_consignor
  ON inventory_items (consignor_id)
  WHERE consignor_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_consignment_expiry
  ON inventory_items (tenant_id, consignment_expires_on)
  WHERE consignor_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION inventory_consignor_same_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.consignor_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM consignors
       WHERE id = NEW.consignor_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'inventory_items.consignor_id must belong to the same tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_consignor_same_tenant ON inventory_items;
CREATE TRIGGER trg_inventory_consignor_same_tenant
BEFORE INSERT OR UPDATE OF consignor_id, tenant_id ON inventory_items
FOR EACH ROW EXECUTE FUNCTION inventory_consignor_same_tenant();

-- ── consignment_payouts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consignment_payouts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  consignor_id    UUID NOT NULL REFERENCES consignors(id) ON DELETE RESTRICT,

  payout_number   TEXT,
  amount          NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  payout_method   payment_method NOT NULL DEFAULT 'cash',
  reference       TEXT,
  notes           TEXT,

  paid_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_by         UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, payout_number)
);

COMMENT ON TABLE consignment_payouts IS
  'One row per cash-out to a consignor. Never edited or deleted — a mistaken payout is corrected by an adjusting payable, not by rewriting history.';

CREATE INDEX IF NOT EXISTS idx_consignment_payouts_consignor
  ON consignment_payouts (consignor_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_consignment_payouts_tenant
  ON consignment_payouts (tenant_id, paid_at DESC);

CREATE OR REPLACE FUNCTION consignment_payouts_assign_number()
RETURNS TRIGGER AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.payout_number IS NULL OR NEW.payout_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'consignment_payout');
    NEW.payout_number := 'CP-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consignment_payouts_number ON consignment_payouts;
CREATE TRIGGER trg_consignment_payouts_number
BEFORE INSERT ON consignment_payouts
FOR EACH ROW EXECUTE FUNCTION consignment_payouts_assign_number();

-- ── consignment_payables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consignment_payables (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  consignor_id      UUID NOT NULL REFERENCES consignors(id) ON DELETE RESTRICT,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  sale_id           UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  sale_item_id      UUID NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
  -- Set only on kind='reversal' rows raised by a return.
  return_item_id    UUID REFERENCES return_items(id) ON DELETE RESTRICT,

  kind              TEXT NOT NULL CHECK (kind IN ('accrual', 'reversal')),
  reason            TEXT,

  -- All three are positive on an accrual and negative on a reversal.
  gross_amount      NUMERIC(18,4) NOT NULL,
  commission_pct    NUMERIC(6,4) NOT NULL,
  commission_amount NUMERIC(18,4) NOT NULL,
  payable_amount    NUMERIC(18,4) NOT NULL,

  status            TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'paid')),
  payout_id         UUID REFERENCES consignment_payouts(id) ON DELETE RESTRICT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT consignment_payables_sign_matches_kind CHECK (
    (kind = 'accrual'  AND payable_amount >= 0)
    OR (kind = 'reversal' AND payable_amount <= 0)
  ),
  CONSTRAINT consignment_payables_paid_has_payout CHECK (
    (status = 'paid' AND payout_id IS NOT NULL)
    OR (status = 'open' AND payout_id IS NULL)
  )
);

COMMENT ON TABLE consignment_payables IS
  'Signed ledger of what the shop owes each consignor. Balance = SUM(payable_amount) WHERE status = ''open''. A negative balance means a reversal landed after the consignor was already paid — the consignor owes the shop, and the next payout nets it off.';
COMMENT ON COLUMN consignment_payables.gross_amount IS
  'sale_items.line_total for the accrual — what the line actually realized after any LINE discount. Cart-level discounts are the shop''s giveaway and are not prorated onto consigned lines.';

CREATE INDEX IF NOT EXISTS idx_consignment_payables_consignor_status
  ON consignment_payables (consignor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consignment_payables_tenant_created
  ON consignment_payables (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consignment_payables_sale
  ON consignment_payables (sale_id);
CREATE INDEX IF NOT EXISTS idx_consignment_payables_payout
  ON consignment_payables (payout_id)
  WHERE payout_id IS NOT NULL;

-- One accrual per sold line.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_consignment_accrual_per_sale_item
  ON consignment_payables (sale_item_id)
  WHERE kind = 'accrual';
-- One reversal per returned line …
CREATE UNIQUE INDEX IF NOT EXISTS uniq_consignment_reversal_per_return_item
  ON consignment_payables (return_item_id)
  WHERE kind = 'reversal' AND return_item_id IS NOT NULL;
-- … and one void-reversal per sold line.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_consignment_void_reversal_per_sale_item
  ON consignment_payables (sale_item_id)
  WHERE kind = 'reversal' AND return_item_id IS NULL;

DROP TRIGGER IF EXISTS trg_consignment_payables_updated_at ON consignment_payables;
CREATE TRIGGER trg_consignment_payables_updated_at
BEFORE UPDATE ON consignment_payables
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger: accrue when a sale completes ─────────────────────────────────
CREATE OR REPLACE FUNCTION consignment_accrue_on_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row        RECORD;
  v_gross      NUMERIC(18,4);
  v_commission NUMERIC(18,4);
BEGIN
  FOR v_row IN
    SELECT si.id            AS sale_item_id,
           si.line_total    AS line_total,
           ii.id            AS inventory_item_id,
           ii.consignor_id  AS consignor_id,
           ii.consignment_commission_pct AS commission_pct
      FROM sale_items si
      JOIN inventory_items ii ON ii.id = si.inventory_item_id
     WHERE si.sale_id = NEW.id
       AND si.deleted_at IS NULL
       AND ii.consignor_id IS NOT NULL
  LOOP
    v_gross      := ROUND(COALESCE(v_row.line_total, 0), 4);
    v_commission := ROUND(v_gross * COALESCE(v_row.commission_pct, 0), 4);

    INSERT INTO consignment_payables (
      tenant_id, consignor_id, inventory_item_id, sale_id, sale_item_id,
      kind, reason, gross_amount, commission_pct, commission_amount,
      payable_amount
    ) VALUES (
      NEW.tenant_id, v_row.consignor_id, v_row.inventory_item_id, NEW.id,
      v_row.sale_item_id, 'accrual', 'sale_completed',
      v_gross, COALESCE(v_row.commission_pct, 0), v_commission,
      ROUND(v_gross - v_commission, 4)
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consignment_accrue_on_sale ON sales;
CREATE TRIGGER trg_consignment_accrue_on_sale
AFTER UPDATE OF status ON sales
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
EXECUTE FUNCTION consignment_accrue_on_sale();

-- ── Trigger: reverse in full when a sale is voided ────────────────────────
CREATE OR REPLACE FUNCTION consignment_reverse_on_void()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO consignment_payables (
    tenant_id, consignor_id, inventory_item_id, sale_id, sale_item_id,
    return_item_id, kind, reason, gross_amount, commission_pct,
    commission_amount, payable_amount
  )
  SELECT a.tenant_id, a.consignor_id, a.inventory_item_id, a.sale_id,
         a.sale_item_id, NULL, 'reversal', 'sale_voided',
         -a.gross_amount, a.commission_pct, -a.commission_amount,
         -a.payable_amount
    FROM consignment_payables a
   WHERE a.sale_id = NEW.id
     AND a.kind = 'accrual'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consignment_reverse_on_void ON sales;
CREATE TRIGGER trg_consignment_reverse_on_void
AFTER UPDATE OF status ON sales
FOR EACH ROW
WHEN (NEW.status = 'voided' AND OLD.status IS DISTINCT FROM 'voided')
EXECUTE FUNCTION consignment_reverse_on_void();

-- ── Trigger: reverse pro-rata when a line comes back ──────────────────────
CREATE OR REPLACE FUNCTION consignment_reverse_on_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_accrual  consignment_payables%ROWTYPE;
  v_sold_qty NUMERIC(8,3);
  v_fraction NUMERIC;
  v_gross    NUMERIC(18,4);
  v_comm     NUMERIC(18,4);
BEGIN
  SELECT * INTO v_accrual
    FROM consignment_payables
   WHERE sale_item_id = NEW.sale_item_id AND kind = 'accrual';
  IF NOT FOUND THEN
    -- Not a consigned line, or the sale never completed. Nothing owed,
    -- nothing to take back.
    RETURN NEW;
  END IF;

  SELECT quantity INTO v_sold_qty FROM sale_items WHERE id = NEW.sale_item_id;
  IF v_sold_qty IS NULL OR v_sold_qty <= 0 THEN
    RETURN NEW;
  END IF;

  v_fraction := LEAST(NEW.quantity / v_sold_qty, 1);
  v_gross    := ROUND(v_accrual.gross_amount * v_fraction, 4);
  v_comm     := ROUND(v_accrual.commission_amount * v_fraction, 4);

  INSERT INTO consignment_payables (
    tenant_id, consignor_id, inventory_item_id, sale_id, sale_item_id,
    return_item_id, kind, reason, gross_amount, commission_pct,
    commission_amount, payable_amount
  ) VALUES (
    v_accrual.tenant_id, v_accrual.consignor_id, v_accrual.inventory_item_id,
    v_accrual.sale_id, v_accrual.sale_item_id, NEW.id, 'reversal',
    'item_returned', -v_gross, v_accrual.commission_pct, -v_comm,
    -ROUND(v_gross - v_comm, 4)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consignment_reverse_on_return ON return_items;
CREATE TRIGGER trg_consignment_reverse_on_return
AFTER INSERT ON return_items
FOR EACH ROW EXECUTE FUNCTION consignment_reverse_on_return();

-- ── Trigger: floor price on consigned lines ───────────────────────────────
CREATE OR REPLACE FUNCTION sale_items_consignment_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_floor     NUMERIC(18,4);
  v_effective NUMERIC(18,4);
BEGIN
  IF NEW.inventory_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT consignment_min_price INTO v_floor
    FROM inventory_items
   WHERE id = NEW.inventory_item_id
     AND consignor_id IS NOT NULL;
  IF v_floor IS NULL THEN
    RETURN NEW;
  END IF;

  -- The realized per-unit price, i.e. after the line discount. Guarding
  -- unit_price alone would let a line discount walk straight through the
  -- floor the shop promised the consignor.
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    v_effective := ROUND(NEW.unit_price, 4);
  ELSE
    v_effective := ROUND(COALESCE(NEW.line_total, NEW.unit_price * NEW.quantity)
                         / NEW.quantity, 4);
  END IF;

  IF v_effective < v_floor THEN
    RAISE EXCEPTION 'consignment_below_floor_price'
      USING ERRCODE = 'P0001',
            DETAIL = format('effective %s, floor %s', v_effective, v_floor);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_items_consignment_floor ON sale_items;
CREATE TRIGGER trg_sale_items_consignment_floor
BEFORE INSERT OR UPDATE OF unit_price, line_discount, line_total, quantity,
                           inventory_item_id
ON sale_items
FOR EACH ROW EXECUTE FUNCTION sale_items_consignment_floor();

-- ── RPC: settle a consignor's open balance ────────────────────────────────
CREATE OR REPLACE FUNCTION consignment_pay_out(
  p_tenant_id     UUID,
  p_consignor_id  UUID,
  p_payout_method payment_method DEFAULT 'cash',
  p_reference     TEXT DEFAULT NULL,
  p_performed_by  UUID DEFAULT NULL
)
-- Output columns carry an o_ prefix so plpgsql does not resolve
-- `payout_id` / `payout_number` / `amount` inside the body to the OUT
-- parameters instead of the table columns of the same names.
RETURNS TABLE (o_payout_id UUID, o_payout_number TEXT, o_amount NUMERIC, o_row_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_net       NUMERIC(18,4);
  v_rows      INTEGER;
  v_payout_id UUID;
  v_number    TEXT;
BEGIN
  -- Lock the consignor so two clerks cannot pay the same balance twice.
  PERFORM 1 FROM consignors
   WHERE id = p_consignor_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consignment_consignor_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(ROUND(SUM(payable_amount), 4), 0), COUNT(*)
    INTO v_net, v_rows
    FROM consignment_payables
   WHERE consignor_id = p_consignor_id
     AND tenant_id = p_tenant_id
     AND status = 'open';

  IF v_rows = 0 OR v_net <= 0 THEN
    RAISE EXCEPTION 'consignment_nothing_payable'
      USING ERRCODE = 'P0001',
            DETAIL = format('net %s across %s open rows', v_net, v_rows);
  END IF;

  INSERT INTO consignment_payouts (
    tenant_id, consignor_id, amount, payout_method, reference, paid_by
  ) VALUES (
    p_tenant_id, p_consignor_id, v_net, p_payout_method, p_reference,
    p_performed_by
  )
  RETURNING consignment_payouts.id, consignment_payouts.payout_number
       INTO v_payout_id, v_number;

  UPDATE consignment_payables
     SET status = 'paid', payout_id = v_payout_id
   WHERE consignor_id = p_consignor_id
     AND tenant_id = p_tenant_id
     AND status = 'open';

  RETURN QUERY SELECT v_payout_id, v_number, v_net, v_rows;
END;
$$;

REVOKE ALL ON FUNCTION consignment_pay_out(UUID, UUID, payment_method, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consignment_pay_out(UUID, UUID, payment_method, TEXT, UUID)
  TO service_role;

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE consignors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_payables  ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_payouts   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consignors_staff_read ON consignors;
CREATE POLICY consignors_staff_read ON consignors FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS consignors_staff_write ON consignors;
CREATE POLICY consignors_staff_write ON consignors FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Payables and payouts are READ-ONLY to staff sessions: every write comes
-- from a trigger or the payout RPC, both SECURITY DEFINER. No hand-edits.
DROP POLICY IF EXISTS consignment_payables_staff_read ON consignment_payables;
CREATE POLICY consignment_payables_staff_read ON consignment_payables FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS consignment_payouts_staff_read ON consignment_payouts;
CREATE POLICY consignment_payouts_staff_read ON consignment_payouts FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Tell PostgREST to pick up the new tables + columns + policies.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0054-consignment.sql
-- ============================================================================
