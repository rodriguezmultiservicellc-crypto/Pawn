'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n/context'
import type {
  InventoryCategory,
  InventoryLocation,
  InventorySource,
  InventoryStatus,
  MetalType,
} from '@/types/database-aliases'

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
  }
}

export function InventoryFormFields({
  initial,
  fieldError,
  isEdit = false,
}: {
  initial?: InventoryFieldValues
  fieldError?: (key: string) => string | undefined
  isEdit?: boolean
}) {
  const { t } = useI18n()
  const v = initial ?? emptyInventoryItem()

  const [tags, setTags] = useState<string[]>(v.tags)
  const [tagInput, setTagInput] = useState('')

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
            className="md:col-span-2"
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
        </div>
      </Section>

      <Section label={t.inventory.sectionPricing}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field
            label={t.inventory.costBasis}
            name="cost_basis"
            type="number"
            step="0.01"
            required
            defaultValue={v.cost_basis}
          />
          <Field
            label={t.inventory.listPrice}
            name="list_price"
            type="number"
            step="0.01"
            defaultValue={v.list_price ?? ''}
          />
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
            defaultValue={v.source}
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
        <div className="mt-3">
          <span className="block text-sm font-medium text-ink">
            {t.inventory.tags}
          </span>
          <p className="mb-1 text-xs text-ash">{t.inventory.tagsHelp}</p>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-canvas p-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-hairline bg-cloud px-2 py-0.5 text-xs text-ink"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-ash hover:text-ink"
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
              className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-none"
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
    <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{label}</legend>
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
  placeholder,
  help,
  step,
  error,
  readOnly,
  className,
}: {
  label: string
  name: string
  required?: boolean
  type?: string
  defaultValue?: string
  placeholder?: string
  help?: string
  step?: string
  error?: string
  readOnly?: boolean
  className?: string
}) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        step={step}
        readOnly={readOnly}
        className={`block w-full rounded-md border bg-canvas px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
          error
            ? 'border-error focus:border-error'
            : 'border-hairline focus:border-ink'
        } ${readOnly ? 'bg-cloud text-ash' : ''}`}
      />
      {help ? <span className="text-xs text-ash">{help}</span> : null}
      {error ? <span className="text-xs text-error">{error}</span> : null}
    </label>
  )
}

function Select({
  label,
  name,
  defaultValue,
  options,
  error,
  className,
}: {
  label: string
  name: string
  defaultValue?: string
  options: ReadonlyArray<{ value: string; label: string }>
  error?: string
  className?: string
}) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-sm font-medium text-ink">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className={`block w-full rounded-md border bg-canvas px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
          error
            ? 'border-error focus:border-error'
            : 'border-hairline focus:border-ink'
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-error">{error}</span> : null}
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
      <span className="text-sm font-medium text-ink">{label}</span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
      />
      {help ? <span className="text-xs text-ash">{help}</span> : null}
    </label>
  )
}
