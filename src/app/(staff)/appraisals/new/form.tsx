'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Upload } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  createAppraisalAction,
  type CreateAppraisalState,
} from './actions'
import StoneEditor, { type StoneRow, newStoneRow } from '@/components/appraisals/StoneEditor'
import type { AppraisalPurpose, MetalType } from '@/types/database-aliases'

export type CustomerOption = {
  id: string
  label: string
}

export type InventoryOption = {
  id: string
  label: string
  description: string
  metal: string | null
  karat: number | null
  weight_grams: number | null
}

const METAL_OPTIONS: ReadonlyArray<MetalType> = [
  'gold',
  'silver',
  'platinum',
  'palladium',
  'rose_gold',
  'white_gold',
  'tungsten',
  'titanium',
  'stainless_steel',
  'mixed',
  'none',
  'other',
]

const PURPOSES: ReadonlyArray<AppraisalPurpose> = [
  'insurance',
  'estate',
  'sale',
  'pawn_intake',
  'collateral_review',
  'customer_request',
]

export default function NewAppraisalForm({
  customers,
  inventory,
  presetCustomerId,
  presetInventoryId,
}: {
  customers: CustomerOption[]
  inventory: InventoryOption[]
  presetCustomerId: string | null
  presetInventoryId: string | null
}) {
  const { t } = useI18n()
  // INLINE `{}` second arg per Next 16 'use server' rules.
  const [state, formAction, pending] = useActionState<
    CreateAppraisalState,
    FormData
  >(createAppraisalAction, {})

  const [purpose, setPurpose] = useState<AppraisalPurpose>('insurance')
  const [stones, setStones] = useState<StoneRow[]>([])
  const [inventoryId, setInventoryId] = useState<string>(presetInventoryId ?? '')
  const [metal, setMetal] = useState<string>('')
  const [karat, setKarat] = useState<string>('')
  const [weightGrams, setWeightGrams] = useState<string>('')
  const [itemDescription, setItemDescription] = useState<string>('')
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [photoNames, setPhotoNames] = useState<string[]>([])

  function addStone() {
    setStones((prev) => [...prev, newStoneRow(prev.length + 1)])
  }
  function patchStone(uid: string, patch: Partial<StoneRow>) {
    setStones((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
    )
  }
  function removeStone(uid: string) {
    setStones((prev) => prev.filter((s) => s.uid !== uid))
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : []
    setPhotoNames(files.map((f) => f.name))
  }

  function onInventoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    setInventoryId(value)
    const match = inventory.find((i) => i.id === value)
    if (match) {
      if (!itemDescription) setItemDescription(match.description)
      if (!metal && match.metal) setMetal(match.metal)
      if (!karat && match.karat != null) setKarat(String(match.karat))
      if (!weightGrams && match.weight_grams != null)
        setWeightGrams(String(match.weight_grams))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.appraisal.new_.title}</h1>
        <Link
          href="/appraisals"
          className="text-sm text-muted hover:text-foreground"
        >
          {t.appraisal.backToList}
        </Link>
      </div>

      {state.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.appraisal.errors[
            state.error as keyof typeof t.appraisal.errors
          ] ?? state.error}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        {/* Subject */}
        <fieldset className="rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.appraisal.new_.sectionSubject}
          </legend>
          <p className="mt-1 text-xs text-muted">
            {t.appraisal.new_.pickCustomerHelp}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.pickCustomer}
              </span>
              <select
                name="customer_id"
                defaultValue={presetCustomerId ?? ''}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              >
                <option value="">—</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.pickInventory}
              </span>
              <select
                name="inventory_item_id"
                value={inventoryId}
                onChange={onInventoryChange}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              >
                <option value="">—</option>
                {inventory.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        {/* Item */}
        <fieldset className="rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.appraisal.new_.sectionItem}
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block space-y-1 md:col-span-3">
              <span className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {t.appraisal.new_.itemDescription} *
                </span>
                {itemDescription.trim().length >= 3 ? (
                  <a
                    href={`https://www.chrono24.com/search/index.htm?query=${encodeURIComponent(
                      itemDescription.trim(),
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-medium text-gold hover:underline"
                    title="Open Chrono24 search in a new tab — useful for watches"
                  >
                    Search Chrono24 ↗
                  </a>
                ) : null}
              </span>
              <textarea
                name="item_description"
                required
                value={itemDescription}
                onChange={(e) => setItemDescription(e.target.value)}
                rows={2}
                placeholder={t.appraisal.new_.itemDescriptionPlaceholder}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
              {state.fieldErrors?.item_description ? (
                <span className="text-xs text-danger">
                  {state.fieldErrors.item_description}
                </span>
              ) : null}
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.metal}
              </span>
              <select
                name="metal_type"
                value={metal}
                onChange={(e) => setMetal(e.target.value)}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              >
                <option value="">—</option>
                {METAL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.karat}
              </span>
              <input
                type="number"
                step="0.01"
                name="karat"
                value={karat}
                onChange={(e) => setKarat(e.target.value)}
                placeholder="14"
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.weightGrams}
              </span>
              <input
                type="number"
                step="0.0001"
                name="weight_grams"
                value={weightGrams}
                onChange={(e) => setWeightGrams(e.target.value)}
                placeholder="22.000"
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>
          </div>
        </fieldset>

        {/* Stones */}
        <fieldset className="rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.appraisal.new_.sectionStones}
          </legend>
          <input type="hidden" name="stone_count" value={stones.length} />
          <div className="mt-2 space-y-3">
            {stones.map((s, idx) => (
              <StoneEditor
                key={s.uid}
                index={idx}
                row={s}
                onChange={(patch) => patchStone(s.uid, patch)}
                onRemove={() => removeStone(s.uid)}
              />
            ))}
            <button
              type="button"
              onClick={addStone}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-foreground"
            >
              <Plus size={14} weight="bold" />
              {t.appraisal.new_.addStone}
            </button>
          </div>
        </fieldset>

        {/* Photos */}
        <fieldset className="rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.appraisal.new_.sectionPhotos}
          </legend>
          <p className="mt-1 text-xs text-muted">
            {t.appraisal.new_.photoUploadHelp}
          </p>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-foreground"
            >
              <Upload size={14} weight="bold" />
              {t.appraisal.new_.photoUpload}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              name="photo_files"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              onChange={onPhotoChange}
              className="sr-only"
            />
            {photoNames.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {photoNames.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </fieldset>

        {/* Valuation */}
        <fieldset className="rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.appraisal.new_.sectionValuation}
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block space-y-1 md:col-span-3">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.purpose} *
              </span>
              <select
                name="purpose"
                value={purpose}
                onChange={(e) =>
                  setPurpose(e.target.value as AppraisalPurpose)
                }
                required
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              >
                {PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {t.appraisal.purposes[p]}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">
                {t.appraisal.new_.purposeHelp}
              </span>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.appraisedValue} *
              </span>
              <input
                type="number"
                step="0.01"
                name="appraised_value"
                required
                placeholder="0.00"
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
              {state.fieldErrors?.appraised_value ? (
                <span className="text-xs text-danger">
                  {state.fieldErrors.appraised_value}
                </span>
              ) : null}
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.replacementValue}
              </span>
              <input
                type="number"
                step="0.01"
                name="replacement_value"
                placeholder="0.00"
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
              <span className="text-xs text-muted">
                {t.appraisal.new_.replacementValueHelp}
              </span>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.common.optional}
              </span>
            </label>

            <label className="block space-y-1 md:col-span-3">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.valuationMethod}
              </span>
              <textarea
                name="valuation_method"
                rows={2}
                placeholder={t.appraisal.new_.valuationMethodPlaceholder}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>

            <label className="block space-y-1 md:col-span-3">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.notes}
              </span>
              <textarea
                name="notes"
                rows={3}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>
          </div>
        </fieldset>

        {/* Validity */}
        <fieldset className="rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.appraisal.new_.sectionValidity}
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.validFrom} *
              </span>
              <input
                type="date"
                name="valid_from"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
              {state.fieldErrors?.valid_from ? (
                <span className="text-xs text-danger">
                  {state.fieldErrors.valid_from}
                </span>
              ) : null}
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.appraisal.new_.validUntil}
              </span>
              <input
                type="date"
                name="valid_until"
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
              <span className="text-xs text-muted">
                {t.appraisal.new_.validUntilHelp}
              </span>
            </label>
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/appraisals"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
          >
            {pending
              ? t.appraisal.new_.submitting
              : t.appraisal.new_.submit}
          </button>
        </div>
      </form>
    </div>
  )
}

// Re-export StoneRow type for convenience (not needed here but anchor the
// shared shape).
export type { StoneRow }
