'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Lock, LockOpen, Plus, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import CustomerPicker, { type CustomerPickerHandle } from '@/components/customers/CustomerPicker'
import QuickCustomerModal from '@/components/customers/QuickCustomerModal'
import StalePriceBanner from '@/components/inventory/StalePriceBanner'
import type { SpotFreshness } from '@/lib/spot-prices/staleness'
import {
  depositSplit,
  expiryDate,
  laborPrice,
  marginBelowMinimum,
  metalLabel,
  priceFromCost,
  quoteTotals,
  type QuoteLineCalc,
} from '@/lib/custom-quotes/math'
import { QUOTE_METALS, spotKey } from '@/lib/custom-quotes/metals'
import { WEIGHT_SOURCES, type WeightSourceId } from '@/lib/custom-quotes/weight-source'
import type { CustomQuoteSettings } from '@/lib/custom-quotes/settings'
import type { QuoteDetailView } from '@/lib/custom-quotes/load'
import type { QuoteLineInput } from '@/lib/validations/custom-quote'
import { saveQuoteAction, type QuoteActionState } from '@/app/(staff)/repair/quotes/actions'
import type { CustomPieceCategory } from '@/types/database-aliases'

/**
 * Custom-piece quoter — The piece → The price → The payment, with the
 * sticky "Total — you keep — margin" footer recalculating on every
 * keystroke. Pure math from lib/custom-quotes/math; the server action
 * recomputes everything again on save.
 */

export type SpotMapEntry = { pricePerGram: number; fetchedAt: string; label: string }
export type StoneOption = { id: string; sku: string; description: string; cost_basis: number }

const CATEGORIES: ReadonlyArray<CustomPieceCategory> = [
  'ring',
  'earrings',
  'chain',
  'bracelet',
  'pendant',
  'nameplate',
  'grillz',
  'other',
]
const EXTRA_TYPES = ['engraving', 'rush', 'packaging', 'shipping', 'other'] as const
type ExtraType = (typeof EXTRA_TYPES)[number]

type MetalBlock = {
  enabled: boolean
  metal: string
  karat: string
  grams: string
  weightSource: WeightSourceId
  price: string
  locked: boolean
}
type WaxBlock = { enabled: boolean; cost: string; price: string; locked: boolean }
type LaborBlock = {
  enabled: boolean
  mode: 'hourly' | 'flat'
  hours: string
  rate: string
  flat: string
  cost: string
}
type StoneRow = {
  uid: string
  source: 'inventory' | 'manual'
  inventoryId: string
  label: string
  qty: string
  unitCost: string
  price: string
  locked: boolean
  settingEach: string
}
type ExtraRow = { uid: string; type: ExtraType; label: string; price: string; cost: string }

type FormState = {
  customerId: string | null
  category: CustomPieceCategory
  description: string
  size: string
  metal: MetalBlock
  wax: WaxBlock
  labor: LaborBlock
  stones: StoneRow[]
  extras: ExtraRow[]
  marginPct: string
  depositPct: string
  paymentMethod: string
  expiresOn: string
  notes: string
}

const uid = () => (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random()))
const num = (s: string) => {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}
const pctStr = (fraction: number) => String(Math.round(fraction * 10000) / 100)
const money4 = (n: number) => String(Math.round(n * 10000) / 10000)

function emptyState(settings: CustomQuoteSettings, today: string): FormState {
  return {
    customerId: null,
    category: 'ring',
    description: '',
    size: '',
    metal: { enabled: false, metal: 'gold', karat: '14', grams: '', weightSource: 'manual', price: '', locked: false },
    wax: { enabled: false, cost: '', price: '', locked: false },
    labor: { enabled: false, mode: 'hourly', hours: '', rate: String(settings.laborRate), flat: '', cost: '' },
    stones: [],
    extras: [],
    marginPct: pctStr(settings.defaultMarginPct),
    depositPct: pctStr(settings.defaultDepositPct),
    paymentMethod: '',
    expiresOn: expiryDate(today, settings.expiryDays),
    notes: '',
  }
}

