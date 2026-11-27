-- 0131 — Voiding a repair ticket puts its inventory parts back in stock
-- (Eddy, 2026-11-27: "yes return parts to stock on void").
--
-- When a ticket becomes 'voided', every live part taken from inventory is
-- soft-deleted; 0130's trigger on repair_ticket_items then moves each item
-- 'used_in_repair' → 'available'. Free-text parts (no inventory_item_id)
-- stay on the voided ticket as they were. No RLS policy is touched.

CREATE OR REPLACE FUNCTION repair_void_returns_parts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'voided' AND OLD.status IS DISTINCT FROM 'voided' THEN
    UPDATE repair_ticket_items
       SET deleted_at = NOW()
     WHERE ticket_id = NEW.id
       AND tenant_id = NEW.tenant_id
       AND inventory_item_id IS NOT NULL
       AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION repair_void_returns_parts() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_repair_void_returns_parts ON repair_tickets;
CREATE TRIGGER trg_repair_void_returns_parts
AFTER UPDATE OF status ON repair_tickets
FOR EACH ROW EXECUTE FUNCTION repair_void_returns_parts();

-- Tickets voided before this patch: return their inventory parts now.
UPDATE repair_ticket_items p
   SET deleted_at = NOW()
  FROM repair_tickets t
 WHERE t.id = p.ticket_id
   AND t.status = 'voided'
   AND p.inventory_item_id IS NOT NULL
   AND p.deleted_at IS NULL;
