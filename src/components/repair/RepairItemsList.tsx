'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { PhotoStrip, type StripPhoto } from '@/components/uploads/PhotoStrip'
import { FOCUS, INPUT, LABEL, OUTLINE_BTN, PRIMARY_BTN } from '@/lib/ui/ledger'
import {
  ITEM_TYPES,
  KARAT_OPTIONS,
  composeLineItemTitle,
  itemTypeLabelEn,
} from '@/lib/repair/line-items'
import type { ServiceType } from '@/types/database-aliases'
import { appendWorkPhrase } from '@/lib/repair/work-presets'

/**
 * Step 2 of New repair ticket, laid out like the pawn ticket's items (Eddy,
 * 2026-11-26): one pill per item type adds an item and opens its popup
 * (Photos · Item · Service); the items show in a table with Edit / Remove.
 *
 * The list is controlled by the form (form.tsx owns the items, the Simple
 * view edits the same ones) and the form submits every value through its own
 * hidden li_<n>_* fields — nothing in here has a name. The popup is a native
 * <dialog> opened with showModal(), always mounted, never in a portal, so a
 * photo still uploading keeps the form's submit waiting (PhotoStrip).
 *
 * Photos are uploaded by the browser to repair-photos/<tenant>/intake/
 * (patches/0119) the moment they are picked; the item keeps their paths.
 */

export type LineItem = {
  uid: string
  item_type: string
  karat: string
  weight_grams: string
  dimension: string
  service_type: ServiceType
  /** False until the operator picks a service. Classic starts every item at
   *  'repair'; the Simple view shows nothing selected and will not open the
   *  ticket until a service has been chosen explicitly. */
  service_touched: boolean
  work_needed: string
  /** What the shop charges for this item, as typed ('' = not priced yet;
   *  patches/0122). Every item priced = the ticket is quoted at their sum. */
  price: string
  /** The item's photos, main first, already uploaded. */
  photos: StripPhoto[]
}

export function newLineItem(): LineItem {
  return {
    uid: typeof crypto !== 'undefined' ? crypto.randomUUID() : `li${Math.random()}`,
    item_type: '',
    karat: '',
    weight_grams: '',
    dimension: '',
    service_type: 'repair',
    service_touched: false,
    work_needed: '',
    price: '',
    photos: [],
  }
}

export function lineItemTitle(li: LineItem): string {
  return composeLineItemTitle({
    typeLabel: li.item_type ? itemTypeLabelEn(li.item_type) : '',
    karat: li.karat,
    weightGrams: li.weight_grams,
    dimension: li.dimension,
  })
}

export const SERVICE_CHOICES: ReadonlyArray<{
  value: ServiceType
  labelKey: 'repair' | 'stoneSetting' | 'sizing' | 'restring' | 'plating' | 'engraving' | 'nameplate' | 'custom'
}> = [
  { value: 'repair', labelKey: 'repair' },
  { value: 'stone_setting', labelKey: 'stoneSetting' },
  { value: 'sizing', labelKey: 'sizing' },
  { value: 'restring', labelKey: 'restring' },
  { value: 'plating', labelKey: 'plating' },
  { value: 'engraving', labelKey: 'engraving' },
  { value: 'nameplate', labelKey: 'nameplate' },
  { value: 'custom', labelKey: 'custom' },
]

/** A typed price as money: "$85.00". */
function fmtPrice(v: string): string {
  const n = parseFloat(v)
  return isFinite(n)
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
    : '—'
}

type Step = 'photos' | 'item' | 'service'
const STEPS: ReadonlyArray<Step> = ['photos', 'item', 'service']

