'use client'

import { useId, useRef, useState } from 'react'
import Image from 'next/image'
import { Plus, Trash, Camera } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type {
  InventoryCategory,
  MetalType,
} from '@/types/database-aliases'

/**
 * Inline editor for the collateral list on /pawn/new. Each row collects:
 *   description, category, metal_type, karat, weight_grams, est_value, photo
 *
 * Photos are kept as File objects in component state. On submit, the form
 * action serializes them via FormData under names:
 *   collateral_count             — number of rows
 *   collateral_<n>_description
 *   collateral_<n>_category
 *   collateral_<n>_metal_type
 *   collateral_<n>_karat
 *   collateral_<n>_weight_grams
 *   collateral_<n>_est_value
 *   collateral_<n>_photo         — the File (optional)
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

export function CollateralItemsList() {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([newRow()])

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

  return (
    <div className="space-y-3">
      <input type="hidden" name="collateral_count" value={rows.length} />
      {rows.map((row, idx) => (
        <CollateralRow
          key={row.uid}
          index={idx}
          row={row}
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
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-hairline bg-canvas px-3 py-2 text-sm font-medium text-ink hover:border-ink"
        >
          <Plus size={14} weight="bold" />
          {t.pawn.new_.addItem}
        </button>
      </div>
    </div>
  )
}

function CollateralRow({
  index,
  row,
  onChange,
  onRemove,
  canRemove,
  tCategory,
  tMetal,
}: {
  index: number
  row: Row
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
  canRemove: boolean
  tCategory: (c: InventoryCategory) => string
  tMetal: (m: MetalType) => string
}) {
  const { t } = useI18n()
  const photoInputRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()

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
    <div className="rounded-lg border border-hairline bg-canvas p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        {/* Photo */}
        <div className="md:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink">
            {t.pawn.new_.itemPhoto}
          </span>
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="group relative flex h-24 w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-hairline bg-cloud hover:border-ink"
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
              <span className="flex flex-col items-center gap-1 text-ash">
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
            <span className="text-xs font-medium text-ink">
              {t.pawn.new_.itemDescription} *
            </span>
            <input
              type="text"
              name={`collateral_${index}_description`}
              required
              value={row.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="14k gold rope chain, 22 inches"
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>

          <label className="md:col-span-3 block space-y-1">
            <span className="text-xs font-medium text-ink">
              {t.pawn.new_.itemCategory}
            </span>
            <select
              name={`collateral_${index}_category`}
              value={row.category}
              onChange={(e) =>
                onChange({ category: e.target.value as InventoryCategory })
              }
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {tCategory(opt.value)}
                </option>
              ))}
            </select>
          </label>

          <label className="md:col-span-2 block space-y-1">
            <span className="text-xs font-medium text-ink">
              {t.pawn.new_.itemMetalType}
            </span>
            <select
              name={`collateral_${index}_metal_type`}
              value={row.metal_type}
              onChange={(e) =>
                onChange({ metal_type: e.target.value as MetalType | '' })
              }
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
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
            <span className="text-xs font-medium text-ink">
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
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>

          <label className="md:col-span-1 block space-y-1">
            <span className="text-xs font-medium text-ink">
              {t.pawn.new_.itemWeightGrams}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              name={`collateral_${index}_weight_grams`}
              value={row.weight_grams}
              onChange={(e) => onChange({ weight_grams: e.target.value })}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>

          <label className="md:col-span-2 block space-y-1">
            <span className="text-xs font-medium text-ink">
              {t.pawn.new_.itemEstValue}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              name={`collateral_${index}_est_value`}
              value={row.est_value}
              onChange={(e) => onChange({ est_value: e.target.value })}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>
        </div>
      </div>

      {canRemove ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md border border-error/30 bg-error/5 px-2 py-1 text-xs font-medium text-error hover:bg-error/10"
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
