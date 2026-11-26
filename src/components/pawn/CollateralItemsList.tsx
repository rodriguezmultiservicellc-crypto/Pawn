'use client'

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Plus, Sparkle, Warning, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { PhotoStrip, type StripPhoto } from '@/components/uploads/PhotoStrip'
import { inventoryCategoryFromSlug } from '@/lib/pawn/intake-categories'
import { photoItemPatch, type PhotoItem } from '@/lib/pawn/photo-describe'
import { en } from '@/lib/i18n/en'
import { FOCUS, INPUT, LABEL, OUTLINE_BTN, PRIMARY_BTN } from '@/lib/ui/ledger'
import {
  COATINGS,
  isPurityInput,
  isSolidMetal,
  purityAfterMetalChange,
  type Coating,
} from '@/lib/spot-prices/purity'
import { PurityField } from './PurityField'
import { GRAMS_PER } from '@/lib/bench/weight'
import type { WatchModelMatch } from './InlinePawnCalculator'
import type {
  InventoryCategory,
  MetalType,
} from '@/types/database-aliases'
import type { PreviousPawnItem } from '@/lib/pawn/customer-history'
import {
  JEWELRY_GENDERS,
  descriptionAfterChange,
  generateItemDescription,
  isLengthPiece,
  type ItemDescriptionKind,
  type JewelryGender,
} from '@/lib/pawn/item-description'
import {
  MAX_STONES,
  blankStone,
  gemstoneText,
  stonesToDrafts,
  type StoneDraft,
} from '@/lib/pawn/stones'
import {
  estValueAfterChange,
  itemMetalValue,
  metalValueText,
  type ItemMetalValue,
} from '@/lib/pawn/item-metal-value'
import type { RateMaps } from '@/lib/metal-counter/math'
import {
  GENERAL_COLOR_KEYS,
  JEWELRY_COLOR_KEYS,
  STONE_TYPE_KEYS,
  choicesFrom,
  matchChoice,
  styleKeysFor,
} from '@/lib/pawn/item-options'
import { ChoiceOrOther } from './ChoiceOrOther'
import { PawnedBeforeDialog } from './PawnedBeforeDialog'
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
    /** A resumed draft's photos, already signed to show. */
    photos?: StripPhoto[]
  }) => void
}

/**
 * The collateral list on /pawn/new: a table with one line per item, and
 * each item's fields in a popup (see CollateralRow). Each row collects:
 *   pawn_category_slug + pawn_subcategory_slug — the per-item pawn
 *     intake category (top + optional sub) picked from a CategoryPicker
 *     at the top of the popup (patches/0040). Until the category is
 *     picked, only the picker shows.
 *   est_value, color, the category's own fields, unique marks, photo, and
 *     the description — written from the other fields while the clerk
 *     leaves it alone (lib/pawn/item-description).
 *
 * Photos upload to storage the moment they are picked; the row keeps their
 * paths. On submit, the form action reads the rows from FormData under names:
 *   collateral_count               — number of rows
 *   collateral_<n>_pawn_category    — top-level slug
 *   collateral_<n>_pawn_subcategory — sub slug (empty when no sub)
 *   collateral_<n>_description
 *   collateral_<n>_category         — inventory_category enum (separate)
 *   collateral_<n>_metal_type
 *   collateral_<n>_karat
 *   collateral_<n>_weight_grams
 *   collateral_<n>_est_value
 *   collateral_<n>_photos           — JSON list of the photos' storage
 *                                     paths, main first (already uploaded)
 *
 * The server action reads these via formData.get(`collateral_<n>_*`).
 *
 * At least one row is enforced client-side AND server-side.
 */

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

type FirearmType = 'handgun' | 'rifle' | 'shotgun' | 'other' | ''

type Row = {
  /** stable id per row, only for React key */
  uid: string
  /** pawn_intake_categories.slug — top-level. NULL = picker still
   *  visible at the top of the row. */
  pawn_category_slug: string | null
  /** pawn_intake_categories.slug — sub. NULL when the picked top has
   *  no subs OR no top picked yet. */
  pawn_subcategory_slug: string | null
  /** UI only, never submitted: the top-level category a pill chose while
   *  the clerk still has to pick its sub-category. */
  pending_top_slug: string | null
  description: string
  category: InventoryCategory
  // Jewelry attributes (existing, only shown for 'jewelry' top).
  metal_type: MetalType | ''
  karat: string
  weight_grams: string
  /** Surface coating (patches/0067). Not 'none' ⇒ not solid gold ⇒ no
   *  melt in the suggested loan. Jewelry-only. */
  coating: Coating
  /** Free-text size (rings) or length (chains/bracelets). Jewelry-only.
   *  patches/0042. */
  jewelry_size: string
  /** UI only: the unit the clerk types the weight in. weight_grams is
   *  always what is kept and submitted. */
  weight_unit: 'g' | 'dwt'
  /** UI only: the number as typed while the unit is dwt. */
  weight_dwt: string
  /** Who the piece is made for (patches/0106). Jewelry-only. */
  jewelry_gender: JewelryGender | ''
  /** Cuban link, Solitaire, Band… free text (patches/0106). */
  jewelry_style: string
  /** FS 539.001(8)(b)2.a-c for a watch or a signed piece (patches/0106). */
  jewelry_brand: string
  jewelry_model: string
  jewelry_serial: string
  /** FS 539.001(8)(b)2.g in boxes — one line per kind of stone. */
  stones: StoneDraft[]
  /** Whatever about the stones does not fit the boxes. */
  gemstone_notes: string
  // Common FS 539.001 fields (patches/0043) — visible across all
  // categories.
  /** FS 539.001(8)(b)(2)(e) — apparent color. */
  color: string
  /** FS 539.001(8)(b)(2)(i) — any other unique identifying marks. */
  unique_marks: string
  // Firearm attributes (patches/0041 + 0043, only shown for
  // 'firearms' top).
  firearm_make: string
  firearm_model: string
  firearm_caliber: string
  firearm_serial_number: string
  firearm_type: FirearmType
  firearm_barrel_length_inches: string
  firearm_action_type: string
  firearm_capacity: string
  /** FS 539.001(8)(b)(2)(h) — finish (blued/stainless/cerakote/etc). */
  firearm_finish: string
  /** FS 539.001(8)(b)(2)(h) — number of barrels (1 / 2 / etc). */
  firearm_number_of_barrels: string
  // Electronic attributes (patches/0041, only shown for 'electronics').
  electronic_brand: string
  electronic_model: string
  electronic_serial: string
  // Tool attributes (patches/0041, only shown for 'tools').
  tool_brand: string
  tool_model: string
  /** FS 539.001(8)(b)2.c for a tool (patches/0107). */
  tool_serial: string
  /** FS 539.001(8)(b)2.a-c for an item whose category has no fields of its
   *  own — General, or one the shop added (patches/0107). */
  general_brand: string
  general_model: string
  general_serial: string
  /** FS 539.001(8)(b)2.d — size of anything that is not jewelry. */
  item_size: string
  est_value: string
  /** The item's photos, already uploaded (components/uploads/PhotoStrip).
   *  The first is the main one. */
  photos: StripPhoto[]
}

/**
 * Most jewelry pawned is yellow gold: a jewelry piece starts on Gold and
 * Yellow, and the clerk changes them when it isn't. Only fills what is still
 * empty; watches and every other category start blank.
 */
function jewelryStartValues(
  row: Pick<Row, 'metal_type' | 'color'>,
  topSlug: string | null,
  subSlug: string | null,
): Partial<Row> {
  if (topSlug !== 'jewelry' || subSlug === 'watches' || subSlug === 'watch') return {}
  return {
    ...(row.metal_type === '' ? { metal_type: 'gold' as const } : {}),
    ...(row.color === '' ? { color: en.pawn.new_.colors.yellow } : {}),
  }
}

