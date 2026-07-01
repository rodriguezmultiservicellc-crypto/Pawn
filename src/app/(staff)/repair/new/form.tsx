'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Plus,
  Trash,
  Upload,
  User,
  CheckCircle,
  Wrench,
  Diamond,
  Ruler,
  LinkSimple,
  PaintBrush,
  PenNib,
  Sparkle,
  type Icon,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import CustomerPicker, {
  type CustomerPickerHandle,
} from '@/components/customers/CustomerPicker'
import QuickCustomerModal from '@/components/customers/QuickCustomerModal'
import {
  createRepairTicketAction,
  type CreateRepairTicketState,
} from './actions'
import type { ServiceType } from '@/types/database-aliases'

export type TechnicianOption = {
  id: string
  label: string
}

const REPAIR_FORM_ID = 'repair-new-form'

const SERVICE_TILES: ReadonlyArray<{
  value: ServiceType
  labelKey:
    | 'repair'
    | 'stoneSetting'
    | 'sizing'
    | 'restring'
    | 'plating'
    | 'engraving'
    | 'custom'
  icon: Icon
}> = [
  { value: 'repair', labelKey: 'repair', icon: Wrench },
  { value: 'stone_setting', labelKey: 'stoneSetting', icon: Diamond },
  { value: 'sizing', labelKey: 'sizing', icon: Ruler },
  { value: 'restring', labelKey: 'restring', icon: LinkSimple },
  { value: 'plating', labelKey: 'plating', icon: PaintBrush },
  { value: 'engraving', labelKey: 'engraving', icon: PenNib },
  { value: 'custom', labelKey: 'custom', icon: Sparkle },
]

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '$0.00'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
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
  technicians,
}: {
  technicians: TechnicianOption[]
}) {
  const { t } = useI18n()
  const tn = t.repair.new_
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

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  )
  const [customerLabel, setCustomerLabel] = useState<string | null>(null)
  const customerPickerRef = useRef<CustomerPickerHandle>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)

  const [title, setTitle] = useState('')
  const [itemDesc, setItemDesc] = useState('')

  // Rail estimate — DISPLAY-ONLY calculator (like the pawn-rail redemption
  // preview). The official quote/deposit are set post-intake via the repair
  // quote workflow (quote_set event + status transition), so these inputs
  // are intentionally NOT submitted.
  const [labor, setLabor] = useState('')
  const [materials, setMaterials] = useState('')
  const [deposit, setDeposit] = useState('')

  const showStones = serviceType === 'stone_setting' || serviceType === 'custom'

  const estTotal = (parseFloat(labor) || 0) + (parseFloat(materials) || 0)
  const estBalance = Math.max(0, estTotal - (parseFloat(deposit) || 0))

  const canOpen =
    !pending &&
    selectedCustomerId != null &&
    title.trim() !== '' &&
    itemDesc.trim() !== ''

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

  const inputCls =
    'block w-full rounded-lg border-2 border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-gold'

  return (
    <form
      id={REPAIR_FORM_ID}
      action={formAction}
      onSubmit={(e) => {
        if (!canOpen) e.preventDefault()
      }}
    >
      {/* Sub bar */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{tn.title}</h1>
        <Link href="/repair" className="text-sm text-muted hover:text-foreground">
          {t.repair.backToList}
        </Link>
      </div>

      {state.error ? (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      <input type="hidden" name="service_type" value={serviceType} />

      <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[1fr_360px]">
        {/* ── LEFT: work surface ─────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Customer */}
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {tn.sectionCustomer}
            </legend>
            <p className="mt-1 text-xs font-medium text-warning">
              {tn.pickCustomerHelp}
            </p>
            <div className="mt-2 flex items-start gap-2">
              <div className="flex-1">
                <CustomerPicker
                  ref={customerPickerRef}
                  name="customer_id"
                  required
                  error={state.fieldErrors?.customer_id}
                  onChange={(c) => {
                    setSelectedCustomerId(c?.id ?? null)
                    setCustomerLabel(c?.label ?? null)
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowCustomerModal(true)}
                className="shrink-0 rounded-md border border-border bg-card px-3 py-3 text-sm text-foreground hover:bg-background hover:text-foreground"
              >
                {tn.newCustomer}
              </button>
            </div>
          </fieldset>

          <QuickCustomerModal
            open={showCustomerModal}
            onClose={() => setShowCustomerModal(false)}
            onCreated={(c) => {
              customerPickerRef.current?.set(c)
              setSelectedCustomerId(c.id)
              setCustomerLabel(c.label)
            }}
          />

          {/* Item & service */}
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {tn.sectionItem}
            </legend>
            <p className="mt-1 text-xs text-muted">{tn.serviceHelp}</p>

            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
              {SERVICE_TILES.map(({ value, labelKey, icon: TileIcon }) => {
                const on = serviceType === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setServiceType(value)}
                    className={`flex flex-col items-center gap-2 rounded-xl border-[1.5px] p-3 text-center transition-all hover:-translate-y-0.5 ${
                      on
                        ? 'border-gold bg-gold/[0.06] shadow-sm'
                        : 'border-border bg-card hover:border-gold'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                        on ? 'bg-gold text-white' : 'bg-gold/15 text-gold'
                      }`}
                    >
                      <TileIcon size={20} weight="regular" />
                    </span>
                    <span className="text-[11.5px] font-bold text-foreground">
                      {t.repair.serviceTypes[labelKey]}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 space-y-4">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">
                  {tn.titleField} *
                </span>
                <input
                  type="text"
                  name="title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={tn.titlePlaceholder}
                  className={inputCls}
                />
                {state.fieldErrors?.title ? (
                  <span className="text-xs text-danger">
                    {state.fieldErrors.title}
                  </span>
                ) : null}
              </label>

              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">
                  {tn.itemDescription} *
                </span>
                <textarea
                  name="item_description"
                  required
                  rows={2}
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                  placeholder={tn.itemDescriptionPlaceholder}
                  className={inputCls}
                />
                {state.fieldErrors?.item_description ? (
                  <span className="text-xs text-danger">
                    {state.fieldErrors.item_description}
                  </span>
                ) : null}
              </label>

              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">
                  {tn.description}
                </span>
                <textarea
                  name="description"
                  rows={3}
                  placeholder={tn.descriptionPlaceholder}
                  className={inputCls}
                />
              </label>
            </div>

            {/* Stones (gated by service type) */}
            {showStones ? (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-background/50 p-3">
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gold">
                  {tn.sectionStones}
                </h3>
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
                    {tn.addStone}
                  </button>
                </div>
              </div>
            ) : null}
          </fieldset>

          {/* Intake photos */}
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {tn.sectionPhotos}
            </legend>
            <p className="mt-1 text-xs text-muted">{tn.photosHelp}</p>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-1 rounded-xl border-[1.5px] border-dashed border-border bg-background px-3 py-5 text-center hover:border-gold"
              >
                <Upload size={22} weight="regular" className="text-gold" />
                <span className="text-sm font-bold text-foreground">
                  {tn.photoUpload}
                </span>
                <span className="text-[11.5px] text-muted">
                  {tn.photoUploadHelp}
                </span>
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
              {tn.sectionStaff}
            </legend>
            <label className="mt-2 block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {tn.notesInternal}
              </span>
              <textarea
                name="notes_internal"
                rows={2}
                className={inputCls}
              />
              <span className="text-xs text-muted">{tn.notesInternalHelp}</span>
            </label>
          </fieldset>
        </div>

        {/* ── RIGHT: ticket summary rail ─────────────────────────────── */}
        <aside className="rounded-2xl bg-navy p-[18px] text-white shadow-lg lg:sticky lg:top-4">
          <h2 className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/50">
            {tn.railSummaryTitle}
          </h2>

          {/* Customer chip */}
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
              <User size={16} weight="bold" />
            </span>
            <span className="min-w-0 truncate text-[13.5px] font-bold">
              {customerLabel ?? tn.railNoCustomer}
            </span>
          </div>

          {/* Service type */}
          <div className="flex items-center justify-between px-0.5 py-1.5 text-[13px]">
            <span className="font-semibold text-white/60">{tn.serviceType}</span>
            <span className="font-bold">
              {t.repair.serviceTypes[SERVICE_TILES.find((s) => s.value === serviceType)!.labelKey]}
            </span>
          </div>

          {/* Assign technician */}
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/55">
              {tn.assignedTo}
            </span>
            <select
              name="assigned_to"
              defaultValue=""
              className="h-[42px] w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 text-sm font-bold text-white outline-none focus:border-gold [&>option]:text-navy"
            >
              <option value="">{tn.assignedToNone}</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.label}
                </option>
              ))}
            </select>
          </label>

          {/* Promised pickup */}
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/55">
              {tn.promisedDate}
            </span>
            <input
              type="date"
              name="promised_date"
              className="h-[42px] w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 text-sm font-semibold text-white outline-none focus:border-gold"
            />
          </label>

          <div className="my-3.5 h-px bg-white/10" />

          {/* Estimate (display-only calculator) */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-white/55">
              {tn.estimateLabel}
            </span>
          </div>
          <RailMoney
            label={tn.laborLabel}
            value={labor}
            onChange={setLabor}
          />
          <RailMoney
            label={tn.materialsLabel}
            value={materials}
            onChange={setMaterials}
          />
          <div className="flex items-center justify-between px-0.5 py-1.5 text-[13px]">
            <span className="font-semibold text-white/60">
              {tn.estimatedTotal}
            </span>
            <span className="font-bold tabular-nums">{fmtMoney(estTotal)}</span>
          </div>
          <div className="mt-1.5">
            <RailMoney
              label={tn.depositLabel}
              value={deposit}
              onChange={setDeposit}
            />
          </div>

          <div className="my-2 rounded-xl border border-gold/25 bg-gold/10 p-3">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/60">
              {tn.balanceDue}
            </div>
            <div className="mt-0.5 text-[27px] font-extrabold tabular-nums">
              {fmtMoney(estBalance)}
            </div>
          </div>
          <p className="mb-1 text-[10.5px] text-white/40">{tn.estimateHelp}</p>

          {/* Open ticket */}
          <button
            type="submit"
            disabled={!canOpen}
            className="mt-1 flex h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-b from-gold-2 to-gold text-base font-extrabold text-[#3a2600] shadow-lg transition-all hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0"
          >
            <CheckCircle size={18} weight="bold" />
            {pending ? tn.submitting : tn.submit}
          </button>

          <Link
            href="/repair"
            className="mt-2.5 flex h-11 w-full items-center justify-center rounded-xl border border-white/13 bg-white/[0.07] text-[13px] font-bold text-white hover:bg-white/12"
          >
            {t.common.cancel}
          </Link>

          {!canOpen && !pending ? (
            <p className="mt-2.5 text-center text-[11.5px] font-semibold text-white/50">
              {tn.railMissingHint}
            </p>
          ) : null}
        </aside>
      </div>
    </form>
  )
}

function RailMoney({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative mb-2.5">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-white/50">
        $
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.07] pl-7 pr-16 text-sm font-bold tabular-nums text-white outline-none focus:border-gold"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10.5px] font-bold uppercase text-white/45">
        {label}
      </span>
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
