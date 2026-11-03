-- ───────────────────────────────────────────────────────────────────────────
-- 0058 — Spot-price fetch log
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0057 has been considered.
--           Append-only — never edit prior migrations.
--
-- Why: the spot feed silently stopped on 2026-04-30 (Stooq's CSV endpoint
-- began returning 404) and nobody could tell from the app — the cron
-- never ran (CRON_SECRET unset → 401 before any logging) and the manual
-- button only echoed a one-line error. Every refresh attempt, cron or
-- manual, success or failure, now lands here with the per-provider trail
-- so the Spot Prices page can show the history.
--
-- Platform-wide data (no tenant owns a spot price). tenant_id / triggered_by
-- only attribute WHO pressed "Refresh now"; cron rows leave both NULL.
--
-- Writes: service-role only (cron route + server action). No INSERT /
-- UPDATE / DELETE policy is exposed through RLS, same as spot_prices.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spot_price_fetches (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- 'cron' = /api/cron/refresh-spot-prices, 'manual' = "Refresh now".
  trigger       TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  triggered_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ NOT NULL,
  ok            BOOLEAN NOT NULL,
  -- Provider that supplied the quotes ('gold-api' | 'yahoo-futures' | 'stooq'),
  -- NULL when every provider failed.
  source        TEXT,
  -- Pure-metal quotes obtained (0-4), per-purity rows attempted / inserted.
  quotes        INTEGER NOT NULL DEFAULT 0 CHECK (quotes >= 0),
  attempted     INTEGER NOT NULL DEFAULT 0 CHECK (attempted >= 0),
  inserted      INTEGER NOT NULL DEFAULT 0 CHECK (inserted >= 0),
  error         TEXT,
  -- [{source, ok, quotes, ms, error}] — one entry per provider tried, in order.
  attempts      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spot_price_fetches_started
  ON spot_price_fetches (started_at DESC);

ALTER TABLE spot_price_fetches ENABLE ROW LEVEL SECURITY;

-- Mirrors spot_prices_read_all (0013): the feed is global, any signed-in
-- user may read its history. No write policy — service role only.
DROP POLICY IF EXISTS spot_price_fetches_read_all ON spot_price_fetches;
CREATE POLICY spot_price_fetches_read_all ON spot_price_fetches FOR SELECT
  USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE spot_price_fetches IS
  'One row per spot-price refresh attempt (cron or manual), with the per-provider trail. Written by the service role only.';
