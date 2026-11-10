'use client'

import { useActionState, useRef, useState, useSyncExternalStore } from 'react'
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
  ITEM_TYPES,
  KARAT_OPTIONS,
  composeLineItemTitle,
  itemTypeLabelEn,
} from '@/lib/repair/line-items'
import {
  createRepairTicketAction,
  type CreateRepairTicketState,
} from './actions'
import type { ServiceType } from '@/types/database-aliases'
import type { PickerCustomerResult } from '@/lib/customers/picker-search'
import { SimpleRepairTicketView } from './simple-view'

export type TechnicianOption = {
  id: string
  label: string
}

const REPAIR_FORM_ID = 'repair-new-form'

// ── View switch (Classic | Simple) ───────────────────────────────────────────
// Both views edit the SAME state below and submit through the same hidden
// fields, so the ticket they open is identical. The choice is remembered per
// browser in localStorage and read through useSyncExternalStore: the server
// snapshot is always 'classic', the client snapshot is the stored one, and
// React reconciles the two without a hydration mismatch or a mount effect.
type IntakeView = 'classic' | 'simple'
const VIEW_STORAGE_KEY = 'pawn.repair.newView'
const viewListeners = new Set<() => void>()

function subscribeView(cb: () => void): () => void {
  viewListeners.add(cb)
  return () => {
    viewListeners.delete(cb)
  }
}
function readPersistedView(): IntakeView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'simple'
      ? 'simple'
      : 'classic'
  } catch {
    return 'classic'
  }
}
function serverView(): IntakeView {
  return 'classic'
}
function persistView(next: IntakeView) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, next)
  } catch {}
  viewListeners.forEach((cb) => cb())
}

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

// ── Line item ────────────────────────────────────────────────────────────────

export type LineItem = {
  uid: string
  item_type: string
  karat: string
  weight_grams: string
  dimension: string
  service_type: ServiceType
  /** False until the operator picks a service. Classic starts every item at
   *  'repair' (unchanged); the Simple view shows nothing selected and will
   *  not open the ticket until a service has been chosen explicitly. */
  service_touched: boolean
  work_needed: string
}

function newLineItem(): LineItem {
  return {
    uid:
      typeof crypto !== 'undefined' ? crypto.randomUUID() : `li${Math.random()}`,
    item_type: '',
    karat: '',
    weight_grams: '',
    dimension: '',
    service_type: 'repair',
    service_touched: false,
    work_needed: '',
  }
}

function lineItemTitle(li: LineItem): string {
  return composeLineItemTitle({
    typeLabel: li.item_type ? itemTypeLabelEn(li.item_type) : '',
    karat: li.karat,
    weightGrams: li.weight_grams,
    dimension: li.dimension,
  })
}

