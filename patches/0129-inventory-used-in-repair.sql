-- 0129 — Inventory status 'used_in_repair' (Eddy, 2026-11-27).
--
-- An inventory item put on a repair ticket as a part is no longer stock:
-- it cannot be sold or used on another ticket. 0130 moves items in and out
-- of this status. Its own file: a new enum value cannot be used in the
-- transaction that adds it.

ALTER TYPE inventory_status ADD VALUE IF NOT EXISTS 'used_in_repair';
