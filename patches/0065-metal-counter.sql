-- ───────────────────────────────────────────────────────────────────────────
-- 0065 — metal counter: sell rates + metal facts on sale lines
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0064 has already run.
--           Append-only — never edit prior migrations.
--
-- Sol Pawn brief, Phase 3 — "Two-way metal counter (buy AND sell)".
--
-- 1. spot_price_overrides.sell_multiplier
--
--    patches/0013 gave every (tenant, metal, purity) ONE multiplier — the
--    PAY rate, what the shop pays a seller as a fraction of spot (0.85 =
--    85% of spot). Selling scrap or bullion needs a second, independent
--    number: the SELL rate, what the shop charges as a fraction of spot
--    (1.05 = 5% over spot). It is a sibling column on the same row, NOT a
--    second meaning of `multiplier`, so the existing pay-rate code path is
--    untouched and one row still describes one (metal, purity) policy.
--
--    NULL = no sell rate configured. The app treats NULL as 1.0000 (sell
--    at spot) and SAYS so on the sell form, so a shop that never set a
--    rate is not silently selling below cost. The CHECK allows up to 5x
--    spot for numismatic / collectible premiums.
--
-- 2. sale_items metal columns
--
--    A metal-sale line records what was sold as metal, not just as text:
--    metal_type + purity (the spot bucket), weight_grams, and the spot
--    price + rate multiplier frozen at the moment of sale. unit_price /
--    line_total keep carrying the money exactly as every other sale line
--    does, so returns, voids, the register and sales reports need no
--    special casing. All five are NULL on ordinary retail lines.
--
-- 3. sales.counterparty_name
--
--    Scrap usually goes to a refiner, who is not a customer record. A
--    metal sale may name its buyer in free text instead of (or as well as)
--    linking a customer. NULL on every other sale kind.
-- ============================================================================

-- ── 1. Sell rate beside the pay rate ──────────────────────────────────────

ALTER TABLE spot_price_overrides
  ADD COLUMN IF NOT EXISTS sell_multiplier NUMERIC(6,4)
    CHECK (sell_multiplier IS NULL OR (sell_multiplier >= 0 AND sell_multiplier <= 5));

COMMENT ON COLUMN spot_price_overrides.multiplier IS
  'PAY rate: fraction of spot the shop pays a seller (0.85 = 85% of spot). Default 1.0.';
COMMENT ON COLUMN spot_price_overrides.sell_multiplier IS
  'SELL rate: fraction of spot the shop charges when selling scrap/bullion (1.05 = 5% over spot). NULL = not configured; app sells at spot and warns.';

-- ── 2. Metal facts on sale lines ──────────────────────────────────────────

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS metal_type       metal_type,
  ADD COLUMN IF NOT EXISTS purity           metal_purity,
  ADD COLUMN IF NOT EXISTS weight_grams     NUMERIC(10,4)
    CHECK (weight_grams IS NULL OR weight_grams >= 0),
  ADD COLUMN IF NOT EXISTS spot_per_gram    NUMERIC(18,4)
    CHECK (spot_per_gram IS NULL OR spot_per_gram >= 0),
  ADD COLUMN IF NOT EXISTS rate_multiplier  NUMERIC(6,4)
    CHECK (rate_multiplier IS NULL OR rate_multiplier >= 0);

COMMENT ON COLUMN sale_items.metal_type IS
  'Metal-sale lines only: the metal sold (gold / silver / platinum / palladium family).';
COMMENT ON COLUMN sale_items.purity IS
  'Metal-sale lines only: spot bucket the line was priced from (14k, sterling_925, ...).';
COMMENT ON COLUMN sale_items.weight_grams IS
  'Metal-sale lines only: grams sold on this line.';
COMMENT ON COLUMN sale_items.spot_per_gram IS
  'Metal-sale lines only: raw spot price per gram at the moment of sale (before the sell multiplier).';
COMMENT ON COLUMN sale_items.rate_multiplier IS
  'Metal-sale lines only: sell multiplier applied to spot when the line was suggested (1.0 when none configured).';

CREATE INDEX IF NOT EXISTS idx_sale_items_metal
  ON sale_items(tenant_id, metal_type, purity)
  WHERE metal_type IS NOT NULL AND deleted_at IS NULL;

-- ── 3. Free-text buyer for metal sales ────────────────────────────────────

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS counterparty_name TEXT;

COMMENT ON COLUMN sales.counterparty_name IS
  'Metal sales: buyer / refiner named in free text when not (or as well as) a customer record. NULL on other sale kinds.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0065-metal-counter.sql
-- ============================================================================
