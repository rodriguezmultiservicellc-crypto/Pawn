-- ───────────────────────────────────────────────────────────────────────────
-- 0083 — Dashboard live-metals display percent
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0082.
--
-- The dashboard "Live metals" strip shows spot per troy ounce. A shop can
-- show it scaled (e.g. 90% of spot) — DISPLAY ONLY. Buy / sell / melt math
-- keeps using spot_price_overrides; nothing reads this column but the
-- dashboard.
--
-- Stored as a fraction like every other rate here (0.9 = 90%).
-- RLS: no policy added or changed (settings already: owner write).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS dashboard_spot_display_pct numeric(6,4) NOT NULL DEFAULT 1.0000;

ALTER TABLE public.settings
  DROP CONSTRAINT IF EXISTS settings_dashboard_spot_display_pct_range;
ALTER TABLE public.settings
  ADD CONSTRAINT settings_dashboard_spot_display_pct_range
  CHECK (dashboard_spot_display_pct > 0 AND dashboard_spot_display_pct <= 2);

COMMENT ON COLUMN public.settings.dashboard_spot_display_pct IS
  'Dashboard live-metals strip shows spot × this fraction (1 = spot). Display only.';
