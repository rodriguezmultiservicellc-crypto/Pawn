-- ───────────────────────────────────────────────────────────────────────────
-- 0038 — Pawn intake sub-categories (two-level hierarchy)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0037 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- Adds a nullable parent_id self-FK on pawn_intake_categories so the
-- 5 default top-level rows can have sub-categories underneath them
-- (e.g., Jewelry → Rings / Chains / Bracelets, Electronics → Phones /
-- Laptops). The wizard step 1 on /pawn/new becomes a cascade: pick
-- top-level tile → sub-tile row appears → pick a sub → advance.
--
-- The old UNIQUE(tenant_id, slug) constraint becomes a UNIQUE INDEX
-- that scopes uniqueness UNDER each parent — so 'rings' under Jewelry
-- doesn't collide with a different 'rings' under, say, Custom (if an
-- operator ever adds two top-levels with overlapping sub-names).
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- SCHEMA
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pawn_intake_categories
  ADD COLUMN IF NOT EXISTS parent_id UUID NULL
    REFERENCES public.pawn_intake_categories(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.pawn_intake_categories.parent_id IS
  'NULL = top-level tile (e.g., Jewelry). Otherwise points to the '
  'parent top-level row this sub-category belongs to. Cascade-delete '
  'a parent removes its subs.';

-- Index for the common "find subs of this parent" query.
CREATE INDEX IF NOT EXISTS idx_pawn_intake_categories_parent
  ON public.pawn_intake_categories(parent_id, sort_order)
  WHERE deleted_at IS NULL AND is_active = TRUE;

-- Replace UNIQUE(tenant_id, slug) with a uniqueness rule that scopes
-- under each parent. We use a UNIQUE INDEX with COALESCE so NULL
-- parents (top-level) are treated as a single bucket — no two
-- top-level rows can share a slug, no two subs of the SAME parent can
-- share a slug, but a sub of Jewelry and a sub of Tools CAN both be
-- 'misc'.
ALTER TABLE public.pawn_intake_categories
  DROP CONSTRAINT IF EXISTS pawn_intake_categories_tenant_id_slug_key;

CREATE UNIQUE INDEX IF NOT EXISTS pawn_intake_categories_tenant_parent_slug
  ON public.pawn_intake_categories
  (tenant_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::UUID), slug);