export function RepairItemsList({
  title,
  items,
  tenantId,
  error,
  onAdd,
  onPatch,
  onRemove,
}: {
  /** "2 · Items" */
  title: string
  items: LineItem[]
  tenantId: string
  error?: string | null
  /** Adds an item of this type and returns its uid. */
  onAdd: (itemType: string) => string
  onPatch: (uid: string, patch: Partial<LineItem>) => void
  onRemove: (uid: string) => void
}) {
  const { t } = useI18n()
  const tn = t.repair.new_
  const tl = tn.list
  const [popup, setPopup] = useState<{ uid: string; adding: boolean } | null>(null)
  const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted'

  return (
    <div className="space-y-4">
      {/* "2 · Items" + one pill per item type: adds the item, opens its popup. */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={`mr-2 ${LABEL}`}>{title}</h2>
        {ITEM_TYPES.map((it) => (
          <button
            key={it.value}
            type="button"
            onClick={() => setPopup({ uid: onAdd(it.value), adding: true })}
            className={`inline-flex h-11 items-center gap-1 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:border-blue hover:bg-background ${FOCUS}`}
          >
            <Plus size={14} weight="bold" />
            {tn.itemTypes[it.value]}
          </button>
        ))}
      </div>
      {error ? <p className="text-[13px] font-semibold text-danger">{error}</p> : null}

      <div className="min-h-[200px] overflow-x-auto rounded-lg border border-border [contain:inline-size]">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-background">
            <tr className="border-b border-border">
              <th className={`${TH} w-12`}>{tl.colNo}</th>
              <th className={TH}>{tl.colItem}</th>
              <th className={TH}>{tl.colService}</th>
              <th className={TH}>{tl.colWork}</th>
              <th className={`${TH} text-right`}>{tl.colPrice}</th>
              <th className={`${TH} text-right`}>{tl.colPhotos}</th>
              <th className={`${TH} text-right`}>{tl.colActions}</th>
            </tr>
          </thead>
          {items.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  {tl.empty}
                </td>
              </tr>
            </tbody>
          ) : (
            items.map((item, idx) => (
              <ItemRow
                key={item.uid}
                index={idx}
                item={item}
                tenantId={tenantId}
                open={popup?.uid === item.uid}
                adding={popup?.uid === item.uid && popup.adding}
                onOpen={() => setPopup({ uid: item.uid, adding: false })}
                onClose={() => setPopup((p) => (p?.uid === item.uid ? null : p))}
                onChange={(patch) => onPatch(item.uid, patch)}
                onRemove={() => {
                  setPopup((p) => (p?.uid === item.uid ? null : p))
                  onRemove(item.uid)
                }}
              />
            ))
          )}
        </table>
      </div>
    </div>
  )
}

