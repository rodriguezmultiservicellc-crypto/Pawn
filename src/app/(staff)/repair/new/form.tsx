'use client'

import { useActionState, useCallback, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Plus, Trash, CheckCircle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import CustomerPicker, {
  type CustomerPickerHandle,
} from '@/components/customers/CustomerPicker'
import QuickCustomerModal from '@/components/customers/QuickCustomerModal'
import type { CustomerScan } from '@/lib/customers/scan-prefill'
import { FOCUS, INPUT, LABEL, OUTLINE_BTN, PRIMARY_BTN } from '@/lib/ui/ledger'
import {
  RepairItemsList,
  lineItemTitle,
  newLineItem,
  type LineItem,
} from '@/components/repair/RepairItemsList'
import type { StripPhoto } from '@/components/uploads/PhotoStrip'
import {
  createRepairTicketAction,
  type CreateRepairTicketState,
} from './actions'
import type { PickerCustomerResult } from '@/lib/customers/picker-search'
import { SimpleRepairTicketView } from './simple-view'
import type { ClaimResult } from '@/lib/pawn/draft-handoff'
import type { RepairDraftPayload } from '@/lib/repair/draft-payload'
import { DraftHandoffButton, TicketMovedNotice } from '@/components/pawn/DraftHandoff'

export type { LineItem }

/** A draft opened on this device (the QR handoff, patches/0118). */
export type RepairDraftInitial = {
  id: string
  customer: PickerCustomerResult
  payload: RepairDraftPayload
  /** Each item's photos, signed again to show (same order as line_items). */
  photos: StripPhoto[][]
}

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

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '$0.00'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
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
  tenantId,
  technicians,
  initialDraft,
  handoff,
}: {
  /** The shop's folder photos upload to (repair-photos/<tenantId>/intake). */
  tenantId: string
  technicians: TechnicianOption[]
  initialDraft: RepairDraftInitial | null
  /** Opened from another device's QR code: did the claim work? */
  handoff: ClaimResult | null
}) {
  const { t } = useI18n()
  const tn = t.repair.new_
  // INLINE `{}` second arg per Next 16 'use server' rules — never an exported
  // `InitialState` constant.
  const [state, formAction, pending] = useActionState<
    CreateRepairTicketState,
    FormData
  >(createRepairTicketAction, {})

  // A draft from another device brings back every field it had.
  const draft = initialDraft?.payload ?? null
  // Like the pawn ticket, the list starts empty: a pill adds each item.
  const [items, setItems] = useState<LineItem[]>(() =>
    (draft?.line_items ?? []).map((li, i) => ({
      ...newLineItem(),
      ...li,
      photos: initialDraft?.photos[i] ?? [],
    })),
  )
  const [stones, setStones] = useState<StoneRow[]>(() =>
    (draft?.stones ?? []).map((st) => ({ ...newStoneRow(), ...st })),
  )
  // The draft this ticket was saved as; opening the ticket closes it.
  const [savedDraftId, setSavedDraftId] = useState<string | null>(initialDraft?.id ?? null)
  // The ticket moved to another device: this screen lets it go.
  const [moved, setMoved] = useState(false)
  const onMoved = useCallback(() => setMoved(true), [])

  const [selectedCustomer, setSelectedCustomer] =
    useState<PickerCustomerResult | null>(initialDraft?.customer ?? null)
  const customerPickerRef = useRef<CustomerPickerHandle>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  // A scanned license with no customer on file: New customer opens filled from it.
  const [customerScan, setCustomerScan] = useState<CustomerScan | null>(null)

  // Ticket-level fields live in state (not in uncontrolled inputs) so they
  // survive a view switch; both views submit them via the hidden inputs below.
  const [promisedDate, setPromisedDate] = useState(draft?.promised_date ?? '')
  const [assignedTo, setAssignedTo] = useState(draft?.assigned_to ?? '')
  const [notesInternal, setNotesInternal] = useState(draft?.notes_internal ?? '')

  const view = useSyncExternalStore(subscribeView, readPersistedView, serverView)

  // Rail estimate — DISPLAY-ONLY calculator (like the pawn-rail redemption
  // preview). The official quote/deposit are set post-intake via the repair
  // quote workflow (quote_set event + status transition). The ticket ignores
  // them; only a draft keeps them (est_* hidden fields).
  const [labor, setLabor] = useState(draft?.est_labor ?? '')
  const [materials, setMaterials] = useState(draft?.est_materials ?? '')
  const [deposit, setDeposit] = useState(draft?.est_deposit ?? '')

  const builtItems = items.filter((it) => it.item_type !== '')
  const showStones = items.some(
    (it) => it.service_type === 'stone_setting' || it.service_type === 'custom',
  )

  const estTotal = (parseFloat(labor) || 0) + (parseFloat(materials) || 0)
  const estBalance = Math.max(0, estTotal - (parseFloat(deposit) || 0))
  // Classic prices each item (patches/0122): the total is their sum, and an
  // item not priced yet is pointed out. (Simple keeps its own estimate.)
  const itemsTotal = builtItems.reduce((sum, li) => sum + (parseFloat(li.price) || 0), 0)
  const unpricedCount = builtItems.filter((li) => li.price.trim() === '').length
  const itemsBalance = Math.max(0, itemsTotal - (parseFloat(deposit) || 0))

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

  /** Adds an item (of this type, from a pill) and returns its uid. */
  function addItem(itemType = ''): string {
    const li = { ...newLineItem(), item_type: itemType }
    setItems((prev) => [...prev, li])
    return li.uid
  }
  function patchItem(uid: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, ...patch } : it)))
  }
  function removeItem(uid: string) {
    setItems((prev) => prev.filter((it) => it.uid !== uid))
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

  const HINT = 'text-[13px] text-muted'

  if (moved) return <TicketMovedNotice kind="repair" />

  return (
    <form
      id={REPAIR_FORM_ID}
      action={formAction}
      onSubmit={(e) => {
        if (!canOpen) e.preventDefault()
      }}
      className="mx-auto w-full max-w-[1440px]"
    >
      {/* Same page shape as New pawn ticket: no visible title row (the
          sidebar is the way back), the view switch on top. */}
      <h1 className="sr-only">{tn.title}</h1>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div
          role="group"
          aria-label={tn.viewLabel}
          className="inline-flex overflow-hidden rounded-md border border-foreground"
        >
          {(['classic', 'simple'] as const).map((v) => {
            const on = view === v
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => persistView(v)}
                className={`inline-flex h-11 items-center px-5 text-sm font-semibold ${FOCUS} ${
                  on ? 'bg-foreground text-white' : 'bg-card text-foreground hover:bg-background'
                }`}
              >
                {v === 'classic' ? tn.viewClassic : tn.viewSimple}
              </button>
            )
          })}
        </div>
        {/* Move this ticket to an iPad / phone / laptop with a QR code. */}
        <DraftHandoffButton
          kind="repair"
          formId={REPAIR_FORM_ID}
          disabled={selectedCustomer == null}
          className={OUTLINE_BTN}
          onDraftSaved={setSavedDraftId}
          onMoved={onMoved}
        />
      </div>

      {handoff ? (
        <div
          role="status"
          className={`mb-6 rounded-md border px-3 py-2 text-sm text-foreground ${
            handoff === 'claimed' ? 'border-success/30 bg-success/5' : 'border-warning/40 bg-warning/5'
          }`}
        >
          {handoff === 'claimed' ? t.pawn.new_.handoff.arrived : t.pawn.new_.handoff.invalid}
        </div>
      ) : null}

      {state.error ? (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error === 'photos_invalid' ? tn.photosInvalid : state.error}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
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
          <input
            type="hidden"
            name={`li_${i}_service_touched`}
            value={li.service_touched ? '1' : '0'}
          />
          <input type="hidden" name={`li_${i}_price`} value={li.price} />
          {/* Paths of the photos the browser already uploaded (patches/0119).
              Here, not in the popup, so a switch to Simple keeps them. */}
          <input
            type="hidden"
            name={`li_${i}_photos`}
            value={JSON.stringify(li.photos.map((p) => p.path))}
          />
        </div>
      ))}

      {/* Ticket-level fields — one source for both views. */}
      <input type="hidden" name="promised_date" value={promisedDate} />
      {/* Only a draft reads these (the QR handoff); the ticket ignores them. */}
      <input type="hidden" name="est_labor" value={labor} />
      <input type="hidden" name="est_materials" value={materials} />
      <input type="hidden" name="est_deposit" value={deposit} />
      {savedDraftId ? <input type="hidden" name="draft_id" value={savedDraftId} /> : null}
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

      <QuickCustomerModal
        open={showCustomerModal}
        onClose={() => {
          setShowCustomerModal(false)
          setCustomerScan(null)
        }}
        prefill={customerScan}
        onCreated={(c) => {
          customerPickerRef.current?.set(c)
          setSelectedCustomer(c)
        }}
      />

      {view === 'simple' ? (
        <SimpleRepairTicketView
          technicians={technicians}
          items={items}
          onAddItem={() => void addItem()}
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
      <div className="space-y-6">
        {/* 1 · Customer */}
        <section className="space-y-2">
          <h2 className={LABEL}>1 · {tn.sectionCustomer}</h2>
          <CustomerPicker
            ref={customerPickerRef}
            name="customer_id"
            required
            enableDlScan
            onAddFromScan={(scan) => {
              setCustomerScan(scan)
              setShowCustomerModal(true)
            }}
            size="lg"
            initialCustomer={selectedCustomer}
            error={state.fieldErrors?.customer_id}
            onChange={setSelectedCustomer}
            trailing={
              <button
                type="button"
                onClick={() => setShowCustomerModal(true)}
                className={`${OUTLINE_BTN} h-[52px]`}
              >
                <Plus size={14} weight="bold" />
                {tn.newCustomer}
              </button>
            }
          />
          <p className={HINT}>{tn.pickCustomerHelp}</p>
        </section>

        {/* 2 · Items — like the pawn ticket: a pill per item type, the items
            in a table, each in its own popup (Photos · Item · Service). */}
        <section className="space-y-3">
          <RepairItemsList
            title={`2 · ${tn.sectionItem}`}
            items={items}
            tenantId={tenantId}
            error={state.fieldErrors?.line_items ? tn.atLeastOneItem : null}
            onAdd={addItem}
            onPatch={patchItem}
            onRemove={removeItem}
          />

          {showStones ? (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <h3 className={LABEL}>{tn.sectionStones}</h3>
              {stones.map((s, idx) => (
                <StoneRowEditor
                  key={s.uid}
                  index={idx}
                  row={s}
                  onChange={(patch) => patchStone(s.uid, patch)}
                  onRemove={() => removeStone(s.uid)}
                />
              ))}
              <button type="button" onClick={addStone} className={OUTLINE_BTN}>
                <Plus size={14} weight="bold" />
                {tn.addStone}
              </button>
            </div>
          ) : null}
        </section>

        {/* 3 · Repair notes */}
        <section>
          <label className="block max-w-3xl space-y-2">
            <span className={`block ${LABEL}`}>3 · {tn.notesInternal}</span>
            <textarea
              rows={3}
              value={notesInternal}
              onChange={(e) => setNotesInternal(e.target.value)}
              className={`block w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue ${FOCUS}`}
            />
            <span className={`block ${HINT}`}>{tn.notesInternalHelp}</span>
          </label>
        </section>

        {/* Ticket summary bar: terms · summary · balance + actions
            (the same bar as New pawn ticket's loan summary). */}
        <section
          aria-label={tn.railSummaryTitle}
          className="grid grid-cols-1 divide-y divide-border rounded-lg border border-foreground bg-card lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0"
        >
          {/* a. Technician · pickup · estimate */}
          <div className="space-y-3 p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className={`block ${LABEL}`}>{tn.assignedTo}</span>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className={INPUT}
                >
                  <option value="">{tn.assignedToNone}</option>
                  {technicians.map((tech) => (
                    <option key={tech.id} value={tech.id}>
                      {tech.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className={`block ${LABEL}`}>{tn.promisedDate}</span>
                <input
                  type="date"
                  value={promisedDate}
                  onChange={(e) => setPromisedDate(e.target.value)}
                  className={`${INPUT} font-mono`}
                />
              </label>
              <MoneyField label={tn.depositLabel} value={deposit} onChange={setDeposit} />
            </div>
            <p className={HINT}>{tn.list.priceHelp}</p>
          </div>

          {/* b. Summary */}
          <dl className="space-y-4 p-5 text-sm">
            <div>
              <dt className={LABEL}>{tn.sectionCustomer}</dt>
              <dd className="mt-1 font-semibold text-foreground">
                {selectedCustomer?.label ?? (
                  <span className="font-normal text-muted">{tn.railNoCustomer}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>
                {tn.railItemsTitle}{' '}
                <span className="font-mono tabular-nums">({builtItems.length})</span>
              </dt>
              {builtItems.length === 0 ? (
                <dd className="mt-1 text-muted">{tn.railNoItems}</dd>
              ) : (
                builtItems.map((li) => (
                  <dd key={li.uid} className="mt-1 text-foreground">
                    <span className="font-semibold">{lineItemTitle(li)}</span>
                    {li.work_needed.trim() ? (
                      <span className="text-muted"> · {li.work_needed}</span>
                    ) : null}
                  </dd>
                ))
              )}
            </div>
            <div>
              <dt className={LABEL}>{tn.list.itemsTotal}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {fmtMoney(itemsTotal)}
              </dd>
              {unpricedCount > 0 ? (
                <dd className="mt-0.5 text-[13px] font-semibold text-warning">
                  {tn.list.notPriced.replace('{n}', String(unpricedCount))}
                </dd>
              ) : null}
            </div>
          </dl>

          {/* c. Balance + actions */}
          <div className="space-y-3 p-5">
            <div>
              <div className={LABEL}>{tn.balanceDue}</div>
              <div className="mt-1 font-mono text-[40px] font-bold leading-tight tabular-nums text-foreground">
                {fmtMoney(itemsBalance)}
              </div>
            </div>
            <button
              type="submit"
              disabled={!canOpen}
              className={`${PRIMARY_BTN} h-14 w-full text-base`}
            >
              <CheckCircle size={18} weight="bold" />
              {pending ? tn.submitting : tn.submit}
            </button>
            <Link href="/repair" className={`${OUTLINE_BTN} w-full`}>
              {t.common.cancel}
            </Link>
            {!canOpen && !pending ? (
              <p className={`${HINT} text-center`}>{tn.railMissingHint}</p>
            ) : null}
          </div>
        </section>
      </div>
      )}
    </form>
  )
}

/** A money input with its label above and a "$" inside (display-only estimate). */
function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block space-y-1.5">
      <span className={`block ${LABEL}`}>{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-muted">
          $
        </span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className={`${INPUT} pl-7 font-mono tabular-nums`}
        />
      </div>
    </label>
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
    <div className="rounded-md border border-border bg-background p-3">
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
          <span className={`block ${LABEL}`}>
            {t.repair.new_.stoneSource}
          </span>
          <select
            value={row.source}
            onChange={(e) =>
              onChange({
                source: e.target.value as 'customer_supplied' | 'shop_supplied',
              })
            }
            className={INPUT}
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
          <span className={`block ${LABEL}`}>
            {t.repair.new_.stoneNotes}
          </span>
          <input
            type="text"
            value={row.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            className={INPUT}
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
      <span className={`block ${LABEL}`}>{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </label>
  )
}
