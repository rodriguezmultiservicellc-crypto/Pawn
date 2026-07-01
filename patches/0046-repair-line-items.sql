-- ============================================================================
-- PAWN — REPAIR TICKET LINE ITEMS (multi-item intake)
-- File:    patches/0046-repair-line-items.sql
-- Date:    2026-06-30
-- Purpose: A repair ticket now holds MULTIPLE customer items, each with its own
--          composed title (item-type + karat + weight + dimension), its own
--          service_type, and its own work-needed line. Replaces the previous
--          single title / item_description / description triple in the intake
--          UI. The parent repair_tickets.title / item_description / service_type
--          columns are KEPT and auto-derived from the line items by the create
--          action, so every existing reader (list, board, detail, portal,
--          dashboard feed, audit) keeps working unchanged.
--
-- Apply to: existing project AFTER 0007-repair-tickets.sql.
--
-- Design notes:
--   - Structured attribute columns (item_type, karat, weight_grams, dimension)
--     are stored ALONGSIDE the composed `title` so a future PDF / catalog can
--     reformat without re-parsing a string. weight_grams is numeric(10,4) per
--     the CLAUDE.md metal-weight rule.
--   - service_type is per line item (a ticket can mix e.g. a solder + a sizing).
--     The ticket-level repair_tickets.service_type stays as a representative
--     (the create action writes the first item's service_type there) so the
--     ticket-scoped workflow / kanban / quote surfaces are unaffected.
--   - Lock immutability (CLAUDE.md rule #14): once the parent ticket locks
--     (pickup / abandon / void → repair_tickets.is_locked = TRUE), line items
--     freeze — a BEFORE UPDATE/DELETE trigger blocks edits. INSERT stays open
--     (matches repair_ticket_stones, which are also not INSERT-locked).
--   - Backfill: every existing non-deleted ticket gets ONE line item derived
--     from its current title / item_description / service_type so the detail
--     page renders legacy tickets through the same line-item path. Idempotent
--     via NOT EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS repair_ticket_line_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id     UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- 1-based ordering for human-readable labels ("Item 1", "Item 2", …).
  line_index    INTEGER NOT NULL,

  -- Structured attributes captured by the intake title-builder chips.
  item_type     TEXT NOT NULL,            -- 'ring' | 'necklace' | 'bracelet' | … | 'other'
  karat         TEXT,                      -- '10k' | '14k' | '18k' | '925' | … (nullable)
  weight_grams  NUMERIC(10,4),             -- nullable
  dimension     TEXT,                      -- '18"' | 'sz 7' | … (nullable)

  -- Composed display title, e.g. 'Necklace · 14k · 2.8g · 18"'.
  title         TEXT NOT NULL,

  -- Per-item service classification + the work the tech must perform.
  service_type  service_type NOT NULL,
  work_needed   TEXT,                      -- 'solder by clasp' (nullable)

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_repair_line_items_ticket
  ON repair_ticket_line_items(ticket_id, line_index)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_line_items_tenant
  ON repair_ticket_line_items(tenant_id) WHERE deleted_at IS NULL;

-- BEFORE UPDATE/DELETE: freeze line items once the parent ticket is locked.
CREATE OR REPLACE FUNCTION repair_line_items_enforce_lock()
RETURNS TRIGGER AS $$
DECLARE v_locked BOOLEAN;
BEGIN
  SELECT is_locked INTO v_locked
    FROM repair_tickets
    WHERE id = COALESCE(NEW.ticket_id, OLD.ticket_id);
  IF v_locked = TRUE THEN
    RAISE EXCEPTION
      'repair_ticket_line_items are immutable after the ticket is locked (ticket %).',
      COALESCE(NEW.ticket_id, OLD.ticket_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repair_line_items_lock ON repair_ticket_line_items;
CREATE TRIGGER trg_repair_line_items_lock
BEFORE UPDATE OR DELETE ON repair_ticket_line_items
FOR EACH ROW EXECUTE FUNCTION repair_line_items_enforce_lock();

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY — staff read/write within accessible tenants.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE repair_ticket_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repair_line_items_staff_read ON repair_ticket_line_items;
CREATE POLICY repair_line_items_staff_read ON repair_ticket_line_items FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS repair_line_items_staff_write ON repair_ticket_line_items;
CREATE POLICY repair_line_items_staff_write ON repair_ticket_line_items FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ───────────────────────────────────────────────────────────────────────────
--  BACKFILL — one line item per existing non-deleted ticket. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO repair_ticket_line_items
  (ticket_id, tenant_id, line_index, item_type, title, service_type, work_needed)
SELECT
  rt.id,
  rt.tenant_id,
  1,
  'other',
  LEFT(rt.title, 200),
  rt.service_type,
  NULLIF(TRIM(COALESCE(rt.description, '')), '')
FROM repair_tickets rt
WHERE rt.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM repair_ticket_line_items li WHERE li.ticket_id = rt.id
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS trg_repair_line_items_lock ON repair_ticket_line_items;
--   DROP FUNCTION IF EXISTS repair_line_items_enforce_lock();
--   DROP TABLE IF EXISTS repair_ticket_line_items;
-- END 0046-repair-line-items.sql
-- ============================================================================
