-- ───────────────────────────────────────────────────────────────────────────
-- 0074 — Item tags (PLAN-2026-11-13 Phase 1)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0073.
--           Append-only — never edit prior migrations.
--
-- Barcode tags for inventory, pawn collateral and repair tickets. The
-- barcode encodes what the shop already has: the SKU (INV-000123, or the
-- 6-digit sku_number on small tags), PT-######-n for collateral and the
-- RT- ticket number for repairs. No new identifier is minted here.
--
--   1. label_templates — a tenant's saved tag designs (stock size, layout,
--      which fields print). A tenant with no rows prints with the
--      built-in templates in src/lib/labels/templates.ts, so nothing is
--      seeded.
--   2. inventory_items.tag_printed_at — when a tag was last printed; the
--      inventory list's "Needs tag" filter is "sellable and NULL".
--   3. settings.tag_cost_code — the shop's ten-letter cost-code word.
--      Distinct letters are checked by the app (a CHECK cannot say it).
--
-- RLS (NEW policies on the NEW table only — no existing policy changes):
--   label_templates_staff_read   SELECT for staff of the tenant
--   label_templates_owner_write  ALL for owners (same rule as settings)
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. label_templates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS label_templates (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind             TEXT NOT NULL CHECK (kind IN ('inventory', 'collateral', 'repair')),
  width_in         NUMERIC(6,3) NOT NULL CHECK (width_in BETWEEN 0.5 AND 6),
  height_in        NUMERIC(6,3) NOT NULL CHECK (height_in BETWEEN 0.25 AND 6),
  layout           TEXT NOT NULL DEFAULT 'single' CHECK (layout IN ('single', 'split')),
  gap_in           NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (gap_in >= 0 AND gap_in <= 3),
  dpi              INTEGER NOT NULL DEFAULT 203 CHECK (dpi IN (203, 300, 600)),
  barcode_payload  TEXT NOT NULL DEFAULT 'code' CHECK (barcode_payload IN ('code', 'number')),
  -- {price, metal, weight, description, stones, cost_code, shop_name, due_date}: boolean
  fields           JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fields) = 'object'),
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  CHECK (layout = 'single' OR width_in - gap_in >= 0.5)
);

-- One default per tenant and kind.
CREATE UNIQUE INDEX IF NOT EXISTS uq_label_templates_default
  ON label_templates (tenant_id, kind)
  WHERE is_default AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_label_templates_tenant
  ON label_templates (tenant_id, kind) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_label_templates_updated_at ON label_templates;
CREATE TRIGGER trg_label_templates_updated_at BEFORE UPDATE ON label_templates
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE label_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS label_templates_staff_read ON label_templates;
CREATE POLICY label_templates_staff_read ON label_templates FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS label_templates_owner_write ON label_templates;
CREATE POLICY label_templates_owner_write ON label_templates FOR ALL
  USING (my_is_owner(tenant_id))
  WITH CHECK (my_is_owner(tenant_id));

-- ── 2. inventory_items.tag_printed_at ─────────────────────────────────────
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS tag_printed_at TIMESTAMPTZ;

COMMENT ON COLUMN inventory_items.tag_printed_at IS
  'Last time a tag was printed for this item (PDF or ZPL). NULL on sellable stock = needs a tag.';

CREATE INDEX IF NOT EXISTS idx_inventory_items_needs_tag
  ON inventory_items (tenant_id, sku_number DESC)
  WHERE tag_printed_at IS NULL AND deleted_at IS NULL AND status IN ('available', 'held');

-- ── 3. settings.tag_cost_code ─────────────────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS tag_cost_code TEXT
  CHECK (tag_cost_code IS NULL OR tag_cost_code ~ '^[A-Z]{10}$');

COMMENT ON COLUMN settings.tag_cost_code IS
  'Ten distinct letters standing for 1..9,0; prints the cost on tags in code. NULL = feature off.';

NOTIFY pgrst, 'reload schema';