-- ───────────────────────────────────────────────────────────────────────────
-- DEFAULT SUB-CATEGORIES — seed function
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_pawn_intake_subcategories(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jewelry     UUID;
  v_electronics UUID;
  v_firearms    UUID;
  v_tools       UUID;
BEGIN
  -- Look up the parent top-level rows. Skip subs for any parent that
  -- doesn't exist (operator may have deleted them).
  SELECT id INTO v_jewelry FROM public.pawn_intake_categories
   WHERE tenant_id = p_tenant_id AND slug = 'jewelry' AND parent_id IS NULL;
  SELECT id INTO v_electronics FROM public.pawn_intake_categories
   WHERE tenant_id = p_tenant_id AND slug = 'electronics' AND parent_id IS NULL;
  SELECT id INTO v_firearms FROM public.pawn_intake_categories
   WHERE tenant_id = p_tenant_id AND slug = 'firearms' AND parent_id IS NULL;
  SELECT id INTO v_tools FROM public.pawn_intake_categories
   WHERE tenant_id = p_tenant_id AND slug = 'tools' AND parent_id IS NULL;

  -- Jewelry subs
  IF v_jewelry IS NOT NULL THEN
    INSERT INTO public.pawn_intake_categories
      (tenant_id, parent_id, slug, label, icon, sort_order, requires_ffl)
    VALUES
      (p_tenant_id, v_jewelry, 'rings',     'Rings',     'Diamond',  10, FALSE),
      (p_tenant_id, v_jewelry, 'chains',    'Chains',    'Tag',      20, FALSE),
      (p_tenant_id, v_jewelry, 'bracelets', 'Bracelets', 'Tag',      30, FALSE),
      (p_tenant_id, v_jewelry, 'earrings',  'Earrings',  'Star',     40, FALSE),
      (p_tenant_id, v_jewelry, 'pendants',  'Pendants',  'Diamond',  50, FALSE),
      (p_tenant_id, v_jewelry, 'watches',   'Watches',   'Watch',    60, FALSE)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Electronics subs
  IF v_electronics IS NOT NULL THEN
    INSERT INTO public.pawn_intake_categories
      (tenant_id, parent_id, slug, label, icon, sort_order, requires_ffl)
    VALUES
      (p_tenant_id, v_electronics, 'phones',   'Phones',   'DeviceMobile', 10, FALSE),
      (p_tenant_id, v_electronics, 'laptops',  'Laptops',  'DeviceMobile', 20, FALSE),
      (p_tenant_id, v_electronics, 'tablets',  'Tablets',  'DeviceMobile', 30, FALSE),
      (p_tenant_id, v_electronics, 'consoles', 'Consoles', 'DeviceMobile', 40, FALSE),
      (p_tenant_id, v_electronics, 'audio',    'Audio',    'MusicNote',    50, FALSE),
      (p_tenant_id, v_electronics, 'tvs',      'TVs',      'DeviceMobile', 60, FALSE)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Firearms subs (all inherit requires_ffl from being under Firearms,
  -- but we also flag them individually so a chain admin who moves a
  -- sub to a non-FFL parent doesn't accidentally lose the gate).
  IF v_firearms IS NOT NULL THEN
    INSERT INTO public.pawn_intake_categories
      (tenant_id, parent_id, slug, label, icon, sort_order, requires_ffl)
    VALUES
      (p_tenant_id, v_firearms, 'handguns', 'Handguns', 'Crosshair', 10, TRUE),
      (p_tenant_id, v_firearms, 'rifles',   'Rifles',   'Crosshair', 20, TRUE),
      (p_tenant_id, v_firearms, 'shotguns', 'Shotguns', 'Crosshair', 30, TRUE)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Tools subs
  IF v_tools IS NOT NULL THEN
    INSERT INTO public.pawn_intake_categories
      (tenant_id, parent_id, slug, label, icon, sort_order, requires_ffl)
    VALUES
      (p_tenant_id, v_tools, 'power_tools', 'Power tools', 'Wrench', 10, FALSE),
      (p_tenant_id, v_tools, 'hand_tools',  'Hand tools',  'Hammer', 20, FALSE),
      (p_tenant_id, v_tools, 'yard_tools',  'Yard tools',  'Wrench', 30, FALSE)
    ON CONFLICT DO NOTHING;
  END IF;

  -- General: no defaults — it's the catch-all top-level.
END;
$$;

COMMENT ON FUNCTION public.seed_pawn_intake_subcategories IS
  'Idempotent seed of the default sub-categories under the 5 default '
  'top-level pawn intake categories. Called by the AFTER INSERT trigger '
  'on tenants (composed with seed_pawn_intake_categories) and by the '
  'migration backfill below.';

-- ───────────────────────────────────────────────────────────────────────────
-- COMPOSE WITH THE TENANT-INSERT TRIGGER
-- ───────────────────────────────────────────────────────────────────────────
-- Replace the previous trigger function so it ALSO seeds subs after
-- the parents land. Two PERFORMs back-to-back — order matters since
-- subs depend on parent rows existing.
CREATE OR REPLACE FUNCTION public.tenant_after_insert_seed_pic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.seed_pawn_intake_categories(NEW.id);
  PERFORM public.seed_pawn_intake_subcategories(NEW.id);
  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- BACKFILL — seed sub-categories for existing tenants
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tenant_id UUID;
BEGIN
  FOR v_tenant_id IN
    SELECT id FROM public.tenants
  LOOP
    PERFORM public.seed_pawn_intake_subcategories(v_tenant_id);
  END LOOP;
END $$;

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