/** Rebuild the editable blocks from a saved quote (edit mode). */
function stateFromQuote(q: QuoteDetailView, settings: CustomQuoteSettings, today: string): FormState {
  const s = emptyState(settings, today)
  s.customerId = q.customer_id
  s.category = q.category
  s.description = q.description
  s.size = q.size ?? ''
  s.marginPct = pctStr(q.margin_pct)
  s.depositPct = pctStr(q.deposit_pct)
  s.paymentMethod = q.payment_method ?? ''
  s.expiresOn = q.expires_on ?? s.expiresOn
  s.notes = q.notes_internal ?? ''
  for (const l of q.lines) {
    const d = l.details as Record<string, unknown>
    switch (l.kind) {
      case 'metal':
        s.metal = {
          enabled: true,
          metal: String(d.metal_type ?? 'gold'),
          karat: String(d.karat ?? ''),
          grams: String(l.quantity),
          weightSource: d.weight_source === 'laser_nameplate' ? 'laser_nameplate' : 'manual',
          price: money4(l.unit_price),
          locked: l.price_locked,
        }
        break
      case 'wax':
        s.wax = { enabled: true, cost: money4(l.unit_cost), price: money4(l.unit_price), locked: l.price_locked }
        break
      case 'labor':
        s.labor = {
          enabled: true,
          mode: d.mode === 'flat' ? 'flat' : 'hourly',
          hours: d.mode === 'flat' ? '' : String(l.quantity),
          rate: d.mode === 'flat' ? String(settings.laborRate) : money4(l.unit_price),
          flat: d.mode === 'flat' ? money4(l.unit_price) : '',
          cost: l.unit_cost > 0 ? money4(l.unit_cost) : '',
        }
        break
      case 'stone':
        s.stones.push({
          uid: uid(),
          source: l.inventory_item_id ? 'inventory' : 'manual',
          inventoryId: l.inventory_item_id ?? '',
          label: l.label,
          qty: String(l.quantity),
          unitCost: money4(l.unit_cost),
          price: money4(l.unit_price),
          locked: l.price_locked,
          settingEach: d.setting_each != null ? money4(Number(d.setting_each)) : '',
        })
        break
      case 'setting':
        // Folded into the stone row via details.setting_each.
        break
      case 'extra':
        s.extras.push({
          uid: uid(),
          type: (EXTRA_TYPES as readonly string[]).includes(String(d.extra_type)) ? (d.extra_type as ExtraType) : 'other',
          label: l.label,
          price: money4(l.unit_price),
          cost: l.unit_cost > 0 ? money4(l.unit_cost) : '',
        })
        break
    }
  }
  return s
}

type BuiltLine = QuoteLineInput & QuoteLineCalc

/** Turn the blocks into the lines the math and the server both consume. */
function buildLines(
  s: FormState,
  spotMap: Record<string, SpotMapEntry>,
  marginPct: number,
  labels: { stoneSetting: string; labor: string; wax: string; extras: Record<string, string> },
): BuiltLine[] {
  const out: BuiltLine[] = []
  const price = (cost: number, typed: string, locked: boolean) =>
    locked && typed !== '' ? num(typed) : priceFromCost(cost, marginPct)

  if (s.metal.enabled) {
    const spot = spotMap[spotKey(s.metal.metal, s.metal.karat || null)]
    const grams = num(s.metal.grams)
    const cost = spot?.pricePerGram ?? 0
    out.push({
      kind: 'metal',
      label: `${metalLabel(s.metal.metal, s.metal.karat || null)} × ${grams} g`,
      quantity: grams,
      unit_cost: cost,
      unit_price: price(cost, s.metal.price, s.metal.locked),
      price_locked: s.metal.locked,
      inventory_item_id: null,
      details: { metal_type: s.metal.metal as never, karat: s.metal.karat || undefined, weight_source: s.metal.weightSource },
    })
  }
  if (s.wax.enabled) {
    const cost = num(s.wax.cost)
    out.push({
      kind: 'wax',
      label: labels.wax,
      quantity: 1,
      unit_cost: cost,
      unit_price: price(cost, s.wax.price, s.wax.locked),
      price_locked: s.wax.locked,
      inventory_item_id: null,
      details: {},
    })
  }
  if (s.labor.enabled) {
    const hourly = s.labor.mode === 'hourly'
    const qty = hourly ? num(s.labor.hours) : 1
    const unitPrice = hourly ? num(s.labor.rate) : laborPrice({ mode: 'flat', flat: num(s.labor.flat) })
    out.push({
      kind: 'labor',
      label: hourly ? `${labels.labor} (${qty} h × ${formatMoney(num(s.labor.rate))})` : labels.labor,
      quantity: qty,
      unit_cost: num(s.labor.cost),
      unit_price: unitPrice,
      price_locked: true,
      inventory_item_id: null,
      details: { mode: s.labor.mode, hours: hourly ? qty : undefined, rate: hourly ? num(s.labor.rate) : undefined },
    })
  }
  for (const st of s.stones) {
    const qty = num(st.qty)
    const cost = num(st.unitCost)
    const label = st.label.trim() || labels.stoneSetting
    out.push({
      kind: 'stone',
      label,
      quantity: qty,
      unit_cost: cost,
      unit_price: price(cost, st.price, st.locked),
      price_locked: st.locked,
      inventory_item_id: st.source === 'inventory' && st.inventoryId ? st.inventoryId : null,
      details: { setting_each: num(st.settingEach) || undefined },
    })
    const settingEach = num(st.settingEach)
    if (settingEach > 0 && qty > 0) {
      out.push({
        kind: 'setting',
        label: `${labels.stoneSetting} — ${label}`,
        quantity: qty,
        unit_cost: 0,
        unit_price: settingEach,
        price_locked: true,
        inventory_item_id: null,
        details: {},
      })
    }
  }
  for (const ex of s.extras) {
    out.push({
      kind: 'extra',
      label: ex.type === 'other' && ex.label.trim() ? ex.label.trim() : labels.extras[ex.type] ?? ex.type,
      quantity: 1,
      unit_cost: num(ex.cost),
      unit_price: num(ex.price),
      price_locked: true,
      inventory_item_id: null,
      details: { extra_type: ex.type },
    })
  }
  return out
}

