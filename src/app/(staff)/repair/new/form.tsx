'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash, Upload } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  createRepairTicketAction,
  type CreateRepairTicketState,
} from './actions'
import type { ServiceType } from '@/types/database-aliases'

export type CustomerOption = {
  id: string
  label: string
}

export type TechnicianOption = {
  id: string
  label: string
}

type StoneRow = {
  uid: string
  stone_type: string
  shape: string
  size_mm: string
  weight_carats: string
  color: string
  clarity: string
  mounting_type: string
  mounting_position: string
  source: 'customer_supplied' | 'shop_supplied'
  notes: string
}

function newStoneRow(): StoneRow {
  return {
    uid:
      typeof crypto !== 'undefined'
        ? crypto.randomUUID()
        : `s${Math.random()}`,
    stone_type: '',
    shape: '',
    size_mm: '',
    weight_carats: '',
    color: '',
    clarity: '',
    mounting_type: '',
    mounting_position: '',
    source: 'customer_supplied',
    notes: '',
  }
}

export default function NewRepairTicketForm({
  customers,
  technicians,
}: {
  customers: CustomerOption[]
  technicians: TechnicianOption[]
}) {
  const { t } = useI18n()
  // INLINE `{}` second arg per Next 16 'use server' rules — never an exported
  // `InitialState` constant.
  const [state, formAction, pending] = useActionState<
    CreateRepairTicketState,
    FormData
  >(createRepairTicketAction, {})

  const [serviceType, setServiceType] = useState<ServiceType>('repair')
  const [stones, setStones] = useState<StoneRow[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [photoNames, setPhotoNames] = useState<string[]>([])

  const showStones = serviceType === 'stone_setting' || serviceType === 'custom'

  function addStone() {
    setStones((prev) => [...prev, newStoneRow()])
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.repair.new_.title}</h1>
        <Link href="/repair" className="text-sm text-muted hover:text-foreground">
          {t.repair.backToList}
        </Link>
      </div>

      {state.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        {/* Customer */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.repair.new_.sectionCustomer}
          </legend>
          <p className="mt-1 text-xs text-muted">
            {t.repair.new_.pickCustomerHelp}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <select
              name="customer_id"
              required
              className="flex-1 rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            >
              <option value="">{t.repair.new_.pickCustomer}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <Link
              href="/customers/new?return=/repair/new"
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
            >
              {t.repair.new_.newCustomer}
            </Link>
          </div>
          {state.fieldErrors?.customer_id ? (
            <div className="mt-1 text-xs text-danger">
              {state.fieldErrors.customer_id}
            </div>
          ) : null}
        </fieldset>

        {/* Item & service */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.repair.new_.sectionItem}
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.repair.new_.serviceType} *
              </span>
              <select
                name="service_type"
                value={serviceType}
                onChange={(e) =>
                  setServiceType(e.target.value as ServiceType)
                }
                required
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              >
                <option value="repair">{t.repair.serviceTypes.repair}</option>
                <option value="stone_setting">
                  {t.repair.serviceTypes.stoneSetting}
                </option>
                <option value="sizing">{t.repair.serviceTypes.sizing}</option>
                <option value="restring">
                  {t.repair.serviceTypes.restring}
                </option>
                <option value="plating">{t.repair.serviceTypes.plating}</option>
                <option value="engraving">
                  {t.repair.serviceTypes.engraving}
                </option>
                <option value="custom">{t.repair.serviceTypes.custom}</option>
              </select>
              <span className="text-xs text-muted">
                {t.repair.new_.serviceTypeHelp}
              </span>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.repair.new_.titleField} *
              </span>
              <input
                type="text"
                name="title"
                required
                placeholder={t.repair.new_.titlePlaceholder}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
              {state.fieldErrors?.title ? (
                <span className="text-xs text-danger">
                  {state.fieldErrors.title}
                </span>
              ) : null}
            </label>

            <label className="block space-y-1 md:col-span-2">
              <span className="text-sm font-medium text-foreground">
                {t.repair.new_.itemDescription} *
              </span>
              <textarea
                name="item_description"
                required
                rows={2}
                placeholder={t.repair.new_.itemDescriptionPlaceholder}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
              {state.fieldErrors?.item_description ? (
                <span className="text-xs text-danger">
                  {state.fieldErrors.item_description}
                </span>
              ) : null}
            </label>

            <label className="block space-y-1 md:col-span-2">
              <span className="text-sm font-medium text-foreground">
                {t.repair.new_.description}
              </span>
              <textarea
                name="description"
                rows={3}
                placeholder={t.repair.new_.descriptionPlaceholder}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.repair.new_.promisedDate}
              </span>
              <input
                type="date"
                name="promised_date"
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.repair.new_.assignedTo}
              </span>
              <select
                name="assigned_to"
                defaultValue=""
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              >
                <option value="">{t.repair.new_.assignedToNone}</option>
                {technicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        {/* Stones (gated by service_type) */}
        {showStones ? (
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {t.repair.new_.sectionStones}
            </legend>
            <input type="hidden" name="stone_count" value={stones.length} />
            <div className="space-y-3">
              {stones.map((s, idx) => (
                <StoneRowEditor
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
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-background hover:text-foreground"
              >
                <Plus size={14} weight="bold" />
                {t.repair.new_.addStone}
              </button>
            </div>
          </fieldset>
        ) : null}

        {/* Intake photos */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.repair.new_.sectionPhotos}
          </legend>
          <p className="mt-1 text-xs text-muted">
            {t.repair.new_.photoUploadHelp}
          </p>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-background hover:text-foreground"
            >
              <Upload size={14} weight="bold" />
              {t.repair.new_.photoUpload}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              name="intake_files"
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

        {/* Internal notes */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.repair.new_.sectionStaff}
          </legend>
          <label className="mt-2 block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.repair.new_.notesInternal}
            </span>
            <p className="text-xs text-muted">
              {t.repair.new_.notesInternalHelp}
            </p>
            <textarea
              name="notes_internal"
              rows={2}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            />
          </label>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/repair"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? t.repair.new_.submitting : t.repair.new_.submit}
          </button>
        </div>
      </form>
    </div>
  )
}

function StoneRowEditor({
  index,
  row,
  onChange,
  onRemove,
}: {
  index: number
  row: StoneRow
  onChange: (patch: Partial<StoneRow>) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-foreground">
          {t.repair.new_.stoneIndex} {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
        >
          <Trash size={12} weight="bold" />
          {t.repair.new_.removeStone}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
        <Input
          name={`stone_${index}_type`}
          label={`${t.repair.new_.stoneType} *`}
          value={row.stone_type}
          onChange={(v) => onChange({ stone_type: v })}
          placeholder={t.repair.new_.stoneTypePlaceholder}
          required
          span={2}
        />
        <Input
          name={`stone_${index}_shape`}
          label={t.repair.new_.stoneShape}
          value={row.shape}
          onChange={(v) => onChange({ shape: v })}
        />
        <Input
          name={`stone_${index}_size_mm`}
          label={t.repair.new_.stoneSize}
          value={row.size_mm}
          onChange={(v) => onChange({ size_mm: v })}
          type="number"
          step="0.01"
        />
        <Input
          name={`stone_${index}_weight_carats`}
          label={t.repair.new_.stoneWeight}
          value={row.weight_carats}
          onChange={(v) => onChange({ weight_carats: v })}
          type="number"
          step="0.001"
        />
        <Input
          name={`stone_${index}_color`}
          label={t.repair.new_.stoneColor}
          value={row.color}
          onChange={(v) => onChange({ color: v })}
        />
        <Input
          name={`stone_${index}_clarity`}
          label={t.repair.new_.stoneClarity}
          value={row.clarity}
          onChange={(v) => onChange({ clarity: v })}
        />
        <Input
          name={`stone_${index}_mounting_type`}
          label={t.repair.new_.mountingType}
          value={row.mounting_type}
          onChange={(v) => onChange({ mounting_type: v })}
        />
        <Input
          name={`stone_${index}_mounting_position`}
          label={t.repair.new_.mountingPosition}
          value={row.mounting_position}
          onChange={(v) => onChange({ mounting_position: v })}
        />
        <label className="md:col-span-2 block space-y-1">
          <span className="text-xs font-medium text-foreground">
            {t.repair.new_.stoneSource}
          </span>
          <select
            name={`stone_${index}_source`}
            value={row.source}
            onChange={(e) =>
              onChange({
                source: e.target.value as 'customer_supplied' | 'shop_supplied',
              })
            }
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          >
            <option value="customer_supplied">
              {t.repair.new_.stoneSourceCustomer}
            </option>
            <option value="shop_supplied">
              {t.repair.new_.stoneSourceShop}
            </option>
          </select>
        </label>
        <label className="md:col-span-6 block space-y-1">
          <span className="text-xs font-medium text-foreground">
            {t.repair.new_.stoneNotes}
          </span>
          <input
            type="text"
            name={`stone_${index}_notes`}
            value={row.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        </label>
      </div>
    </div>
  )
}

function Input({
  name,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  step,
  required,
  span = 1,
}: {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  step?: string
  required?: boolean
  span?: number
}) {
  const colSpan =
    span === 2 ? 'md:col-span-2' : span === 3 ? 'md:col-span-3' : ''
  return (
    <label className={`block space-y-1 ${colSpan}`}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      <input
        type={type}
        step={step}
        name={name}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
      />
    </label>
  )
}