function newRow(): Row {
  return {
    uid: typeof crypto !== 'undefined' ? crypto.randomUUID() : `r${Math.random()}`,
    pawn_category_slug: null,
    pawn_subcategory_slug: null,
    pending_top_slug: null,
    description: '',
    category: 'other',
    metal_type: '',
    karat: '',
    weight_grams: '',
    coating: 'none',
    jewelry_size: '',
    weight_unit: 'g',
    weight_dwt: '',
    jewelry_gender: '',
    jewelry_style: '',
    jewelry_brand: '',
    jewelry_model: '',
    jewelry_serial: '',
    stones: [blankStone()],
    gemstone_notes: '',
    color: '',
    unique_marks: '',
    firearm_make: '',
    firearm_model: '',
    firearm_caliber: '',
    firearm_serial_number: '',
    firearm_type: '',
    firearm_barrel_length_inches: '',
    firearm_action_type: '',
    firearm_capacity: '',
    firearm_finish: '',
    firearm_number_of_barrels: '',
    electronic_brand: '',
    electronic_model: '',
    electronic_serial: '',
    tool_brand: '',
    tool_model: '',
    tool_serial: '',
    general_brand: '',
    general_model: '',
    general_serial: '',
    item_size: '',
    est_value: '0',
    photos: [],
  }
}

export const CollateralItemsList = forwardRef<
  CollateralListHandle,
  {
    categories: PawnIntakeCategory[]
    /** Spot per gram + the shop's pay percent per karat — a jewelry
     *  item's metal value, and its Est. value by default. */
    metalRates: RateMaps
    /** Reports running { item count, summed est_value } up to the parent
     *  so the loan-summary rail can show collateral value + LTV live. */
    onTotalsChange?: (count: number, totalValue: number) => void
    /** Section label shown before the category pills. */
    title: string
    /** Pieces this customer pawned and picked up before. ONE pill opens the
     *  list; adding a piece writes it again with what was lent last time. */
    previousItems?: ReadonlyArray<PreviousPawnItem>
    /** The shop: its folder is where an item's photos upload to. */
    tenantId: string
    /** What an item's amount is called ("Price paid" on a purchase,
     *  patches/0115). Default: Est. value. */
    valueLabel?: string
  }
>(function CollateralItemsList(
  { categories, metalRates, onTotalsChange, title, previousItems = [], tenantId, valueLabel },
  ref,
) {
  const { t } = useI18n()
  // Starts empty: the table shows "Pick a category above…" until a pill,
  // voice intake or a resumed draft adds the first row.
  const [rows, setRows] = useState<Row[]>([])
  // The one item whose popup is open. `adding`: a pill just started it, so
  // leaving the popup without "Add item" takes the row away again.
  // `report`: Issue found a required field empty in a closed row — the popup
  // opens pointing at that field.
  const [popup, setPopup] = useState<{
    uid: string
    adding: boolean
    report: boolean
  } | null>(null)
  // The "Pawned before" list, and which of its pieces are on this ticket.
  const [beforeOpen, setBeforeOpen] = useState(false)
  const [beforeAdded, setBeforeAdded] = useState<ReadonlySet<string>>(new Set())
  // Another customer's pieces: nothing from the new list is on the ticket yet.
  const beforeSig = previousItems.map((p) => p.key).join('|')
  const [beforeSigSeen, setBeforeSigSeen] = useState(beforeSig)
  if (beforeSigSeen !== beforeSig) {
    setBeforeSigSeen(beforeSig)
    setBeforeAdded(new Set())
    setBeforeOpen(false)
  }

  // Report collateral count + total est_value up to the rail whenever rows
  // change. Counts only rows the operator has actually started (a picked
  // category or a non-empty description) so the seeded pristine row reads
  // as 0 items / $0.
  useEffect(() => {
    if (!onTotalsChange) return
    let count = 0
    let total = 0
    for (const r of rows) {
      const started =
        r.pawn_category_slug != null || r.description.trim() !== ''
      if (!started) continue
      count += 1
      total += parseFloat(r.est_value) || 0
    }
    onTotalsChange(count, total)
  }, [rows, onTotalsChange])

  // Default category for auto-populated rows (voice intake / watch
  // typeahead). Prefer 'general' (no subs, no extra picker step) then
  // fall back to whatever's first in the seeded list. Same behavior
  // as the prior wizard step 1.
  const defaultCategorySlug =
    categories.find((c) => c.slug === 'general')?.slug ??
    categories[0]?.slug ??
    null
  // Default for the watch typeahead: jewelry → watches when those exist
  // in the tenant's category list, else fall through to defaultCategorySlug.
  // The seeded sub-category is 'watches' (patches seed, xPawn import);
  // 'watch' is accepted for a shop that named its own.
  const watchCategorySlug =
    categories.find((c) => c.slug === 'jewelry')?.slug ?? defaultCategorySlug
  const watchSubcategorySlug =
    categories
      .find((c) => c.slug === 'jewelry')
      ?.subcategories.find((s) => s.slug === 'watches' || s.slug === 'watch')?.slug ?? null

  // A category pill opens the new item's popup: a category with no
  // sub-categories is picked outright; one with subs starts on its
  // sub-category step.
  function addFromCategory(c: PawnIntakeCategory) {
    const base: Row = { ...newRow(), weight_unit: rememberedWeightUnit() }
    const row: Row =
      c.subcategories.length === 0
        ? {
            ...base,
            ...jewelryStartValues(base, c.slug, null),
            pawn_category_slug: c.slug,
            category: inventoryCategoryFromSlug(c.slug, null),
          }
        : { ...base, pending_top_slug: c.slug }
    setRows((prev) => [...prev, row])
    setPopup({ uid: row.uid, adding: true, report: false })
  }

  // A piece pawned before: the row arrives filled in and goes straight to
  // the table (several can be added from the list in one go); Edit opens it.
  // Its category must be one this shop still has; otherwise it goes under
  // the default and the clerk picks.
  function addPrevious(p: PreviousPawnItem) {
    const top = categories.find((c) => c.slug === p.pawn_category_slug)
    const sub = top?.subcategories.find((s) => s.slug === p.pawn_subcategory_slug)
    const firearmType: FirearmType =
      p.firearm_type === 'handgun' || p.firearm_type === 'rifle' || p.firearm_type === 'shotgun' || p.firearm_type === 'other'
        ? p.firearm_type
        : ''
    const previousStones = stonesToDrafts(p.stones)
    const row: Row = {
      ...newRow(),
      pawn_category_slug: top?.slug ?? defaultCategorySlug,
      pawn_subcategory_slug: sub?.slug ?? null,
      description: p.description,
      category: p.category as InventoryCategory,
      metal_type: (p.metal_type ?? '') as MetalType | '',
      karat: p.karat != null ? String(p.karat) : '',
      weight_grams: p.weight_grams != null ? String(p.weight_grams) : '',
      jewelry_size: p.jewelry_size ?? '',
      color: p.color ?? '',
      jewelry_gender: (JEWELRY_GENDERS as ReadonlyArray<string>).includes(p.jewelry_gender ?? '')
        ? (p.jewelry_gender as JewelryGender)
        : '',
      jewelry_style: p.jewelry_style ?? '',
      jewelry_brand: p.jewelry_brand ?? '',
      jewelry_model: p.jewelry_model ?? '',
      jewelry_serial: p.jewelry_serial ?? '',
      // A ticket from before the stones had boxes has only the one line:
      // it goes in the notes, where the clerk can read and keep it.
      stones: previousStones.length > 0 ? previousStones : [blankStone()],
      gemstone_notes:
        previousStones.length > 0
          ? p.gemstone_notes ?? ''
          : p.gemstone_notes ?? p.gemstone_description ?? '',
      unique_marks: p.unique_marks ?? '',
      firearm_make: p.firearm_make ?? '',
      firearm_model: p.firearm_model ?? '',
      firearm_caliber: p.firearm_caliber ?? '',
      firearm_serial_number: p.firearm_serial_number ?? '',
      firearm_type: firearmType,
      electronic_brand: p.electronic_brand ?? '',
      electronic_model: p.electronic_model ?? '',
      electronic_serial: p.electronic_serial ?? '',
      tool_brand: p.tool_brand ?? '',
      tool_model: p.tool_model ?? '',
      tool_serial: p.tool_serial ?? '',
      general_brand: p.general_brand ?? '',
      general_model: p.general_model ?? '',
      general_serial: p.general_serial ?? '',
      item_size: p.item_size ?? '',
      est_value: p.last_value > 0 ? String(p.last_value) : '0',
    }
    setRows((prev) => [...prev, row])
  }

  function removeRow(uid: string) {
    setRows((prev) => prev.filter((r) => r.uid !== uid))
    setPopup((prev) => (prev?.uid === uid ? null : prev))
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
      r.pending_top_slug == null &&
      r.description.trim() === '' &&
      r.category === 'other' &&
      r.metal_type === '' &&
      r.karat === '' &&
      r.weight_grams === '' &&
      r.coating === 'none' &&
      r.jewelry_size === '' &&
      r.jewelry_gender === '' &&
      r.jewelry_style === '' &&
      r.jewelry_brand === '' &&
      r.jewelry_model === '' &&
      r.jewelry_serial === '' &&
      gemstoneText(r.stones, r.gemstone_notes) === '' &&
      r.color === '' &&
      r.unique_marks === '' &&
      r.firearm_make === '' &&
      r.firearm_model === '' &&
      r.firearm_caliber === '' &&
      r.firearm_serial_number === '' &&
      r.firearm_type === '' &&
      r.firearm_barrel_length_inches === '' &&
      r.firearm_action_type === '' &&
      r.firearm_capacity === '' &&
      r.firearm_finish === '' &&
      r.firearm_number_of_barrels === '' &&
      r.electronic_brand === '' &&
      r.electronic_model === '' &&
      r.electronic_serial === '' &&
      r.tool_brand === '' &&
      r.tool_model === '' &&
      r.tool_serial === '' &&
      r.general_brand === '' &&
      r.general_model === '' &&
      r.general_serial === '' &&
      r.item_size === '' &&
      r.est_value === '0' &&
      r.photos.length === 0
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
          photos: extracted.photos ?? [],
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

  const tn = t.pawn.new_
  const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted'

  return (
    <div className="space-y-4">
      <input type="hidden" name="collateral_count" value={rows.length} />

      {/* "2 · Add collateral" + one pill per top-level category. A pill
          starts the same category → sub-category → item workflow the big
          tiles used to start. */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={`mr-2 ${LABEL}`}>{title}</h2>
        {categories.length === 0 ? (
          <p className="text-sm text-warning">{tn.categoryNoneConfigured}</p>
        ) : (
          categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => addFromCategory(c)}
              className={`inline-flex h-11 items-center gap-1 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:border-blue hover:bg-background ${FOCUS}`}
            >
              <Plus size={14} weight="bold" />
              {c.label}
            </button>
          ))
        )}
        {/* Pieces this customer pawned and picked up before: one pill, a
            list behind it. */}
        {previousItems.length > 0 ? (
          <button
            type="button"
            onClick={() => setBeforeOpen(true)}
            className={`inline-flex h-11 items-center gap-2 rounded-full border border-gold/60 bg-gold/10 px-4 text-sm font-semibold text-foreground transition-colors hover:border-gold hover:bg-gold/20 ${FOCUS}`}
          >
            <Plus size={14} weight="bold" />
            {tn.history.pawnedBefore}
            <span className="rounded-full bg-gold px-2 py-0.5 font-mono text-xs font-bold text-navy">
              {previousItems.length}
            </span>
          </button>
        ) : null}
      </div>
      {beforeOpen ? (
        <PawnedBeforeDialog
          items={previousItems}
          addedKeys={beforeAdded}
          onAdd={(p) => {
            addPrevious(p)
            setBeforeAdded((prev) => new Set(prev).add(p.key))
          }}
          onClose={() => setBeforeOpen(false)}
        />
      ) : null}

      <div
        className="min-h-[240px] overflow-x-auto rounded-lg border border-border [contain:inline-size]"
        // A required field in a closed item would block Issue with no
        // visible message — open that item's popup pointing at the field.
        // (A popup that is already open is checking its own fields.)
        onInvalidCapture={(e) => {
          const uid = (e.target as HTMLElement)
            .closest('[data-row-uid]')
            ?.getAttribute('data-row-uid')
          if (uid) {
            setPopup((prev) => prev ?? { uid, adding: false, report: true })
          }
        }}
      >
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-background">
            <tr className="border-b border-border">
              <th className={`${TH} w-12`}>{tn.colNo}</th>
              <th className={TH}>{tn.colCategory}</th>
              <th className={TH}>{tn.colDescription}</th>
              <th className={TH}>{tn.colWeightSerial}</th>
              <th className={`${TH} text-right`}>{valueLabel ?? tn.colValue}</th>
              <th className={`${TH} text-right`}>{tn.colActions}</th>
            </tr>
          </thead>
          {rows.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {tn.collateralEmpty}
                </td>
              </tr>
            </tbody>
          ) : (
            rows.map((row, idx) => (
              <CollateralRow
                key={row.uid}
                index={idx}
                row={row}
                tenantId={tenantId}
                categories={categories}
                metalRates={metalRates}
                open={popup?.uid === row.uid}
                adding={popup?.uid === row.uid && popup.adding}
                reportOnOpen={popup?.uid === row.uid && popup.report}
                onOpen={() =>
                  setPopup({ uid: row.uid, adding: false, report: false })
                }
                onClose={() =>
                  setPopup((prev) => (prev?.uid === row.uid ? null : prev))
                }
                onChange={(patch) => patchRow(row.uid, patch)}
                onRemove={() => removeRow(row.uid)}
                valueLabel={valueLabel}
                tMetal={(m) =>
                  (t.inventory as unknown as Record<string, string>)[
                    METAL_OPTIONS.find((o) => o.value === m)?.key ?? 'metalOther'
                  ] ?? m
                }
              />
            ))
          )}
        </table>
      </div>
    </div>
  )
})

