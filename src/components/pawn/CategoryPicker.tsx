'use client'

import { createElement } from 'react'
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
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

export type PawnIntakeCategory = {
  id: string
  slug: string
  label: string
  icon: string
  requires_ffl: boolean
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
 * Wizard step 1 on /pawn/new — operator picks a high-level category.
 * Tiles render in sort_order. Firearms-flagged tiles are pre-filtered
 * by the parent page based on tenants.has_firearms (this component
 * just renders whatever it's given).
 */
export default function CategoryPicker({
  categories,
  onPick,
}: {
  categories: PawnIntakeCategory[]
  onPick: (slug: string) => void
}) {
  const { t } = useI18n()

  if (categories.length === 0) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-6 text-center text-sm text-warning">
        {t.pawn.new_.categoryNoneConfigured}
      </div>
    )
  }

  return (
    <fieldset className="rounded-xl border border-border bg-card p-5">
      <legend className="px-1 font-display text-base font-semibold text-foreground">
        {t.pawn.new_.categoryStepTitle}
      </legend>
      <p className="mt-1 text-xs text-muted">
        {t.pawn.new_.categoryStepHelp}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.slug)}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-background p-4 text-center transition-all hover:-translate-y-1 hover:border-gold/60 hover:bg-gold/5 hover:shadow-lg"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-gold/10 text-gold transition-colors group-hover:bg-gold/20">
              <CategoryIcon name={c.icon} size={32} weight="duotone" />
            </span>
            <span className="font-display text-base font-bold uppercase tracking-wide text-foreground">
              {c.label}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Compact picked-category banner shown at the top of the form AFTER step
 * 1 is complete. Includes a "Change" button that calls onChange with no
 * args (returns to picker view).
 */
export function CategoryBanner({
  category,
  onChange,
}: {
  category: PawnIntakeCategory
  onChange: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-gold/40 bg-gold/5 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/10 text-gold">
        <CategoryIcon name={category.icon} size={20} weight="duotone" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t.pawn.new_.categoryStepTitle}
        </div>
        <div className="font-display text-base font-bold text-foreground">
          {category.label}
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
