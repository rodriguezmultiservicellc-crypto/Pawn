import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { InventoryCategory } from '@/types/database-aliases'
import type { PawnIntakeCategory } from '@/components/pawn/CategoryPicker'

/**
 * The shop's pawn intake categories (pawn_intake_categories, patches/0040):
 * what the New pawn ticket item popup offers, and what the photo reader
 * (/api/ai/vision/pawn-item) may answer with. One loader, so the two can
 * never disagree about which categories exist.
 */

/**
 * Active categories of a tenant as a two-level tree (top-levels have
 * parent_id IS NULL). Firearms-flagged tiles, top or sub, are left out when
 * the tenant does not take firearms.
 */
export async function loadPawnIntakeCategories(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  hasFirearms: boolean,
): Promise<PawnIntakeCategory[]> {
  const { data: catRows } = await supabase
    .from('pawn_intake_categories')
    .select('id, slug, label, icon, requires_ffl, parent_id')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const visible = (catRows ?? []).filter((c) => !c.requires_ffl || hasFirearms)

  const subsByParent = new Map<string, typeof visible>()
  for (const r of visible) {
    if (r.parent_id != null) {
      const arr = subsByParent.get(r.parent_id) ?? []
      arr.push(r)
      subsByParent.set(r.parent_id, arr)
    }
  }

  return visible
    .filter((r) => r.parent_id == null)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      label: r.label,
      icon: r.icon,
      requires_ffl: r.requires_ffl,
      subcategories: (subsByParent.get(r.id) ?? []).map((s) => ({
        id: s.id,
        slug: s.slug,
        label: s.label,
        icon: s.icon,
        requires_ffl: s.requires_ffl,
      })),
    }))
}

/**
 * Derive a reasonable inventory_category enum value from the picked
 * pawn_intake_categories slug pair. Used to keep the legacy
 * loan_collateral_items.category column populated without showing a
 * separate dropdown to the operator — pawn_category_slug +
 * pawn_subcategory_slug are the new source of truth, but the enum
 * column still drives forfeiture-to-inventory routing and reports.
 *
 * Falls back to 'other' for anything we can't map (e.g., firearms,
 * general, custom operator-added categories).
 */
export function inventoryCategoryFromSlug(
  topSlug: string | null,
  subSlug: string | null,
): InventoryCategory {
  if (!topSlug) return 'other'
  if (topSlug === 'jewelry') {
    switch (subSlug) {
      case 'rings':
        return 'ring'
      case 'necklaces':
        return 'necklace'
      case 'bracelets':
        return 'bracelet'
      case 'earrings':
        return 'earrings'
      case 'pendants':
        return 'pendant'
      case 'chains':
        return 'chain'
      case 'watches':
        return 'watch'
      case 'coins':
        return 'coin'
      case 'bullion':
        return 'bullion'
      case 'loose-stones':
      case 'loose_stones':
        return 'loose_stone'
      default:
        return 'other'
    }
  }
  if (topSlug === 'electronics') return 'electronics'
  if (topSlug === 'tools') return 'tool'
  return 'other'
}
