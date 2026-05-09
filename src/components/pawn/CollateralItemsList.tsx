'use client'

import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import Image from 'next/image'
import { Plus, Trash, Camera } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { WatchModelMatch } from './InlinePawnCalculator'
import type {
  InventoryCategory,
  MetalType,
} from '@/types/database-aliases'
import CategoryPicker, {
  CategoryBanner,
  type PawnIntakeCategory,
} from './CategoryPicker'

/**
 * Imperative handle exposed by CollateralItemsList. The /pawn/new form
 * uses this to push a populated row into the list when the operator
 * picks a watch model from the inline calculator's typeahead.
 *
 * Why imperative instead of lifting state to the parent: collateral
 * row state is large (each row owns a description, category, metal,
 * karat, weight, est_value, photo File + preview URL) and lifting it
 * would require re-plumbing every keystroke through the parent, which
 * complicates the existing form action serialization. The handle lets
 * the parent INSERT a new pre-populated row without owning the rest of
 * the list's state.
 */
export type CollateralListHandle = {
  addWatchRow: (match: WatchModelMatch) => void
  /**
   * Append (or replace the pristine seed row with) a row populated from
   * voice-extracted collateral data. Same in-place-replace behavior as
   * addWatchRow so the typical "operator opens form, voice fills it"
   * path keeps the row count at 1.
   */
  addExtractedRow: (extracted: {
    description: string
    category: InventoryCategory
    metal_type: MetalType | ''
    karat: string
    weight_grams: string
    est_value: string
  }) => void
}

/**
 * Inline editor for the collateral list on /pawn/new. Each row collects:
 *   pawn_category_slug + pawn_subcategory_slug — the per-item pawn
 *     intake category (top + optional sub) picked from a CategoryPicker
 *     rendered at the top of the row (patches/0040). Until the row's
 *     category is picked, only the picker shows.
 *   description, category, metal_type, karat, weight_grams, est_value, photo
 *
 * Photos are kept as File objects in component state. On submit, the form
 * action serializes them via FormData under names:
 *   collateral_count               — number of rows
 *   collateral_<n>_pawn_category    — top-level slug
 *   collateral_<n>_pawn_subcategory — sub slug (empty when no sub)
 *   collateral_<n>_description
 *   collateral_<n>_category         — inventory_category enum (separate)
 *   collateral_<n>_metal_type
 *   collateral_<n>_karat
 *   collateral_<n>_weight_grams
 *   collateral_<n>_est_value
 *   collateral_<n>_photo            — the File (optional)
 *
 * The server action reads these via formData.get(`collateral_<n>_*`).
 *
 * At least one row is enforced client-side AND server-side.
 */

const CATEGORY_OPTIONS: ReadonlyArray<{ value: InventoryCategory; key: string }> = [
  { value: 'ring', key: 'catRing' },
  { value: 'necklace', key: 'catNecklace' },
  { value: 'bracelet', key: 'catBracelet' },
  { value: 'earrings', key: 'catEarrings' },
  { value: 'pendant', key: 'catPendant' },
  { value: 'chain', key: 'catChain' },
  { value: 'watch', key: 'catWatch' },
  { value: 'coin', key: 'catCoin' },
  { value: 'bullion', key: 'catBullion' },
  { value: 'loose_stone', key: 'catLooseStone' },
  { value: 'electronics', key: 'catElectronics' },
  { value: 'tool', key: 'catTool' },
  { value: 'instrument', key: 'catInstrument' },
  { value: 'other', key: 'catOther' },
]

const METAL_OPTIONS: ReadonlyArray<{ value: MetalType; key: string }> = [
  { value: 'gold', key: 'metalGold' },
  { value: 'silver', key: 'metalSilver' },
  { value: 'platinum', key: 'metalPlatinum' },
  { value: 'palladium', key: 'metalPalladium' },
  { value: 'rose_gold', key: 'metalRoseGold' },
  { value: 'white_gold', key: 'metalWhiteGold' },
  { value: 'tungsten', key: 'metalTungsten' },
  { value: 'titanium', key: 'metalTitanium' },
  { value: 'stainless_steel', key: 'metalStainlessSteel' },
  { value: 'mixed', key: 'metalMixed' },
  { value: 'none', key: 'metalNone' },
  { value: 'other', key: 'metalOther' },
]

