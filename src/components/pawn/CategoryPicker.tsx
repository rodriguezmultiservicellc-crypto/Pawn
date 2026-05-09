'use client'

import { createElement, useState } from 'react'
import {
  Diamond,
  DeviceMobile,
  Crosshair,
  Wrench,
  Package,
  Watch,
  Coin,
  MusicNote,
  Bicycle,
  Star,
  Tag,
  Hammer,
  ArrowLeft,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

export type PawnIntakeCategory = {
  id: string
  slug: string
  label: string
  icon: string
  requires_ffl: boolean
  /** Sub-categories nested under this top-level. Empty array when the
   *  top-level has no children (operator clicks straight through to
   *  step 2). Server-side filters firearms-requiring subs when
   *  has_firearms=false. */
  subcategories: Array<Omit<PawnIntakeCategory, 'subcategories'>>
}

/**
 * Map of supported Phosphor icon names → component. Operators pick from
 * this allowlist in /settings/pawn-categories. Unknown icon names fall
 * back to Package.
 */
const ICON_MAP: Record<string, PhosphorIcon> = {
  Diamond,
  DeviceMobile,
  // Phosphor doesn't ship a firearm icon — Crosshair is the closest
  // semantic fit. Operator-editable in /settings/pawn-categories.
  Gun: Crosshair,
  Crosshair,
  Wrench,
  Package,
  Watch,
  Coin,
  MusicNote,
  Bicycle,
  Star,
  Tag,
  Hammer,
}

export const SUPPORTED_ICONS = Object.keys(ICON_MAP)

function iconFor(name: string): PhosphorIcon {
  return ICON_MAP[name] ?? Package
}

/**
 * Stable wrapper component that resolves the icon name → Phosphor
 * component internally. Uses createElement instead of JSX to avoid
 * tripping react-hooks/static-components — the lookup IS referentially
 * stable (same name → same component) but the linter can't see that.
 */
function CategoryIcon({
  name,
  size,
  weight,
}: {
  name: string
  size: number
  weight: 'regular' | 'bold' | 'duotone' | 'fill'
}) {
  return createElement(iconFor(name), { size, weight })
}

/**
 * Wizard step 1 on /pawn/new — operator picks a top-level category, then
 * (if that top has sub-categories) picks a sub. Cascade-renders both
 * steps inline so the operator never leaves the page.
 *
 * onPick fires with (topSlug, subSlug):
 *   - top has subs → onPick fires when a sub tile is clicked
 *     (subSlug is the picked sub's slug)
 *   - top has no subs → onPick fires immediately on the top click
 *     (subSlug is null)
 */
export default function CategoryPicker({
  categories,
  onPick,
}: {
  categories: PawnIntakeCategory[]
  onPick: (topSlug: string, subSlug: string | null) => void
}) {
  const { t } = useI18n()
  const [drilledTop, setDrilledTop] = useState<PawnIntakeCategory | null>(null)

  if (categories.length === 0) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-6 text-center text-sm text-warning">
        {t.pawn.new_.categoryNoneConfigured}
      </div>
    )
  }

  function onTopClick(top: PawnIntakeCategory) {
    if (top.subcategories.length === 0) {
      // No subs — advance directly.
      onPick(top.slug, null)
      return
    }
    setDrilledTop(top)
  }

  // Drilled-in view — show the picked top's sub-tiles.
  if (drilledTop) {
    return (
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <legend className="px-1 font-display text-base font-semibold text-foreground">
            {drilledTop.label} → {t.pawn.new_.categorySubStepTitle}
          </legend>
          <button
            type="button"
            onClick={() => setDrilledTop(null)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-blue"
          >
            <ArrowLeft size={12} weight="bold" />
            {t.pawn.new_.categoryBackToTop}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          {t.pawn.new_.categorySubStepHelp}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {drilledTop.subcategories.map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => onPick(drilledTop.slug, sub.slug)}
              className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-background p-3 text-center transition-all hover:-translate-y-1 hover:border-gold/60 hover:bg-gold/5 hover:shadow-lg"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10 text-gold transition-colors group-hover:bg-gold/20">
                <CategoryIcon name={sub.icon} size={22} weight="duotone" />
              </span>
              <span className="font-display text-sm font-bold uppercase tracking-wide text-foreground">
                {sub.label}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
    )
  }

  // Top-level view.
  return (
    <fieldset className="rounded-xl border border-border bg-card p-5">
      <legend className="px-1 font-display text-base font-semibold text-foreground">
        {t.pawn.new_.categoryStepTitle}
      </legend>
      <p className="mt-1 text-xs text-muted">{t.pawn.new_.categoryStepHelp}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onTopClick(c)}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-background p-4 text-center transition-all hover:-translate-y-1 hover:border-gold/60 hover:bg-gold/5 hover:shadow-lg"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-gold/10 text-gold transition-colors group-hover:bg-gold/20">
              <CategoryIcon name={c.icon} size={32} weight="duotone" />
            </span>
            <span className="font-display text-base font-bold uppercase tracking-wide text-foreground">
              {c.label}
            </span>
            {c.subcategories.length > 0 ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {c.subcategories.length} {t.pawn.new_.categorySubcountSuffix}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Compact picked-category banner shown at the top of the form AFTER step
 * 1 is complete. Includes a "Change" button that calls onChange (returns
 * to picker view).
 */
export function CategoryBanner({
  category,
  subcategory,
  onChange,
}: {
  category: PawnIntakeCategory
  /** Optional — null when the parent has no subs. */
  subcategory: { slug: string; label: string; icon: string } | null
  onChange: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-gold/40 bg-gold/5 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/10 text-gold">
        <CategoryIcon
          name={subcategory?.icon ?? category.icon}
          size={20}
          weight="duotone"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t.pawn.new_.categoryStepTitle}
        </div>
        <div className="font-display text-base font-bold text-foreground">
          {category.label}
          {subcategory ? (
            <>
              <span className="mx-2 text-muted">→</span>
              {subcategory.label}
            </>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-blue/40 hover:bg-blue/5 hover:text-blue"
      >
        {t.pawn.new_.categoryChange}
      </button>
    </div>
  )
}
