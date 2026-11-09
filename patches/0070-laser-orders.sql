-- ───────────────────────────────────────────────────────────────────────────
-- 0070 — Laser nameplate orders (Sol Pawn → orocut.com → OroCut)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0069.
--           Append-only — never edit prior migrations.
--
-- A repair ticket (a nameplate written up at the counter, usually born from
-- a custom quote with category 'nameplate') gets a "Send to laser" button.
-- The clerk fills in the exact text / style / metal and the app POSTs the
-- order to orocut.com; every OroCut activated on the shop's licence key
-- sees it, the operator makes it, and the status comes back (webhook or
-- poll): new → received → cut → done, or rejected (with a reason), or
-- cancelled by the shop while not done.
--
-- One row per order SENT (a row exists only once orocut.com answered with
-- an order_id). A ticket may have several orders over time (a recut after
-- a reject), but at most ONE open order at a time — partial unique index.
-- The payload that was sent is kept on the row verbatim so the panel and
-- the audit trail show exactly what the laser PC saw.
--
-- The orocut.com order token is a secret: it lives in the tenant vault
-- (kind 'orocut_order_token', patches/0033 RPCs), never in a column and
-- never in the browser. The shop's OroCut style names (typed by hand for
-- now) are plain settings.
--
-- RLS mirrors repair_tickets: staff read/write in accessible tenants. The
-- webhook and the cron write through the service role.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Enum ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE laser_order_status AS ENUM (
    'new',        -- accepted by orocut.com, no OroCut has listed it yet
    'received',   -- an OroCut on the shop's key has listed it
    'cut',        -- a send of it finished on a real laser (may repeat)
    'done',       -- the operator pressed Done; terminal
    'rejected',   -- the operator rejected it (reason); terminal
    'cancelled'   -- Sol Pawn cancelled it while not done; terminal
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Settings: the shop's OroCut style names ────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS orocut_style_names TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN settings.orocut_style_names IS
  'OroCut nameplate style names offered in the Send-to-laser form (typed by hand; an export from OroCut later). The order token itself is in the vault (kind orocut_order_token).';

-- ── 3. laser_orders ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS laser_orders (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_ticket_id   UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE RESTRICT,

  -- What orocut.com knows us by.
  external_id        TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
  orocut_order_id    TEXT NOT NULL CHECK (length(orocut_order_id) BETWEEN 1 AND 128),
  status             laser_order_status NOT NULL DEFAULT 'new',

  -- The order as sent (spec "The order").
  text               TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 60),
  text2              TEXT CHECK (text2 IS NULL OR length(text2) <= 60),
  style              TEXT CHECK (style IS NULL OR length(style) <= 80),
  quantity           INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 50),
  metal              TEXT CHECK (metal IS NULL OR length(metal) <= 40),
  thickness_mm       NUMERIC(6,3) CHECK (thickness_mm IS NULL OR (thickness_mm >= 0.1 AND thickness_mm <= 5)),
  chain_length_in    NUMERIC(6,2) CHECK (chain_length_in IS NULL OR (chain_length_in >= 6 AND chain_length_in <= 36)),
  height_mm          NUMERIC(6,2) CHECK (height_mm IS NULL OR (height_mm >= 2 AND height_mm <= 60)),
  customer_name      TEXT CHECK (customer_name IS NULL OR length(customer_name) <= 80),
  due_at             TIMESTAMPTZ,
  notes              TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  picture_url        TEXT CHECK (picture_url IS NULL OR length(picture_url) <= 2048),

  -- What came back.
  reject_reason      TEXT,
  -- Last 'cut' details from OroCut: {width_mm, height_mm, minutes, passes}.
  cut_details        JSONB,
  cut_count          INTEGER NOT NULL DEFAULT 0 CHECK (cut_count >= 0),
  -- Every status change we saw: [{status, at, by, reason?, via}], oldest first.
  status_history     JSONB NOT NULL DEFAULT '[]'::jsonb,
  remote_updated_at  TIMESTAMPTZ,
  last_synced_at     TIMESTAMPTZ,
  last_sync_error    TEXT,

  sent_by            UUID REFERENCES auth.users(id),
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at        TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

-- orocut.com ids are global — the webhook resolves the tenant from one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_laser_orders_orocut_order_id
  ON laser_orders (orocut_order_id);

-- One OPEN order per ticket at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_laser_orders_open_per_ticket
  ON laser_orders (repair_ticket_id)
  WHERE status IN ('new', 'received', 'cut') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_laser_orders_tenant_status
  ON laser_orders (tenant_id, status, sent_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_laser_orders_ticket
  ON laser_orders (repair_ticket_id, sent_at DESC) WHERE deleted_at IS NULL;
-- The poller: open orders, oldest sync first.
CREATE INDEX IF NOT EXISTS idx_laser_orders_open_sync
  ON laser_orders (last_synced_at NULLS FIRST)
  WHERE status IN ('new', 'received', 'cut') AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_laser_orders_updated_at ON laser_orders;
CREATE TRIGGER trg_laser_orders_updated_at BEFORE UPDATE ON laser_orders
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- The order as sent is immutable (what the laser PC saw is what we show).
-- Only the status side of the row may change after insert.
CREATE OR REPLACE FUNCTION laser_orders_enforce_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id        IS DISTINCT FROM OLD.tenant_id
  OR NEW.repair_ticket_id IS DISTINCT FROM OLD.repair_ticket_id
  OR NEW.external_id      IS DISTINCT FROM OLD.external_id
  OR NEW.orocut_order_id  IS DISTINCT FROM OLD.orocut_order_id
  OR NEW.text             IS DISTINCT FROM OLD.text
  OR NEW.text2            IS DISTINCT FROM OLD.text2
  OR NEW.style            IS DISTINCT FROM OLD.style
  OR NEW.quantity         IS DISTINCT FROM OLD.quantity
  OR NEW.metal            IS DISTINCT FROM OLD.metal
  OR NEW.thickness_mm     IS DISTINCT FROM OLD.thickness_mm
  OR NEW.chain_length_in  IS DISTINCT FROM OLD.chain_length_in
  OR NEW.height_mm        IS DISTINCT FROM OLD.height_mm
  OR NEW.customer_name    IS DISTINCT FROM OLD.customer_name
  OR NEW.due_at           IS DISTINCT FROM OLD.due_at
  OR NEW.notes            IS DISTINCT FROM OLD.notes
  OR NEW.picture_url      IS DISTINCT FROM OLD.picture_url
  OR NEW.sent_by          IS DISTINCT FROM OLD.sent_by
  OR NEW.sent_at          IS DISTINCT FROM OLD.sent_at THEN
    RAISE EXCEPTION 'laser_order_locked: the order as sent cannot be edited — cancel it and send a new one';
  END IF;
  -- Terminal states never move again.
  IF OLD.status IN ('done', 'rejected', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'laser_order_terminal: order % is % and cannot change status', OLD.external_id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_laser_orders_lock ON laser_orders;
CREATE TRIGGER trg_laser_orders_lock
BEFORE UPDATE ON laser_orders
FOR EACH ROW EXECUTE FUNCTION laser_orders_enforce_lock();

-- ── 4. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE laser_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS laser_orders_staff_read ON laser_orders;
CREATE POLICY laser_orders_staff_read ON laser_orders FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS laser_orders_staff_write ON laser_orders;
CREATE POLICY laser_orders_staff_write ON laser_orders FOR ALL
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id))
  WITH CHECK (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

NOTIFY pgrst, 'reload schema';
