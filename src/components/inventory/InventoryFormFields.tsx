'use client'

import { useState } from 'react'
import { Sparkle, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { CommissionField } from '@/components/consignment/CommissionField'
import { priceFromCost } from '@/lib/custom-quotes/math'
import { COATINGS, isSolidMetal, type Coating } from '@/lib/spot-prices/purity'
import { formatMoney } from '@/lib/format/money'
import type {
  InventoryCategory,
  InventoryLocation,
  InventorySource,
  InventoryStatus,
  MetalType,
} from '@/types/database-aliases'

export type InventoryCondition = 'new' | 'used' | 'restored' | 'vintage' | 'antique'
export const INVENTORY_CONDITIONS: ReadonlyArray<InventoryCondition> = [
  'new',
  'used',
  'restored',
  'vintage',
  'antique',
]

/** Suggestions for the free-text finish field (brief Phase 4.2). */
const FINISH_SUGGESTIONS = [
  'polished',
  'matte',
  'brushed',
  'hammered',
  'diamond-cut',
  'rhodium',
  'satin',
  'florentine',
  'sandblasted',
  'two-tone',
] as const

export type InventoryFieldValues = {
  sku: string | null
  description: string
  category: InventoryCategory
  brand: string | null
  model: string | null
  serial_number: string | null
  metal: MetalType | null
  karat: string | null
  weight_grams: string | null
  weight_dwt: string | null
  // patches/0067
  condition: InventoryCondition | null
  coating: Coating
  finish: string | null
  shelf_location: string | null
  legacy_code: string | null
  wholesale_price: string | null
  cost_basis: string
  list_price: string | null
  sale_price: string | null
  source: InventorySource
  source_vendor: string | null
  acquired_at: string
  acquired_cost: string | null
  hold_until: string | null
  location: InventoryLocation
  status: InventoryStatus
  notes: string | null
  staff_memo: string | null
  tags: string[]
  is_hidden_from_catalog: boolean
  consignor_id: string | null
  consignment_commission_pct: string | null
  consignment_min_price: string | null
  consignment_expires_on: string | null
}

export function emptyInventoryItem(): InventoryFieldValues {
  return {
    sku: null,
    description: '',
    category: 'other',
    brand: null,
    model: null,
    serial_number: null,
    metal: null,
    karat: null,
    weight_grams: null,
    weight_dwt: null,
    condition: null,
    coating: 'none',
    finish: null,
    shelf_location: null,
    legacy_code: null,
    wholesale_price: null,
    cost_basis: '0',
    list_price: null,
    sale_price: null,
    source: 'bought',
    source_vendor: null,
    acquired_at: new Date().toISOString().slice(0, 10),
    acquired_cost: null,
    hold_until: null,
    location: 'case',
    status: 'available',
    notes: null,
    staff_memo: null,
    tags: [],
    is_hidden_from_catalog: false,
    consignor_id: null,
    consignment_commission_pct: null,
    consignment_min_price: null,
    consignment_expires_on: null,
  }
}

export type ConsignorOption = { id: string; label: string }

export function InventoryFormFields({
  initial,
  fieldError,
  isEdit = false,
  consignmentEnabled = false,
  consignors = [],
  defaultCommissionPct = 0.2,
  targetMarginPct = 0.5,
}: {
  initial?: InventoryFieldValues
  fieldError?: (key: string) => string | undefined
  isEdit?: boolean
  /** Tenant has consignment switched on (settings.consignment_enabled). */
  consignmentEnabled?: boolean
  consignors?: ConsignorOption[]
  /** settings.consignment_default_commission_pct, as a fraction. */
  defaultCommissionPct?: number
  /** settings.inventory_target_margin_pct, as a fraction — "Suggest price". */
  targetMarginPct?: number
}) {
  const { t } = useI18n()
  const v = initial ?? emptyInventoryItem()

  const [tags, setTags] = useState<string[]>(v.tags)
  const [tagInput, setTagInput] = useState('')
  // Sourcing drives whether the consignment block exists at all.
  const [source, setSource] = useState<InventorySource>(v.source)
  // Coating drives the "not solid gold" warning (patches/0067).
  const [coating, setCoating] = useState<Coating>(v.coating)
  // Cost + list price are controlled so "Suggest price" can fill the list.
  const [costBasis, setCostBasis] = useState(v.cost_basis)
  const [listPrice, setListPrice] = useState(v.list_price ?? '')
  const costNum = parseFloat(costBasis)
  const suggested =
    Number.isFinite(costNum) && costNum > 0 ? priceFromCost(costNum, targetMarginPct) : null

  function addTag() {
    const x = tagInput.trim()
    if (!x) return
    if (tags.includes(x)) {
      setTagInput('')
      return
    }
    setTags([...tags, x])
    setTagInput('')
  }
  function removeTag(tag: string) {
    setTags(tags.filter((tt) => tt !== tag))
  }

  return (
    <div className="space-y-6">
      <Section label={t.inventory.sectionDescription}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label={t.inventory.sku}
            name="sku"
            defaultValue={v.sku ?? ''}
            placeholder={isEdit ? '' : t.inventory.skuAuto}
            help={isEdit ? undefined : t.inventory.skuHelp}
            error={fieldError?.('sku')}
            readOnly={isEdit}
          />
          <Select
            label={t.inventory.category}
            name="category"
            defaultValue={v.category}
            error={fieldError?.('category')}
            options={[
              { value: 'ring', label: t.inventory.catRing },
              { value: 'necklace', label: t.inventory.catNecklace },
              { value: 'bracelet', label: t.inventory.catBracelet },
              { value: 'earrings', label: t.inventory.catEarrings },
              { value: 'pendant', label: t.inventory.catPendant },
              { value: 'chain', label: t.inventory.catChain },
              { value: 'watch', label: t.inventory.catWatch },
              { value: 'coin', label: t.inventory.catCoin },
              { value: 'bullion', label: t.inventory.catBullion },
              { value: 'loose_stone', label: t.inventory.catLooseStone },
              { value: 'electronics', label: t.inventory.catElectronics },
              { value: 'tool', label: t.inventory.catTool },
              { value: 'instrument', label: t.inventory.catInstrument },
              { value: 'other', label: t.inventory.catOther },
            ]}
          />
          <Field
            label={t.inventory.description}
            name="description"
            required
            defaultValue={v.description}
            error={fieldError?.('description')}
            className="md:col-span-2"
          />
          <Field
            label={t.inventory.brand}
            name="brand"
            defaultValue={v.brand ?? ''}
          />
          <Field
            label={t.inventory.model}
            name="model"
            defaultValue={v.model ?? ''}
          />
          <Field
            label={t.inventory.serialNumber}
            name="serial_number"
            defaultValue={v.serial_number ?? ''}
          />
          <Field
            label={t.inventory.legacyCode}
            name="legacy_code"
            defaultValue={v.legacy_code ?? ''}
            help={t.inventory.legacyCodeHelp}
          />
          <Select
            label={t.inventory.condition}
            name="condition"
            defaultValue={v.condition ?? ''}
            error={fieldError?.('condition')}
            options={[
              { value: '', label: '—' },
              ...INVENTORY_CONDITIONS.map((c) => ({
                value: c,
                label: t.inventory.conditions[c],
              })),
            ]}
          />
        </div>
      </Section>

      <Section label={t.inventory.sectionMetal}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Select
            label={t.inventory.metal}
            name="metal"
            defaultValue={v.metal ?? ''}
            error={fieldError?.('metal')}
            options={[
              { value: '', label: '—' },
              { value: 'gold', label: t.inventory.metalGold },
              { value: 'silver', label: t.inventory.metalSilver },
              { value: 'platinum', label: t.inventory.metalPlatinum },
              { value: 'palladium', label: t.inventory.metalPalladium },
              { value: 'rose_gold', label: t.inventory.metalRoseGold },
              { value: 'white_gold', label: t.inventory.metalWhiteGold },
              { value: 'tungsten', label: t.inventory.metalTungsten },
              { value: 'titanium', label: t.inventory.metalTitanium },
              {
                value: 'stainless_steel',
                label: t.inventory.metalStainlessSteel,
              },
              { value: 'mixed', label: t.inventory.metalMixed },
              { value: 'none', label: t.inventory.metalNone },
              { value: 'other', label: t.inventory.metalOther },
            ]}
          />
          <Field
            label={t.inventory.karat}
            name="karat"
            defaultValue={v.karat ?? ''}
            placeholder="14K"
          />
          <Field
            label={t.inventory.weightGrams}
            name="weight_grams"
            type="number"
            step="0.0001"
            defaultValue={v.weight_grams ?? ''}
          />
          <Field
            label={t.inventory.weightDwt}
            name="weight_dwt"
            type="number"
            step="0.0001"
            defaultValue={v.weight_dwt ?? ''}
          />
          <Select
            label={t.inventory.coating}
            name="coating"
            value={coating}
            onChange={(next) => setCoating(next as Coating)}
            error={fieldError?.('coating')}
            options={COATINGS.map((c) => ({ value: c, label: t.inventory.coatings[c] }))}
            className="md:col-span-2"
          />
          <Field
            label={t.inventory.finish}
            name="finish"
            defaultValue={v.finish ?? ''}
            list="inventory-finish-suggestions"
            placeholder={t.inventory.finishPlaceholder}
            className="md:col-span-2"
          />
          <datalist id="inventory-finish-suggestions">
            {FINISH_SUGGESTIONS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          {!isSolidMetal(coating) ? (
            <p
              role="status"
              className="md:col-span-4 inline-flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground"
            >
              <Warning size={14} weight="bold" className="mt-0.5 shrink-0 text-warning" />
              <span>{t.inventory.coatingWarning}</span>
            </p>
          ) : null}
        </div>
      </Section>

      <Section label={t.inventory.sectionPricing}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field
            label={t.inventory.costBasis}
            name="cost_basis"
            type="number"
            step="0.01"
            required
            value={costBasis}
            onChange={setCostBasis}
          />
          <Field
            label={t.inventory.wholesalePrice}
            name="wholesale_price"
            type="number"
            step="0.01"
            defaultValue={v.wholesale_price ?? ''}
          />
          <div className="block space-y-1">
            <Field
              label={t.inventory.listPrice}
              name="list_price"
              type="number"
              step="0.01"
              value={listPrice}
              onChange={setListPrice}
            />
            <button
              type="button"
              onClick={() => suggested != null && setListPrice((Math.round(suggested * 100) / 100).toFixed(2))}
              disabled={suggested == null}
              title={t.inventory.suggestPriceHelp.replace(
                '{pct}',
                String(Math.round(targetMarginPct * 100)),
              )}
              className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkle size={12} weight="bold" />
              {t.inventory.suggestPrice}
              {suggested != null ? (
                <span className="font-mono text-muted">({formatMoney(suggested)})</span>
              ) : null}
            </button>
          </div>
          {isEdit ? (
            <Field
              label={t.inventory.salePrice}
              name="sale_price"
              type="number"
              step="0.01"
              defaultValue={v.sale_price ?? ''}
            />
          ) : null}
        </div>
      </Section>

      <Section label={t.inventory.sectionSourcing}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            label={t.inventory.source}
            name="source"
            value={source}
            onChange={(next) => setSource(next as InventorySource)}
            error={fieldError?.('source')}
            options={[
              { value: 'bought', label: t.inventory.sourceBought },
              { value: 'pawn_forfeit', label: t.inventory.sourcePawnForfeit },
              { value: 'consigned', label: t.inventory.sourceConsigned },
              { value: 'new_stock', label: t.inventory.sourceNewStock },
              {
                value: 'repair_excess',
                label: t.inventory.sourceRepairExcess,
              },
              {
                value: 'abandoned_repair',
                label: t.inventory.sourceAbandonedRepair,
              },
            ]}
          />
          <Field
            label={t.inventory.sourceVendor}
            name="source_vendor"
            defaultValue={v.source_vendor ?? ''}
          />
          <Field
            label={t.inventory.acquiredAt}
            name="acquired_at"
            type="date"
            required
            defaultValue={v.acquired_at}
          />
          <Field
            label={t.inventory.acquiredCost}
            name="acquired_cost"
            type="number"
            step="0.01"
            defaultValue={v.acquired_cost ?? ''}
          />
          <Field
            label={t.inventory.holdUntil}
            name="hold_until"
            type="date"
            defaultValue={v.hold_until ?? ''}
            help={t.inventory.holdUntilHelp}
            className="md:col-span-2"
          />
        </div>
      </Section>

      {/* Consignment — only for goods the shop does not own. The fields are
          unmounted for any other source so a stale consignor cannot ride
          along on a sourcing change; the schema clears them server-side too. */}
      {consignmentEnabled && source === 'consigned' ? (
        <Section label={t.consignment.item.sectionLabel}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select
              label={t.consignment.item.consignor}
              name="consignor_id"
              defaultValue={v.consignor_id ?? ''}
              help={t.consignment.item.consignorHelp}
              error={
                fieldError?.('consignor_id')
                  ? t.consignment.errors.consignor_required
                  : undefined
              }
              options={[
                { value: '', label: '—' },
                ...consignors.map((c) => ({ value: c.id, label: c.label })),
              ]}
            />
            <CommissionField
              name="consignment_commission_pct"
              label={t.consignment.item.commission}
              defaultFraction={
                v.consignment_commission_pct == null
                  ? defaultCommissionPct
                  : Number(v.consignment_commission_pct)
              }
              error={
                fieldError?.('consignment_commission_pct')
                  ? t.consignment.errors.commission_required
                  : undefined
              }
            />
            <Field
              label={t.consignment.item.minPrice}
              name="consignment_min_price"
              type="number"
              step="0.01"
              defaultValue={v.consignment_min_price ?? ''}
              help={t.consignment.item.minPriceHelp}
            />
            <Field
              label={t.consignment.item.expiresOn}
              name="consignment_expires_on"
              type="date"
              defaultValue={v.consignment_expires_on ?? ''}
              help={t.consignment.item.expiresOnHelp}
            />
          </div>
        </Section>
      ) : null}

      <Section label={t.inventory.sectionLocationStatus}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            label={t.inventory.location}
            name="location"
            defaultValue={v.location}
            error={fieldError?.('location')}
            options={[
              { value: 'case', label: t.inventory.locCase },
              { value: 'safe', label: t.inventory.locSafe },
              { value: 'vault', label: t.inventory.locVault },
              { value: 'display', label: t.inventory.locDisplay },
              { value: 'workshop', label: t.inventory.locWorkshop },
              { value: 'offsite', label: t.inventory.locOffsite },
              { value: 'transfer', label: t.inventory.locTransfer },
            ]}
          />
          <Field
            label={t.inventory.shelfLocation}
            name="shelf_location"
            defaultValue={v.shelf_location ?? ''}
            placeholder={t.inventory.shelfLocationPlaceholder}
          />
          <Select
            label={t.inventory.status}
            name="status"
            defaultValue={v.status}
            error={fieldError?.('status')}
            options={[
              { value: 'available', label: t.inventory.statusAvailable },
              { value: 'held', label: t.inventory.statusHeld },
              { value: 'sold', label: t.inventory.statusSold },
              { value: 'scrapped', label: t.inventory.statusScrapped },
              { value: 'transferred', label: t.inventory.statusTransferred },
              { value: 'returned', label: t.inventory.statusReturned },
            ]}
          />
        </div>
      </Section>

      <Section label={t.inventory.sectionStaffOnly}>
        <Textarea
          label={t.inventory.notes}
          name="notes"
          rows={3}
          defaultValue={v.notes ?? ''}
        />
        <Textarea
          label={t.inventory.staffMemo}
          name="staff_memo"
          rows={2}
          defaultValue={v.staff_memo ?? ''}
          help={t.inventory.staffMemoHelp}
        />
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="is_hidden_from_catalog"
            value="on"
            defaultChecked={v.is_hidden_from_catalog}
            className="mt-0.5 h-4 w-4 rounded border-border text-gold focus:ring-gold"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">Hide from public catalog</span>
            <span className="text-xs text-muted">
              When the tenant catalog is published, this item still won&apos;t
              appear on the public surface. Use for consigned items under
              negotiation, photo retakes pending, or back-room stock.
            </span>
          </span>
        </label>
        <div className="mt-3">
          <span className="block text-sm font-medium text-foreground">
            {t.inventory.tags}
          </span>
          <p className="mb-1 text-xs text-muted">{t.inventory.tagsHelp}</p>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-muted hover:text-foreground"
                  aria-label={`remove ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                } else if (
                  e.key === 'Backspace' &&
                  !tagInput &&
                  tags.length > 0
                ) {
                  setTags(tags.slice(0, -1))
                }
              }}
              onBlur={addTag}
              className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none"
            />
          </div>
          <input type="hidden" name="tags" value={tags.join(',')} />
        </div>
      </Section>
    </div>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">{label}</legend>
      <div className="mt-2">{children}</div>
    </fieldset>
  )
}

function Field({
  label,
  name,
  required,
  type = 'text',
  defaultValue,
  value,
  onChange,
  placeholder,
  help,
  step,
  error,
  readOnly,
  className,
  list,
}: {
  label: string
  name: string
  required?: boolean
  type?: string
  defaultValue?: string
  /** Pass with onChange to control the input from parent state. */
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  help?: string
  step?: string
  error?: string
  readOnly?: boolean
  className?: string
  /** id of a <datalist> for suggestions. */
  list?: string
}) {
  const controlled = value !== undefined && onChange !== undefined
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        {...(controlled
          ? { value, onChange: (e) => onChange(e.target.value) }
          : { defaultValue })}
        placeholder={placeholder}
        step={step}
        readOnly={readOnly}
        list={list}
        className={`block w-full rounded-md border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
          error
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-blue'
        } ${readOnly ? 'bg-background text-muted' : ''}`}
      />
      {help ? <span className="text-xs text-muted">{help}</span> : null}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  )
}

function Select({
  label,
  name,
  defaultValue,
  value,
  onChange,
  options,
  error,
  help,
  className,
}: {
  label: string
  name: string
  defaultValue?: string
  /** Pass with onChange to drive the select from parent state instead. */
  value?: string
  onChange?: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  error?: string
  help?: string
  className?: string
}) {
  const controlled = value !== undefined && onChange !== undefined
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <select
        name={name}
        {...(controlled
          ? { value, onChange: (e) => onChange(e.target.value) }
          : { defaultValue })}
        className={`block w-full rounded-md border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
          error
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-blue'
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {help ? <span className="text-xs text-muted">{help}</span> : null}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  )
}

function Textarea({
  label,
  name,
  rows = 3,
  defaultValue,
  help,
}: {
  label: string
  name: string
  rows?: number
  defaultValue?: string
  help?: string
}) {
  return (
    <label className="mb-3 block space-y-1 last:mb-0">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
      />
      {help ? <span className="text-xs text-muted">{help}</span> : null}
    </label>
  )
}
