-- ============================================================================
-- PAWN — INVENTORY TRANSFER METADATA + MULTI-ITEM SUPPORT
-- File:    patches/0006-transfer-metadata.sql
-- Date:    2026-04-27
-- Purpose: Extend the inventory_transfers row shipped in 0003 to support a
--          request → accept/reject/cancel workflow with full audit metadata,
--          and a multi-item transfer model via a new child table.
--
-- Apply to: existing project AFTER 0001 / 0002 / 0003 / 0004 / 0005 have run.
-- Append-only — never edit prior migrations.
--
-- Design notes:
--   - The original inventory_transfers row was shipped with a single
--     item_id column and a status enum tuned to a "ship → received"
--     model. The actual workflow we ship in the UI is a request that the
--     destination shop must explicitly accept or reject (and the origin
--     can cancel before either side moves). This migration extends both.
--   - transfer_status enum gains 'accepted' and 'rejected' values. The
--     legacy 'in_transit' / 'received' values stay (additive enum changes
--     are non-breaking) but are unused by the v1 UI.
--   - inventory_transfers.item_id becomes nullable so multi-item transfers
--     can use the new child table exclusively. Single-item legacy rows
--     keep working (the UI still inserts the new child rows, but old data
--     doesn't break).
--   - Acceptance moves items between sibling tenants. The cross-chain
--     trigger from 0003 already prevents picking a destination outside the
--     shared chain. RLS on inventory_items would block a user-scoped client
--     from rewriting tenant_id mid-flight; the app layer uses the admin
--     client (after a guard) to perform that write. Documented in the
--     server action.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  ENUM EXTENSION
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TYPE transfer_status ADD VALUE IF NOT EXISTS 'accepted';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE transfer_status ADD VALUE IF NOT EXISTS 'rejected';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  inventory_transfers — workflow metadata columns
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE inventory_transfers
  ADD COLUMN IF NOT EXISTS requested_by      UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS accepted_by       UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS accepted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by       UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason  TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by      UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ;

-- Make the legacy single-item column nullable so multi-item transfers
-- (driven by inventory_transfer_items below) can leave it null.
ALTER TABLE inventory_transfers
  ALTER COLUMN item_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_requested_at
  ON inventory_transfers(tenant_id, requested_at DESC)
  WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  inventory_transfer_items — child table for the items in a transfer
-- ───────────────────────────────────────────────────────────────────────────
-- One row per item moved in a transfer. tenant_id is the OWNER side at
-- request time (== inventory_transfers.from_tenant_id). The child rows are
-- the source of truth for which items are in the transfer; the parent
-- row's legacy item_id is left NULL by the multi-item flow.

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transfer_id         UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  inventory_item_id   UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  -- Snapshot of basic identifying fields at request time. If the item is
  -- later edited, the historical record on the transfer remains correct.
  sku_snapshot        TEXT,
  description_snapshot TEXT,
  est_value           NUMERIC(18,4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transfer_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer
  ON inventory_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_item
  ON inventory_transfer_items(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_tenant
  ON inventory_transfer_items(tenant_id);

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────
-- Both ends of the transfer can see the item rows (mirrors the dual-
-- readable policy on inventory_transfers itself). Writes only allowed
-- from the origin side; acceptance side mutations on parent rows go
-- through the admin client + app-layer staff check.

ALTER TABLE inventory_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transfer_items_read ON inventory_transfer_items;
CREATE POLICY transfer_items_read ON inventory_transfer_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM inventory_transfers it
      WHERE it.id = inventory_transfer_items.transfer_id
      AND (
        (
          it.from_tenant_id IN (SELECT my_accessible_tenant_ids())
          AND my_is_staff(it.from_tenant_id)
        )
        OR
        (
          it.to_tenant_id IN (SELECT my_accessible_tenant_ids())
          AND my_is_staff(it.to_tenant_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS transfer_items_origin_write ON inventory_transfer_items;
CREATE POLICY transfer_items_origin_write ON inventory_transfer_items FOR ALL
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
-- END 0006-transfer-metadata.sql
-- ============================================================================
