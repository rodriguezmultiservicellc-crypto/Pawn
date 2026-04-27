-- ============================================================================
-- PAWN — REPAIR TICKETS MIGRATION (Phase 3)
-- File:    patches/0007-repair-tickets.sql
-- Date:    2026-04-27
-- Purpose: Repair / stone-setting / sizing / restring / plating / engraving /
--          custom-work tickets with stones, parts, photos, time logs, and
--          full event timeline. Append-only — never edit prior migrations.
--
-- Apply to: existing project AFTER 0001 / 0002 / 0003 / 0004 / 0005 / 0006
-- have run.
--
-- Design notes:
--   - Single repair_tickets table differentiated by `service_type` enum.
--     No separate stone-setting / sizing / engraving table — all one module
--     per CLAUDE.md WHAT WE ARE BUILDING #2.
--   - ticket_number is per-tenant monotonic ('RT-' + 6-digit pad), assigned
--     by trigger via next_tenant_counter('repair_ticket') from 0003.
--   - Pickup-lock: once status flips to picked_up / abandoned / voided, the
--     is_locked flag is set TRUE and a BEFORE UPDATE trigger blocks edits
--     to the economic / customer-bound fields. Status transitions still
--     allowed (so an abandoned conversion can flip from ready to abandoned
--     even after a pickup lock — though canTransition() in the app layer
--     prevents that path).
--   - Workflow state machine lives in src/lib/repair/workflow.ts. The DB
--     enforces enum membership; the app enforces legal transitions before
--     issuing the UPDATE.
--   - Customer's item photos and pickup signatures live in a NEW private
--     bucket `repair-photos`, with the same tenant-folder RLS shape as
--     0003's customer-documents and inventory-photos buckets.
--   - Money: numeric(18,4). Stone size_mm: numeric(6,2). Stone weight_carats:
--     numeric(6,3). Time logs use TIMESTAMPTZ (no separate duration column —
--     compute (stopped_at - started_at) in queries).
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  ENUMS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE service_type AS ENUM (
    'repair',          -- generic repair (cleaning, soldering, prong rebuild, ...)
    'stone_setting',   -- mount a customer-supplied or shop-supplied stone
    'sizing',          -- ring sizing up or down
    'restring',        -- pearl restringing, beaded jewelry restring
    'plating',         -- rhodium plate, gold plate, etc.
    'engraving',
    'custom'           -- bespoke design / fabrication
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE repair_status AS ENUM (
    'intake',              -- received from customer, no quote yet
    'quoted',              -- staff has set a quote, awaiting customer review
    'awaiting_approval',   -- quote sent, waiting on customer signoff
    'in_progress',         -- approved + work has started
    'needs_parts',         -- paused waiting on a part / stone / material
    'ready',               -- work complete, customer can pick up
    'picked_up',           -- customer (or designee) collected the item; terminal
    'abandoned',           -- past the abandon window with no pickup; terminal
    'voided'               -- cancelled / mistaken intake; terminal
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE repair_event_type AS ENUM (
    'intake',                 -- ticket created
    'quote_set',              -- quote_amount written
    'approved',               -- customer approved the quote
    'started',                -- work started / resumed
    'paused',                 -- work paused (informational; no status change required)
    'resumed',                -- (informational)
    'parts_needed',           -- transition to needs_parts
    'parts_received',         -- transition back to in_progress
    'completed',              -- transition to ready
    'pickup',                 -- customer collected the item
    'abandoned_conversion',   -- abandoned -> inventory hook fired
    'void',
    'note',                   -- staff note (no state change)
    'photo_added'             -- attachment recorded in events for an at-a-glance audit feel
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE repair_photo_kind AS ENUM (
    'intake',         -- before-work photo
    'in_progress',    -- mid-work photo (e.g. a tricky stone position)
    'final',          -- finished work photo
    'reference'       -- customer-provided reference photo
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  REPAIR_TICKETS
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repair_tickets (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  customer_id             UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  -- Per-tenant monotonic 'RT-' + 6-digit pad. Trigger assigns when null.
  ticket_number           TEXT,

  -- Service classification (drives the form variants in the UI).
  service_type            service_type NOT NULL,

  -- Short summary + free-form description.
  title                   TEXT NOT NULL,
  description             TEXT,

  -- Customer's item — NOT inventory. Free-text snapshot at intake.
  item_description        TEXT NOT NULL,

  -- Quote / deposit / balance economics.
  quote_amount            NUMERIC(18,4),                      -- NULL until quoted
  quote_set_at            TIMESTAMPTZ,
  quote_approved_at       TIMESTAMPTZ,
  deposit_amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
  deposit_collected_at    TIMESTAMPTZ,
  -- Stored explicitly so it can be edited; stays NULL when no quote yet.
  balance_due             NUMERIC(18,4),
  -- Running total at pickup time.
  paid_amount             NUMERIC(18,4) NOT NULL DEFAULT 0,

  -- Promised pickup date.
  promised_date           DATE,

  -- Lifecycle timestamps.
  completed_at            TIMESTAMPTZ,
  picked_up_at            TIMESTAMPTZ,

  -- Pickup details. Could be the customer themselves or a designated person.
  pickup_by_name          TEXT,
  pickup_signature_path   TEXT,                               -- Storage path; signed URL on read.
  pickup_id_check         TEXT,                               -- description of ID checked at pickup.

  -- Technician (any user_tenants member; FK to auth.users so we can join to profiles).
  assigned_to             UUID REFERENCES auth.users(id),

  -- Workflow state.
  status                  repair_status NOT NULL DEFAULT 'intake',

  -- Inverse pointer when an abandoned ticket has been converted to an
  -- inventory item. For traceability — most tickets won't have it.
  source_inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,

  -- Set true on pickup or abandonment to lock core fields.
  is_locked               BOOLEAN NOT NULL DEFAULT FALSE,

  -- Staff-only notes — never shown on a customer ticket / portal.
  notes_internal          TEXT,

  -- Audit / soft-delete.
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,
  created_by              UUID REFERENCES auth.users(id),
  updated_by              UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_repair_tickets_tenant_status_due
  ON repair_tickets(tenant_id, status, promised_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_tickets_tenant_assigned
  ON repair_tickets(tenant_id, assigned_to, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_tickets_customer
  ON repair_tickets(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_tickets_tenant_created
  ON repair_tickets(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_tickets_source_inventory
  ON repair_tickets(source_inventory_item_id)
  WHERE source_inventory_item_id IS NOT NULL;

-- BEFORE INSERT: assign ticket_number when blank.
CREATE OR REPLACE FUNCTION repair_tickets_assign_ticket_number()
RETURNS TRIGGER AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'repair_ticket');
    NEW.ticket_number := 'RT-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repair_tickets_ticket_number ON repair_tickets;
CREATE TRIGGER trg_repair_tickets_ticket_number
BEFORE INSERT ON repair_tickets
FOR EACH ROW EXECUTE FUNCTION repair_tickets_assign_ticket_number();

-- BEFORE UPDATE: enforce post-pickup / abandonment lock. Once is_locked is
-- TRUE, the economic + customer-bound fields freeze. Status can still
-- transition (so an abandoned conversion can move ticket from ready→abandoned
-- even after locking elsewhere). Notes additions still allowed via separate
-- repair_ticket_events writes.
CREATE OR REPLACE FUNCTION repair_tickets_enforce_lock()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_locked = TRUE THEN
    IF NEW.customer_id        IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'repair_tickets.customer_id is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.service_type       IS DISTINCT FROM OLD.service_type THEN
      RAISE EXCEPTION 'repair_tickets.service_type is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.item_description   IS DISTINCT FROM OLD.item_description THEN
      RAISE EXCEPTION 'repair_tickets.item_description is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.quote_amount       IS DISTINCT FROM OLD.quote_amount THEN
      RAISE EXCEPTION 'repair_tickets.quote_amount is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.deposit_amount     IS DISTINCT FROM OLD.deposit_amount THEN
      RAISE EXCEPTION 'repair_tickets.deposit_amount is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.paid_amount        IS DISTINCT FROM OLD.paid_amount THEN
      RAISE EXCEPTION 'repair_tickets.paid_amount is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.picked_up_at       IS DISTINCT FROM OLD.picked_up_at THEN
      RAISE EXCEPTION 'repair_tickets.picked_up_at is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.pickup_by_name     IS DISTINCT FROM OLD.pickup_by_name THEN
      RAISE EXCEPTION 'repair_tickets.pickup_by_name is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repair_tickets_lock ON repair_tickets;
CREATE TRIGGER trg_repair_tickets_lock
BEFORE UPDATE ON repair_tickets
FOR EACH ROW EXECUTE FUNCTION repair_tickets_enforce_lock();

DROP TRIGGER IF EXISTS trg_repair_tickets_updated_at ON repair_tickets;
CREATE TRIGGER trg_repair_tickets_updated_at BEFORE UPDATE ON repair_tickets
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  REPAIR_TICKET_STONES — for stone-setting jobs.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repair_ticket_stones (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id             UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- 1-based for human-readable labels ("Stone 1", "Stone 2", …).
  stone_index           INTEGER NOT NULL,
  stone_type            TEXT NOT NULL,                -- 'diamond' | 'sapphire' | 'amethyst' | …
  shape                 TEXT,                          -- 'round' | 'oval' | 'princess' | …
  size_mm               NUMERIC(6,2),
  weight_carats         NUMERIC(6,3),
  color                 TEXT,
  clarity               TEXT,
  mounting_type         TEXT,                          -- 'prong' | 'bezel' | 'channel' | 'pavé' | …
  mounting_position     TEXT,                          -- 'center' | 'side' | 'halo' | …

  -- Drives whether the customer or the shop owns the stone.
  source                TEXT NOT NULL CHECK (source IN ('customer_supplied', 'shop_supplied')),
  -- Only set when source='shop_supplied' and the stone came from inventory;
  -- used for COGS at pickup.
  shop_inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_repair_stones_ticket
  ON repair_ticket_stones(ticket_id, stone_index)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_stones_tenant
  ON repair_ticket_stones(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_stones_inventory
  ON repair_ticket_stones(shop_inventory_item_id)
  WHERE shop_inventory_item_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  REPAIR_TICKET_ITEMS — parts / materials used. Links to inventory for COGS.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repair_ticket_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id           UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- NULL for non-inventory parts (purchased ad-hoc for this ticket).
  inventory_item_id   UUID REFERENCES inventory_items(id) ON DELETE SET NULL,

  description         TEXT NOT NULL,                       -- free-text fallback
  quantity            NUMERIC(8,3) NOT NULL DEFAULT 1,
  unit_cost           NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_cost          NUMERIC(18,4) NOT NULL DEFAULT 0,    -- denormalized; computed by app
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_repair_items_ticket
  ON repair_ticket_items(ticket_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_items_tenant
  ON repair_ticket_items(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_items_inventory
  ON repair_ticket_items(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  REPAIR_TICKET_EVENTS — append-only timeline.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repair_ticket_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id       UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  event_type      repair_event_type NOT NULL,
  notes           TEXT,
  amount          NUMERIC(18,4),                       -- quote_set / approved / pickup
  -- Mirrors the status the parent transitioned to as a result of this event.
  new_status      repair_status,

  performed_by    UUID REFERENCES auth.users(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_events_ticket
  ON repair_ticket_events(ticket_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_events_tenant
  ON repair_ticket_events(tenant_id, occurred_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
--  REPAIR_TICKET_PHOTOS — intake / in-progress / final / reference photos.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repair_ticket_photos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id     UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Storage path WITHIN the repair-photos bucket. Convention:
  -- '<tenant_id>/<ticket_id>/<kind>/<uuid>.<ext>'
  storage_path  TEXT NOT NULL,
  kind          repair_photo_kind NOT NULL,
  caption       TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  uploaded_by   UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_repair_photos_ticket
  ON repair_ticket_photos(ticket_id, position)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_photos_kind
  ON repair_ticket_photos(ticket_id, kind, position)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_photos_tenant
  ON repair_ticket_photos(tenant_id) WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  REPAIR_TIME_LOGS — technician timer sessions.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repair_time_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id     UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  technician_id UUID NOT NULL REFERENCES auth.users(id),
  started_at    TIMESTAMPTZ NOT NULL,
  -- NULL while the timer is running.
  stopped_at    TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_time_logs_ticket
  ON repair_time_logs(ticket_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_time_logs_technician
  ON repair_time_logs(technician_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_time_logs_tenant
  ON repair_time_logs(tenant_id, started_at DESC);

-- A technician may only have ONE running timer per ticket at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_repair_time_logs_running
  ON repair_time_logs(ticket_id, technician_id)
  WHERE stopped_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE repair_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_ticket_stones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_ticket_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_ticket_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_ticket_photos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_time_logs       ENABLE ROW LEVEL SECURITY;

-- ── repair_tickets
DROP POLICY IF EXISTS repair_tickets_staff_read ON repair_tickets;
CREATE POLICY repair_tickets_staff_read ON repair_tickets FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS repair_tickets_staff_write ON repair_tickets;
CREATE POLICY repair_tickets_staff_write ON repair_tickets FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── repair_ticket_stones
DROP POLICY IF EXISTS repair_stones_staff_read ON repair_ticket_stones;
CREATE POLICY repair_stones_staff_read ON repair_ticket_stones FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS repair_stones_staff_write ON repair_ticket_stones;
CREATE POLICY repair_stones_staff_write ON repair_ticket_stones FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── repair_ticket_items
DROP POLICY IF EXISTS repair_items_staff_read ON repair_ticket_items;
CREATE POLICY repair_items_staff_read ON repair_ticket_items FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS repair_items_staff_write ON repair_ticket_items;
CREATE POLICY repair_items_staff_write ON repair_ticket_items FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── repair_ticket_events
DROP POLICY IF EXISTS repair_events_staff_read ON repair_ticket_events;
CREATE POLICY repair_events_staff_read ON repair_ticket_events FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS repair_events_staff_write ON repair_ticket_events;
CREATE POLICY repair_events_staff_write ON repair_ticket_events FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── repair_ticket_photos
DROP POLICY IF EXISTS repair_photos_staff_read ON repair_ticket_photos;
CREATE POLICY repair_photos_staff_read ON repair_ticket_photos FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS repair_photos_staff_write ON repair_ticket_photos;
CREATE POLICY repair_photos_staff_write ON repair_ticket_photos FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── repair_time_logs
DROP POLICY IF EXISTS repair_time_logs_staff_read ON repair_time_logs;
CREATE POLICY repair_time_logs_staff_read ON repair_time_logs FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS repair_time_logs_staff_write ON repair_time_logs;
CREATE POLICY repair_time_logs_staff_write ON repair_time_logs FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ───────────────────────────────────────────────────────────────────────────
--  STORAGE BUCKET — repair-photos (private; signed URL only).
-- ───────────────────────────────────────────────────────────────────────────
-- Path convention (enforced at app layer, RLS verifies):
--   repair-photos/<tenant_id>/<ticket_id>/<kind>/<uuid>.<ext>
--   repair-photos/<tenant_id>/<ticket_id>/pickup/signature_<uuid>.<ext>

INSERT INTO storage.buckets (id, name, public)
VALUES ('repair-photos', 'repair-photos', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Staff-only read/write within accessible tenants. tenant_id MUST be folder[0].
DROP POLICY IF EXISTS repair_photos_storage_read ON storage.objects;
CREATE POLICY repair_photos_storage_read ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'repair-photos'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS repair_photos_storage_write ON storage.objects;
CREATE POLICY repair_photos_storage_write ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'repair-photos'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS repair_photos_storage_update ON storage.objects;
CREATE POLICY repair_photos_storage_update ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'repair-photos'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS repair_photos_storage_delete ON storage.objects;
CREATE POLICY repair_photos_storage_delete ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'repair-photos'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0007-repair-tickets.sql
-- ============================================================================
