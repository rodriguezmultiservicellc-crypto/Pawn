-- ───────────────────────────────────────────────────────────────────────────
-- 0037 — Per-tenant pawn intake categories + has_firearms flag
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0036 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- Adds a per-tenant configurable list of "pawn intake categories" that
-- drives the new wizard step 1 on /pawn/new. Operators see large tile
-- buttons (Jewelry / Electronics / Firearms / Tools / General) and pick
-- one before filling in the rest of the ticket.
--
-- These are HIGHER-LEVEL groupings than the existing inventory_category
-- enum (ring/necklace/etc.) — workflow groupings, not item taxonomy.
-- The granular inventory_category dropdown remains separate per
-- collateral item.
--
-- Categories are PER-TENANT EDITABLE via /settings/pawn-categories. New
-- tenants get the 5 default categories auto-seeded via an AFTER INSERT
-- trigger.
--
-- FIREARMS GATE
-- ─────────────
-- tenants.has_firearms is a hard tenant-level flag. Even if a tenant has
-- a "firearms" category configured, the picker hides it when
-- has_firearms=false. This is because firearms work requires an FFL
-- license + ATF Form 4473 + NICS background check workflow that this
-- app does not yet support. Default = FALSE so no tenant accidentally
-- thinks they can pawn firearms through this app.
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- TENANT FLAG
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS has_firearms BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tenants.has_firearms IS
  'When TRUE, the tenant holds a federal FFL and the pawn-intake '
  'category picker shows the Firearms tile (and any other category '
  'with requires_ffl=true). When FALSE, those tiles are hidden in the '
  'picker even if the rows exist in pawn_intake_categories. Default '
  'FALSE for safety — operators must explicitly opt in via settings.';

-- ───────────────────────────────────────────────────────────────────────────
-- CATEGORIES TABLE
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pawn_intake_categories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Machine name. Stable across renames so the form's hidden field
  -- doesn't break when an operator changes the label.
  slug            TEXT NOT NULL,

  -- Display label shown on the tile. Operator-editable.
  label           TEXT NOT NULL,

  -- Phosphor icon name (e.g., 'Diamond', 'Gun', 'DeviceMobile'). Falls
  -- back to 'Package' if the picker doesn't recognize the name.
  icon            TEXT NOT NULL DEFAULT 'Package',

  sort_order      INTEGER NOT NULL DEFAULT 0,

  -- Soft-disable: operator can hide a category from the picker without
  -- deleting historical references. is_active=FALSE removes the tile
  -- from /pawn/new but keeps the row for audit.
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,

  -- When TRUE, this category requires the tenant to ALSO have
  -- has_firearms=TRUE. The picker hides the tile if either is missing.
  requires_ffl    BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  -- Operator can rename a slug (rare), but two ACTIVE categories with
  -- the same slug in the same tenant would be ambiguous in the form.
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pawn_intake_categories_tenant_active
  ON public.pawn_intake_categories(tenant_id, sort_order)
  WHERE deleted_at IS NULL AND is_active = TRUE;

DROP TRIGGER IF EXISTS trg_pawn_intake_categories_updated_at
  ON public.pawn_intake_categories;
CREATE TRIGGER trg_pawn_intake_categories_updated_at
  BEFORE UPDATE ON public.pawn_intake_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pawn_intake_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pic_member_read ON public.pawn_intake_categories;
CREATE POLICY pic_member_read
  ON public.pawn_intake_categories
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT public.my_tenant_ids()));

DROP POLICY IF EXISTS pic_manager_write ON public.pawn_intake_categories;
CREATE POLICY pic_manager_write
  ON public.pawn_intake_categories
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (SELECT public.my_tenant_ids())
    AND public.my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager')
  )
  WITH CHECK (
    tenant_id IN (SELECT public.my_tenant_ids())
    AND public.my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager')
  );

-- ───────────────────────────────────────────────────────────────────────────
-- DEFAULT CATEGORIES — seed function + auto-seed on new tenants
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_pawn_intake_categories(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Idempotent — uses ON CONFLICT to skip already-seeded slugs. Safe to
  -- re-run during recovery / after a category was deleted.
  INSERT INTO public.pawn_intake_categories
    (tenant_id, slug, label, icon, sort_order, requires_ffl)
  VALUES
    (p_tenant_id, 'jewelry',     'Jewelry',     'Diamond',      10, FALSE),
    (p_tenant_id, 'electronics', 'Electronics', 'DeviceMobile', 20, FALSE),
    (p_tenant_id, 'firearms',    'Firearms',    'Gun',          30, TRUE),
    (p_tenant_id, 'tools',       'Tools',       'Wrench',       40, FALSE),
    (p_tenant_id, 'general',     'General',     'Package',      50, FALSE)
  ON CONFLICT (tenant_id, slug) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_pawn_intake_categories IS
  'Idempotent seed of the 5 default pawn intake categories for a tenant. '
  'Called by the AFTER INSERT trigger on tenants and by the migration '
  'backfill below.';

-- AFTER INSERT trigger so newly-created tenants automatically get the
-- default category list.
CREATE OR REPLACE FUNCTION public.tenant_after_insert_seed_pic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.seed_pawn_intake_categories(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_after_insert_seed_pic ON public.tenants;
CREATE TRIGGER trg_tenant_after_insert_seed_pic
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.tenant_after_insert_seed_pic();

-- Backfill existing tenants. Idempotent — uses the same ON CONFLICT
-- guard as the seed function. tenants uses is_active (not deleted_at)
-- for soft-suspension; both is_active=true and is_active=false tenants
-- get categories so a re-activation finds them already configured.
DO $$
DECLARE
  v_tenant_id UUID;
BEGIN
  FOR v_tenant_id IN
    SELECT id FROM public.tenants
  LOOP
    PERFORM public.seed_pawn_intake_categories(v_tenant_id);
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- COMMENTS
-- ───────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.pawn_intake_categories IS
  'Per-tenant configurable list of high-level pawn intake category '
  'tiles shown on /pawn/new step 1. Editable in /settings/pawn-categories. '
  'Granular item taxonomy lives in the inventory_category enum '
  '(unrelated to this table).';

-- Refresh PostgREST schema cache so /api routes can see the new table
-- without a Supabase API restart.
NOTIFY pgrst, 'reload schema';