/** One stone line on a wide screen: qty · stone · carats · color · cut · clarity · remove. */
const STONE_GRID =
  'md:grid-cols-[4.5rem_minmax(0,2fr)_6rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem]'

const WEIGHT_UNIT_KEY = 'pawn.intake.weightUnit'

/** The unit this counter weighed in last time — a dwt shop stays in dwt. */
function rememberedWeightUnit(): 'g' | 'dwt' {
  try {
    return window.localStorage.getItem(WEIGHT_UNIT_KEY) === 'dwt' ? 'dwt' : 'g'
  } catch {
    return 'g'
  }
}

function rememberWeightUnit(unit: 'g' | 'dwt') {
  try {
    window.localStorage.setItem(WEIGHT_UNIT_KEY, unit)
  } catch {
    // Private mode / storage off: the unit simply is not remembered.
  }
}

/** Pennyweight as typed → grams as kept (2 dp, like the scale reads). */
function gramsFromDwt(dwt: string): string {
  const n = parseFloat(dwt)
  if (!Number.isFinite(n) || n <= 0) return ''
  return String(Math.round(n * GRAMS_PER.dwt * 100) / 100)
}

/** Which fields a category has to write a description from. */
function descriptionKind(topSlug: string | null): ItemDescriptionKind {
  return topSlug === 'jewelry' ||
    topSlug === 'firearms' ||
    topSlug === 'electronics' ||
    topSlug === 'tools'
    ? topSlug
    : 'other'
}

/** Required fields filled in. A row that is not gets a mark in the table. */
function isRowComplete(row: Row, categoryStepDone: boolean): boolean {
  if (!categoryStepDone) return false
  if (row.description.trim() === '') return false
  if (!isPurityInput(row.metal_type, row.karat)) return false
  if (row.pawn_category_slug === 'firearms' && row.firearm_serial_number.trim() === '') {
    return false
  }
  return true
}