type Row = {
  /** stable id per row, only for React key */
  uid: string
  /** pawn_intake_categories.slug — top-level. NULL = picker still
   *  visible at the top of the row. */
  pawn_category_slug: string | null
  /** pawn_intake_categories.slug — sub. NULL when the picked top has
   *  no subs OR no top picked yet. */
  pawn_subcategory_slug: string | null
  description: string
  category: InventoryCategory
  metal_type: MetalType | ''
  karat: string
  weight_grams: string
  est_value: string
  photo: File | null
  photoPreview: string | null
}

function newRow(): Row {
  return {
    uid: typeof crypto !== 'undefined' ? crypto.randomUUID() : `r${Math.random()}`,
    pawn_category_slug: null,
    pawn_subcategory_slug: null,
    description: '',
    category: 'other',
    metal_type: '',
    karat: '',
    weight_grams: '',
    est_value: '0',
    photo: null,
    photoPreview: null,
  }
}

export const CollateralItemsList = forwardRef<
  CollateralListHandle,
  { categories: PawnIntakeCategory[] }
>(function CollateralItemsList({ categories }, ref) {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([newRow()])

  // Default category for auto-populated rows (voice intake / watch
  // typeahead). Prefer 'general' (no subs, no extra picker step) then
  // fall back to whatever's first in the seeded list. Same behavior
  // as the prior wizard step 1.
  const defaultCategorySlug =
    categories.find((c) => c.slug === 'general')?.slug ??
    categories[0]?.slug ??
    null
  // Default for the watch typeahead: jewelry → watch when those exist
  // in the tenant's category list, else fall through to defaultCategorySlug.
  const watchCategorySlug =
    categories.find((c) => c.slug === 'jewelry')?.slug ?? defaultCategorySlug
  const watchSubcategorySlug =
    categories
      .find((c) => c.slug === 'jewelry')
      ?.subcategories.find((s) => s.slug === 'watch')?.slug ?? null

  function addRow() {
    setRows((prev) => [...prev, newRow()])
  }

  function removeRow(uid: string) {
    setRows((prev) => {
      const next = prev.filter((r) => r.uid !== uid)
      // Always keep at least one row.
      return next.length === 0 ? [newRow()] : next
    })
  }

  function patchRow(uid: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    )
  }

  // Build a populated row from a WatchModelMatch. Description follows
  // the existing describeWatch() pattern from InlinePawnCalculator
  // (brand + model + ref + year). est_value is the midpoint of
  // min/max — same anchor the calculator surfaces in its midValue
  // tile. Metal / karat / weight stay blank because watches are
  // typically valued by reference, not melt.
  function buildWatchRow(match: WatchModelMatch): Row {
    const yearLabel =
      match.year_start === match.year_end
        ? `${match.year_start}`
        : `${match.year_start}–${match.year_end}`
    const description = `${match.brand} ${match.model} ref ${match.reference_no} (${yearLabel})`
    const midpoint = Math.round(
      (match.est_value_min + match.est_value_max) / 2,
    )
    return {
      ...newRow(),
      pawn_category_slug: watchCategorySlug,
      pawn_subcategory_slug: watchSubcategorySlug,
      description,
      category: 'watch',
      est_value: midpoint.toString(),
    }
  }

  // If the first row is still pristine (default empty values), reuse
  // it instead of appending — saves the operator the click to delete
  // the placeholder row that newRow() seeds. Pristine = no category
  // picked yet, empty description, default category, no photo,
  // est_value still '0'.
  function isPristineRow(r: Row): boolean {
    return (
      r.pawn_category_slug == null &&
      r.description.trim() === '' &&
      r.category === 'other' &&
      r.metal_type === '' &&
      r.karat === '' &&
      r.weight_grams === '' &&
      r.est_value === '0' &&
      r.photo == null
    )
  }

  useImperativeHandle(
    ref,
    () => ({
      addWatchRow(match) {
        const built = buildWatchRow(match)
        setRows((prev) => {
          if (prev.length === 1 && isPristineRow(prev[0])) {
            // Replace the seed row in place so the row count stays at 1
            // for the typical "operator opens form, picks a watch" path.
            return [{ ...built, uid: prev[0].uid }]
          }
          return [...prev, built]
        })
      },
      addExtractedRow(extracted) {
        const built: Row = {
          ...newRow(),
          // Voice intake doesn't yet emit a pawn_intake_categories
          // slug — default the auto-row to the tenant's 'general'
          // category (or the first available) so the row reveals
          // its fields immediately. Operator can hit Change.
          pawn_category_slug: defaultCategorySlug,
          pawn_subcategory_slug: null,
          description: extracted.description,
          category: extracted.category,
          metal_type: extracted.metal_type,
          karat: extracted.karat,
          weight_grams: extracted.weight_grams,
          est_value: extracted.est_value || '0',
        }
        setRows((prev) => {
          if (prev.length === 1 && isPristineRow(prev[0])) {
            return [{ ...built, uid: prev[0].uid }]
          }
          return [...prev, built]
        })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <div className="space-y-3">
      <input type="hidden" name="collateral_count" value={rows.length} />
      {rows.map((row, idx) => (
        <CollateralRow
          key={row.uid}
          index={idx}
          row={row}
          categories={categories}
          onChange={(patch) => patchRow(row.uid, patch)}
          onRemove={() => removeRow(row.uid)}
          canRemove={rows.length > 1}
          tCategory={(c) =>
            (t.inventory as unknown as Record<string, string>)[
              CATEGORY_OPTIONS.find((o) => o.value === c)?.key ?? 'catOther'
            ] ?? c
          }
          tMetal={(m) =>
            (t.inventory as unknown as Record<string, string>)[
              METAL_OPTIONS.find((o) => o.value === m)?.key ?? 'metalOther'
            ] ?? m
          }
        />
      ))}

      <div>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-background hover:text-foreground"
        >
          <Plus size={14} weight="bold" />
          {t.pawn.new_.addItem}
        </button>
      </div>
    </div>
  )
})

function CollateralRow({
  index,
  row,
  categories,
  onChange,
  onRemove,
  canRemove,
  tCategory,
  tMetal,
}: {
  index: number
  row: Row
  categories: PawnIntakeCategory[]
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
  canRemove: boolean
  tCategory: (c: InventoryCategory) => string
  tMetal: (m: MetalType) => string
}) {
  const { t } = useI18n()
  const photoInputRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()

  // Resolve the picked top + sub once per render. Both null until the
  // operator picks via the inline CategoryPicker.
  const selectedCategory =
    row.pawn_category_slug
      ? categories.find((c) => c.slug === row.pawn_category_slug) ?? null
      : null
  const selectedSubcategory =
    selectedCategory && row.pawn_subcategory_slug
      ? selectedCategory.subcategories.find(
          (s) => s.slug === row.pawn_subcategory_slug,
        ) ?? null
      : null
  // Row's category step is "done" when the top is picked AND either
  // it has no subs or a sub is also picked. Mirrors the prior loan-
  // level wizard logic.
  const categoryStepDone =
    selectedCategory != null &&
    (selectedCategory.subcategories.length === 0 ||
      selectedSubcategory != null)

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (!file) {
      onChange({ photo: null, photoPreview: null })
      return
    }
    const preview = URL.createObjectURL(file)
    onChange({ photo: file, photoPreview: preview })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      {/* Hidden inputs always present so the form action sees the
          slug pair on submit. Empty strings serialize fine — the
          server-side schema treats empty as null. */}
      <input
        type="hidden"
        name={`collateral_${index}_pawn_category`}
        value={row.pawn_category_slug ?? ''}
      />
      <input
        type="hidden"
        name={`collateral_${index}_pawn_subcategory`}
        value={row.pawn_subcategory_slug ?? ''}
      />

      {/* Per-row pawn intake category picker. While not picked, only
          the picker shows — fields below are hidden so the operator
          must classify the item before describing it. Once picked,
          the banner replaces the picker and the rest of the row
          reveals. */}
      {!categoryStepDone ? (
        <div className="mb-3">
          <CategoryPicker
            categories={categories}
            onPick={(topSlug, subSlug) =>
              onChange({
                pawn_category_slug: topSlug,
                pawn_subcategory_slug: subSlug,
              })
            }
          />
        </div>
      ) : (
        <div className="mb-3">
          <CategoryBanner
            category={selectedCategory!}
            subcategory={selectedSubcategory}
            onChange={() =>
              onChange({
                pawn_category_slug: null,
                pawn_subcategory_slug: null,
              })
            }
          />
        </div>
      )}

      {categoryStepDone ? (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        {/* Photo */}
        <div className="md:col-span-2">
          <span className="mb-1 block text-xs font-medium text-foreground">
            {t.pawn.new_.itemPhoto}
          </span>
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="group relative flex h-24 w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-background hover:bg-background hover:text-foreground"
            aria-label={t.pawn.new_.itemPhoto}
          >
            {row.photoPreview ? (
              <Image
                src={row.photoPreview}
                alt=""
                fill
                sizes="120px"
                unoptimized
                className="object-cover"
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-muted">
                <Camera size={20} weight="regular" />
                <span className="text-[10px]">{t.common.upload}</span>
              </span>
            )}
          </button>
          <input
            ref={photoInputRef}
            type="file"
            name={`collateral_${index}_photo`}
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={onPhotoChange}
            className="sr-only"
          />
        </div>

        {/* Fields */}
        <div className="md:col-span-10 grid grid-cols-1 gap-3 md:grid-cols-6">
          <label className="md:col-span-3 block space-y-1">
            <span className="text-xs font-medium text-foreground">
              {t.pawn.new_.itemDescription} *
            </span>
            <input
              type="text"
              name={`collateral_${index}_description`}
              required
              value={row.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="14k gold rope chain, 22 inches"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>

          <label className="md:col-span-3 block space-y-1">
            <span className="text-xs font-medium text-foreground">
              {t.pawn.new_.itemCategory}
            </span>
            <select
              name={`collateral_${index}_category`}
              value={row.category}
              onChange={(e) =>
                onChange({ category: e.target.value as InventoryCategory })
              }
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {tCategory(opt.value)}
                </option>
              ))}
            </select>
          </label>

          <label className="md:col-span-2 block space-y-1">
            <span className="text-xs font-medium text-foreground">
              {t.pawn.new_.itemMetalType}
            </span>
            <select
              name={`collateral_${index}_metal_type`}
              value={row.metal_type}
              onChange={(e) =>
                onChange({ metal_type: e.target.value as MetalType | '' })
              }
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            >
              <option value="">—</option>
              {METAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {tMetal(opt.value)}
                </option>
              ))}
            </select>
          </label>

          <label className="md:col-span-1 block space-y-1">
            <span className="text-xs font-medium text-foreground">
              {t.pawn.new_.itemKarat}
            </span>
            <input
              type="number"
              step="0.5"
              min={0}
              max={24}
              name={`collateral_${index}_karat`}
              value={row.karat}
              onChange={(e) => onChange({ karat: e.target.value })}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>

          <label className="md:col-span-1 block space-y-1">
            <span className="text-xs font-medium text-foreground">
              {t.pawn.new_.itemWeightGrams}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              name={`collateral_${index}_weight_grams`}
              value={row.weight_grams}
              onChange={(e) => onChange({ weight_grams: e.target.value })}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>

          <label className="md:col-span-2 block space-y-1">
            <span className="text-xs font-medium text-foreground">
              {t.pawn.new_.itemEstValue}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              name={`collateral_${index}_est_value`}
              value={row.est_value}
              onChange={(e) => onChange({ est_value: e.target.value })}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>
        </div>
      </div>
      ) : null}

      {canRemove ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
            aria-label={`${t.pawn.new_.removeItem} ${index + 1}`}
            data-row-id={fieldId}
          >
            <Trash size={12} weight="bold" />
            {t.pawn.new_.removeItem}
          </button>
        </div>
      ) : null}
    </div>
  )
}
