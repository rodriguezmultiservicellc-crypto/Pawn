-- ───────────────────────────────────────────────────────────────────────────
-- 0063 — Custom-piece quotes (brief Phase 2)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0062 (separate apply — this
--           file seeds templates of the enum value 0062 adds).
--           Append-only — never edit prior migrations.
--
-- A quote builder for custom work (nameplates, rings, chains made to
-- order): The piece → The price → The payment. Every price block is a
-- LINE with a cost (what the shop pays out) and a price (what the customer
-- pays); the quote's margin is (Σprice − Σcost) / Σprice. Saving freezes
-- the metal price used (spot per gram + when) so a quote does not drift
-- with the market; quotes expire after N days; an accepted quote becomes
-- a repair ticket (service_type 'custom') in one tap.
--
-- Money rules: numeric(18,4) everywhere; totals are recomputed by the app
-- from the lines and checked here with a CHECK on sign only — the trigger
-- below freezes every money column once the quote leaves draft/sent, so a
-- quote the customer accepted can never be edited in place (void + requote
-- instead, same spirit as rule 2 / rule 14).
--
-- Public read path: SECURITY DEFINER RPC custom_quote_public(token) —
-- customer-safe jsonb, never a cost, lines only when the shop enabled the
-- breakdown. Tenant resolves from the token (rule 8).
--
-- RLS mirrors repair_tickets (staff read/write in accessible tenants).
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Enums ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE custom_quote_status AS ENUM (
    'draft',      -- being built
    'sent',       -- shared with the customer (link / PDF / SMS)
    'accepted',   -- customer said yes — frozen, ready to convert
    'declined',   -- customer said no; terminal
    'expired',    -- past expires_on without acceptance; terminal
    'converted',  -- became a repair ticket; terminal
    'voided'      -- staff cancelled; terminal
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE custom_piece_category AS ENUM (
    'ring', 'earrings', 'chain', 'bracelet', 'pendant', 'nameplate', 'grillz', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE custom_quote_line_kind AS ENUM (
    'metal',    -- metal × grams at frozen spot
    'wax',      -- wax / 3D print, flat
    'labor',    -- hours × rate, or flat
    'stone',    -- stones (inventory or by hand), qty × cost
    'setting',  -- setting cost per stone
    'extra'     -- engraving, rush, packaging, shipping, other
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Settings ───────────────────────────────────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS custom_quote_default_margin_pct   NUMERIC(6,4) NOT NULL DEFAULT 0.5000
    CHECK (custom_quote_default_margin_pct >= 0 AND custom_quote_default_margin_pct <= 0.95),
  ADD COLUMN IF NOT EXISTS custom_quote_min_margin_pct       NUMERIC(6,4) NOT NULL DEFAULT 0.3000
    CHECK (custom_quote_min_margin_pct >= 0 AND custom_quote_min_margin_pct <= 0.95),
  ADD COLUMN IF NOT EXISTS custom_quote_default_deposit_pct  NUMERIC(6,4) NOT NULL DEFAULT 0.5000
    CHECK (custom_quote_default_deposit_pct >= 0 AND custom_quote_default_deposit_pct <= 1),
  ADD COLUMN IF NOT EXISTS custom_quote_expiry_days          INTEGER NOT NULL DEFAULT 14
    CHECK (custom_quote_expiry_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS custom_quote_labor_rate           NUMERIC(18,4) NOT NULL DEFAULT 75.0000
    CHECK (custom_quote_labor_rate >= 0),
  ADD COLUMN IF NOT EXISTS custom_quote_show_cost_breakdown  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN settings.custom_quote_default_margin_pct IS 'Fraction (0.5 = 50%). Pre-filled on a new quote.';
COMMENT ON COLUMN settings.custom_quote_min_margin_pct IS 'Fraction. Staff may lower a quote''s margin, never below this.';
COMMENT ON COLUMN settings.custom_quote_show_cost_breakdown IS 'When TRUE the customer PDF / public page list the price lines (never costs).';

-- ── 3. custom_quotes ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_quotes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id           UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  -- Per-tenant 'CQ-' + 6-digit pad, assigned by trigger.
  quote_number          TEXT,
  status                custom_quote_status NOT NULL DEFAULT 'draft',

  -- The piece
  category              custom_piece_category NOT NULL,
  description           TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  size                  TEXT,
  -- repair-photos bucket, '<tenant_id>/quotes/<quote_id>/reference/<uuid>.<ext>'
  reference_photo_path  TEXT,

  -- The price
  margin_pct            NUMERIC(6,4)  NOT NULL CHECK (margin_pct >= 0 AND margin_pct <= 0.95),
  cost_total            NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  price_total           NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (price_total >= 0),
  -- Frozen metal price: summary for "Priced at $X/g on <date>" (per-line
  -- detail lives in custom_quote_lines.details).
  spot_priced_at        TIMESTAMPTZ,
  spot_price_per_gram   NUMERIC(18,4),
  spot_metal_label      TEXT,

  -- The payment
  deposit_pct           NUMERIC(6,4)  NOT NULL DEFAULT 0 CHECK (deposit_pct >= 0 AND deposit_pct <= 1),
  deposit_amount        NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  balance_due           NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
  payment_method        payment_method,

  expires_on            DATE,
  sent_at               TIMESTAMPTZ,
  accepted_at           TIMESTAMPTZ,
  declined_at           TIMESTAMPTZ,
  converted_at          TIMESTAMPTZ,
  voided_at             TIMESTAMPTZ,
  repair_ticket_id      UUID REFERENCES repair_tickets(id) ON DELETE SET NULL,

  -- Public, read-only quote page: /q/<token>. NULL = revoked.
  public_token          TEXT,
  public_token_created_at TIMESTAMPTZ,

  notes_internal        TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  created_by            UUID REFERENCES auth.users(id),
  updated_by            UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, quote_number)
);

CREATE INDEX IF NOT EXISTS idx_custom_quotes_tenant_status
  ON custom_quotes (tenant_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_custom_quotes_customer
  ON custom_quotes (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_custom_quotes_ticket
  ON custom_quotes (repair_ticket_id) WHERE repair_ticket_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_quotes_public_token
  ON custom_quotes (public_token) WHERE public_token IS NOT NULL;

-- Number + token on insert.
CREATE OR REPLACE FUNCTION custom_quotes_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'custom_quote');
    NEW.quote_number := 'CQ-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  IF NEW.public_token IS NULL THEN
    NEW.public_token := repair_public_token();
    NEW.public_token_created_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_quotes_before_insert ON custom_quotes;
CREATE TRIGGER trg_custom_quotes_before_insert
BEFORE INSERT ON custom_quotes
FOR EACH ROW EXECUTE FUNCTION custom_quotes_before_insert();

-- Freeze: once a quote leaves draft/sent, the piece and every money column
-- are immutable. Status, timestamps, the ticket link, the public token and
-- internal notes may still change.
CREATE OR REPLACE FUNCTION custom_quotes_enforce_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status NOT IN ('draft', 'sent') THEN
    IF NEW.customer_id          IS DISTINCT FROM OLD.customer_id
    OR NEW.category             IS DISTINCT FROM OLD.category
    OR NEW.description          IS DISTINCT FROM OLD.description
    OR NEW.size                 IS DISTINCT FROM OLD.size
    OR NEW.margin_pct           IS DISTINCT FROM OLD.margin_pct
    OR NEW.cost_total           IS DISTINCT FROM OLD.cost_total
    OR NEW.price_total          IS DISTINCT FROM OLD.price_total
    OR NEW.spot_priced_at       IS DISTINCT FROM OLD.spot_priced_at
    OR NEW.spot_price_per_gram  IS DISTINCT FROM OLD.spot_price_per_gram
    OR NEW.spot_metal_label     IS DISTINCT FROM OLD.spot_metal_label
    OR NEW.deposit_pct          IS DISTINCT FROM OLD.deposit_pct
    OR NEW.deposit_amount       IS DISTINCT FROM OLD.deposit_amount
    OR NEW.balance_due          IS DISTINCT FROM OLD.balance_due
    OR NEW.payment_method       IS DISTINCT FROM OLD.payment_method
    OR NEW.expires_on           IS DISTINCT FROM OLD.expires_on THEN
      RAISE EXCEPTION 'custom_quote_locked: quote % is % and can no longer be edited — void it and write a new quote', OLD.quote_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_quotes_lock ON custom_quotes;
CREATE TRIGGER trg_custom_quotes_lock
BEFORE UPDATE ON custom_quotes
FOR EACH ROW EXECUTE FUNCTION custom_quotes_enforce_lock();

DROP TRIGGER IF EXISTS trg_custom_quotes_updated_at ON custom_quotes;
CREATE TRIGGER trg_custom_quotes_updated_at BEFORE UPDATE ON custom_quotes
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 4. custom_quote_lines ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_quote_lines (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id          UUID NOT NULL REFERENCES custom_quotes(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind              custom_quote_line_kind NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  label             TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  quantity          NUMERIC(12,4)  NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_cost         NUMERIC(18,4)  NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  unit_price        NUMERIC(18,4)  NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  cost_total        NUMERIC(18,4)  NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  price_total       NUMERIC(18,4)  NOT NULL DEFAULT 0 CHECK (price_total >= 0),
  -- TRUE = staff typed the price; the target-margin recompute leaves it alone.
  price_locked      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Kind-specific facts: metal {metal_type, karat, grams, spot_per_gram,
  -- spot_fetched_at, spot_source, weight_source}; labor {hours, rate, mode};
  -- stone {inventory_item_id, sku}; extra {extra_type}.
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_quote_lines_quote
  ON custom_quote_lines (quote_id, position);
CREATE INDEX IF NOT EXISTS idx_custom_quote_lines_tenant
  ON custom_quote_lines (tenant_id);

-- Lines follow the parent's freeze.
CREATE OR REPLACE FUNCTION custom_quote_lines_enforce_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status custom_quote_status;
  v_quote  UUID;
BEGIN
  v_quote := COALESCE(NEW.quote_id, OLD.quote_id);
  SELECT status INTO v_status FROM custom_quotes WHERE id = v_quote;
  -- Parent gone (cascade delete) → nothing to protect.
  IF v_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF v_status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'custom_quote_locked: lines of a % quote cannot change', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_quote_lines_lock ON custom_quote_lines;
CREATE TRIGGER trg_custom_quote_lines_lock
BEFORE INSERT OR UPDATE OR DELETE ON custom_quote_lines
FOR EACH ROW EXECUTE FUNCTION custom_quote_lines_enforce_lock();

-- ── 5. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE custom_quotes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_quote_lines  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_quotes_staff_read ON custom_quotes;
CREATE POLICY custom_quotes_staff_read ON custom_quotes FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS custom_quotes_staff_write ON custom_quotes;
CREATE POLICY custom_quotes_staff_write ON custom_quotes FOR ALL
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id))
  WITH CHECK (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS custom_quote_lines_staff_read ON custom_quote_lines;
CREATE POLICY custom_quote_lines_staff_read ON custom_quote_lines FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS custom_quote_lines_staff_write ON custom_quote_lines;
CREATE POLICY custom_quote_lines_staff_write ON custom_quote_lines FOR ALL
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id))
  WITH CHECK (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

-- ── 6. Public read: token → customer-safe document ────────────────────────
-- NEVER a cost. Lines only when the shop turned the breakdown on, and then
-- only label / kind / quantity / price. NULL for unknown or revoked token,
-- deleted or voided quote, inactive tenant.

CREATE OR REPLACE FUNCTION custom_quote_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  q         custom_quotes%ROWTYPE;
  v_tenant  RECORD;
  v_show    BOOLEAN;
  v_lines   JSONB;
  v_lang    TEXT;
  v_status  TEXT;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 32 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO q FROM custom_quotes
  WHERE public_token = p_token AND deleted_at IS NULL AND status <> 'voided';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT name, dba, logo_url, phone, public_slug, public_landing_enabled
  INTO v_tenant
  FROM tenants WHERE id = q.tenant_id AND is_active = TRUE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT custom_quote_show_cost_breakdown INTO v_show
  FROM settings WHERE tenant_id = q.tenant_id;

  IF COALESCE(v_show, FALSE) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'kind', l.kind, 'label', l.label, 'quantity', l.quantity,
             'price_total', l.price_total
           ) ORDER BY l.position), '[]'::jsonb)
    INTO v_lines
    FROM custom_quote_lines l WHERE l.quote_id = q.id;
  ELSE
    v_lines := '[]'::jsonb;
  END IF;

  SELECT language INTO v_lang FROM customers WHERE id = q.customer_id;

  -- A sent quote past its date reads as expired even before the sweep.
  v_status := q.status::text;
  IF q.status IN ('draft','sent') AND q.expires_on IS NOT NULL AND q.expires_on < CURRENT_DATE THEN
    v_status := 'expired';
  END IF;

  RETURN jsonb_build_object(
    'quote_number',        q.quote_number,
    'status',              v_status,
    'category',            q.category,
    'description',         q.description,
    'size',                q.size,
    'price_total',         q.price_total,
    'deposit_pct',         q.deposit_pct,
    'deposit_amount',      q.deposit_amount,
    'balance_due',         q.balance_due,
    'expires_on',          q.expires_on,
    'spot_priced_at',      q.spot_priced_at,
    'spot_price_per_gram', q.spot_price_per_gram,
    'spot_metal_label',    q.spot_metal_label,
    'created_at',          q.created_at,
    'accepted_at',         q.accepted_at,
    'lines',               v_lines,
    'photo_path',          q.reference_photo_path,
    'language',            COALESCE(v_lang, 'en'),
    'shop', jsonb_build_object(
        'name',        COALESCE(v_tenant.dba, v_tenant.name),
        'logo_url',    v_tenant.logo_url,
        'phone',       v_tenant.phone,
        'public_slug', CASE WHEN v_tenant.public_landing_enabled THEN v_tenant.public_slug ELSE NULL END)
  );
