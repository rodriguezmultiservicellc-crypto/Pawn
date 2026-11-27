-- 0128 — Repair labor rate (Eddy, 2026-11-27).
--
-- The shop's hourly cost of a technician's time. A repair ticket's
-- Profit / loss counts the timer's hours at this rate as labor.
-- NULL = not set: labor is left out of the P/L (the screen says so).
-- Money is numeric(18,4) (rule 11). No policy is touched: `settings` keeps
-- its existing RLS; the Settings → Repair action writes it with the admin
-- client after requireRoleInTenant (owner / chain_admin / manager).

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS repair_labor_rate NUMERIC(18,4)
    CHECK (repair_labor_rate IS NULL OR repair_labor_rate >= 0);

COMMENT ON COLUMN settings.repair_labor_rate IS
  'Hourly labor cost for repair P/L (timer hours x rate). NULL = not set.';