// ── Stones (unchanged sub-editor) ────────────────────────────────────────────

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
      typeof crypto !== 'undefined' ? crypto.randomUUID() : `s${Math.random()}`,
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

  const [items, setItems] = useState<LineItem[]>([newLineItem()])
  const [stones, setStones] = useState<StoneRow[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [photoNames, setPhotoNames] = useState<string[]>([])

  const [selectedCustomer, setSelectedCustomer] =
    useState<PickerCustomerResult | null>(null)
  const customerPickerRef = useRef<CustomerPickerHandle>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)

  // Ticket-level fields live in state (not in uncontrolled inputs) so they
  // survive a view switch; both views submit them via the hidden inputs below.
  const [promisedDate, setPromisedDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [notesInternal, setNotesInternal] = useState('')

  const view = useSyncExternalStore(subscribeView, readPersistedView, serverView)

  // Rail estimate — DISPLAY-ONLY calculator (like the pawn-rail redemption
  // preview). The official quote/deposit are set post-intake via the repair
  // quote workflow (quote_set event + status transition), so these inputs
  // are intentionally NOT submitted.
  const [labor, setLabor] = useState('')
  const [materials, setMaterials] = useState('')
  const [deposit, setDeposit] = useState('')

  const builtItems = items.filter((it) => it.item_type !== '')
  const showStones = items.some(
    (it) => it.service_type === 'stone_setting' || it.service_type === 'custom',
  )

  const estTotal = (parseFloat(labor) || 0) + (parseFloat(materials) || 0)
  const estBalance = Math.max(0, estTotal - (parseFloat(deposit) || 0))

  // Same gate in both views (customer + at least one built item). Simple adds
  // one requirement of its own: every built item needs an explicit service,
  // since it preselects nothing where Classic preselects Repair.
  const needsService =
    view === 'simple' && builtItems.some((it) => !it.service_touched)
  const canOpen =
    !pending &&
    selectedCustomer != null &&
    builtItems.length > 0 &&
    !needsService

  function addItem() {
    setItems((prev) => [...prev, newLineItem()])
  }
  function patchItem(uid: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, ...patch } : it)))
  }
  function removeItem(uid: string) {
    setItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((it) => it.uid !== uid),
    )
  }

  function addStone() {
    setStones((prev) => [...prev, newStoneRow()])
  }
  function patchStone(uid: string, patch: Partial<StoneRow>) {
    setStones((prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)))
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{tn.title}</h1>
        <div className="flex items-center gap-4">
          <div
            role="group"
            aria-label={tn.viewLabel}
            className="inline-flex rounded-xl border border-border bg-card p-0.5"
          >
            {(['classic', 'simple'] as const).map((v) => {
              const on = view === v
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => persistView(v)}
                  className={`min-h-9 rounded-[10px] px-3 text-sm font-bold transition-colors ${
                    on
                      ? 'bg-navy text-white'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  {v === 'classic' ? tn.viewClassic : tn.viewSimple}
                </button>
              )
            })}
          </div>
          <Link href="/repair" className="text-sm text-muted hover:text-foreground">
            {t.repair.backToList}
          </Link>
        </div>
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

      {/* Line-item hidden fields (server reads li_<n>_* + line_item_count). */}
      <input type="hidden" name="line_item_count" value={items.length} />
      {items.map((li, i) => (
        <div key={`hidden-${li.uid}`}>
          <input type="hidden" name={`li_${i}_item_type`} value={li.item_type} />
          <input type="hidden" name={`li_${i}_karat`} value={li.karat} />
          <input
            type="hidden"
            name={`li_${i}_weight_grams`}
            value={li.weight_grams}
          />
          <input type="hidden" name={`li_${i}_dimension`} value={li.dimension} />
          <input type="hidden" name={`li_${i}_title`} value={lineItemTitle(li)} />
          <input
            type="hidden"
            name={`li_${i}_service_type`}
            value={li.service_type}
          />
          <input
            type="hidden"
            name={`li_${i}_work_needed`}
            value={li.work_needed}
          />
        </div>
      ))}

      {/* Ticket-level fields — one source for both views. */}
      <input type="hidden" name="promised_date" value={promisedDate} />
      <input type="hidden" name="assigned_to" value={assignedTo} />
      <input type="hidden" name="notes_internal" value={notesInternal} />

      {/* Stones submit only while a stone-setting / custom item exists —
          exactly when Classic shows the stones editor (unchanged rule). */}
      {showStones ? (
        <>
          <input type="hidden" name="stone_count" value={stones.length} />
          {stones.map((s, i) => (
            <div key={`hidden-stone-${s.uid}`}>
              <input type="hidden" name={`stone_${i}_type`} value={s.stone_type} />
              <input type="hidden" name={`stone_${i}_shape`} value={s.shape} />
              <input type="hidden" name={`stone_${i}_size_mm`} value={s.size_mm} />
              <input
                type="hidden"
                name={`stone_${i}_weight_carats`}
                value={s.weight_carats}
              />
              <input type="hidden" name={`stone_${i}_color`} value={s.color} />
              <input type="hidden" name={`stone_${i}_clarity`} value={s.clarity} />
              <input
                type="hidden"
                name={`stone_${i}_mounting_type`}
                value={s.mounting_type}
              />
              <input
                type="hidden"
                name={`stone_${i}_mounting_position`}
                value={s.mounting_position}
              />
              <input type="hidden" name={`stone_${i}_source`} value={s.source} />
              <input type="hidden" name={`stone_${i}_notes`} value={s.notes} />
            </div>
          ))}
        </>
      ) : null}

      {/* Intake photos: the file input stays mounted outside both views so a
          selection made in Classic survives a switch to Simple and back. */}
      <input
        ref={photoInputRef}
        type="file"
        name="intake_files"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
        multiple
        onChange={onPhotoChange}
        className="sr-only"
      />

      <QuickCustomerModal
        open={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onCreated={(c) => {
          customerPickerRef.current?.set(c)
          setSelectedCustomer(c)
        }}
      />

      {view === 'simple' ? (
        <SimpleRepairTicketView
          technicians={technicians}
          items={items}
          onAddItem={addItem}
          onPatchItem={patchItem}
          onRemoveItem={removeItem}
          customer={selectedCustomer}
          onCustomerChange={setSelectedCustomer}
          onNewCustomer={() => setShowCustomerModal(true)}
          customerPickerRef={customerPickerRef}
          customerError={state.fieldErrors?.customer_id}
          itemsError={state.fieldErrors?.line_items}
          promisedDate={promisedDate}
          onPromisedDateChange={setPromisedDate}
          assignedTo={assignedTo}
          onAssignedToChange={setAssignedTo}
          labor={labor}
          onLaborChange={setLabor}
          materials={materials}
          onMaterialsChange={setMaterials}
          deposit={deposit}
          onDepositChange={setDeposit}
          estBalance={estBalance}
          canOpen={canOpen}
          needsService={needsService}
          submitLabel={pending ? tn.submitting : tn.submit}
          fmtMoney={fmtMoney}
        />
      ) : (
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
                  initialCustomer={selectedCustomer}
                  error={state.fieldErrors?.customer_id}
                  onChange={setSelectedCustomer}
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

          {/* Items */}
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {tn.sectionItem}
            </legend>
            <p className="mt-1 text-xs text-muted">{tn.itemsHelp}</p>
            {state.fieldErrors?.line_items ? (
              <p className="mt-1 text-xs text-danger">{tn.atLeastOneItem}</p>
            ) : null}

            <div className="mt-3 space-y-3">
              {items.map((li, idx) => (
                <LineItemEditor
                  key={li.uid}
                  index={idx}
                  item={li}
                  canRemove={items.length > 1}
                  onChange={(patch) => patchItem(li.uid, patch)}
                  onRemove={() => removeItem(li.uid)}
                />
              ))}
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-background hover:text-foreground"
              >
                <Plus size={14} weight="bold" />
                {tn.addItem}
              </button>
            </div>

            {/* Stones (shown when any item is stone-setting / custom) */}
            {showStones ? (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-background/50 p-3">
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gold">
                  {tn.sectionStones}
                </h3>
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
              {photoNames.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {photoNames.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </fieldset>

          {/* Repair notes (tech) */}
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {tn.sectionStaff}
            </legend>
            <label className="mt-2 block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {tn.notesInternal}
              </span>
              <textarea
                rows={2}
                value={notesInternal}
                onChange={(e) => setNotesInternal(e.target.value)}
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
              {selectedCustomer?.label ?? tn.railNoCustomer}
            </span>
          </div>

          {/* Items summary */}
          <div className="mb-1 flex items-center justify-between px-0.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/55">
              {tn.railItemsTitle}
            </span>
            <span className="text-[12px] font-bold tabular-nums text-white/70">
              {builtItems.length}
            </span>
          </div>
          {builtItems.length === 0 ? (
            <p className="mb-3 px-0.5 text-[12px] text-white/45">
              {tn.railNoItems}
            </p>
          ) : (
            <ul className="mb-3 space-y-1">
              {builtItems.map((li) => (
                <li
                  key={li.uid}
                  className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5"
                >
                  <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold">
                      {lineItemTitle(li)}
                    </span>
                    {li.work_needed.trim() ? (
                      <span className="block truncate text-[11px] text-white/55">
                        {li.work_needed}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Assign technician */}
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/55">
              {tn.assignedTo}
            </span>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
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
              value={promisedDate}
              onChange={(e) => setPromisedDate(e.target.value)}
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
          <RailMoney label={tn.laborLabel} value={labor} onChange={setLabor} />
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
      )}
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

// ── Line-item editor (title-builder chips + service + work) ───────────────────

function LineItemEditor({
  index,
  item,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number
  item: LineItem
  canRemove: boolean
  onChange: (patch: Partial<LineItem>) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const tn = t.repair.new_
  const title = lineItemTitle(item)

  const chipBase =
    'rounded-lg border-[1.5px] px-2.5 py-1.5 text-[12px] font-bold transition-colors'
  const chipOn = 'border-gold bg-gold/[0.08] text-foreground'
  const chipOff = 'border-border bg-card text-muted hover:border-gold'

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-foreground">
          {tn.itemLabel.replace('{n}', String(index + 1))}
        </span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
          >
            <Trash size={12} weight="bold" />
            {tn.removeItem}
          </button>
        ) : null}
      </div>

      {/* Item type chips */}
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {tn.itemType}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {ITEM_TYPES.map((it) => {
          const on = item.item_type === it.value
          return (
            <button
              key={it.value}
              type="button"
              onClick={() =>
                onChange({ item_type: on ? '' : it.value })
              }
              className={`${chipBase} ${on ? chipOn : chipOff}`}
            >
              {tn.itemTypes[it.value]}
            </button>
          )
        })}
      </div>

      {/* Karat chips */}
      <div className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {tn.karat}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {KARAT_OPTIONS.map((k) => {
          const on = item.karat === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange({ karat: on ? '' : k })}
              className={`${chipBase} ${on ? chipOn : chipOff}`}
            >
              {k}
            </button>
          )
        })}
      </div>

      {/* Weight + dimension */}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground">
            {tn.weightGrams}
          </span>
          <input
            type="number"
            step="0.001"
            inputMode="decimal"
            value={item.weight_grams}
            onChange={(e) => onChange({ weight_grams: e.target.value })}
            placeholder={tn.weightPlaceholder}
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground">
            {tn.dimension}
          </span>
          <input
            type="text"
            value={item.dimension}
            onChange={(e) => onChange({ dimension: e.target.value })}
            placeholder={tn.dimensionPlaceholder}
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        </label>
      </div>

      {/* Service chips */}
      <div className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {tn.service}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {SERVICE_TILES.map(({ value, labelKey }) => {
          const on = item.service_type === value
          return (
            <button
              key={value}
              type="button"
              onClick={() =>
                onChange({ service_type: value, service_touched: true })
              }
              className={`${chipBase} ${on ? chipOn : chipOff}`}
            >
              {t.repair.serviceTypes[labelKey]}
            </button>
          )
        })}
      </div>

      {/* Work needed */}
      <label className="mt-2.5 block space-y-1">
        <span className="text-[11px] font-medium text-foreground">
          {tn.workNeeded}
        </span>
        <input
          type="text"
          value={item.work_needed}
          onChange={(e) => onChange({ work_needed: e.target.value })}
          placeholder={tn.workNeededPlaceholder}
          className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        />
      </label>

      {/* Composed title preview */}
      <div className="mt-2.5 rounded-lg border border-border bg-card px-3 py-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">
          {tn.titlePreview}
        </span>
        <div className="mt-0.5 text-sm font-semibold text-foreground">
          {title || (
            <span className="font-normal text-muted">{tn.titleEmpty}</span>
          )}
        </div>
      </div>
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
      {/* Values submit through the hidden stone_<n>_* inputs in the form
          root (shared by both views); these controls carry no name. */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
        <Input
          label={`${t.repair.new_.stoneType} *`}
          value={row.stone_type}
          onChange={(v) => onChange({ stone_type: v })}
          placeholder={t.repair.new_.stoneTypePlaceholder}
          required
          span={2}
        />
        <Input
          label={t.repair.new_.stoneShape}
          value={row.shape}
          onChange={(v) => onChange({ shape: v })}
        />
        <Input
          label={t.repair.new_.stoneSize}
          value={row.size_mm}
          onChange={(v) => onChange({ size_mm: v })}
          type="number"
          step="0.01"
        />
        <Input
          label={t.repair.new_.stoneWeight}
          value={row.weight_carats}
          onChange={(v) => onChange({ weight_carats: v })}
          type="number"
          step="0.001"
        />
        <Input
          label={t.repair.new_.stoneColor}
          value={row.color}
          onChange={(v) => onChange({ color: v })}
        />
        <Input
          label={t.repair.new_.stoneClarity}
          value={row.clarity}
          onChange={(v) => onChange({ clarity: v })}
        />
        <Input
          label={t.repair.new_.mountingType}
          value={row.mounting_type}
          onChange={(v) => onChange({ mounting_type: v })}
        />
        <Input
          label={t.repair.new_.mountingPosition}
          value={row.mounting_position}
          onChange={(v) => onChange({ mounting_position: v })}
        />
        <label className="md:col-span-2 block space-y-1">
          <span className="text-xs font-medium text-foreground">
            {t.repair.new_.stoneSource}
          </span>
          <select
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
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  step,
  required,
  span = 1,
}: {
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
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
      />
    </label>
  )
}
