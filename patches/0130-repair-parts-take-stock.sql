-- 0130 — A repair part from inventory takes the item out of stock
-- (Eddy, 2026-11-27: "yes take it out of stock").
--
-- The database owns it, like other money / stock moves (rule 19):
--   * INSERT of a repair_ticket_items row with inventory_item_id: the item
--     is locked, must be this tenant's, not deleted and 'available'
--     (else 'inventory_item_not_available'), and becomes 'used_in_repair'.
--   * The part soft-deleted (Remove): the item goes back to 'available' —
--     only if it is still 'used_in_repair' (a part pointing at an item that
--     was sold before 0130 never puts it back on the shelf).
--   * A part's inventory_item_id never changes after insert.
--   * Nothing else may move an item into or out of 'used_in_repair' (the
--     inventory edit form, a sale, a transfer): the guard refuses unless the
--     move comes from these triggers (transaction-local flag).
-- No RLS policy is touched.

-- ── Guard on inventory_items ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory_used_in_repair_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- An item is never created already used: only a part puts it there.
    IF NEW.status = 'used_in_repair' THEN
      RAISE EXCEPTION 'inventory_used_in_repair' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status = 'used_in_repair' OR NEW.status = 'used_in_repair')
     AND current_setting('app.repair_part_stock', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'inventory_used_in_repair'
      USING ERRCODE = 'P0001',
            DETAIL = 'Only adding / removing a repair part moves an item into or out of used_in_repair.';
  END IF;
  -- A used item cannot be deleted while a part still points at it.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
     AND OLD.status = 'used_in_repair' THEN
    RAISE EXCEPTION 'inventory_used_in_repair' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_used_in_repair_guard ON inventory_items;
CREATE TRIGGER trg_inventory_used_in_repair_guard
BEFORE INSERT OR UPDATE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION inventory_used_in_repair_guard();

-- ── Parts: take / give back ────────────────────────────────────────────────
-- SECURITY DEFINER: repair staff (repair_tech) add parts but have no write
-- on inventory_items. The function only ever touches the one item the part
-- names, inside the part's own tenant.
CREATE OR REPLACE FUNCTION repair_part_take_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status inventory_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.inventory_item_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    SELECT status INTO v_status
      FROM inventory_items
     WHERE id = NEW.inventory_item_id
       AND tenant_id = NEW.tenant_id
       AND deleted_at IS NULL
       FOR UPDATE;
    IF v_status IS DISTINCT FROM 'available' THEN
      RAISE EXCEPTION 'inventory_item_not_available' USING ERRCODE = 'P0001';
    END IF;
    PERFORM set_config('app.repair_part_stock', 'on', true);
    UPDATE inventory_items
       SET status = 'used_in_repair', updated_at = NOW()
     WHERE id = NEW.inventory_item_id;
    PERFORM set_config('app.repair_part_stock', 'off', true);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.inventory_item_id IS DISTINCT FROM OLD.inventory_item_id THEN
    RAISE EXCEPTION 'repair_part_item_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND NEW.inventory_item_id IS NOT NULL THEN
    PERFORM set_config('app.repair_part_stock', 'on', true);
    UPDATE inventory_items
       SET status = 'available', updated_at = NOW()
     WHERE id = NEW.inventory_item_id
       AND tenant_id = NEW.tenant_id
       AND status = 'used_in_repair';
    PERFORM set_config('app.repair_part_stock', 'off', true);
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'repair_part_undelete' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION repair_part_take_stock() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_repair_part_take_stock ON repair_ticket_items;
CREATE TRIGGER trg_repair_part_take_stock
BEFORE INSERT OR UPDATE ON repair_ticket_items
FOR EACH ROW EXECUTE FUNCTION repair_part_take_stock();

-- ── Backfill: items already on a live part and still 'available' ──────────
DO $$
BEGIN
  PERFORM set_config('app.repair_part_stock', 'on', true);
  UPDATE inventory_items i
     SET status = 'used_in_repair', updated_at = NOW()
   WHERE i.status = 'available'
     AND i.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM repair_ticket_items p
        WHERE p.inventory_item_id = i.id
          AND p.tenant_id = i.tenant_id
          AND p.deleted_at IS NULL
     );
  PERFORM set_config('app.repair_part_stock', 'off', true);
END $$;
