-- ============================================================================
-- PAWN — RETAIL / POS MIGRATION (Phase 4)
-- File:    patches/0008-retail-pos.sql
-- Date:    2026-04-27
-- Purpose: Sales, sale items, sale payments, returns, return items, layaways,
--          layaway payments, and register sessions. Card-present payment
--          support via stripe_payment_intent_id columns (the actual reader
--          handshake ships in a follow-up agent).
--
-- Apply to: existing project AFTER 0001..0007 have run.
-- Append-only — never edit prior migrations.
--
-- Design notes:
--   - Money: numeric(18,4). Tax rate: numeric(6,4). Quantity: numeric(8,3).
--   - Per-tenant monotonic numbers via tenant_counters (from 0003):
--       sales.sale_number       -> 'S-' + LPAD(seq,6,'0')   counter 'sale'
--       returns.return_number   -> 'R-' + LPAD(seq,6,'0')   counter 'return'
--       layaways.layaway_number -> 'L-' + LPAD(seq,6,'0')   counter 'layaway'
--   - Sale completion lock: sales.is_locked flips TRUE when status moves to
--     'completed' / 'voided'. A BEFORE UPDATE trigger blocks edits to the
--     economic and customer-bound fields once is_locked = TRUE. Status
--     changes still permitted (so partial_returned / fully_returned / voided
--     transitions can land via the action layer).
--   - One register session per tenant open at a time (PARTIAL UNIQUE INDEX
--     on register_sessions(tenant_id) WHERE status='open' + a friendlier
--     trigger error).
--   - Card-present status flows: 'not_used' (cash/check), 'pending' (PI
--     created), 'succeeded' / 'failed' / 'refunded' as the webhook (or
--     manual TEST shortcut) reports back.
--   - All tables: tenant_id NOT NULL FK, created_at, updated_at, deleted_at.
--     Soft-delete via deleted_at — financial records never hard-delete.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  ENUMS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE sale_status AS ENUM (
    'open',                -- cart in progress, payments may still be added
    'completed',           -- locked; balance settled
    'voided',              -- cancelled — refunded if any payments
    'partial_returned',    -- one or more line items returned, some remain
    'fully_returned'       -- every line item fully returned
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sale_kind AS ENUM (
    'retail',              -- ordinary in-store sale
    'layaway'              -- layaway: items held until paid off
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE return_status AS ENUM (
    'issued',
    'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE layaway_status AS ENUM (
    'active',              -- payments in progress
    'completed',           -- balance paid in full; items released
    'cancelled',           -- customer or shop cancelled
    'defaulted'            -- past final due date, no recent activity
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE register_session_status AS ENUM (
    'open',
    'closed',
    'reconciled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE card_present_status AS ENUM (
    'not_used',            -- non-card payment
    'pending',             -- PaymentIntent created, awaiting reader
    'succeeded',
    'failed',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  REGISTER_SESSIONS — open / close / reconcile a cash drawer.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS register_sessions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  status                   register_session_status NOT NULL DEFAULT 'open',
  opened_by                UUID REFERENCES auth.users(id),
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_cash             NUMERIC(18,4) NOT NULL DEFAULT 0,

  closed_by                UUID REFERENCES auth.users(id),
  closed_at                TIMESTAMPTZ,
  -- Drawer cash counted at close.
  closing_cash_counted     NUMERIC(18,4),
  -- opening_cash + cash sales − cash refunds + adjustments. Filled at close.
  expected_cash            NUMERIC(18,4),
  -- counted − expected. Positive = over the expected, negative = short.
  cash_variance            NUMERIC(18,4),
  -- Card batch reconciliation total.
  card_batch_total         NUMERIC(18,4),

  notes                    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_register_sessions_tenant_status
  ON register_sessions(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_register_sessions_tenant_opened
  ON register_sessions(tenant_id, opened_at DESC)
  WHERE deleted_at IS NULL;

-- One open session per tenant (defense-in-depth alongside the trigger).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_register_sessions_one_open_per_tenant
  ON register_sessions(tenant_id)
  WHERE status = 'open' AND deleted_at IS NULL;

-- BEFORE INSERT: friendlier error than the unique-constraint violation.
CREATE OR REPLACE FUNCTION register_sessions_block_double_open()
RETURNS TRIGGER AS $$
DECLARE existing_id UUID;
BEGIN
  IF NEW.status = 'open' THEN
    SELECT id INTO existing_id
      FROM register_sessions
     WHERE tenant_id = NEW.tenant_id
       AND status = 'open'
       AND deleted_at IS NULL
     LIMIT 1;
    IF existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'register_sessions: a session is already open for tenant % (session %).', NEW.tenant_id, existing_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_register_sessions_block_double_open ON register_sessions;
CREATE TRIGGER trg_register_sessions_block_double_open
BEFORE INSERT ON register_sessions
FOR EACH ROW EXECUTE FUNCTION register_sessions_block_double_open();

DROP TRIGGER IF EXISTS trg_register_sessions_updated_at ON register_sessions;
CREATE TRIGGER trg_register_sessions_updated_at BEFORE UPDATE ON register_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  SALES
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  register_session_id      UUID REFERENCES register_sessions(id) ON DELETE SET NULL,

  -- Per-tenant monotonic 'S-' + 6-digit pad, assigned by trigger when blank.
  sale_number              TEXT,

  sale_kind                sale_kind NOT NULL DEFAULT 'retail',
  status                   sale_status NOT NULL DEFAULT 'open',

  -- NULL for anonymous walk-in retail. Layaway requires a customer (the app
  -- enforces this — schema just RESTRICTs the FK so the customer can't be
  -- deleted while sales reference them).
  customer_id              UUID REFERENCES customers(id) ON DELETE RESTRICT,

  -- Economics.
  subtotal                 NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax_amount               NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- Tax rate captured at time of sale (per-tenant default; stored explicit).
  tax_rate                 NUMERIC(6,4) NOT NULL DEFAULT 0,
  discount_amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- subtotal − discount + tax.
  total                    NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- Sum of sale_payments (positive amounts only).
  paid_total               NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- Sum of returns.total against this sale.
  returned_total           NUMERIC(18,4) NOT NULL DEFAULT 0,

  notes                    TEXT,

  -- Locks core fields once the sale completes or voids. The action layer
  -- still flips status to 'partial_returned' / 'fully_returned' for return
  -- accounting after lock — the trigger lets status changes through.
  is_locked                BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at             TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, sale_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_tenant_status_completed
  ON sales(tenant_id, status, completed_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tenant_created
  ON sales(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_customer
  ON sales(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_register_session
  ON sales(register_session_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_kind
  ON sales(tenant_id, sale_kind, status) WHERE deleted_at IS NULL;

-- BEFORE INSERT: assign sale_number when blank.
CREATE OR REPLACE FUNCTION sales_assign_sale_number()
RETURNS TRIGGER AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.sale_number IS NULL OR NEW.sale_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'sale');
    NEW.sale_number := 'S-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_sale_number ON sales;
CREATE TRIGGER trg_sales_sale_number
BEFORE INSERT ON sales
FOR EACH ROW EXECUTE FUNCTION sales_assign_sale_number();

-- BEFORE UPDATE: enforce post-completion / post-void lock on the economic
-- and customer-bound fields. Status changes still allowed (so the action
-- layer can flip to 'partial_returned' / 'fully_returned' / 'voided' after
-- the initial lock event).
CREATE OR REPLACE FUNCTION sales_enforce_lock()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_locked = TRUE THEN
    IF NEW.subtotal       IS DISTINCT FROM OLD.subtotal THEN
      RAISE EXCEPTION 'sales.subtotal is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
    IF NEW.tax_amount     IS DISTINCT FROM OLD.tax_amount THEN
      RAISE EXCEPTION 'sales.tax_amount is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
    IF NEW.total          IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'sales.total is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
    IF NEW.customer_id    IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'sales.customer_id is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
    IF NEW.completed_at   IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'sales.completed_at is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_lock ON sales;
CREATE TRIGGER trg_sales_lock
BEFORE UPDATE ON sales
FOR EACH ROW EXECUTE FUNCTION sales_enforce_lock();

DROP TRIGGER IF EXISTS trg_sales_updated_at ON sales;
CREATE TRIGGER trg_sales_updated_at BEFORE UPDATE ON sales
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  SALE_ITEMS — line items.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sale_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id             UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- NULL for non-inventory line items (custom service, generic product).
  inventory_item_id   UUID REFERENCES inventory_items(id) ON DELETE RESTRICT,

  description         TEXT NOT NULL,
  quantity            NUMERIC(8,3) NOT NULL DEFAULT 1,
  unit_price          NUMERIC(18,4) NOT NULL DEFAULT 0,
  line_discount       NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- (unit_price × quantity) − line_discount. Computed by app.
  line_total          NUMERIC(18,4) NOT NULL DEFAULT 0,
  position            INTEGER NOT NULL DEFAULT 0,
  -- Track partial returns against this line.
  returned_qty        NUMERIC(8,3) NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_position
  ON sale_items(sale_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sale_items_tenant
  ON sale_items(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sale_items_inventory
  ON sale_items(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_sale_items_updated_at ON sale_items;
CREATE TRIGGER trg_sale_items_updated_at BEFORE UPDATE ON sale_items
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  SALE_PAYMENTS
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sale_payments (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id                     UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  amount                      NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  payment_method              payment_method NOT NULL,

  -- Card-present plumbing. 'not_used' for non-card payments. Stripe Terminal
  -- writes succeeded/failed via webhook; cash/check stay 'not_used'.
  card_present_status         card_present_status NOT NULL DEFAULT 'not_used',
  stripe_payment_intent_id    TEXT,
  reader_id                   TEXT,

  notes                       TEXT,
  performed_by                UUID REFERENCES auth.users(id),
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale
  ON sale_payments(sale_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sale_payments_tenant
  ON sale_payments(tenant_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sale_payments_pi
  ON sale_payments(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_sale_payments_updated_at ON sale_payments;
CREATE TRIGGER trg_sale_payments_updated_at BEFORE UPDATE ON sale_payments
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  RETURNS
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS returns (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id             UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,

  return_number       TEXT,

  status              return_status NOT NULL DEFAULT 'issued',
  reason              TEXT,

  subtotal            NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
  total               NUMERIC(18,4) NOT NULL DEFAULT 0,
  refunded_total      NUMERIC(18,4) NOT NULL DEFAULT 0,
  refund_method       payment_method NOT NULL DEFAULT 'cash',
  refunded_at         TIMESTAMPTZ,

  performed_by        UUID REFERENCES auth.users(id),
  created_by          UUID REFERENCES auth.users(id),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  UNIQUE (tenant_id, return_number)
);

CREATE INDEX IF NOT EXISTS idx_returns_tenant_created
  ON returns(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_returns_sale
  ON returns(sale_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION returns_assign_return_number()
RETURNS TRIGGER AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.return_number IS NULL OR NEW.return_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'return');
    NEW.return_number := 'R-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_returns_return_number ON returns;
CREATE TRIGGER trg_returns_return_number
BEFORE INSERT ON returns
FOR EACH ROW EXECUTE FUNCTION returns_assign_return_number();

DROP TRIGGER IF EXISTS trg_returns_updated_at ON returns;
CREATE TRIGGER trg_returns_updated_at BEFORE UPDATE ON returns
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  RETURN_ITEMS
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS return_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id         UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_item_id      UUID NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,

  quantity          NUMERIC(8,3) NOT NULL CHECK (quantity > 0),
  unit_price        NUMERIC(18,4) NOT NULL,
  line_total        NUMERIC(18,4) NOT NULL,
  -- When TRUE the action flips the linked inventory item back to 'available'.
  restock           BOOLEAN NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_return_items_return
  ON return_items(return_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_return_items_tenant
  ON return_items(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_return_items_sale_item
  ON return_items(sale_item_id) WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  LAYAWAYS
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS layaways (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  sale_id                  UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  layaway_number           TEXT,

  customer_id              UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status                   layaway_status NOT NULL DEFAULT 'active',

  -- Copy of sales.total at creation. Frozen.
  total_due                NUMERIC(18,4) NOT NULL,
  paid_total               NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- total_due − paid_total. Recomputed by app on each layaway_payment write.
  balance_remaining        NUMERIC(18,4) NOT NULL,

  schedule_kind            TEXT NOT NULL CHECK (schedule_kind IN ('weekly','biweekly','monthly','custom')),
  down_payment             NUMERIC(18,4) NOT NULL DEFAULT 0,
  first_payment_due        DATE,
  final_due_date           DATE,
  -- Per-tenant policy default (decimal fraction; 0.10 = 10%).
  cancellation_fee_pct     NUMERIC(6,4) NOT NULL DEFAULT 0,

  cancelled_at             TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  notes                    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, layaway_number)
);

CREATE INDEX IF NOT EXISTS idx_layaways_tenant_status_due
  ON layaways(tenant_id, status, first_payment_due)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_layaways_tenant_created
  ON layaways(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_layaways_customer
  ON layaways(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_layaways_sale
  ON layaways(sale_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION layaways_assign_layaway_number()
RETURNS TRIGGER AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.layaway_number IS NULL OR NEW.layaway_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'layaway');
    NEW.layaway_number := 'L-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_layaways_layaway_number ON layaways;
CREATE TRIGGER trg_layaways_layaway_number
BEFORE INSERT ON layaways
FOR EACH ROW EXECUTE FUNCTION layaways_assign_layaway_number();

DROP TRIGGER IF EXISTS trg_layaways_updated_at ON layaways;
CREATE TRIGGER trg_layaways_updated_at BEFORE UPDATE ON layaways
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  LAYAWAY_PAYMENTS
-- ───────────────────────────────────────────────────────────────────────────
--
-- amount: positive for customer payments. Cancellation refunds are written
-- as a NEGATIVE amount (reversing entry; CHECK is permissive on this table
-- precisely so we can keep the audit trail).
CREATE TABLE IF NOT EXISTS layaway_payments (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  layaway_id                  UUID NOT NULL REFERENCES layaways(id) ON DELETE CASCADE,
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  amount                      NUMERIC(18,4) NOT NULL CHECK (amount <> 0),
  payment_method              payment_method NOT NULL,

  card_present_status         card_present_status NOT NULL DEFAULT 'not_used',
  stripe_payment_intent_id    TEXT,
  reader_id                   TEXT,

  notes                       TEXT,
  performed_by                UUID REFERENCES auth.users(id),
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_layaway_payments_layaway
  ON layaway_payments(layaway_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_layaway_payments_tenant
  ON layaway_payments(tenant_id, occurred_at DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_layaway_payments_updated_at ON layaway_payments;
CREATE TRIGGER trg_layaway_payments_updated_at BEFORE UPDATE ON layaway_payments
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE register_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE layaways            ENABLE ROW LEVEL SECURITY;
ALTER TABLE layaway_payments    ENABLE ROW LEVEL SECURITY;

-- ── register_sessions
DROP POLICY IF EXISTS register_sessions_staff_read ON register_sessions;
CREATE POLICY register_sessions_staff_read ON register_sessions FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS register_sessions_staff_write ON register_sessions;
CREATE POLICY register_sessions_staff_write ON register_sessions FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── sales
DROP POLICY IF EXISTS sales_staff_read ON sales;
CREATE POLICY sales_staff_read ON sales FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS sales_staff_write ON sales;
CREATE POLICY sales_staff_write ON sales FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── sale_items
DROP POLICY IF EXISTS sale_items_staff_read ON sale_items;
CREATE POLICY sale_items_staff_read ON sale_items FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS sale_items_staff_write ON sale_items;
CREATE POLICY sale_items_staff_write ON sale_items FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── sale_payments
DROP POLICY IF EXISTS sale_payments_staff_read ON sale_payments;
CREATE POLICY sale_payments_staff_read ON sale_payments FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS sale_payments_staff_write ON sale_payments;
CREATE POLICY sale_payments_staff_write ON sale_payments FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── returns
DROP POLICY IF EXISTS returns_staff_read ON returns;
CREATE POLICY returns_staff_read ON returns FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS returns_staff_write ON returns;
CREATE POLICY returns_staff_write ON returns FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── return_items
DROP POLICY IF EXISTS return_items_staff_read ON return_items;
CREATE POLICY return_items_staff_read ON return_items FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS return_items_staff_write ON return_items;
CREATE POLICY return_items_staff_write ON return_items FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── layaways
DROP POLICY IF EXISTS layaways_staff_read ON layaways;
CREATE POLICY layaways_staff_read ON layaways FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS layaways_staff_write ON layaways;
CREATE POLICY layaways_staff_write ON layaways FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── layaway_payments
DROP POLICY IF EXISTS layaway_payments_staff_read ON layaway_payments;
CREATE POLICY layaway_payments_staff_read ON layaway_payments FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS layaway_payments_staff_write ON layaway_payments;
CREATE POLICY layaway_payments_staff_write ON layaway_payments FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0008-retail-pos.sql
-- ============================================================================
