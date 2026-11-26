-- 0120 — Nameplate is a repair-ticket service of its own (Eddy, 2026-11-26:
-- "nameplate is missing" from Repair · Stone setting · Sizing · …).
--
-- Only the enum value. A new enum value cannot be used in the transaction
-- that adds it, so the stages for it are seeded in 0121.
-- No table, column or policy changes.

ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'nameplate' AFTER 'engraving';

NOTIFY pgrst, 'reload schema';