END;
$$;

REVOKE ALL ON FUNCTION custom_quote_public(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION custom_quote_public(TEXT) TO anon, authenticated, service_role;

-- ── 7. Templates for the quote link ───────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_custom_quote_templates(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nl CONSTANT TEXT := E'\n\n';
BEGIN
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, is_enabled) VALUES
    (p_tenant_id, 'custom_quote_link', 'en', 'sms',
     '{{shop_name}}: your quote {{quote_number}} for {{amount}} is ready. View it here: {{quote_link}}', TRUE),
    (p_tenant_id, 'custom_quote_link', 'es', 'sms',
     '{{shop_name}}: su cotización {{quote_number}} por {{amount}} está lista. Véala aquí: {{quote_link}}', TRUE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, subject, body, is_enabled) VALUES
    (p_tenant_id, 'custom_quote_link', 'en', 'email',
     'Your quote {{quote_number}} from {{shop_name}}',
     'Hi {{customer_first_name}},'||nl||'Your quote {{quote_number}} for {{amount}} is ready. You can view it here: {{quote_link}}'||nl||'— {{shop_name}}', TRUE),
    (p_tenant_id, 'custom_quote_link', 'es', 'email',
     'Su cotización {{quote_number}} de {{shop_name}}',
     'Hola {{customer_first_name}},'||nl||'Su cotización {{quote_number}} por {{amount}} está lista. Puede verla aquí: {{quote_link}}'||nl||'— {{shop_name}}', TRUE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, body, whatsapp_content_sid, is_enabled) VALUES
    (p_tenant_id, 'custom_quote_link', 'en', 'whatsapp',
     '{{shop_name}}: your quote {{quote_number}} for {{amount}} is ready. View it here: {{quote_link}}', NULL, FALSE),
    (p_tenant_id, 'custom_quote_link', 'es', 'whatsapp',
     '{{shop_name}}: su cotización {{quote_number}} por {{amount}} está lista. Véala aquí: {{quote_link}}', NULL, FALSE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION seed_custom_quote_templates(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_custom_quote_templates(UUID) TO service_role;

CREATE OR REPLACE FUNCTION tenant_after_insert_seed_custom_quotes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM seed_custom_quote_templates(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_after_insert_seed_custom_quotes ON tenants;
CREATE TRIGGER trg_tenant_after_insert_seed_custom_quotes
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION tenant_after_insert_seed_custom_quotes();

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM tenants LOOP
    PERFORM seed_custom_quote_templates(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