function fmtValue(v: string): string {
  const n = parseFloat(v)
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

/**
 * One collateral item: its line in the table, and its fields in a popup.
 *
 * The popup is a <dialog> that stays INSIDE the ticket's <form> and is
 * always mounted, open or not: the fields (and the photo's file input) are
 * what the form submits, so they can neither move to a portal nor unmount.
 * showModal() puts it above the page and keeps Tab inside it.
 */
function CollateralRow({
  index,
  row,
  tenantId,
  categories,
  metalRates,
  open,
  adding,
  reportOnOpen,
  onOpen,
  onClose,
  onChange: onRowChange,
  onRemove,
  tMetal,
  valueLabel,
}: {
  index: number
  row: Row
  tenantId: string
  categories: PawnIntakeCategory[]
  metalRates: RateMaps
  /** This item's popup is the one showing. */
  open: boolean
  /** A pill just started this item: leaving without "Add item" removes it. */
  adding: boolean
  /** Opened because Issue found a field wrong here — point at it. */
  reportOnOpen: boolean
  onOpen: () => void
  onClose: () => void
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
  tMetal: (m: MetalType) => string
  /** The item amount's label when it is not Est. value. */
  valueLabel?: string
}) {
  const { t } = useI18n()
  const tn = t.pawn.new_
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fieldId = useId()

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (!open) {
      if (d.open) d.close()
      return
    }
    if (!d.open) d.showModal()
    if (reportOnOpen) {
      d.querySelector<HTMLInputElement>('input:invalid, select:invalid')?.reportValidity()
    } else {
      d.querySelector<HTMLElement>('[data-first-field], [data-popup-card]')?.focus()
    }
  }, [open, reportOnOpen])

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

  // The Color and Style choices for a row: what the clerk reads, and the
  // English word that is saved.
  function colorChoicesFor(r: Row) {
    return choicesFrom(
      r.pawn_category_slug === 'jewelry' ? JEWELRY_COLOR_KEYS : GENERAL_COLOR_KEYS,
      en.pawn.new_.colors,
      tn.colors,
    )
  }
  function styleChoicesFor(r: Row) {
    return choicesFrom(styleKeysFor(r.category), en.pawn.new_.styles, tn.styles)
  }
  const stoneTypeChoices = choicesFrom(STONE_TYPE_KEYS, en.pawn.new_.stoneTypes, tn.stoneTypes)
  // The stones as they are saved and described: a stone typed under "Other"
  // that is one of the listed ones in the screen language ("Rubí") becomes
  // its English word, like Color and Style.
  function stonesInEnglish(stones: StoneDraft[]): StoneDraft[] {
    return stones.map((s) => ({
      ...s,
      type: matchChoice(s.type, stoneTypeChoices)?.value ?? s.type,
    }))
  }

  // The description this row's fields add up to. ALWAYS IN ENGLISH — every
  // word comes from the English dictionary, never from `t` — because FS
  // 539.001(8)(a) wants the form's entries in English.
  function describeRow(r: Row): string {
    const top = categories.find((c) => c.slug === r.pawn_category_slug) ?? null
    const sub = top?.subcategories.find((s) => s.slug === r.pawn_subcategory_slug) ?? null
    const inv = en.inventory
    const words = en.pawn.new_
    const jewelry = top?.slug === 'jewelry'
    const itemWords: Partial<Record<InventoryCategory, string>> = {
      ring: inv.catRing,
      necklace: inv.catNecklace,
      bracelet: inv.catBracelet,
      earrings: inv.catEarrings,
      pendant: inv.catPendant,
      chain: inv.catChain,
      watch: inv.catWatch,
      coin: inv.catCoin,
      bullion: inv.catBullion,
      loose_stone: inv.catLooseStone,
    }
    const firearmTypeWords: Record<FirearmType, string> = {
      '': '',
      handgun: words.itemFirearmTypeHandgun,
      rifle: words.itemFirearmTypeRifle,
      shotgun: words.itemFirearmTypeShotgun,
      other: '',
    }
    const metalKey = METAL_OPTIONS.find((o) => o.value === r.metal_type)?.key
    const metalWord =
      metalKey && r.metal_type !== 'none' && r.metal_type !== 'other'
        ? (inv as unknown as Record<string, string>)[metalKey] ?? ''
        : ''
    return generateItemDescription({
      kind: descriptionKind(top?.slug ?? null),
      itemWord: itemWords[r.category] ?? sub?.label ?? '',
      isRing: r.category === 'ring',
      isLength: isLengthPiece(r.category),
      // A value picked from the list is already English; one that only
      // matches a choice's shown word is turned into it.
      color: matchChoice(r.color, colorChoicesFor(r))?.value ?? r.color,
      metalWord,
      metal: r.metal_type,
      karat: r.karat,
      weightGrams: r.weight_grams,
      size: jewelry ? r.jewelry_size : r.item_size,
      coatingWord: isSolidMetal(r.coating) ? '' : inv.coatings[r.coating],
      gemstones: gemstoneText(stonesInEnglish(r.stones), r.gemstone_notes),
      gender: r.jewelry_gender,
      style: matchChoice(r.jewelry_style, styleChoicesFor(r))?.value ?? r.jewelry_style,
      jewelryBrand: r.jewelry_brand,
      jewelryModel: r.jewelry_model,
      firearmMake: r.firearm_make,
      firearmModel: r.firearm_model,
      firearmCaliber: r.firearm_caliber,
      firearmTypeWord: firearmTypeWords[r.firearm_type],
      firearmFinish: r.firearm_finish,
      electronicBrand: r.electronic_brand,
      electronicModel: r.electronic_model,
      toolBrand: r.tool_brand,
      toolModel: r.tool_model,
      generalBrand: r.general_brand,
      generalModel: r.general_model,
    })
  }

  // What this row's metal is worth: weight × spot at its karat × the shop's
  // pay percent. Jewelry only — the metal fields exist nowhere else.
  function metalValueOf(r: Row): ItemMetalValue {
    if (r.pawn_category_slug !== 'jewelry') return { status: 'incomplete' }
    return itemMetalValue(metalRates, {
      metal: r.metal_type,
      karat: r.karat,
      weightGrams: r.weight_grams,
      coating: r.coating,
    })
  }

  // Every field change goes through here. Two fields follow the others
  // until the clerk writes their own: the Est. value (the metal value) and
  // the description. `base` is the row the change is made to — the one on
  // screen, except after a wait (the photo reader), when it is the row as
  // it is by then.
  function onChange(patchIn: Partial<Row>, base: Row = row) {
    // A new metal brings its own purity (silver 925…) — purityAfterMetalChange.
    const patch = { ...patchIn }
    if ('metal_type' in patch && !('karat' in patch)) {
      const karat = purityAfterMetalChange(base.metal_type, patch.metal_type, base.karat)
      if (karat !== base.karat) patch.karat = karat
    }
    const after = { ...base, ...patch }
    const follow: Partial<Row> = {}
    if (!('est_value' in patch)) {
      const estValue = estValueAfterChange(
        base.est_value,
        metalValueText(metalValueOf(base)),
        metalValueText(metalValueOf(after)),
      )
      if (estValue !== base.est_value) follow.est_value = estValue
    }
    if (!('description' in patch)) {
      const description = descriptionAfterChange(
        base.description,
        describeRow(base),
        describeRow(after),
      )
      if (description !== base.description) follow.description = description
    }
    onRowChange({ ...patch, ...follow })
  }
  // FS 539.001(8)(b)2.d — the size of anything that is not jewelry (jewelry
  // has its own Size / Length). Electronics, tools and general items.
  const sizeField = (
    <label className="md:col-span-2 block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        {t.pawn.new_.itemSize}
      </span>
      <input
        type="text"
        name={`collateral_${index}_item_size`}
        value={row.item_size}
        onChange={(e) => onChange({ item_size: e.target.value })}
        placeholder={t.pawn.new_.itemSizePlaceholder}
        className={INPUT}
      />
    </label>
  )
  const metalValue = metalValueOf(row)
  const metalValueAsText = metalValueText(metalValue)

  // "Describe from photo": the photo goes to /api/ai/vision/pawn-item and
  // what can be SEEN in it fills the fields (lib/pawn/photo-describe says
  // what that is — never a weight, a value, or what a stone is). When the
  // photo shows another category than the one picked, the category is
  // changed, said so, and "Change back" undoes it.
  type AiNote =
    | { kind: 'filled' }
    | { kind: 'nothing' }
    | { kind: 'error'; text: string }
    | {
        kind: 'moved'
        seen: string
        from: string
        to: string
        back: Pick<Row, 'pawn_category_slug' | 'pawn_subcategory_slug' | 'category'>
      }
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState<AiNote | null>(null)
  // The photos showed different items: the answer describes the main one.
  const [aiPhotosDiffer, setAiPhotosDiffer] = useState(false)
  // The popup's steps. Stones only for jewelry. Opening the popup starts on
  // Photos.
  type Step = 'photos' | 'item' | 'stones'
  const steps: Step[] =
    selectedCategory?.slug === 'jewelry' ? ['photos', 'item', 'stones'] : ['photos', 'item']
  const [stepPicked, setStep] = useState<Step>('photos')
  const [openSeen, setOpenSeen] = useState(open)
  if (openSeen !== open) {
    setOpenSeen(open)
    if (open) setStep('photos')
  }
  const step: Step = steps.includes(stepPicked) ? stepPicked : 'item'
  // The row as it is now, for the answer that comes back seconds later.
  const rowNow = useRef(row)
  useEffect(() => {
    rowNow.current = row
  })

  function categoryLabel(topSlug: string | null, subSlug: string | null): string {
    const top = categories.find((c) => c.slug === topSlug)
    const sub = top?.subcategories.find((s) => s.slug === subSlug)
    return [top?.label, sub?.label].filter(Boolean).join(' → ')
  }

  async function describeFromPhoto() {
    if (row.photos.length === 0 || !row.pawn_category_slug || aiBusy) return
    const ai = tn.photoAi
    setAiBusy(true)
    setAiNote(null)
    setAiPhotosDiffer(false)
    try {
      // The photos are already in storage: only their paths go.
      const fd = new FormData()
      fd.set('photo_paths', JSON.stringify(row.photos.map((p) => p.path)))
      fd.set('pawn_category', row.pawn_category_slug)
      fd.set('pawn_subcategory', row.pawn_subcategory_slug ?? '')
      const res = await fetch('/api/ai/vision/pawn-item', { method: 'POST', body: fd })
      const json = (await res.json().catch(() => null)) as {
        error?: string
        data?: { item: PhotoItem; category: { top: string; sub: string | null } | null }
      } | null
      if (!res.ok || !json?.data) {
        const errors: Record<string, string> = ai.errors
        setAiNote({ kind: 'error', text: errors[json?.error ?? ''] ?? ai.errors.failed })
        return
      }
      const { item, category } = json.data
      setAiPhotosDiffer(item.photos_differ === true)
      setStep('item')
      const now = rowNow.current
      const moved =
        category != null &&
        (category.top !== now.pawn_category_slug ||
          category.sub !== now.pawn_subcategory_slug)
      const top = moved ? category.top : now.pawn_category_slug
      const sub = moved ? category.sub : now.pawn_subcategory_slug
      const kind = inventoryCategoryFromSlug(top, sub)
      const seen = photoItemPatch(item, top, kind)
      onChange(
        {
          ...(moved
            ? {
                ...jewelryStartValues(now, top, sub),
                pawn_category_slug: top,
                pawn_subcategory_slug: sub,
                pending_top_slug: null,
                category: kind,
              }
            : {}),
          ...seen,
        },
        now,
      )
      setAiNote(
        moved
          ? {
              kind: 'moved',
              seen: item.item_seen,
              from: categoryLabel(now.pawn_category_slug, now.pawn_subcategory_slug),
              to: categoryLabel(top, sub),
              back: {
                pawn_category_slug: now.pawn_category_slug,
                pawn_subcategory_slug: now.pawn_subcategory_slug,
                category: now.category,
              },
            }
          : { kind: Object.keys(seen).length > 0 ? 'filled' : 'nothing' },
      )
    } catch {
      setAiNote({ kind: 'error', text: ai.errors.failed })
    } finally {
      setAiBusy(false)
    }
  }

  const complete = isRowComplete(row, categoryStepDone)

  // "Add item" / "Done": the browser's own message on the first field that
  // is wrong, and the popup stays; otherwise it closes.
  function confirm() {
    if (!categoryStepDone) return
    const bad = dialogRef.current?.querySelector<HTMLInputElement>(
      'input:invalid, select:invalid',
    )
    if (bad) {
      // A wrong field on a step that is not showing: show that step first,
      // then the browser's message on the field.
      const on = bad.closest<HTMLElement>('[data-step]')?.dataset.step as Step | undefined
      if (on && on !== step) {
        setStep(on)
        requestAnimationFrame(() => bad.reportValidity())
      } else {
        bad.reportValidity()
      }
      return
    }
    onClose()
  }

  // X / Esc / Cancel: an item that was being added is taken away; one that
  // was already on the ticket just closes (the fields save as they are typed).
  function dismiss() {
    if (adding) onRemove()
    else onClose()
  }

  const pendingTop = row.pending_top_slug
    ? categories.find((c) => c.slug === row.pending_top_slug) ?? null
    : null
  const categoryText = selectedCategory
    ? selectedSubcategory
      ? `${selectedCategory.label} → ${selectedSubcategory.label}`
      : selectedCategory.label
    : pendingTop
      ? pendingTop.label
      : '—'
  const weightSerial =
    selectedCategory?.slug === 'jewelry'
      ? row.weight_grams.trim()
        ? `${row.weight_grams.trim()} g`
        : '—'
      : selectedCategory?.slug === 'firearms'
        ? row.firearm_serial_number.trim() || '—'
        : selectedCategory?.slug === 'electronics'
          ? row.electronic_serial.trim() || '—'
          : '—'
  const TD = 'px-4 py-4 align-top'

  return (
    <tbody data-row-uid={row.uid} className="border-b border-border last:border-b-0">
      <tr>
        <td className={`${TD} font-mono text-muted`}>{index + 1}</td>
        <td className={`${TD} text-foreground`}>{categoryText}</td>
        <td className={`${TD} text-foreground`}>
          {row.description.trim() || <span className="text-muted">—</span>}
          {!complete ? (
            <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-warning">
              <Warning size={12} weight="bold" />
              {tn.itemNeedsDetails}
            </span>
          ) : null}
        </td>
        <td className={`${TD} font-mono text-foreground`}>{weightSerial}</td>
        <td className={`${TD} text-right font-mono font-semibold text-foreground`}>
          {fmtValue(row.est_value)}
        </td>
        <td className="px-4 py-2 text-right align-top">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onOpen}
              aria-haspopup="dialog"
              className={`inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-blue hover:text-blue-2 hover:underline ${FOCUS}`}
            >
              {tn.itemEdit}
            </button>
            <button
              type="button"
              onClick={onRemove}
              className={`inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-danger hover:underline ${FOCUS}`}
              aria-label={`${tn.removeItem} ${index + 1}`}
              data-row-id={fieldId}
            >
              {tn.removeItem}
            </button>
          </div>

          {/* The item's popup. No display class on the <dialog> itself: a
              closed dialog must stay display:none. It fills the screen as
              the dimmed overlay; the card sits in the middle of it. */}
          <dialog
            ref={dialogRef}
            aria-labelledby={`${fieldId}-title`}
            // Esc. A file picker dismissed without a file fires its own
            // "cancel", which bubbles up to here — that one is not ours.
            onCancel={(e) => {
              if (e.target !== e.currentTarget) return
              e.preventDefault()
              dismiss()
            }}
            // The browser closed it on its own (Esc pressed twice).
            onClose={() => {
              if (open) dismiss()
            }}
            // Enter in a field means "Add item" / "Done" — never "Issue the
            // ticket", which is what the form around it would make of it.
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              const el = e.target as HTMLElement
              if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') return
              e.preventDefault()
              confirm()
            }}
            className="m-0 h-full max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-navy/40 p-4 text-left text-sm font-normal text-foreground"
          >
            <div className="flex min-h-full items-center justify-center">
              <div
                // Takes the focus when the popup opens on the category step,
                // where no field exists yet.
                tabIndex={-1}
                data-popup-card
                className="w-full max-w-5xl rounded-xl border border-border bg-card p-5 shadow-lg outline-none"
              >
                <header className="mb-4 flex items-center justify-between gap-3">
                  <h3
                    id={`${fieldId}-title`}
                    className="text-base font-semibold text-foreground"
                  >
                    {adding
                      ? tn.itemAdd
                      : tn.itemEditTitle.replace('{n}', String(index + 1))}
                  </h3>
                  <button
                    type="button"
                    onClick={dismiss}
                    aria-label={adding ? t.common.cancel : t.common.close}
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-background hover:text-foreground ${FOCUS}`}
                  >
                    <X size={16} weight="bold" />
                  </button>
                </header>

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
            initialTopSlug={row.pending_top_slug}
            onPick={(topSlug, subSlug) =>
              onChange({
                ...jewelryStartValues(row, topSlug, subSlug),
                pawn_category_slug: topSlug,
                pawn_subcategory_slug: subSlug,
                pending_top_slug: null,
                // Derive the inventory_category enum value from the
                // pawn slugs so the legacy column stays populated
                // without asking the operator twice.
                category: inventoryCategoryFromSlug(topSlug, subSlug),
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
                pending_top_slug: null,
                category: 'other',
              })
            }
          />
        </div>
      )}

      {/* What "Describe from photo" did. */}
      {categoryStepDone && aiNote ? (
        <div
          role="status"
          className={`mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-sm ${
            aiNote.kind === 'error'
              ? 'border-danger/30 bg-danger/5 text-danger'
              : aiNote.kind === 'moved'
                ? 'border-warning/40 bg-warning/5 text-foreground'
                : 'border-border bg-background text-foreground'
          }`}
        >
          <span>
            {aiNote.kind === 'error'
              ? aiNote.text
              : aiNote.kind === 'nothing'
                ? tn.photoAi.nothing
                : aiNote.kind === 'moved'
                  ? `${tn.photoAi.moved
                      .replace('{seen}', aiNote.seen)
                      .replace('{from}', aiNote.from)
                      .replace('{to}', aiNote.to)} ${tn.photoAi.check}`
                  : `${tn.photoAi.filled} ${tn.photoAi.check}`}
            {aiPhotosDiffer && aiNote.kind !== 'error' ? (
              <span className="mt-1 block font-semibold text-danger">{tn.photoAi.photosDiffer}</span>
            ) : null}
          </span>
          {aiNote.kind === 'moved' ? (
            <button
              type="button"
              onClick={() => {
                onChange({ ...aiNote.back, pending_top_slug: null })
                setAiNote({ kind: 'filled' })
              }}
              className={`inline-flex h-9 shrink-0 items-center rounded-md px-2 text-sm font-semibold text-blue hover:text-blue-2 hover:underline ${FOCUS}`}
            >
              {tn.photoAi.changeBack}
            </button>
          ) : null}
        </div>
      ) : null}

      {categoryStepDone ? (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        {/* The two money fields on top; then the steps (Photos · Item ·
            Stones — Eddy, 2026-11-25: "too much stuff on the screen"); the
            description under all of them. A step that is not shown is only
            HIDDEN (display:none), never unmounted: its inputs are what the
            ticket form submits (rule 27). */}
          {/* Field order is the order the clerk fills them (Eddy, 2026-11-24):
              value, color, then the category's own fields, unique marks,
              and the description LAST — it writes itself from the others
              (lib/pawn/item-description). */}
          <label className="md:col-span-2 block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {valueLabel ?? t.pawn.new_.itemEstValue}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              name={`collateral_${index}_est_value`}
              // Focused when the popup opens on the fields, and when they
              // appear after the category is picked inside it. Selected, so
              // typing replaces the starting 0.
              data-first-field
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={row.est_value}
              onChange={(e) => onChange({ est_value: e.target.value })}
              className={INPUT}
            />
          </label>

          {/* Jewelry: what the metal is worth, beside the value it fills in.
              The Est. value takes it by default (estValueAfterChange); once
              the clerk types their own, "Use" puts it back. */}
          {selectedCategory?.slug === 'jewelry' ? (
            <div className="md:col-span-2 space-y-1">
              <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                {t.pawn.new_.itemMetalValue}
              </span>
              <div
                aria-live="polite"
                className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5"
              >
                {metalValue.status === 'ok' ? (
                  <>
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                        {fmtValue(String(metalValue.value))}
                      </div>
                      <div className="text-xs text-muted">
                        {t.pawn.new_.itemMetalValueFormula
                          .replace('{grams}', String(metalValue.grams))
                          .replace('{rate}', fmtValue(String(metalValue.perGram)))
                          .replace('{pct}', String(metalValue.percent))}
                      </div>
                    </div>
                    {row.est_value !== metalValueAsText ? (
                      <button
                        type="button"
                        onClick={() => onChange({ est_value: metalValueAsText })}
                        className={`inline-flex h-9 shrink-0 items-center rounded-md px-2 text-sm font-semibold text-blue hover:text-blue-2 hover:underline ${FOCUS}`}
                      >
                        {t.pawn.new_.itemMetalValueUse}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <span className="text-xs text-muted">
                    {t.pawn.new_.itemMetalValueWhy[metalValue.status]}
                  </span>
                )}
              </div>
            </div>
          ) : null}

          <nav
            aria-label={tn.wizard.label}
            className="md:col-span-6 flex flex-wrap gap-2 border-b border-border pb-2"
          >
            {steps.map((st, i) => (
              <button
                key={st}
                type="button"
                onClick={() => setStep(st)}
                aria-current={step === st ? 'step' : undefined}
                className={`inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold ${
                  step === st
                    ? 'bg-navy text-white'
                    : 'text-text-secondary hover:bg-background hover:text-foreground'
                } ${FOCUS}`}
              >
                <span className="font-mono text-xs">{i + 1}</span>
                {tn.wizard[st]}
              </button>
            ))}
          </nav>

        {/* Photos — uploaded as they are picked; the form carries their
            paths (components/uploads/PhotoStrip). */}
        <div data-step="photos" className={step === 'photos' ? 'md:col-span-6 space-y-3' : 'hidden'}>
          <PhotoStrip
            tenantId={tenantId}
            name={`collateral_${index}_photos`}
            photos={row.photos}
            onChange={(photos) => {
              setAiNote(null)
              onChange({ photos })
            }}
            label={t.pawn.new_.itemPhoto}
          />
          {row.photos.length > 0 ? (
            <button
              type="button"
              onClick={describeFromPhoto}
              disabled={aiBusy}
              className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`}
            >
              <Sparkle size={14} weight="fill" className="shrink-0 text-gold" />
              {aiBusy ? tn.photoAi.working : tn.photoAi.button}
            </button>
          ) : null}
        </div>

          {/* Inventory category — derived from pawn_subcategory_slug
              by inventoryCategoryFromSlug(). Hidden input so the
              server-side schema (which requires the field) still
              validates. The dropdown that used to live here was
              removed once the pawn_intake_categories picker became
              the single source of truth. */}
          <input
            type="hidden"
            name={`collateral_${index}_category`}
            value={row.category}
          />

          <div data-step="item" className={step === 'item' ? 'contents' : 'hidden'}>
          {/* Common FS 539.001(8)(b)(2) fields — visible regardless of
              picked category. Color (e) here; unique marks (i) after the
              category's own fields. */}
          <ChoiceOrOther
            className="md:col-span-2"
            label={t.pawn.new_.itemColor}
            name={`collateral_${index}_color`}
            value={row.color}
            onChange={(color) => onChange({ color })}
            choices={colorChoicesFor(row)}
            otherLabel={t.pawn.new_.itemChoiceOther}
            otherPlaceholder={t.pawn.new_.itemChoiceOtherText}
          />

          {/* ── JEWELRY: metal / karat / weight / size / coating / stones ── */}
          {selectedCategory?.slug === 'jewelry' ? (
            <>
              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemMetalType}
                </span>
                <select
                  name={`collateral_${index}_metal_type`}
                  value={row.metal_type}
                  onChange={(e) =>
                    onChange({ metal_type: e.target.value as MetalType | '' })
                  }
                  className={INPUT}
                >
                  <option value="">—</option>
                  {METAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {tMetal(opt.value)}
                    </option>
                  ))}
                </select>
              </label>

              {/* Gold in karats, silver / platinum / palladium in parts per
                  thousand (925, 950), steel and the like none: the choices
                  follow the metal, and Other takes any purity it can have. */}
              <PurityField
                className="md:col-span-1"
                metal={row.metal_type}
                name={`collateral_${index}_karat`}
                value={row.karat}
                onChange={(karat) => onChange({ karat })}
              />

              {/* Weight in grams or pennyweight. Grams is what is kept,
                  printed and priced; dwt is only how it was typed. */}
              <div className="md:col-span-2 space-y-1">
                <label
                  htmlFor={`${fieldId}-weight`}
                  className="block text-xs font-semibold uppercase tracking-[0.08em] text-muted"
                >
                  {t.pawn.new_.itemWeight}
                </label>
                <div className="flex gap-2">
                  <input
                    id={`${fieldId}-weight`}
                    type="number"
                    step="0.01"
                    min={0}
                    value={row.weight_unit === 'dwt' ? row.weight_dwt : row.weight_grams}
                    onChange={(e) =>
                      onChange(
                        row.weight_unit === 'dwt'
                          ? { weight_dwt: e.target.value, weight_grams: gramsFromDwt(e.target.value) }
                          : { weight_grams: e.target.value },
                      )
                    }
                    className={INPUT}
                  />
                  <div className="w-24 shrink-0">
                    <select
                      aria-label={t.pawn.new_.itemWeightUnit}
                      value={row.weight_unit}
                      // The number stays as typed; the unit says what it
                      // means ("5" weighed in dwt, typed before the unit).
                      onChange={(e) => {
                        const unit = e.target.value === 'dwt' ? 'dwt' : 'g'
                        if (unit === row.weight_unit) return
                        rememberWeightUnit(unit)
                        onChange(
                          unit === 'dwt'
                            ? {
                                weight_unit: 'dwt',
                                weight_dwt: row.weight_grams,
                                weight_grams: gramsFromDwt(row.weight_grams),
                              }
                            : { weight_unit: 'g', weight_grams: row.weight_dwt },
                        )
                      }}
                      className={INPUT}
                    >
                      <option value="g">g</option>
                      <option value="dwt">dwt</option>
                    </select>
                  </div>
                </div>
                <input
                  type="hidden"
                  name={`collateral_${index}_weight_grams`}
                  value={row.weight_grams}
                />
                {row.weight_unit === 'dwt' && row.weight_grams !== '' ? (
                  <span className="block font-mono text-xs text-muted">= {row.weight_grams} g</span>
                ) : null}
              </div>

              <label className="md:col-span-1 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemJewelrySize}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_jewelry_size`}
                  value={row.jewelry_size}
                  onChange={(e) =>
                    onChange({ jewelry_size: e.target.value })
                  }
                  placeholder="7  /  22 in"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemCoating}
                </span>
                <select
                  name={`collateral_${index}_coating`}
                  value={row.coating}
                  onChange={(e) => onChange({ coating: e.target.value as Coating })}
                  className={INPUT}
                >
                  {COATINGS.map((c) => (
                    <option key={c} value={c}>
                      {t.inventory.coatings[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemGender}
                </span>
                <select
                  name={`collateral_${index}_jewelry_gender`}
                  value={row.jewelry_gender}
                  onChange={(e) =>
                    onChange({ jewelry_gender: e.target.value as JewelryGender | '' })
                  }
                  className={INPUT}
                >
                  <option value="">—</option>
                  {JEWELRY_GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {t.pawn.new_.itemGenders[g]}
                    </option>
                  ))}
                </select>
              </label>

              <ChoiceOrOther
                className="md:col-span-2"
                label={t.pawn.new_.itemStyle}
                name={`collateral_${index}_jewelry_style`}
                value={row.jewelry_style}
                onChange={(jewelry_style) => onChange({ jewelry_style })}
                choices={styleChoicesFor(row)}
                otherLabel={t.pawn.new_.itemChoiceOther}
                otherPlaceholder={t.pawn.new_.itemChoiceOtherText}
              />
              {!isSolidMetal(row.coating) ? (
                <p
                  role="status"
                  className="md:col-span-6 inline-flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground"
                >
                  <Warning size={14} weight="bold" className="mt-0.5 shrink-0 text-warning" />
                  <span>{t.pawn.new_.itemCoatingWarning}</span>
                </p>
              ) : null}

              {/* FS 539.001(8)(b)2.a-c — a watch or a signed piece. */}
              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemJewelryBrand}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_jewelry_brand`}
                  value={row.jewelry_brand}
                  onChange={(e) => onChange({ jewelry_brand: e.target.value })}
                  placeholder="Rolex / Gucci"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemJewelryModel}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_jewelry_model`}
                  value={row.jewelry_model}
                  onChange={(e) => onChange({ jewelry_model: e.target.value })}
                  placeholder="Submariner 16610"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemJewelrySerial}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_jewelry_serial`}
                  value={row.jewelry_serial}
                  onChange={(e) => onChange({ jewelry_serial: e.target.value })}
                  className={INPUT}
                />
              </label>

            </>
          ) : null}

          {/* ── FIREARMS: 10 fields (FS 539.001(8)(b)(2)(h)) ────── */}
          {selectedCategory?.slug === 'firearms' ? (
            <>
              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmMake}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_firearm_make`}
                  value={row.firearm_make}
                  onChange={(e) => onChange({ firearm_make: e.target.value })}
                  placeholder="Glock"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmModel}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_firearm_model`}
                  value={row.firearm_model}
                  onChange={(e) => onChange({ firearm_model: e.target.value })}
                  placeholder="19 Gen 5"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmCaliber}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_firearm_caliber`}
                  value={row.firearm_caliber}
                  onChange={(e) =>
                    onChange({ firearm_caliber: e.target.value })
                  }
                  placeholder="9mm"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-3 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmSerialNumber} *
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_firearm_serial_number`}
                  required
                  value={row.firearm_serial_number}
                  onChange={(e) =>
                    onChange({ firearm_serial_number: e.target.value })
                  }
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmType}
                </span>
                <select
                  name={`collateral_${index}_firearm_type`}
                  value={row.firearm_type}
                  onChange={(e) =>
                    onChange({ firearm_type: e.target.value as FirearmType })
                  }
                  className={INPUT}
                >
                  <option value="">—</option>
                  <option value="handgun">{t.pawn.new_.itemFirearmTypeHandgun}</option>
                  <option value="rifle">{t.pawn.new_.itemFirearmTypeRifle}</option>
                  <option value="shotgun">{t.pawn.new_.itemFirearmTypeShotgun}</option>
                  <option value="other">{t.pawn.new_.itemFirearmTypeOther}</option>
                </select>
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmActionType}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_firearm_action_type`}
                  value={row.firearm_action_type}
                  onChange={(e) =>
                    onChange({ firearm_action_type: e.target.value })
                  }
                  placeholder="Semi-auto"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmBarrelLength}
                </span>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  name={`collateral_${index}_firearm_barrel_length_inches`}
                  value={row.firearm_barrel_length_inches}
                  onChange={(e) =>
                    onChange({
                      firearm_barrel_length_inches: e.target.value,
                    })
                  }
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmCapacity}
                </span>
                <input
                  type="number"
                  step="1"
                  min={0}
                  max={1000}
                  name={`collateral_${index}_firearm_capacity`}
                  value={row.firearm_capacity}
                  onChange={(e) =>
                    onChange({ firearm_capacity: e.target.value })
                  }
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-3 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmFinish}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_firearm_finish`}
                  value={row.firearm_finish}
                  onChange={(e) =>
                    onChange({ firearm_finish: e.target.value })
                  }
                  placeholder="Blued / Stainless / Cerakote"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-1 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemFirearmBarrels}
                </span>
                <input
                  type="number"
                  step="1"
                  min={0}
                  max={20}
                  name={`collateral_${index}_firearm_number_of_barrels`}
                  value={row.firearm_number_of_barrels}
                  onChange={(e) =>
                    onChange({ firearm_number_of_barrels: e.target.value })
                  }
                  className={INPUT}
                />
              </label>
            </>
          ) : null}

          {/* ── ELECTRONICS: brand / model / serial-imei ────────── */}
          {selectedCategory?.slug === 'electronics' ? (
            <>
              <label className="md:col-span-3 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemElectronicBrand}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_electronic_brand`}
                  value={row.electronic_brand}
                  onChange={(e) =>
                    onChange({ electronic_brand: e.target.value })
                  }
                  placeholder="Apple"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-3 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemElectronicModel}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_electronic_model`}
                  value={row.electronic_model}
                  onChange={(e) =>
                    onChange({ electronic_model: e.target.value })
                  }
                  placeholder="iPhone 13 Pro"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-4 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemElectronicSerial}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_electronic_serial`}
                  value={row.electronic_serial}
                  onChange={(e) =>
                    onChange({ electronic_serial: e.target.value })
                  }
                  className={INPUT}
                />
              </label>
              {sizeField}
            </>
          ) : null}

          {/* ── TOOLS: brand / model ───────────────────────────── */}
          {selectedCategory?.slug === 'tools' ? (
            <>
              <label className="md:col-span-3 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemToolBrand}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_tool_brand`}
                  value={row.tool_brand}
                  onChange={(e) => onChange({ tool_brand: e.target.value })}
                  placeholder="DeWalt"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-3 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemToolModel}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_tool_model`}
                  value={row.tool_model}
                  onChange={(e) => onChange({ tool_model: e.target.value })}
                  placeholder="DCD777"
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-4 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemJewelrySerial}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_tool_serial`}
                  value={row.tool_serial}
                  onChange={(e) => onChange({ tool_serial: e.target.value })}
                  className={INPUT}
                />
              </label>
              {sizeField}
            </>
          ) : null}

          {/* ── GENERAL (and any category the shop added): the statute's
              brand / model / serial / size, FS 539.001(8)(b)2.a-d ── */}
          {descriptionKind(row.pawn_category_slug) === 'other' ? (
            <>
              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemJewelryBrand}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_general_brand`}
                  value={row.general_brand}
                  onChange={(e) => onChange({ general_brand: e.target.value })}
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemJewelryModel}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_general_model`}
                  value={row.general_model}
                  onChange={(e) => onChange({ general_model: e.target.value })}
                  className={INPUT}
                />
              </label>

              <label className="md:col-span-2 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemJewelrySerial}
                </span>
                <input
                  type="text"
                  name={`collateral_${index}_general_serial`}
                  value={row.general_serial}
                  onChange={(e) => onChange({ general_serial: e.target.value })}
                  className={INPUT}
                />
              </label>
              {sizeField}
            </>
          ) : null}

          <label className="md:col-span-6 block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {t.pawn.new_.itemUniqueMarks}
            </span>
            <input
              type="text"
              name={`collateral_${index}_unique_marks`}
              value={row.unique_marks}
              onChange={(e) => onChange({ unique_marks: e.target.value })}
              placeholder="Engraving, hallmark, scratch pattern"
              className={INPUT}
            />
          </label>
          </div>

          {selectedCategory?.slug === 'jewelry' ? (
            <div data-step="stones" className={step === 'stones' ? 'contents' : 'hidden'}>
              {/* FS 539.001(8)(b)2.g — the stones, one line per kind, with
                  how many. Submitted as one JSON field; the server writes
                  the printed line from it (lib/pawn/stones). */}
              <fieldset className="md:col-span-6 space-y-2">
                <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {t.pawn.new_.itemStones}
                </legend>
                <input
                  type="hidden"
                  name={`collateral_${index}_stones`}
                  value={JSON.stringify(stonesInEnglish(row.stones))}
                />
                <div
                  className={`hidden gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted md:grid ${STONE_GRID}`}
                >
                  <span>{t.pawn.new_.stoneQty}</span>
                  <span>{t.pawn.new_.stoneType}</span>
                  <span>{t.pawn.new_.stoneCarat}</span>
                  <span>{t.pawn.new_.stoneColor}</span>
                  <span>{t.pawn.new_.stoneCut}</span>
                  <span>{t.pawn.new_.stoneClarity}</span>
                  <span />
                </div>
                {row.stones.map((stone, si) => {
                  const setStone = (patch: Partial<StoneDraft>) =>
                    onChange({
                      stones: row.stones.map((x, i) => (i === si ? { ...x, ...patch } : x)),
                    })
                  return (
                    <div key={si} className={`grid grid-cols-2 items-start gap-2 ${STONE_GRID}`}>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={stone.qty}
                        onChange={(e) => setStone({ qty: e.target.value })}
                        aria-label={t.pawn.new_.stoneQty}
                        placeholder={t.pawn.new_.stoneQty}
                        className={INPUT}
                      />
                      <ChoiceOrOther
                        labelHidden
                        label={t.pawn.new_.stoneType}
                        value={stone.type}
                        onChange={(type) => setStone({ type })}
                        choices={stoneTypeChoices}
                        otherLabel={t.pawn.new_.itemChoiceOther}
                        otherPlaceholder={t.pawn.new_.itemChoiceOtherText}
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={stone.carat}
                        onChange={(e) => setStone({ carat: e.target.value })}
                        aria-label={t.pawn.new_.stoneCarat}
                        placeholder="0.75"
                        className={INPUT}
                      />
                      <input
                        type="text"
                        value={stone.color}
                        onChange={(e) => setStone({ color: e.target.value })}
                        aria-label={t.pawn.new_.stoneColor}
                        placeholder={t.pawn.new_.stoneColorPlaceholder}
                        className={INPUT}
                      />
                      <input
                        type="text"
                        value={stone.cut}
                        onChange={(e) => setStone({ cut: e.target.value })}
                        aria-label={t.pawn.new_.stoneCut}
                        placeholder={t.pawn.new_.stoneCutPlaceholder}
                        className={INPUT}
                      />
                      <input
                        type="text"
                        value={stone.clarity}
                        onChange={(e) => setStone({ clarity: e.target.value })}
                        aria-label={t.pawn.new_.stoneClarity}
                        placeholder="VS1"
                        className={INPUT}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            stones:
                              row.stones.length > 1
                                ? row.stones.filter((_, i) => i !== si)
                                : [blankStone()],
                          })
                        }
                        aria-label={`${t.pawn.new_.stoneRemove} ${si + 1}`}
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-background hover:text-danger ${FOCUS}`}
                      >
                        <X size={14} weight="bold" />
                      </button>
                    </div>
                  )
                })}
                <div className="flex flex-wrap items-center gap-2">
                  {row.stones.length < MAX_STONES ? (
                    <button
                      type="button"
                      onClick={() => onChange({ stones: [...row.stones, blankStone()] })}
                      className={`inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-semibold text-blue hover:text-blue-2 hover:underline ${FOCUS}`}
                    >
                      <Plus size={14} weight="bold" />
                      {t.pawn.new_.stoneAdd}
                    </button>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      name={`collateral_${index}_gemstone_notes`}
                      value={row.gemstone_notes}
                      onChange={(e) => onChange({ gemstone_notes: e.target.value })}
                      aria-label={t.pawn.new_.itemGemstoneNotes}
                      placeholder={t.pawn.new_.itemGemstoneNotes}
                      className={INPUT}
                    />
                  </div>
                </div>
              </fieldset>
            </div>
          ) : null}

          {/* Last: written from the fields above while the clerk leaves it
              alone; theirs once they type in it (descriptionAfterChange). */}
          <label className="md:col-span-6 block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {t.pawn.new_.itemDescription} *
            </span>
            <input
              type="text"
              name={`collateral_${index}_description`}
              required
              value={row.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="14k gold rope chain, 22 inches"
              className={INPUT}
            />
            <span className="block text-xs text-muted">
              {t.pawn.new_.itemDescriptionHint}
            </span>
          </label>
      </div>
      ) : null}

                <footer className="mt-5 flex flex-wrap items-center justify-between gap-2">
                  {adding ? (
                    <span />
                  ) : (
                    <button
                      type="button"
                      onClick={onRemove}
                      className={`inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-danger hover:underline ${FOCUS}`}
                    >
                      {tn.removeItem}
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    {adding ? (
                      <button type="button" onClick={dismiss} className={OUTLINE_BTN}>
                        {t.common.cancel}
                      </button>
                    ) : null}
                    {categoryStepDone && steps.indexOf(step) < steps.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => setStep(steps[steps.indexOf(step) + 1])}
                        className={OUTLINE_BTN}
                      >
                        {tn.wizard.next}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={confirm}
                      disabled={!categoryStepDone}
                      className={`${PRIMARY_BTN} h-11 text-sm`}
                    >
                      {adding ? tn.itemAdd : tn.itemDone}
                    </button>
                  </div>
                </footer>
              </div>
            </div>
          </dialog>
        </td>
      </tr>
    </tbody>
  )
}