export default function QuoteForm({
  mode,
  quoteId,
  initial,
  settings,
  spotMap,
  stoneOptions,
  spotFreshness,
  today,
}: {
  mode: 'create' | 'edit'
  quoteId?: string
  initial?: QuoteDetailView
  settings: CustomQuoteSettings
  spotMap: Record<string, SpotMapEntry>
  stoneOptions: StoneOption[]
  spotFreshness: SpotFreshness
  today: string
}) {
  const { t, lang } = useI18n()
  const tq = t.quotes
  const router = useRouter()
  const [state, formAction, pending] = useActionState<QuoteActionState, FormData>(saveQuoteAction, {})
  const [s, setS] = useState<FormState>(() =>
    initial ? stateFromQuote(initial, settings, today) : emptyState(settings, today),
  )
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const customerPickerRef = useRef<CustomerPickerHandle>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)

  useEffect(() => {
    if (state.ok && state.quoteId) router.push(`/repair/quotes/${state.quoteId}`)
  }, [state.ok, state.quoteId, router])

  const patch = (p: Partial<FormState>) => setS((prev) => ({ ...prev, ...p }))

  const marginPct = num(s.marginPct) / 100
  const labels = useMemo(
    () => ({
      stoneSetting: tq.price.stones.label,
      labor: tq.price.labor.title,
      wax: tq.price.wax.title,
      extras: {
        engraving: tq.price.extras.engraving,
        rush: tq.price.extras.rush,
        packaging: tq.price.extras.packaging,
        shipping: tq.price.extras.shipping,
        other: tq.price.extras.other,
      } as Record<string, string>,
    }),
    [tq],
  )
  const lines = useMemo(() => buildLines(s, spotMap, marginPct, labels), [s, spotMap, marginPct, labels])
  const totals = useMemo(() => quoteTotals(lines), [lines])
  const belowMin = totals.cost > 0 && marginBelowMinimum(totals.marginPct, settings.minMarginPct)
  const targetBelowMin = marginBelowMinimum(marginPct, settings.minMarginPct)
  const { deposit, balance } = depositSplit(totals.price, num(s.depositPct) / 100)
  const metalSpot = s.metal.enabled ? spotMap[spotKey(s.metal.metal, s.metal.karat || null)] : undefined

  const payload = useMemo(
    () =>
      JSON.stringify({
        customer_id: s.customerId,
        category: s.category,
        description: s.description,
        size: s.size,
        margin_pct: marginPct,
        deposit_pct: num(s.depositPct) / 100,
        payment_method: s.paymentMethod || null,
        expires_on: s.expiresOn || null,
        notes_internal: s.notes,
        lines: lines.map((l) => ({
          kind: l.kind,
          label: l.label,
          quantity: l.quantity,
          unit_cost: l.unit_cost,
          unit_price: l.unit_price,
          price_locked: l.price_locked,
          inventory_item_id: l.inventory_item_id ?? null,
          details: l.details,
        })),
      }),
    [s, lines, marginPct],
  )

  const pieceOk = !!s.customerId && s.description.trim().length > 0
  const canSave = pieceOk && lines.length > 0 && !belowMin && !targetBelowMin && !pending
  const err = (code: string | undefined) =>
    code == null ? null : (tq.errors as Record<string, string>)[code] ?? code
  const fieldErr = (k: string) => err(state.fieldErrors?.[k])

  const inputCls =
    'w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-blue focus:outline-none'
  const smallCls =
    'w-24 rounded-md border border-border bg-card px-2 py-1 font-mono text-sm text-foreground focus:border-blue focus:outline-none'

  return (
    <form action={formAction} className="space-y-4 pb-28">
      <input type="hidden" name="payload" value={payload} />
      {quoteId ? <input type="hidden" name="quote_id" value={quoteId} /> : null}

      <div className="flex items-center justify-between">
        <Link
          href={quoteId ? `/repair/quotes/${quoteId}` : '/repair/quotes'}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {tq.backToList}
        </Link>
      </div>
      <h1 className="font-display text-2xl font-bold text-foreground">
        {mode === 'edit' ? tq.edit : tq.new}
        {initial ? <span className="ml-2 font-mono text-base text-muted">{initial.quote_number}</span> : null}
      </h1>

      <StalePriceBanner freshness={spotFreshness} />

      {state.error && !state.ok ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          {err(state.error)}
        </div>
      ) : null}

      {/* Stepper */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1" role="tablist">
        {([tq.steps.piece, tq.steps.price, tq.steps.payment] as const).map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={step === i}
            onClick={() => setStep(i as 0 | 1 | 2)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              step === i ? 'bg-navy text-white' : 'text-foreground hover:bg-background'
            }`}
          >
            <span className="mr-2 font-mono text-xs opacity-70">{i + 1}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ── Step 1: the piece ─────────────────────────────────────────── */}
      <section className={step === 0 ? 'space-y-4' : 'hidden'}>
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">{tq.piece.customer}</legend>
          <div className="mt-2 flex items-start gap-2">
            <div className="flex-1">
              <CustomerPicker
                ref={customerPickerRef}
                name="customer_id_display"
                initialCustomerId={initial?.customer_id ?? null}
                error={fieldErr('customer_id') ?? undefined}
                onChange={(c) => patch({ customerId: c?.id ?? null })}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowCustomerModal(true)}
              className="shrink-0 rounded-md border border-border bg-card px-3 py-3 text-sm text-foreground hover:bg-background"
            >
              {tq.piece.newCustomer}
            </button>
          </div>
        </fieldset>
        <QuickCustomerModal
          open={showCustomerModal}
          onClose={() => setShowCustomerModal(false)}
          onCreated={(c) => {
            customerPickerRef.current?.set(c)
            patch({ customerId: c.id })
          }}
        />

        <fieldset className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">{tq.piece.category}</span>
            <select
              value={s.category}
              onChange={(e) => patch({ category: e.target.value as CustomPieceCategory })}
              className={inputCls}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tq.categories[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">{tq.piece.size}</span>
            <input
              value={s.size}
              onChange={(e) => patch({ size: e.target.value })}
              placeholder={tq.piece.sizePlaceholder}
              maxLength={80}
              className={inputCls}
            />
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-muted">{tq.piece.description}</span>
            <textarea
              value={s.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder={tq.piece.descriptionPlaceholder}
              rows={3}
              maxLength={500}
              className={inputCls}
            />
            {fieldErr('description') ? <span className="text-xs text-danger">{fieldErr('description')}</span> : null}
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-muted">{tq.piece.photo}</span>
            <input
              type="file"
              name="reference_photo"
              accept="image/*,.heic,.heif"
              className="block w-full text-sm text-foreground"
            />
            <span className="block text-xs text-muted">
              {tq.piece.photoHelp}
              {initial?.reference_photo_path ? ` · ${tq.piece.currentPhoto}` : ''}
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end">
          <NavButton onClick={() => setStep(1)} disabled={!pieceOk}>
            {tq.next} →
          </NavButton>
        </div>
      </section>

      {/* ── Step 2: the price ─────────────────────────────────────────── */}
      <section className={step === 1 ? 'space-y-4' : 'hidden'}>
        <p className="text-xs text-muted">{tq.price.help}</p>

        <fieldset className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {tq.price.targetMargin}
              <input
                type="number"
                min={0}
                max={95}
                step={1}
                value={s.marginPct}
                onChange={(e) => patch({ marginPct: e.target.value })}
                className={smallCls}
              />
              <span className="text-xs text-muted">%</span>
            </label>
            <span className={`text-xs ${targetBelowMin ? 'text-danger' : 'text-muted'}`}>
              {tq.price.minMargin.replace('{pct}', String(Math.round(settings.minMarginPct * 100)))}
            </span>
          </div>
          {targetBelowMin ? (
            <p className="mt-1 text-xs text-danger">
              {tq.price.belowMin.replace('{pct}', String(Math.round(settings.minMarginPct * 100)))}
            </p>
          ) : null}
        </fieldset>

        {/* Metal */}
        <Block
          title={tq.price.metal.title}
          enabled={s.metal.enabled}
          onToggle={(v) => patch({ metal: { ...s.metal, enabled: v } })}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">{tq.price.metal.metal}</span>
              <select
                value={s.metal.metal}
                onChange={(e) => {
                  const m = QUOTE_METALS.find((x) => x.metal === e.target.value)
                  patch({ metal: { ...s.metal, metal: e.target.value, karat: m?.karats[0] ?? '' } })
                }}
                className={inputCls}
              >
                {QUOTE_METALS.map((m) => (
                  <option key={m.metal} value={m.metal}>
                    {(t.spotPrices.metals as Record<string, string>)[m.metal] ?? m.metal}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">{tq.price.metal.karat}</span>
              <select
                value={s.metal.karat}
                onChange={(e) => patch({ metal: { ...s.metal, karat: e.target.value } })}
                disabled={(QUOTE_METALS.find((x) => x.metal === s.metal.metal)?.karats.length ?? 0) === 0}
                className={inputCls}
              >
                {(QUOTE_METALS.find((x) => x.metal === s.metal.metal)?.karats ?? ['']).map((k) => (
                  <option key={k} value={k}>
                    {k ? `${k}k` : '—'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">{tq.price.metal.grams}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={s.metal.grams}
                onChange={(e) => patch({ metal: { ...s.metal, grams: e.target.value } })}
                className={`${inputCls} font-mono`}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">{tq.price.metal.weightFrom}</span>
              <select
                value={s.metal.weightSource}
                onChange={(e) => patch({ metal: { ...s.metal, weightSource: e.target.value as WeightSourceId } })}
                className={inputCls}
              >
                {WEIGHT_SOURCES.map((w) => (
                  <option key={w.id} value={w.id} disabled={!w.available}>
                    {w.label[lang]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className={metalSpot ? 'text-muted' : 'text-danger'}>
              {metalSpot
                ? `${tq.price.metal.spot}: ${formatMoney(metalSpot.pricePerGram)}/g · ${tq.price.metal.frozenNote}`
                : tq.price.metal.noSpot}
            </span>
            <CostPrice
              cost={metalSpot ? metalSpot.pricePerGram * num(s.metal.grams) : 0}
              price={lines.find((l) => l.kind === 'metal')?.unit_price ?? 0}
              qty={num(s.metal.grams)}
              typed={s.metal.price}
              locked={s.metal.locked}
              onPrice={(v) => patch({ metal: { ...s.metal, price: v, locked: true } })}
              onUnlock={() => patch({ metal: { ...s.metal, locked: false, price: '' } })}
              perUnit
            />
          </div>
        </Block>

        {/* Wax */}
        <Block title={tq.price.wax.title} enabled={s.wax.enabled} onToggle={(v) => patch({ wax: { ...s.wax, enabled: v } })}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">{tq.price.wax.cost}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={s.wax.cost}
                onChange={(e) => patch({ wax: { ...s.wax, cost: e.target.value } })}
                className={smallCls}
              />
            </label>
            <CostPrice
              cost={num(s.wax.cost)}
              price={lines.find((l) => l.kind === 'wax')?.unit_price ?? 0}
              qty={1}
              typed={s.wax.price}
              locked={s.wax.locked}
              onPrice={(v) => patch({ wax: { ...s.wax, price: v, locked: true } })}
              onUnlock={() => patch({ wax: { ...s.wax, locked: false, price: '' } })}
            />
          </div>
        </Block>

        {/* Labor */}
        <Block
          title={tq.price.labor.title}
          enabled={s.labor.enabled}
          onToggle={(v) => patch({ labor: { ...s.labor, enabled: v } })}
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">{tq.price.labor.mode}</span>
              <select
                value={s.labor.mode}
                onChange={(e) => patch({ labor: { ...s.labor, mode: e.target.value as 'hourly' | 'flat' } })}
                className={inputCls}
              >
                <option value="hourly">{tq.price.labor.hourly}</option>
                <option value="flat">{tq.price.labor.flat}</option>
              </select>
            </label>
            {s.labor.mode === 'hourly' ? (
              <>
                <NumField label={tq.price.labor.hours} value={s.labor.hours} onChange={(v) => patch({ labor: { ...s.labor, hours: v } })} step={0.25} cls={smallCls} />
                <NumField label={tq.price.labor.rate} value={s.labor.rate} onChange={(v) => patch({ labor: { ...s.labor, rate: v } })} step={0.01} cls={smallCls} />
              </>
            ) : (
              <NumField label={tq.price.labor.flatAmount} value={s.labor.flat} onChange={(v) => patch({ labor: { ...s.labor, flat: v } })} step={0.01} cls={smallCls} />
            )}
            <NumField label={tq.price.labor.outsourcedCost} value={s.labor.cost} onChange={(v) => patch({ labor: { ...s.labor, cost: v } })} step={0.01} cls={smallCls} />
            <div className="ml-auto text-sm">
              <span className="text-xs uppercase tracking-wide text-muted">{tq.price.lineTotal} </span>
              <span className="font-mono font-semibold text-foreground">
                {formatMoney(quoteTotals(lines.filter((l) => l.kind === 'labor')).price)}
              </span>
            </div>
          </div>
        </Block>

        {/* Stones */}
        <Block
          title={tq.price.stones.title}
          enabled={s.stones.length > 0}
          onToggle={(v) =>
            patch({
              stones: v
                ? [{ uid: uid(), source: stoneOptions.length ? 'inventory' : 'manual', inventoryId: '', label: '', qty: '1', unitCost: '', price: '', locked: false, settingEach: '' }]
                : [],
            })
          }
        >
          <div className="space-y-3">
            {s.stones.map((st, i) => (
              <div key={st.uid} className="rounded-md border border-border bg-background/40 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs uppercase tracking-wide text-muted">{tq.price.stones.label}</span>
                    <select
                      value={st.source}
                      onChange={(e) => updateStone(i, { source: e.target.value as 'inventory' | 'manual', inventoryId: '', label: '', unitCost: '' })}
                      className={inputCls}
                    >
                      <option value="inventory" disabled={stoneOptions.length === 0}>
                        {tq.price.stones.fromInventory}
                      </option>
                      <option value="manual">{tq.price.stones.byHand}</option>
                    </select>
                  </label>
                  {st.source === 'inventory' ? (
                    <select
                      value={st.inventoryId}
                      onChange={(e) => {
                        const opt = stoneOptions.find((o) => o.id === e.target.value)
                        updateStone(i, {
                          inventoryId: e.target.value,
                          label: opt ? `${opt.sku} — ${opt.description}` : '',
                          unitCost: opt ? money4(opt.cost_basis) : '',
                        })
                      }}
                      className={`${inputCls} min-w-[16rem] flex-1`}
                    >
                      <option value="">{stoneOptions.length ? tq.price.stones.pick : tq.price.stones.noInventory}</option>
                      {stoneOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.sku} — {o.description} · {formatMoney(o.cost_basis)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={st.label}
                      onChange={(e) => updateStone(i, { label: e.target.value })}
                      placeholder={tq.price.stones.label}
                      className={`${inputCls} min-w-[12rem] flex-1`}
                    />
                  )}
                  <NumField label={tq.price.qty} value={st.qty} onChange={(v) => updateStone(i, { qty: v })} step={1} cls={smallCls} />
                  <NumField label={tq.price.cost} value={st.unitCost} onChange={(v) => updateStone(i, { unitCost: v })} step={0.01} cls={smallCls} disabled={st.source === 'inventory'} />
                  <NumField label={tq.price.stones.settingEach} value={st.settingEach} onChange={(v) => updateStone(i, { settingEach: v })} step={0.01} cls={smallCls} />
                  <button
                    type="button"
                    onClick={() => patch({ stones: s.stones.filter((_, idx) => idx !== i) })}
                    className="rounded p-1 text-muted hover:text-danger"
                    title={tq.price.remove}
                    aria-label={tq.price.remove}
                  >
                    <Trash size={14} weight="bold" />
                  </button>
                </div>
                <div className="mt-2 flex justify-end">
                  <CostPrice
                    cost={num(st.unitCost)}
                    price={lines.find((l) => l.kind === 'stone' && l.label === (st.label.trim() || labels.stoneSetting))?.unit_price ?? 0}
                    qty={num(st.qty)}
                    typed={st.price}
                    locked={st.locked}
                    onPrice={(v) => updateStone(i, { price: v, locked: true })}
                    onUnlock={() => updateStone(i, { locked: false, price: '' })}
                    perUnit
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                patch({ stones: [...s.stones, { uid: uid(), source: stoneOptions.length ? 'inventory' : 'manual', inventoryId: '', label: '', qty: '1', unitCost: '', price: '', locked: false, settingEach: '' }] })
              }
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
            >
              <Plus size={14} weight="bold" />
              {tq.price.stones.addStone}
            </button>
          </div>
        </Block>

        {/* Extras */}
        <Block
          title={tq.price.extras.title}
          enabled={s.extras.length > 0}
          onToggle={(v) => patch({ extras: v ? [{ uid: uid(), type: 'engraving', label: '', price: '', cost: '' }] : [] })}
        >
          <div className="space-y-2">
            {s.extras.map((ex, i) => (
              <div key={ex.uid} className="flex flex-wrap items-end gap-3">
                <label className="block space-y-1">
                  <span className="text-xs uppercase tracking-wide text-muted">{tq.price.extras.type}</span>
                  <select
                    value={ex.type}
                    onChange={(e) => updateExtra(i, { type: e.target.value as ExtraType })}
                    className={inputCls}
                  >
                    {EXTRA_TYPES.map((x) => (
                      <option key={x} value={x}>
                        {labels.extras[x]}
                      </option>
                    ))}
                  </select>
                </label>
                {ex.type === 'other' ? (
                  <input
                    value={ex.label}
                    onChange={(e) => updateExtra(i, { label: e.target.value })}
                    placeholder={tq.price.extras.other}
                    className={`${inputCls} min-w-[10rem] flex-1`}
                  />
                ) : null}
                <NumField label={tq.price.price} value={ex.price} onChange={(v) => updateExtra(i, { price: v })} step={0.01} cls={smallCls} />
                <NumField label={tq.price.extras.costOptional} value={ex.cost} onChange={(v) => updateExtra(i, { cost: v })} step={0.01} cls={smallCls} />
                <button
                  type="button"
                  onClick={() => patch({ extras: s.extras.filter((_, idx) => idx !== i) })}
                  className="rounded p-1 text-muted hover:text-danger"
                  title={tq.price.remove}
                  aria-label={tq.price.remove}
                >
                  <Trash size={14} weight="bold" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => patch({ extras: [...s.extras, { uid: uid(), type: 'other', label: '', price: '', cost: '' }] })}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
            >
              <Plus size={14} weight="bold" />
              {tq.price.extras.addExtra}
            </button>
          </div>
        </Block>

        <div className="flex justify-between">
          <NavButton onClick={() => setStep(0)}>← {tq.back}</NavButton>
          <NavButton onClick={() => setStep(2)} disabled={lines.length === 0}>
            {tq.next} →
          </NavButton>
        </div>
      </section>

      {/* ── Step 3: the payment ───────────────────────────────────────── */}
      <section className={step === 2 ? 'space-y-4' : 'hidden'}>
        <fieldset className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">{tq.payment.depositPct}</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={s.depositPct}
              onChange={(e) => patch({ depositPct: e.target.value })}
              className={`${inputCls} font-mono`}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">{tq.payment.depositAmount}</div>
              <div className="font-mono text-xl font-bold text-foreground">{formatMoney(deposit)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">{tq.payment.balance}</div>
              <div className="font-mono text-xl font-bold text-foreground">{formatMoney(balance)}</div>
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">{tq.payment.method}</span>
            <select value={s.paymentMethod} onChange={(e) => patch({ paymentMethod: e.target.value })} className={inputCls}>
              <option value="">{tq.payment.methodNone}</option>
              <option value="cash">{t.pos.payment.methodCash}</option>
              <option value="card">{t.pos.payment.methodCard}</option>
              <option value="check">{t.pos.payment.methodCheck}</option>
              <option value="other">{t.pos.payment.methodOther}</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">{tq.payment.expires}</span>
            <input type="date" value={s.expiresOn} onChange={(e) => patch({ expiresOn: e.target.value })} className={`${inputCls} font-mono`} />
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-muted">{tq.payment.notes}</span>
            <textarea value={s.notes} onChange={(e) => patch({ notes: e.target.value })} rows={2} maxLength={2000} className={inputCls} />
            <span className="block text-xs text-muted">{tq.payment.notesHelp}</span>
          </label>
        </fieldset>
        <div className="flex justify-start">
          <NavButton onClick={() => setStep(1)}>← {tq.back}</NavButton>
        </div>
      </section>

      {/* ── Sticky footer ─────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-navy text-white shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-sm">
              <span className="text-white/60">{tq.footer.total} </span>
              <span className="font-mono text-2xl font-extrabold">{formatMoney(totals.price)}</span>
            </span>
            <span className="text-sm">
              <span className="text-white/60">— {tq.footer.keep} </span>
              <span className="font-mono text-lg font-bold text-gold">{formatMoney(totals.keep)}</span>
            </span>
            <span className={`text-sm ${belowMin ? 'text-danger' : ''}`}>
              <span className="text-white/60">— {tq.footer.margin} </span>
              <span className="font-mono text-lg font-bold">{Math.round(totals.marginPct * 1000) / 10}%</span>
            </span>
          </div>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-xl bg-gold px-5 py-2.5 text-sm font-extrabold text-navy hover:bg-gold-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? tq.footer.saving : tq.footer.save}
          </button>
        </div>
      </div>
    </form>
  )

  function updateStone(i: number, p: Partial<StoneRow>) {
    patch({ stones: s.stones.map((row, idx) => (idx === i ? { ...row, ...p } : row)) })
  }
  function updateExtra(i: number, p: Partial<ExtraRow>) {
    patch({ extras: s.extras.map((row, idx) => (idx === i ? { ...row, ...p } : row)) })
  }
}

function Block({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="px-1">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-gold"
          />
          {title}
        </label>
      </legend>
      {enabled ? <div className="mt-2">{children}</div> : null}
    </fieldset>
  )
}

function NumField({
  label,
  value,
  onChange,
  step,
  cls,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  step: number
  cls: string
  disabled?: boolean
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`${cls} disabled:opacity-60`}
      />
    </label>
  )
}

/** Cost → price for one line, with the lock toggle. */
function CostPrice({
  cost,
  price,
  qty,
  typed,
  locked,
  onPrice,
  onUnlock,
  perUnit,
}: {
  cost: number
  price: number
  qty: number
  typed: string
  locked: boolean
  onPrice: (v: string) => void
  onUnlock: () => void
  perUnit?: boolean
}) {
  const { t } = useI18n()
  const tq = t.quotes.price
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">{tq.cost}</div>
        <div className="font-mono text-foreground">{formatMoney(cost)}</div>
      </div>
      <label className="block space-y-1">
        <span className="text-xs uppercase tracking-wide text-muted">
          {tq.price}
          {perUnit ? ` / ${tq.qty.toLowerCase()}` : ''}
        </span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={0.01}
            value={locked ? typed : String(Math.round(price * 100) / 100)}
            onChange={(e) => onPrice(e.target.value)}
            className="w-28 rounded-md border border-border bg-card px-2 py-1 font-mono text-sm text-foreground focus:border-blue focus:outline-none"
          />
          <button
            type="button"
            onClick={locked ? onUnlock : undefined}
            title={locked ? tq.unlock : tq.locked}
            aria-label={locked ? tq.unlock : tq.locked}
            className={`rounded p-1 ${locked ? 'text-warning hover:text-foreground' : 'text-muted/50'}`}
          >
            {locked ? <Lock size={14} weight="bold" /> : <LockOpen size={14} weight="bold" />}
          </button>
        </span>
      </label>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">{tq.lineTotal}</div>
        <div className="font-mono font-semibold text-foreground">{formatMoney(price * (perUnit ? qty : 1))}</div>
      </div>
    </div>
  )
}

function NavButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-background disabled:opacity-50"
    >
      {children}
    </button>
  )
}
