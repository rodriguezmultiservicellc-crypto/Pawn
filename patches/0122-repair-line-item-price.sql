-- 0122 — Each item on a repair ticket has its own price (Eddy, 2026-11-26:
-- "in the repair items there is no place to put the price of the repair").
--
-- The clerk prices each item at intake. When EVERY item of a new ticket has a
-- price, createRepairTicketAction sets the ticket's quote to their sum the way
-- "Set quote" does (quote_amount + quote_set event + status quoted). A ticket
-- with an item not priced yet is quoted later, as before.
--
-- New nullable column only. No policy is added or changed.

ALTER TABLE repair_ticket_line_items
  ADD COLUMN IF NOT EXISTS price NUMERIC(18,4)
    CHECK (price IS NULL OR price >= 0);

COMMENT ON COLUMN repair_ticket_line_items.price IS
  'What the shop charges for this item''s work, set at intake; NULL = not priced yet.';

NOTIFY pgrst, 'reload schema';