function ItemRow({
  index,
  item,
  tenantId,
  open,
  adding,
  onOpen,
  onClose,
  onChange,
  onRemove,
}: {
  index: number
  item: LineItem
  tenantId: string
  /** This item's popup is the one showing. */
  open: boolean
  /** A pill just started this item: leaving without "Add item" removes it. */
  adding: boolean
  onOpen: () => void
  onClose: () => void
  onChange: (patch: Partial<LineItem>) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const tn = t.repair.new_
  const tl = tn.list
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fieldId = useId()
  // A new item starts on its photos; an item already on the ticket on Item.
  const [step, setStep] = useState<Step>('photos')
  const workRef = useRef<HTMLTextAreaElement>(null)

  /** A ready-made phrase goes on its own line; its "#" is selected so the
   *  clerk types the number right over it. */
  function addPhrase(phrase: string) {
    const { text, blank } = appendWorkPhrase(item.work_needed, phrase)
    onChange({ work_needed: text })
    requestAnimationFrame(() => {
      const el = workRef.current
      if (!el) return
      el.focus()
      const [s, e] = blank ?? [text.length, text.length]
      el.setSelectionRange(s, e)
    })
  }

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (!open) {
      if (d.open) d.close()
      return
    }
    if (!d.open) d.showModal()
    d.querySelector<HTMLElement>('[data-popup-card]')?.focus()
  }, [open])

  // Add item / Done: wait for a photo still uploading (its hidden field is
  // invalid until then), then close. The fields save as they are typed.
  function confirm() {
    const bad = dialogRef.current?.querySelector<HTMLInputElement>('input:invalid')
    if (bad) {
      const on = bad.closest<HTMLElement>('[data-step]')?.dataset.step as Step | undefined
      if (on && on !== step) setStep(on)
      requestAnimationFrame(() => bad.reportValidity())
      return
    }
    onClose()
  }

  // X / Esc / Cancel: an item being added is taken away; one already on the
  // ticket just closes.
  function dismiss() {
    if (adding) onRemove()
    else onClose()
  }

  const title = lineItemTitle(item)
  const service = SERVICE_CHOICES.find((s) => s.value === item.service_type)
  const TD = 'px-4 py-4 align-top'
  const chip = (on: boolean) =>
    `inline-flex h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${FOCUS} ${
      on ? 'border-navy bg-navy text-white' : 'border-border bg-card text-foreground hover:border-blue'
    }`

  return (
    <tbody className="border-b border-border last:border-b-0">
      <tr>
        <td className={`${TD} font-mono text-muted`}>{index + 1}</td>
        <td className={`${TD} font-semibold text-foreground`}>{title || '—'}</td>
        <td className={`${TD} text-foreground`}>
          {service ? t.repair.serviceTypes[service.labelKey] : '—'}
        </td>
        <td className={`${TD} text-foreground`}>
          {item.work_needed.trim() || <span className="text-muted">—</span>}
        </td>
        <td className={`${TD} text-right font-mono font-semibold text-foreground`}>
          {item.price.trim() ? fmtPrice(item.price) : <span className="font-normal text-muted">—</span>}
        </td>
        <td className={`${TD} text-right font-mono text-foreground`}>{item.photos.length}</td>
        <td className="px-4 py-2 text-right align-top">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setStep('item')
                onOpen()
              }}
              aria-haspopup="dialog"
              className={`inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-blue hover:text-blue-2 hover:underline ${FOCUS}`}
            >
              {tl.edit}
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`${tn.removeItem} ${index + 1}`}
              className={`inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-danger hover:underline ${FOCUS}`}
            >
              {tn.removeItem}
            </button>
          </div>

          {/* The item's popup. No display class on the <dialog> itself: a
              closed dialog must stay display:none. */}
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
            onClose={() => {
              if (open) dismiss()
            }}
            // Enter in a field means Add item / Done, never "Open ticket".
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
                tabIndex={-1}
                data-popup-card
                className="flex h-[calc(100dvh-2rem)] max-h-[820px] w-full max-w-4xl flex-col rounded-xl border border-border bg-card p-5 shadow-lg outline-none"
              >
                <header className="mb-4 flex shrink-0 items-center justify-between gap-3">
                  <h3 id={`${fieldId}-title`} className="text-base font-semibold text-foreground">
                    {adding ? tl.addTitle : tl.editTitle.replace('{n}', String(index + 1))}
                    {title ? <span className="ml-2 font-normal text-muted">{title}</span> : null}
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

                <nav
                  aria-label={tl.stepsLabel}
                  className="mb-1 flex shrink-0 flex-wrap gap-2 border-b border-border pb-2"
                >
                  {STEPS.map((st, i) => (
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
                      {tl.steps[st]}
                    </button>
                  ))}
                </nav>

                {/* One size for every step: only the step's fields scroll. A
                    step not shown is hidden, never unmounted. */}
                <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-3">
                  <div data-step="photos" className={step === 'photos' ? 'space-y-2' : 'hidden'}>
                    <PhotoStrip
                      tenantId={tenantId}
                      bucket="repair-photos"
                      photos={item.photos}
                      onChange={(photos) => onChange({ photos })}
                      label={tl.photosLabel}
                      large
                    />
                    <p className="text-[13px] text-muted">{tn.photosHelp}</p>
                  </div>

                  <div data-step="item" className={step === 'item' ? 'space-y-4' : 'hidden'}>
                    <div>
                      <div className={LABEL}>{tn.itemType}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ITEM_TYPES.map((it) => (
                          <button
                            key={it.value}
                            type="button"
                            aria-pressed={item.item_type === it.value}
                            onClick={() => onChange({ item_type: it.value })}
                            className={chip(item.item_type === it.value)}
                          >
                            {tn.itemTypes[it.value]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className={LABEL}>{tn.karat}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {KARAT_OPTIONS.map((k) => (
                          <button
                            key={k}
                            type="button"
                            aria-pressed={item.karat === k}
                            onClick={() => onChange({ karat: item.karat === k ? '' : k })}
                            className={chip(item.karat === k)}
                          >
                            {k}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block space-y-1.5">
                        <span className={`block ${LABEL}`}>{tn.weightGrams}</span>
                        <input
                          type="number"
                          step="0.001"
                          min={0}
                          inputMode="decimal"
                          value={item.weight_grams}
                          onChange={(e) => onChange({ weight_grams: e.target.value })}
                          placeholder={tn.weightPlaceholder}
                          className={`${INPUT} font-mono`}
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className={`block ${LABEL}`}>{tn.dimension}</span>
                        <input
                          type="text"
                          value={item.dimension}
                          onChange={(e) => onChange({ dimension: e.target.value })}
                          placeholder={tn.dimensionPlaceholder}
                          className={INPUT}
                        />
                      </label>
                    </div>
                  </div>

                  <div data-step="service" className={step === 'service' ? 'space-y-4' : 'hidden'}>
                    <div>
                      <div className={LABEL}>{tn.service}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {SERVICE_CHOICES.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            aria-pressed={item.service_type === s.value}
                            onClick={() => onChange({ service_type: s.value, service_touched: true })}
                            className={chip(item.service_type === s.value)}
                          >
                            {t.repair.serviceTypes[s.labelKey]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Left: ready-made phrases for this service; a click adds
                        one to the work needed. Right: the work itself. */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                      <div className="space-y-1.5">
                        <span className={`block ${LABEL}`}>{tn.workPresetsTitle}</span>
                        <div className="flex flex-col gap-1.5">
                          {tn.workPresets[item.service_type].map((phrase) => (
                            <button
                              key={phrase}
                              type="button"
                              onClick={() => addPhrase(phrase)}
                              className={`flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-blue hover:bg-background ${FOCUS}`}
                            >
                              <Plus size={12} weight="bold" className="shrink-0 text-muted" />
                              {phrase}
                            </button>
                          ))}
                        </div>
                        <p className="text-[13px] text-muted">{tn.workPresetsHelp}</p>
                      </div>
                      <div className="flex flex-col space-y-1.5">
                        <label htmlFor={`${fieldId}-work`} className={`block ${LABEL}`}>{tn.workNeeded}</label>
                        <textarea
                          id={`${fieldId}-work`}
                          ref={workRef}
                          rows={10}
                          value={item.work_needed}
                          onChange={(e) => onChange({ work_needed: e.target.value })}
                          placeholder={tn.workNeededPlaceholder}
                          className={`block min-h-56 w-full flex-1 rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue ${FOCUS}`}
                        />
                        {/* The price of this item's work (patches/0122). */}
                        <label htmlFor={`${fieldId}-price`} className={`block pt-2 ${LABEL}`}>{tl.price}</label>
                        <div className="relative max-w-xs">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-lg font-semibold text-muted">
                            $
                          </span>
                          <input
                            id={`${fieldId}-price`}
                            type="number"
                            step="0.01"
                            min={0}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={item.price}
                            onChange={(e) => onChange({ price: e.target.value })}
                            className={`block h-11 w-full rounded-md border-2 border-blue bg-card pl-7 pr-3 font-mono text-lg font-semibold tabular-nums text-foreground outline-none ${FOCUS}`}
                          />
                        </div>
                        <span className="block text-[13px] text-muted">{tl.priceHelp}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border pt-4">
                  <span className="text-[13px] text-muted">
                    {tn.titlePreview}: <span className="font-semibold text-foreground">{title || '—'}</span>
                  </span>
                  <div className="flex gap-2">
                    <button type="button" onClick={dismiss} className={OUTLINE_BTN}>
                      {t.common.cancel}
                    </button>
                    {step !== 'service' ? (
                      <button
                        type="button"
                        onClick={() => setStep(STEPS[STEPS.indexOf(step) + 1])}
                        className={OUTLINE_BTN}
                      >
                        {tl.next}
                      </button>
                    ) : null}
                    <button type="button" onClick={confirm} className={`${PRIMARY_BTN} h-11`}>
                      {adding ? tn.addItem : tl.done}
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
