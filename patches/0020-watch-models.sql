-- ───────────────────────────────────────────────────────────────────────────
-- 0020 — Watch model reference table
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0019 has already run.
--           Append-only — never edit prior migrations.
--
-- Curated reference table for common watches the operator might
-- encounter at intake. Used by the suggested-loan calculator to fill
-- in an estimated value when the operator picks a brand+model from
-- a typeahead instead of typing one from scratch.
--
-- v1 ships PLATFORM-LEVEL records (no tenant_id) — every shop sees
-- the same catalog. Per-tenant overrides can land later via a
-- separate watch_model_overrides table mirroring the spot_price_
-- overrides pattern (multiplier, custom est_value).
--
-- Scope decisions:
--   - Pre-owned wholesale value range (USD), NOT MSRP. Pawn shops buy
--     at wholesale floor and sell at retail above; the calculator
--     wants the floor.
--   - est_value_min / est_value_max — operator picks the midpoint or
--     adjusts based on condition. Reflects "this watch is worth
--     somewhere in this range to a wholesaler."
--   - The seed data is intentionally TINY (10-20 well-known refs).
--     Real coverage requires a paid feed (ALPS, WatchCharts) which
--     is on the backlog. The table exists so the calculator can
--     LOOK UP entries when the operator types a recognized model.
--   - Photos defer to Phase 10 — keeping this table to text only
--     for now.
--
-- Source-of-truth for ranges below: rough wholesale floors as of
-- 2026-04 from publicly-quoted recent sales. Operators should NOT
-- treat these as appraisals — they're a starting point.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watch_models (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand           TEXT         NOT NULL,
  model           TEXT         NOT NULL,
  reference_no    TEXT,
  -- A short distinguishing nickname / dial variant ('Hulk', 'Pepsi',
  -- 'James Bond'). Free text. Helps the typeahead.
  nickname        TEXT,
  -- Production span — for aging-based filtering later. Either bound
  -- can be NULL (unknown).
  year_start      INTEGER,
  year_end        INTEGER,
  -- Wholesale-floor estimate in USD.
  est_value_min   NUMERIC(12,2) NOT NULL CHECK (est_value_min >= 0),
  est_value_max   NUMERIC(12,2) NOT NULL CHECK (est_value_max >= est_value_min),
  -- Generic notes: complications, common condition issues, etc.
  notes           TEXT,
  -- Soft-delete + audit timestamps.
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Who curated this row (always a superadmin in v1).
  created_by      UUID         REFERENCES auth.users(id),
  updated_by      UUID         REFERENCES auth.users(id)
);

-- Lookup indexes for the typeahead.
CREATE INDEX IF NOT EXISTS idx_watch_models_brand
  ON watch_models(LOWER(brand))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_watch_models_brand_model
  ON watch_models(LOWER(brand), LOWER(model))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_watch_models_reference
  ON watch_models(reference_no)
  WHERE deleted_at IS NULL AND reference_no IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────
-- Read: all authenticated users (this is reference data, not customer
--        data — every shop benefits from access).
-- Write: superadmin only — curated by RMS, mutated via /admin/watch-models.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE watch_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watch_models_authenticated_read ON watch_models;
CREATE POLICY watch_models_authenticated_read ON watch_models FOR SELECT
  USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

-- Writes go through the admin (service-role) client gated by
-- requireSuperAdmin() in /admin/watch-models actions.

-- ───────────────────────────────────────────────────────────────────────────
-- SEED DATA
-- ───────────────────────────────────────────────────────────────────────────
-- ~15 of the most-pawn-shop-relevant references. Conservative ranges.
-- All values are USD; current as of 2026-04.
--
-- Insert with conflict skip on (brand, model, reference_no) tuple — re-
-- running the migration is safe.
-- ───────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_watch_models_brand_model_ref
  ON watch_models(LOWER(brand), LOWER(model), COALESCE(reference_no, ''))
  WHERE deleted_at IS NULL;

INSERT INTO watch_models (brand, model, reference_no, nickname, year_start, est_value_min, est_value_max, notes) VALUES
  -- Rolex
  ('Rolex', 'Submariner', '116610LN', NULL, 2010, 6500, 9500, 'Black dial, ceramic bezel.'),
  ('Rolex', 'Submariner', '116610LV', 'Hulk', 2010, 11000, 16000, 'Green dial + green ceramic bezel. 2010-2020 only.'),
  ('Rolex', 'GMT-Master II', '126710BLRO', 'Pepsi', 2018, 13000, 18000, 'Blue/red ceramic bezel on Jubilee or Oyster.'),
  ('Rolex', 'Daytona', '116500LN', NULL, 2016, 22000, 32000, 'Black or white dial; ceramic bezel. Steel.'),
  ('Rolex', 'Datejust', '126234', NULL, 2018, 5500, 8500, '36mm steel + white gold bezel. Various dials.'),
  ('Rolex', 'Explorer II', '216570', NULL, 2011, 7500, 11000, 'Black or white dial, 42mm.'),
  -- Omega
  ('Omega', 'Speedmaster Professional', '311.30.42.30.01.005', 'Moonwatch', 1969, 4500, 6500, 'Hesalite, manual-wind 1861/3861.'),
  ('Omega', 'Seamaster Diver 300M', '210.30.42.20.03.001', NULL, 2018, 3500, 5500, 'Wave dial, ceramic bezel.'),
  -- Tudor
  ('Tudor', 'Black Bay 58', '79030N', NULL, 2018, 2800, 4200, '39mm, black dial, gilt accents.'),
  ('Tudor', 'Pelagos', '25600TN', NULL, 2016, 3200, 4800, 'Titanium, 42mm.'),
  -- Audemars Piguet
  ('Audemars Piguet', 'Royal Oak', '15400ST', NULL, 2012, 35000, 55000, '41mm steel, blue or grey dial.'),
  -- Patek Philippe
  ('Patek Philippe', 'Nautilus', '5711/1A', NULL, 2006, 80000, 130000, 'Stainless steel, blue dial. Discontinued 2021.'),
  -- Cartier
  ('Cartier', 'Tank', 'WSTA0029', 'Solo', 2019, 1800, 2800, 'Steel, large model. Quartz movement.'),
  ('Cartier', 'Santos', 'WSSA0009', NULL, 2018, 5500, 8000, 'Medium steel automatic.'),
  -- Breitling
  ('Breitling', 'Navitimer', 'AB0127211C1A1', NULL, 2018, 3500, 5000, '43mm slide rule, automatic.'),
  -- Tag Heuer
  ('Tag Heuer', 'Carrera', 'CBN2A1B.BA0643', NULL, 2020, 2500, 3800, 'Heuer 02 chronograph, 44mm.')
ON CONFLICT (LOWER(brand), LOWER(model), COALESCE(reference_no, ''))
WHERE deleted_at IS NULL
DO NOTHING;
