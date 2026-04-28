-- ============================================================================
-- PAWN — BULLION SPOT-PRICE FEED MIGRATION (Phase 9 — Path B)
-- File:    patches/0013-spot-prices.sql
-- Date:    2026-04-27
-- Status:  RESERVED — DO NOT APPLY without operator review.
--
-- Purpose: Platform-wide bullion spot-price history + per-tenant pay-rate
-- override multipliers. Powers melt-value computation on inventory items.
--
-- Apply to: project AFTER 0001..0011 have already run. Append-only.
--
-- Design notes:
--   - spot_prices is PLATFORM-WIDE (no tenant_id). Every tenant reads the
--     same global feed. INSERTs come exclusively from the cron route
--     (service-role bypasses the RLS write block). SELECT is open to all
--     authenticated users so list pages and the inventory detail page can
--     resolve the latest price.
--   - spot_price_overrides is per-tenant. A multiplier of 1.0000 means
--     "pay 100% of spot"; 0.8500 means "pay 85% of spot" (a tenant who
--     wants a 15% margin on melt value). UNIQUE (tenant_id, metal_type,
--     purity).
--   - Append-only history on spot_prices: UNIQUE(metal_type, purity,
--     fetched_at) lets the cron be idempotent (ON CONFLICT DO NOTHING).
--   - Money columns are numeric(18,4) per the Pawn money convention
--     (see CLAUDE.md rule 11).
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  ENUMS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE metal_purity AS ENUM (
    'pure_24k',        -- 24k gold (1.000)
    '22k',             -- 22/24
    '18k',             -- 18/24
    '14k',             -- 14/24
    '10k',             -- 10/24
    'sterling_925',    -- silver .925
    'platinum_950',    -- platinum .950
    'palladium_950',   -- palladium .950
    'fine'             -- .999/.9999 fine bullion (gold or silver)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  SPOT PRICES — platform-wide append-only history
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spot_prices (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  metal_type            metal_type   NOT NULL,
  purity                metal_purity NOT NULL,
  price_per_gram        NUMERIC(18,4) NOT NULL,
  price_per_troy_oz     NUMERIC(18,4) NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'USD',
  source                TEXT NOT NULL,        -- 'metals.live' | 'kitco' | 'manual' | 'seed'
  source_request_id     TEXT,
  fetched_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (metal_type, purity, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_spot_prices_latest
  ON spot_prices (metal_type, purity, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_spot_prices_fetched_at
  ON spot_prices (fetched_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
--  SPOT PRICE OVERRIDES — per-tenant pay-rate multiplier
-- ───────────────────────────────────────────────────────────────────────────
-- Tenants set a multiplier per (metal_type, purity) to dial the melt value
-- they're willing to pay against the global spot price. multiplier=1.0
-- means "pay 100% of spot"; 0.85 means "pay 85% of spot".

CREATE TABLE IF NOT EXISTS spot_price_overrides (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metal_type            metal_type   NOT NULL,
  purity                metal_purity NOT NULL,
  multiplier            NUMERIC(6,4) NOT NULL DEFAULT 1.0
                          CHECK (multiplier >= 0 AND multiplier <= 2),
  updated_by            UUID REFERENCES auth.users(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, metal_type, purity)
);

CREATE INDEX IF NOT EXISTS idx_spot_price_overrides_tenant
  ON spot_price_overrides (tenant_id);

DROP TRIGGER IF EXISTS trg_spot_price_overrides_updated_at ON spot_price_overrides;
CREATE TRIGGER trg_spot_price_overrides_updated_at
  BEFORE UPDATE ON spot_price_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE spot_prices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_price_overrides   ENABLE ROW LEVEL SECURITY;

-- spot_prices: SELECT is open to every authenticated user (every tenant
-- reads the same global feed). INSERT/UPDATE/DELETE are NOT exposed via
-- RLS — only the cron route (service-role) can write.
DROP POLICY IF EXISTS spot_prices_read_all ON spot_prices;
CREATE POLICY spot_prices_read_all ON spot_prices FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- spot_price_overrides: per-tenant staff read + write.
DROP POLICY IF EXISTS spot_price_overrides_staff_read ON spot_price_overrides;
CREATE POLICY spot_price_overrides_staff_read ON spot_price_overrides FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS spot_price_overrides_staff_write ON spot_price_overrides;
CREATE POLICY spot_price_overrides_staff_write ON spot_price_overrides FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ───────────────────────────────────────────────────────────────────────────
--  SEED — placeholder rows so list pages don't break before first cron fire.
-- ───────────────────────────────────────────────────────────────────────────
-- Conservative placeholders (April 2026 ballpark). Replaced as soon as the
-- cron route runs once. ON CONFLICT DO NOTHING keeps re-runs idempotent.
--
-- Placeholder USD per troy ounce (conservative round numbers):
--   gold      = 2400, silver = 28, platinum = 950, palladium = 1100
-- Per-gram = per-oz / 31.1035, applied with the per-purity multiplier.

DO $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Gold purities
  INSERT INTO spot_prices (metal_type, purity, price_per_gram, price_per_troy_oz, source, fetched_at)
  VALUES
    ('gold', 'pure_24k', ROUND( (2400.0 / 31.1034768)::numeric            , 4), 2400.0,                                'seed', v_now),
    ('gold', 'fine',     ROUND( (2400.0 / 31.1034768 * 0.999)::numeric    , 4), ROUND((2400.0 * 0.999)::numeric, 4),    'seed', v_now),
    ('gold', '22k',      ROUND( (2400.0 / 31.1034768 * (22.0/24.0))::numeric, 4), ROUND((2400.0 * 22.0/24.0)::numeric,4),'seed', v_now),
    ('gold', '18k',      ROUND( (2400.0 / 31.1034768 * (18.0/24.0))::numeric, 4), ROUND((2400.0 * 18.0/24.0)::numeric,4),'seed', v_now),
    ('gold', '14k',      ROUND( (2400.0 / 31.1034768 * (14.0/24.0))::numeric, 4), ROUND((2400.0 * 14.0/24.0)::numeric,4),'seed', v_now),
    ('gold', '10k',      ROUND( (2400.0 / 31.1034768 * (10.0/24.0))::numeric, 4), ROUND((2400.0 * 10.0/24.0)::numeric,4),'seed', v_now)
  ON CONFLICT (metal_type, purity, fetched_at) DO NOTHING;

  -- Silver purities
  INSERT INTO spot_prices (metal_type, purity, price_per_gram, price_per_troy_oz, source, fetched_at)
  VALUES
    ('silver', 'fine',         ROUND( (28.0 / 31.1034768 * 0.999)::numeric, 4), ROUND((28.0 * 0.999)::numeric, 4), 'seed', v_now),
    ('silver', 'sterling_925', ROUND( (28.0 / 31.1034768 * 0.925)::numeric, 4), ROUND((28.0 * 0.925)::numeric, 4), 'seed', v_now)
  ON CONFLICT (metal_type, purity, fetched_at) DO NOTHING;

  -- Platinum
  INSERT INTO spot_prices (metal_type, purity, price_per_gram, price_per_troy_oz, source, fetched_at)
  VALUES
    ('platinum', 'platinum_950', ROUND( (950.0 / 31.1034768 * 0.95)::numeric, 4), ROUND((950.0 * 0.95)::numeric, 4), 'seed', v_now)
  ON CONFLICT (metal_type, purity, fetched_at) DO NOTHING;

  -- Palladium
  INSERT INTO spot_prices (metal_type, purity, price_per_gram, price_per_troy_oz, source, fetched_at)
  VALUES
    ('palladium', 'palladium_950', ROUND( (1100.0 / 31.1034768 * 0.95)::numeric, 4), ROUND((1100.0 * 0.95)::numeric, 4), 'seed', v_now)
  ON CONFLICT (metal_type, purity, fetched_at) DO NOTHING;
END $$;

-- Refresh PostgREST so the new tables are visible to the JS client.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0013-spot-prices.sql
-- ============================================================================
