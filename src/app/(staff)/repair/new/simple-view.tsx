'use client'

/**
 * "Simple" view of the New repair ticket page — a second skin over the SAME
 * form state Classic owns (form.tsx). It renders no named inputs of its own
 * except the customer id: every value it edits lives in form.tsx state and
 * is submitted through the hidden fields form.tsx renders for both views, so
 * a ticket opened here is row-for-row the ticket Classic opens.
 *
 * Layout: one centred column (max 780px), three cards, a bottom bar fixed to
 * the screen. The bar is measured against the <main> column so it never
 * covers the sidebar.
 */

import { useEffect, useRef, useState, type RefObject } from 'react'
import { CheckCircle, Plus, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import CustomerPicker, {
  type CustomerPickerHandle,
} from '@/components/customers/CustomerPicker'
import type { PickerCustomerResult } from '@/lib/customers/picker-search'
import { ITEM_TYPES } from '@/lib/repair/line-items'
import {
  READY_BY_OFFSETS,
  SIMPLE_METALS_MORE,
  SIMPLE_METALS_PRIMARY,
  SIMPLE_SERVICES,
  formatReadyBy,
  localDatePlusDays,
  metalLabel,
  sanitizeDecimal,
  simpleItemHeading,
  sizeFieldFor,
} from '@/lib/repair/simple-intake'
import type { ServiceType } from '@/types/database-aliases'
import type { LineItem, TechnicianOption } from './form'

export type SimpleViewProps = {
  technicians: TechnicianOption[]
  items: LineItem[]
  onAddItem: () => void
  onPatchItem: (uid: string, patch: Partial<LineItem>) => void
  onRemoveItem: (uid: string) => void
  customer: PickerCustomerResult | null
  onCustomerChange: (c: PickerCustomerResult | null) => void
  onNewCustomer: () => void
  customerPickerRef: RefObject<CustomerPickerHandle | null>
  customerError?: string
  itemsError?: string
  promisedDate: string
  onPromisedDateChange: (v: string) => void
  assignedTo: string
  onAssignedToChange: (v: string) => void
  labor: string
  onLaborChange: (v: string) => void
  materials: string
  onMaterialsChange: (v: string) => void
  deposit: string
  onDepositChange: (v: string) => void
  estBalance: number
  canOpen: boolean
  needsService: boolean
  submitLabel: string
  fmtMoney: (v: number) => string
}

const SERVICE_LABEL_KEY: Record<
  ServiceType,
  'repair' | 'stoneSetting' | 'sizing' | 'restring' | 'plating' | 'engraving' | 'custom'
> = {
  repair: 'repair',
  stone_setting: 'stoneSetting',
  sizing: 'sizing',
  restring: 'restring',
  plating: 'plating',
  engraving: 'engraving',
  custom: 'custom',
}

const card = 'rounded-xl border border-border bg-card p-4 sm:p-5'
const cardTitle = 'text-[11px] font-bold uppercase tracking-[0.06em] text-muted'
const chipBase =
  'inline-flex min-h-11 items-center justify-center rounded-xl border-[1.5px] px-3.5 text-sm font-bold transition-colors'
const chipOn = 'border-navy bg-navy text-white'
const chipOff = 'border-border bg-card text-foreground hover:border-navy'
const fieldLabel = 'text-sm font-semibold text-foreground'
const inputCls =
  'block min-h-11 w-full rounded-xl border-2 border-border bg-background px-3.5 text-base text-foreground outline-none transition-colors focus:border-gold'

export function SimpleRepairTicketView({
  technicians,
  items,
  onAddItem,
  onPatchItem,
  onRemoveItem,
  customer,
  onCustomerChange,
  onNewCustomer,
  customerPickerRef,
  customerError,
  itemsError,
  promisedDate,
  onPromisedDateChange,
  assignedTo,
  onAssignedToChange,
  labor,
  onLaborChange,
  materials,
  onMaterialsChange,
  deposit,
  onDepositChange,
  estBalance,
  canOpen,
  needsService,
  submitLabel,
  fmtMoney,
}: SimpleViewProps) {
  const { t, lang } = useI18n()
  const tn = t.repair.new_
  const ts = tn.simple
  const locale = lang === 'es' ? 'es-US' : 'en-US'

  // ── Fixed bottom bar: measured against <main> so it spans the content
  // column (sidebar excluded) and follows the sidebar collapse animation.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [barBox, setBarBox] = useState<{ left: number; width: number } | null>(
    null,
  )
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const target = el.closest('main') ?? el
    const measure = () => {
      const r = target.getBoundingClientRect()
      setBarBox({ left: r.left, width: r.width })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(target)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  function itemHeading(li: LineItem): string {
    return simpleItemHeading({
      metal: li.karat
        ? metalLabel(li.karat, { silver: ts.silver, platinum: ts.platinum })
        : '',
      typeLabel: li.item_type
        ? (tn.itemTypes as Record<string, string>)[li.item_type] ?? ''
        : '',
      serviceLabel: !li.service_touched
        ? ''
        : li.service_type === 'custom'
          ? ts.serviceOther
          : t.repair.serviceTypes[SERVICE_LABEL_KEY[li.service_type]],
    })
  }

  const builtItems = items.filter((it) => it.item_type !== '')
  const firstTitle = builtItems[0] ? itemHeading(builtItems[0]) : ''
  const readyShort = promisedDate
    ? formatReadyBy(promisedDate, locale, 'short')
    : ''
  const summaryBits: string[] = [
    builtItems.length === 1
      ? ts.itemCount
      : ts.itemsCount.replace('{n}', String(builtItems.length)),
  ]
  if (firstTitle) summaryBits.push(firstTitle)
  if (readyShort) summaryBits.push(ts.readyShort.replace('{date}', readyShort))

  return (
    <div ref={wrapRef} className="pb-36">
      <div className="mx-auto w-full max-w-[780px] space-y-4">
        {/* ── Card 1: Customer ─────────────────────────────────────────── */}
        <section className={card}>
          <h2 className={cardTitle}>{ts.customerTitle}</h2>
          {customer ? (
            <CustomerChosen
              customer={customer}
              changeLabel={ts.change}
              onChange={() => onCustomerChange(null)}
            />
          ) : (
            <>
              <p className="mt-1 text-xs font-medium text-warning">
                {tn.pickCustomerHelp}
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <CustomerPicker
                    ref={customerPickerRef}
                    name="customer_id"
                    required
                    error={customerError}
                    onChange={onCustomerChange}
                  />
                </div>
                <button
                  type="button"
                  onClick={onNewCustomer}
                  className="min-h-11 shrink-0 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
                >
                  {tn.newCustomer}
                </button>
              </div>
            </>
          )}
        </section>

        {/* ── Card 2: one card per item ─────────────────────────────────── */}
        {itemsError ? (
          <p className="text-xs text-danger">{tn.atLeastOneItem}</p>
        ) : null}
        {items.map((li, idx) => (
          <SimpleItemCard
            key={li.uid}
            index={idx}
            item={li}
            heading={itemHeading(li)}
            canRemove={items.length > 1}
            onChange={(patch) => onPatchItem(li.uid, patch)}
            onRemove={() => onRemoveItem(li.uid)}
          />
        ))}
        <button
          type="button"
          onClick={onAddItem}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card text-sm font-bold text-foreground hover:border-navy"
        >
          <Plus size={16} weight="bold" />
          {ts.addAnother}
        </button>

        {/* ── Card 3: Pickup and price ──────────────────────────────────── */}
        <PickupAndPrice
          locale={locale}
          technicians={technicians}
          promisedDate={promisedDate}
          onPromisedDateChange={onPromisedDateChange}
          assignedTo={assignedTo}
          onAssignedToChange={onAssignedToChange}
          labor={labor}
          onLaborChange={onLaborChange}
          materials={materials}
          onMaterialsChange={onMaterialsChange}
          deposit={deposit}
          onDepositChange={onDepositChange}
        />
      </div>

      {/* ── Bottom bar ────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 z-20 border-t border-white/10 bg-navy text-white shadow-lg"
        style={
          barBox
            ? { left: barBox.left, width: barBox.width }
            : { left: 0, right: 0 }
        }
      >
        <div className="mx-auto flex w-full max-w-[780px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-0">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-white/65">
              {builtItems.length === 0 ? ts.noItems : summaryBits.join(' · ')}
            </div>
            <div className="text-lg font-extrabold tabular-nums">
              {ts.balance}{' '}
              <span className="font-mono">{fmtMoney(estBalance)}</span>
            </div>
            {needsService ? (
              <div className="text-[11.5px] font-semibold text-gold">
                {ts.pickService}
              </div>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={!canOpen}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gold px-6 text-base font-extrabold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0 sm:w-auto"
          >
            <CheckCircle size={18} weight="bold" />
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Customer chosen (collapsed) ─────────────────────────────────────────────

function CustomerChosen({
  customer,
  changeLabel,
  onChange,
}: {
  customer: PickerCustomerResult
  changeLabel: string
  onChange: () => void
}) {
  // Picker label is "Lastname, Firstname · phone" (picker-search.ts).
  const sep = customer.label.lastIndexOf(' · ')
  const name = sep >= 0 ? customer.label.slice(0, sep) : customer.label
  const phone = sep >= 0 ? customer.label.slice(sep + 3) : ''
  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border-2 border-blue/40 bg-blue/5 px-4 py-3">
      <input type="hidden" name="customer_id" value={customer.id} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-bold text-foreground">{name}</div>
        {phone ? (
          <div className="font-mono text-sm text-text-secondary">{phone}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onChange}
        className="min-h-11 shrink-0 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
      >
        {changeLabel}
      </button>
    </div>
  )
}

// ── Item card ───────────────────────────────────────────────────────────────

function SimpleItemCard({
  index,
  item,
  heading,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number
  item: LineItem
  heading: string
  canRemove: boolean
  onChange: (patch: Partial<LineItem>) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const tn = t.repair.new_
  const ts = tn.simple
  const [moreMetals, setMoreMetals] = useState(() =>
    SIMPLE_METALS_MORE.includes(item.karat),
  )
  const size = sizeFieldFor(item.item_type)
  const placeholder = item.service_touched
    ? ts.notesPlaceholder[item.service_type]
    : ts.notesPlaceholder.none

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className={cardTitle}>
            {ts.itemTitle.replace('{n}', String(index + 1))}
          </div>
          <div className="truncate text-lg font-bold text-foreground">
            {heading || (
              <span className="font-normal text-muted">{ts.itemUntitled}</span>
            )}
          </div>
        </div>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/5 px-3 text-sm font-semibold text-danger hover:bg-danger/10"
          >
            <Trash size={14} weight="bold" />
            {ts.remove}
          </button>
        ) : null}
      </div>

      <ChipGroup label={ts.whatIsIt}>
        {ITEM_TYPES.map((it) => {
          const on = item.item_type === it.value
          return (
            <button
              key={it.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ item_type: on ? '' : it.value })}
              className={`${chipBase} ${on ? chipOn : chipOff}`}
            >
              {tn.itemTypes[it.value]}
            </button>
          )
        })}
      </ChipGroup>

      <ChipGroup label={ts.metal}>
        {[...SIMPLE_METALS_PRIMARY, ...(moreMetals ? SIMPLE_METALS_MORE : [])].map(
          (k) => {
            const on = item.karat === k
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ karat: on ? '' : k })}
                className={`${chipBase} ${on ? chipOn : chipOff}`}
              >
                {metalLabel(k, { silver: ts.silver, platinum: ts.platinum })}
              </button>
            )
          },
        )}
        {!moreMetals ? (
          <button
            type="button"
            onClick={() => setMoreMetals(true)}
            className={`${chipBase} border-dashed border-border bg-transparent text-text-secondary hover:border-navy`}
          >
            {ts.moreMetals}
          </button>
        ) : null}
      </ChipGroup>

      <ChipGroup label={ts.whatNeeded}>
        {SIMPLE_SERVICES.map((value) => {
          const on = item.service_touched && item.service_type === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange({ service_type: value, service_touched: true })
              }
              className={`${chipBase} ${on ? chipOn : chipOff}`}
            >
              {value === 'custom'
                ? ts.serviceOther
                : t.repair.serviceTypes[SERVICE_LABEL_KEY[value]]}
            </button>
          )
        })}
      </ChipGroup>

      <label className="mt-4 block space-y-1.5">
        <span className={fieldLabel}>{ts.notes}</span>
        <input
          type="text"
          value={item.work_needed}
          onChange={(e) => onChange({ work_needed: e.target.value })}
          placeholder={placeholder}
          className={inputCls}
        />
      </label>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {size ? (
          <label className="block space-y-1.5">
            <span className={fieldLabel}>
              {size === 'ring' ? ts.ringSize : ts.length}
            </span>
            <input
              type="text"
              value={item.dimension}
              onChange={(e) => onChange({ dimension: e.target.value })}
              placeholder={tn.dimensionPlaceholder}
              className={inputCls}
            />
          </label>
        ) : null}
        <label className="block space-y-1.5">
          <span className={fieldLabel}>{ts.weight}</span>
          <input
            type="text"
            inputMode="decimal"
            value={item.weight_grams}
            onChange={(e) =>
              onChange({ weight_grams: sanitizeDecimal(e.target.value) })
            }
            placeholder={tn.weightPlaceholder}
            className={inputCls}
          />
        </label>
      </div>
    </section>
  )
}

function ChipGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-4">
      <div className={fieldLabel}>{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

// ── Pickup and price ────────────────────────────────────────────────────────

function PickupAndPrice({
  locale,
  technicians,
  promisedDate,
  onPromisedDateChange,
  assignedTo,
  onAssignedToChange,
  labor,
  onLaborChange,
  materials,
  onMaterialsChange,
  deposit,
  onDepositChange,
}: {
  locale: string
  technicians: TechnicianOption[]
  promisedDate: string
  onPromisedDateChange: (v: string) => void
  assignedTo: string
  onAssignedToChange: (v: string) => void
  labor: string
  onLaborChange: (v: string) => void
  materials: string
  onMaterialsChange: (v: string) => void
  deposit: string
  onDepositChange: (v: string) => void
}) {
  const { t } = useI18n()
  const ts = t.repair.new_.simple
  const [split, setSplit] = useState(
    () => materials !== '' && (parseFloat(materials) || 0) !== 0,
  )
  const [showPicker, setShowPicker] = useState(false)

  // Which chip matches the promised date. The browser clock is only consulted
  // once a date exists, i.e. after an operator clicked something — the
  // server-rendered tree never depends on it.
  const chipDates = READY_BY_OFFSETS.map((o) => ({
    ...o,
    iso: promisedDate ? localDatePlusDays(new Date(), o.days) : '',
  }))
  const matchedKey = promisedDate
    ? chipDates.find((c) => c.iso === promisedDate)?.key
    : undefined
  const pickerOn = showPicker || (promisedDate !== '' && !matchedKey)
  const promisedWords = promisedDate
    ? formatReadyBy(promisedDate, locale, 'long')
    : ''

  function toggleSplit() {
    if (split) {
      // Fold both boxes back into one estimate.
      const total = (parseFloat(labor) || 0) + (parseFloat(materials) || 0)
      onLaborChange(total ? String(total) : '')
      onMaterialsChange('')
      setSplit(false)
    } else {
      setSplit(true)
    }
  }

  return (
    <section className={card}>
      <h2 className={cardTitle}>{ts.pickupTitle}</h2>

      <div className="mt-3">
        <div className={fieldLabel}>{ts.readyBy}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {chipDates.map((c) => {
            const on = matchedKey === c.key && !showPicker
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setShowPicker(false)
                  onPromisedDateChange(localDatePlusDays(new Date(), c.days))
                }}
                className={`${chipBase} ${on ? chipOn : chipOff}`}
              >
                {ts[c.key]}
              </button>
            )
          })}
          <button
            type="button"
            aria-pressed={pickerOn}
            onClick={() => setShowPicker(true)}
            className={`${chipBase} ${pickerOn ? chipOn : chipOff}`}
          >
            {ts.pickDate}
          </button>
        </div>
        {pickerOn ? (
          <input
            type="date"
            value={promisedDate}
            onChange={(e) => onPromisedDateChange(e.target.value)}
            className={`${inputCls} mt-2 sm:max-w-xs`}
          />
        ) : null}
        {promisedWords ? (
          <p className="mt-2 text-sm font-semibold text-foreground">
            {ts.promisedFor.replace('{date}', promisedWords)}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {split ? (
          <>
            <MoneyField label={ts.labor} value={labor} onChange={onLaborChange} />
            <MoneyField
              label={ts.materials}
              value={materials}
              onChange={onMaterialsChange}
            />
          </>
        ) : (
          <MoneyField label={ts.estimate} value={labor} onChange={onLaborChange} />
        )}
        <MoneyField
          label={ts.depositToday}
          value={deposit}
          onChange={onDepositChange}
        />
      </div>
      <button
        type="button"
        onClick={toggleSplit}
        className="mt-2 text-sm font-semibold text-blue hover:underline"
      >
        {split ? ts.unsplitLink : ts.splitLink}
      </button>

      <label className="mt-4 block space-y-1.5">
        <span className={fieldLabel}>{ts.technician}</span>
        <select
          value={assignedTo}
          onChange={(e) => onAssignedToChange(e.target.value)}
          className={inputCls}
        >
          <option value="">{ts.assignLater}</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}

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
      <span className={fieldLabel}>{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted">
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(sanitizeDecimal(e.target.value))}
          placeholder="0.00"
          className={`${inputCls} pl-8 font-mono tabular-nums`}
        />
      </div>
    </label>
  )
}
