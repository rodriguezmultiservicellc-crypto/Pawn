-- ───────────────────────────────────────────────────────────────────────────
-- 0067 — inventory fields: condition, coating, finish, shelf, legacy code,
--        wholesale price, target margin, category+metal SKUs
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0066 has already run.
--           Append-only — never edit prior migrations.
--
-- Sol Pawn brief, Phase 4.2 — "Inventory item fields".
--
-- COATING is the one with teeth: an item that is gold plated / gold
-- filled / vermeil / PVD is NOT solid metal. The app excludes it from
-- every melt value (inventory detail, buy outright, pawn intake, the
-- suggested-loan math) and shows a "not solid gold" warning wherever the
-- field is set. It also lives on loan_collateral_items so the New Pawn
-- Ticket records it and the police-report snapshot carries it.
--
-- AUTO SKU: the BEFORE INSERT trigger now builds <CATEGORY>-<METAL>-<seq>
-- (e.g. RNG-AU-000123) instead of INV-<seq>. Same per-tenant counter, so
-- existing INV- SKUs keep their numbers and uniqueness is unchanged; an
-- app-provided SKU still wins. Metal code is omitted for none / other /
-- NULL (e.g. ELC-000124).
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE inventory_condition AS ENUM ('new', 'used', 'restored', 'vintage', 'antique');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_coating AS ENUM ('none', 'gold_plated', 'gold_filled', 'vermeil', 'pvd');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── inventory_items ─────────────────────────────────────────────────────

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS condition        inventory_condition,
  ADD COLUMN IF NOT EXISTS coating          inventory_coating NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS finish           TEXT,
  ADD COLUMN IF NOT EXISTS shelf_location   TEXT,
  ADD COLUMN IF NOT EXISTS legacy_code      TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_price  NUMERIC(18,4)
    CHECK (wholesale_price IS NULL OR wholesale_price >= 0);

COMMENT ON COLUMN inventory_items.coating IS
  'Surface coating. Anything but ''none'' means NOT solid metal: excluded from melt value everywhere, warned on intake.';
COMMENT ON COLUMN inventory_items.finish IS
  'Free text: polished, matte, brushed, hammered, diamond-cut, rhodium, ...';
COMMENT ON COLUMN inventory_items.shelf_location IS
  'Where it physically sits within the location (e.g. "Case 3, tray B").';
COMMENT ON COLUMN inventory_items.legacy_code IS
  'The item''s code in the shop''s previous system. Searchable.';
COMMENT ON COLUMN inventory_items.wholesale_price IS
  'Trade / wholesale price, separate from list_price (retail).';

CREATE INDEX IF NOT EXISTS idx_inventory_legacy_code
  ON inventory_items(tenant_id, legacy_code)
  WHERE legacy_code IS NOT NULL AND deleted_at IS NULL;

-- ── loan_collateral_items ───────────────────────────────────────────────

ALTER TABLE loan_collateral_items
  ADD COLUMN IF NOT EXISTS coating inventory_coating NOT NULL DEFAULT 'none';

COMMENT ON COLUMN loan_collateral_items.coating IS
  'Surface coating recorded at pawn intake. Not ''none'' = excluded from melt / suggested loan.';

-- ── settings: target margin for "Suggest price" ─────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS inventory_target_margin_pct NUMERIC(6,4) NOT NULL DEFAULT 0.5000
    CHECK (inventory_target_margin_pct >= 0 AND inventory_target_margin_pct <= 0.95);

COMMENT ON COLUMN settings.inventory_target_margin_pct IS
  'Fraction (0.5 = 50%). "Suggest price" on an inventory item = cost_basis / (1 - margin).';

-- ── Auto SKU: category + metal + sequence ───────────────────────────────

CREATE OR REPLACE FUNCTION inventory_items_assign_sku()
RETURNS TRIGGER AS $$
DECLARE
  v_cat   TEXT;
  v_metal TEXT;
BEGIN
  IF NEW.sku IS NULL OR NEW.sku = '' THEN
    NEW.sku_number := next_tenant_counter(NEW.tenant_id, 'inventory_sku');
    v_cat := CASE NEW.category
      WHEN 'ring'        THEN 'RNG'
      WHEN 'necklace'    THEN 'NCK'
      WHEN 'bracelet'    THEN 'BRC'
      WHEN 'earrings'    THEN 'EAR'
      WHEN 'pendant'     THEN 'PND'
      WHEN 'chain'       THEN 'CHN'
      WHEN 'watch'       THEN 'WCH'
      WHEN 'coin'        THEN 'CON'
      WHEN 'bullion'     THEN 'BUL'
      WHEN 'loose_stone' THEN 'STN'
      WHEN 'electronics' THEN 'ELC'
      WHEN 'tool'        THEN 'TOL'
      WHEN 'instrument'  THEN 'INS'
      ELSE 'OTH'
    END;
    v_metal := CASE NEW.metal
      WHEN 'gold'            THEN 'AU'
      WHEN 'rose_gold'       THEN 'RG'
      WHEN 'white_gold'      THEN 'WG'
      WHEN 'silver'          THEN 'AG'
      WHEN 'platinum'        THEN 'PT'
      WHEN 'palladium'       THEN 'PD'
      WHEN 'tungsten'        THEN 'TU'
      WHEN 'titanium'        THEN 'TI'
      WHEN 'stainless_steel' THEN 'SS'
      WHEN 'mixed'           THEN 'MX'
      ELSE NULL
    END;
    NEW.sku := v_cat
      || COALESCE('-' || v_metal, '')
      || '-' || LPAD(NEW.sku_number::TEXT, 6, '0');
  ELSIF NEW.sku_number IS NULL THEN
    -- App-provided SKU: stash the counter value anyway so sortable order
    -- still works. Don't advance the counter (user-provided SKUs are
    -- expected to live outside the auto-numbered range).
    NEW.sku_number := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0067-inventory-fields.sql
-- ============================================================================
