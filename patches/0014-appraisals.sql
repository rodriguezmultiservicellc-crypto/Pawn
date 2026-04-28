-- ============================================================================
-- PAWN — APPRAISED VALUATION MIGRATION (Phase 9 — Path B)
-- File:    patches/0014-appraisals.sql
-- Date:    2026-04-27
-- Purpose: Appraised-valuation module — formal jewelry appraisals for insurance,
--          estate, sale, pawn-intake (advisory), collateral-review, and
--          customer-request purposes. Bilingual printable certificate. Stones
--          and photos in sub-tables. Finalize/print locks core fields.
--
-- Apply to: existing project AFTER 0001 / 0002 / 0003 / 0004 / 0005 / 0006 /
--           0007 / 0008 / 0009 / 0010 / 0011 / (operator-applied 0012/0013, if
--           any) have run. Append-only — never edit prior migrations.
--
-- Design notes:
--   - One single-row table `appraisals` with a 1:N `appraisal_stones` table
--     and a 1:N `appraisal_photos` table — same shape as repair_ticket_stones
--     and repair_ticket_photos in 0007.
--   - Appraisal subject is either an existing customer's item (customer_id) OR
--     shop stock (inventory_item_id). Both nullable so a free-form appraisal
--     for a walk-in (no customer record yet) is also possible. Caller pattern:
--     pick at least one when the appraisal isn't ad-hoc.
--   - appraisal_number per-tenant monotonic via next_tenant_counter, counter
--     name 'appraisal', format 'AP-' + LPAD(seq,6,'0'). Same shape as the
--     pawn ticket number / inventory SKU patterns.
--   - Workflow: draft → finalized → voided. Finalized + printed locks core
--     fields via BEFORE UPDATE trigger (same pattern as pawn ticket
--     immutability and repair pickup lock).
--   - Money: numeric(18,4). Karat: numeric(4,2) so '14.0', '18.5', '24.0'
--     all fit. weight_grams: numeric(10,4). carat: numeric(10,4).
--   - Storage buckets: 'appraisal-photos' and 'appraisal-signatures'. Both
--     private, RLS keys off the tenant_id at folder[0] (same shape as
--     repair-photos in 0007 and customer-documents in 0003).
--   - Indexes follow the established convention: (tenant_id, status,
--     created_at DESC) for the list page, (tenant_id, customer_id) for the
--     customer-detail tab.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  ENUMS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE appraisal_status AS ENUM (
    'draft',
    'finalized',
    'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE appraisal_purpose AS ENUM (
    'insurance',           -- replacement-value appraisal for the customer's insurer
    'estate',              -- estate / probate valuation
    'sale',                -- pre-sale market value
    'pawn_intake',         -- internal advisory before issuing a pawn loan
    'collateral_review',   -- mid-loan re-valuation
    'customer_request'     -- customer paid for an opinion of value
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE appraisal_photo_kind AS ENUM (
    'front',
    'back',
    'detail',
    'serial',
    'cert',
    'reference'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  APPRAISALS
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appraisals (
  id                                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Per-tenant monotonic 'AP-' + 6-digit pad. Trigger assigns when null.
  appraisal_number                    TEXT,

  -- Subject of the appraisal. Either a customer's item (customer_id) or
  -- shop stock (inventory_item_id). Both nullable to allow ad-hoc / walk-in
  -- appraisals; staff convention is to capture at least one when possible.
  customer_id                         UUID REFERENCES customers(id) ON DELETE RESTRICT,
  inventory_item_id                   UUID REFERENCES inventory_items(id) ON DELETE SET NULL,

  -- Item description (free-text, captured at intake — frozen at finalize).
  item_description                    TEXT NOT NULL,

  -- Optional metal / weight / karat — same shape as inventory_items.
  metal_type                          metal_type,
  karat                               NUMERIC(4,2),
  weight_grams                        NUMERIC(10,4),

  -- Why is the appraisal being written.
  purpose                             appraisal_purpose NOT NULL,

  -- Money. appraised_value is the headline figure; replacement_value is
  -- typically only set for insurance appraisals (retail-replacement basis).
  appraised_value                     NUMERIC(18,4) NOT NULL,
  replacement_value                   NUMERIC(18,4),

  -- Method + sources. Free-text + JSONB so we can structure later without
  -- another migration. Examples of `valuation_method`: "Comparable retail
  -- sales — Tampa market", "Melt value + 35% retail markup", "GIA full lab
  -- report referenced (#234893)". `comparable_data` is an open shape for
  -- the appraiser's source citations.
  valuation_method                    TEXT,
  comparable_data                     JSONB,

  -- Free-form addenda.
  notes                               TEXT,

  -- Appraiser (staff member who signed the appraisal). NOT a per-tenant FK
  -- because we want auth.users at the global level — the resolved staff
  -- name comes from profiles.full_name.
  appraiser_user_id                   UUID NOT NULL REFERENCES auth.users(id),
  appraiser_signature_storage_path    TEXT,
  customer_signature_storage_path     TEXT,

  -- Validity. Insurance appraisals usually expire after a year; estate /
  -- pawn-intake appraisals don't expire (valid_until NULL).
  valid_from                          DATE NOT NULL,
  valid_until                         DATE,

  -- Lifecycle.
  status                              appraisal_status NOT NULL DEFAULT 'draft',
  finalized_at                        TIMESTAMPTZ,
  finalized_by                        UUID REFERENCES auth.users(id),
  voided_at                           TIMESTAMPTZ,
  voided_by                           UUID REFERENCES auth.users(id),
  void_reason                         TEXT,

  -- Print state — locks core fields (same pattern as pawn tickets).
  is_printed                          BOOLEAN NOT NULL DEFAULT FALSE,
  printed_at                          TIMESTAMPTZ,

  -- Audit / soft-delete.
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                          TIMESTAMPTZ,
  created_by                          UUID REFERENCES auth.users(id),
  updated_by                          UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, appraisal_number)
);

CREATE INDEX IF NOT EXISTS idx_appraisals_tenant_status_created
  ON appraisals(tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_appraisals_tenant_customer
  ON appraisals(tenant_id, customer_id)
  WHERE deleted_at IS NULL AND customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appraisals_tenant_inventory
  ON appraisals(tenant_id, inventory_item_id)
  WHERE deleted_at IS NULL AND inventory_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appraisals_appraiser
  ON appraisals(tenant_id, appraiser_user_id)
  WHERE deleted_at IS NULL;

-- BEFORE INSERT: assign appraisal_number when blank.
CREATE OR REPLACE FUNCTION appraisals_assign_number()
RETURNS TRIGGER AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.appraisal_number IS NULL OR NEW.appraisal_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'appraisal');
    NEW.appraisal_number := 'AP-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appraisals_assign_number ON appraisals;
CREATE TRIGGER trg_appraisals_assign_number
BEFORE INSERT ON appraisals
FOR EACH ROW EXECUTE FUNCTION appraisals_assign_number();

-- BEFORE UPDATE: enforce print-lock on finalized appraisals. Once
-- status='finalized' AND is_printed=true, the economic + subject-binding
-- fields freeze. Status transitions still allowed (for void path) and
-- non-core fields (notes, comparable_data, signatures) remain mutable.
CREATE OR REPLACE FUNCTION appraisals_enforce_print_lock()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'finalized' AND OLD.is_printed = TRUE THEN
    IF NEW.appraised_value      IS DISTINCT FROM OLD.appraised_value THEN
      RAISE EXCEPTION 'appraisals.appraised_value is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.replacement_value    IS DISTINCT FROM OLD.replacement_value THEN
      RAISE EXCEPTION 'appraisals.replacement_value is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.item_description     IS DISTINCT FROM OLD.item_description THEN
      RAISE EXCEPTION 'appraisals.item_description is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.metal_type           IS DISTINCT FROM OLD.metal_type THEN
      RAISE EXCEPTION 'appraisals.metal_type is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.weight_grams         IS DISTINCT FROM OLD.weight_grams THEN
      RAISE EXCEPTION 'appraisals.weight_grams is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.customer_id          IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'appraisals.customer_id is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.inventory_item_id    IS DISTINCT FROM OLD.inventory_item_id THEN
      RAISE EXCEPTION 'appraisals.inventory_item_id is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.valid_from           IS DISTINCT FROM OLD.valid_from THEN
      RAISE EXCEPTION 'appraisals.valid_from is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appraisals_print_lock ON appraisals;
CREATE TRIGGER trg_appraisals_print_lock
BEFORE UPDATE ON appraisals
FOR EACH ROW EXECUTE FUNCTION appraisals_enforce_print_lock();

DROP TRIGGER IF EXISTS trg_appraisals_updated_at ON appraisals;
CREATE TRIGGER trg_appraisals_updated_at BEFORE UPDATE ON appraisals
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  APPRAISAL_STONES — 1:N stones, same shape as inventory_item_stones /
--  repair_ticket_stones.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appraisal_stones (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appraisal_id        UUID NOT NULL REFERENCES appraisals(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- 1-based for human-readable labels ("Stone 1", "Stone 2", ...).
  position            INTEGER NOT NULL DEFAULT 1,
  -- Quantity for this row (e.g., a halo of 12 melee diamonds = one row,
  -- count=12).
  count               INTEGER NOT NULL DEFAULT 1,
  type                TEXT,                  -- 'diamond' | 'sapphire' | 'ruby' | ...
  cut                 TEXT,                  -- 'round' | 'princess' | ...
  est_carat           NUMERIC(10,4),         -- per-stone OR total (see notes)
  color               TEXT,                  -- 'D' | 'E' | 'F' | ...
  clarity             TEXT,                  -- 'IF' | 'VVS1' | ...
  certified           BOOLEAN NOT NULL DEFAULT FALSE,
  cert_lab            TEXT,                  -- 'GIA' | 'IGI' | 'AGS' | ...
  cert_number         TEXT,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_appraisal_stones_appraisal
  ON appraisal_stones(appraisal_id, position)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_appraisal_stones_tenant
  ON appraisal_stones(tenant_id) WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  APPRAISAL_PHOTOS — 1:N photos, same shape as repair_ticket_photos.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appraisal_photos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appraisal_id        UUID NOT NULL REFERENCES appraisals(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Storage path WITHIN the appraisal-photos bucket. Convention:
  -- '<tenant_id>/<appraisal_id>/<kind>/<uuid>.<ext>'
  storage_path        TEXT NOT NULL,
  kind                appraisal_photo_kind NOT NULL,
  caption             TEXT,
  position            INTEGER NOT NULL DEFAULT 0,
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_appraisal_photos_appraisal
  ON appraisal_photos(appraisal_id, position)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_appraisal_photos_kind
  ON appraisal_photos(appraisal_id, kind, position)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_appraisal_photos_tenant
  ON appraisal_photos(tenant_id) WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE appraisals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisal_stones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisal_photos    ENABLE ROW LEVEL SECURITY;

-- ── appraisals
DROP POLICY IF EXISTS appraisals_staff_read ON appraisals;
CREATE POLICY appraisals_staff_read ON appraisals FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS appraisals_staff_write ON appraisals;
CREATE POLICY appraisals_staff_write ON appraisals FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── appraisal_stones
DROP POLICY IF EXISTS appraisal_stones_staff_read ON appraisal_stones;
CREATE POLICY appraisal_stones_staff_read ON appraisal_stones FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS appraisal_stones_staff_write ON appraisal_stones;
CREATE POLICY appraisal_stones_staff_write ON appraisal_stones FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── appraisal_photos
DROP POLICY IF EXISTS appraisal_photos_staff_read ON appraisal_photos;
CREATE POLICY appraisal_photos_staff_read ON appraisal_photos FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS appraisal_photos_staff_write ON appraisal_photos;
CREATE POLICY appraisal_photos_staff_write ON appraisal_photos FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ───────────────────────────────────────────────────────────────────────────
--  STORAGE BUCKETS — appraisal-photos + appraisal-signatures.
-- ───────────────────────────────────────────────────────────────────────────
-- Path conventions (enforced at app layer, RLS verifies):
--   appraisal-photos/<tenant_id>/<appraisal_id>/<kind>/<uuid>.<ext>
--   appraisal-signatures/<tenant_id>/<appraisal_id>/<role>/<uuid>.<ext>
-- where <role> ∈ {appraiser, customer}.

INSERT INTO storage.buckets (id, name, public)
VALUES ('appraisal-photos', 'appraisal-photos', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('appraisal-signatures', 'appraisal-signatures', FALSE)
ON CONFLICT (id) DO NOTHING;

-- ── appraisal-photos: staff-only read/write within accessible tenants.
DROP POLICY IF EXISTS appraisal_photos_storage_read ON storage.objects;
CREATE POLICY appraisal_photos_storage_read ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'appraisal-photos'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS appraisal_photos_storage_write ON storage.objects;
CREATE POLICY appraisal_photos_storage_write ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'appraisal-photos'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS appraisal_photos_storage_update ON storage.objects;
CREATE POLICY appraisal_photos_storage_update ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'appraisal-photos'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS appraisal_photos_storage_delete ON storage.objects;
CREATE POLICY appraisal_photos_storage_delete ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'appraisal-photos'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

-- ── appraisal-signatures: staff-only read/write within accessible tenants.
DROP POLICY IF EXISTS appraisal_sigs_storage_read ON storage.objects;
CREATE POLICY appraisal_sigs_storage_read ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'appraisal-signatures'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS appraisal_sigs_storage_write ON storage.objects;
CREATE POLICY appraisal_sigs_storage_write ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'appraisal-signatures'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS appraisal_sigs_storage_update ON storage.objects;
CREATE POLICY appraisal_sigs_storage_update ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'appraisal-signatures'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

DROP POLICY IF EXISTS appraisal_sigs_storage_delete ON storage.objects;
CREATE POLICY appraisal_sigs_storage_delete ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'appraisal-signatures'
    AND (
      SELECT (storage.foldername(name))[1]::UUID
    ) IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff((SELECT (storage.foldername(name))[1]::UUID))
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0014-appraisals.sql
-- ============================================================================
