'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Calculator,
  Circle,
  Flask,
  Scales,
  Trash,
  TrendUp,
  Wrench,
  FloppyDisk,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import StalePriceBanner from '@/components/inventory/StalePriceBanner'
import type { SpotFreshness } from '@/lib/spot-prices/staleness'
import { COUNTER_COMBOS_CLIENT } from '@/lib/bench/combos'
import { convertRingSize, nearestUsQuarter, type RingScale } from '@/lib/bench/ring-size'
import { convertWeight, WEIGHT_UNITS, type WeightUnit } from '@/lib/bench/weight'
import { alloyDown, mixLots, raiseKarat } from '@/lib/bench/alloy'
import {
  dollarsFromGrams,
  parseNum,
  resolveRate,
  type RateMaps,
} from '@/lib/metal-counter/math'
import { pctLabel } from '@/components/buy/EntryModeToggle'
import type { CalculatorKind } from '@/lib/bench/calculators'
import { deleteCalculationAction, saveCalculationAction } from './actions'

export type RecentCalculation = {
  id: string
  calculator: CalculatorKind
  label: string
  inputs: Record<string, unknown>
  result: Record<string, unknown>
  created_at: string
}

const KINDS: ReadonlyArray<{ kind: CalculatorKind; icon: React.ReactNode }> = [
  { kind: 'ring_size', icon: <Circle size={16} weight="bold" /> },
  { kind: 'weight', icon: <Scales size={16} weight="bold" /> },
  { kind: 'alloy_down', icon: <Flask size={16} weight="bold" /> },
  { kind: 'raise_karat', icon: <TrendUp size={16} weight="bold" /> },
  { kind: 'mix_lots', icon: <Wrench size={16} weight="bold" /> },
  { kind: 'melt', icon: <Calculator size={16} weight="bold" /> },
]

export default function ToolsContent({
  rates,
  freshness,
  recent,
}: {
  rates: RateMaps
  freshness: SpotFreshness
  recent: RecentCalculation[]
}) {
  const { t } = useI18n()
  const tl = t.tools
  const [active, setActive] = useState<CalculatorKind>('ring_size')
  const [pending, start] = useTransition()
  const [notice, setNotice] = useState<string | null>(null)

  const save = (calculator: CalculatorKind, label: string, inputs: Record<string, unknown>, result: Record<string, unknown>) => {
    start(async () => {
      const r = await saveCalculationAction({ calculator, label, inputs, result })
      setNotice(r.ok ? tl.saved : tl.saveFailed)
    })
  }
  const forget = (id: string) => {
    start(async () => {
      await deleteCalculationAction(id)
    })
  }

  return (
    <div className="space-y-6">
      <StalePriceBanner freshness={freshness} />
      <div>
        <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
          <Calculator size={22} weight="bold" />
          {tl.title}
        </h1>
        <p className="text-sm text-muted">{tl.subtitle}</p>
      </div>

      <nav className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1" aria-label={tl.title}>
        {KINDS.map(({ kind, icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => setActive(kind)}
            aria-pressed={active === kind}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              active === kind ? 'bg-navy text-white' : 'text-foreground hover:bg-background'
            }`}
          >
            {icon}
            {tl.kinds[kind]}
          </button>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          {active === 'ring_size' ? <RingSizeCalc onSave={save} /> : null}
          {active === 'weight' ? <WeightCalc onSave={save} /> : null}
          {active === 'alloy_down' ? <AlloyDownCalc onSave={save} /> : null}
          {active === 'raise_karat' ? <RaiseKaratCalc onSave={save} /> : null}
          {active === 'mix_lots' ? <MixLotsCalc onSave={save} /> : null}
          {active === 'melt' ? <MeltCalc rates={rates} onSave={save} /> : null}
          {notice ? (
            <p className="mt-3 text-xs text-muted" role="status">
              {notice}
            </p>
          ) : null}
        </section>

        <aside className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{tl.recentTitle}</h2>
          <p className="mt-1 text-xs text-muted">{tl.recentHelp}</p>
          {recent.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{tl.recentEmpty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-muted">
                      {tl.kinds[r.calculator]} · {shortDateTime(r.created_at)}
                    </div>
                    <div className="truncate font-mono text-xs text-foreground">{r.label}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => forget(r.id)}
                    disabled={pending}
                    className="shrink-0 rounded-md p-1 text-muted hover:bg-background hover:text-danger disabled:opacity-50"
                    title={tl.forget}
                    aria-label={tl.forget}
                  >
                    <Trash size={12} weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}

type SaveFn = (
  calculator: CalculatorKind,
  label: string,
  inputs: Record<string, unknown>,
  result: Record<string, unknown>,
) => void

// ── Shared bits ────────────────────────────────────────────────────────────

function Num({
  label,
  value,
  onChange,
  step = '0.01',
  suffix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: string
  suffix?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border border-border bg-card px-3 py-2 text-right font-mono text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        />
        {suffix ? <span className="text-xs text-muted">{suffix}</span> : null}
      </div>
    </label>
  )
}

function Out({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`font-mono tabular-nums text-foreground ${big ? 'text-2xl font-bold' : 'text-sm'}`}>{value}</div>
    </div>
  )
}

function Formula({ text }: { text: string }) {
  const { t } = useI18n()
  return (
    <details className="mt-4 rounded-md border border-border bg-background/40 p-2 text-xs text-muted">
      <summary className="cursor-pointer font-medium text-foreground">{t.tools.howCalculated}</summary>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{text}</pre>
    </details>
  )
}

function SaveButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
    >
      <FloppyDisk size={12} weight="bold" />
      {t.tools.save}
    </button>
  )
}

function g4(n: number): string {
  return `${n.toFixed(4)} g`
}

// ── Ring size ──────────────────────────────────────────────────────────────

const RING_SCALES: ReadonlyArray<RingScale> = ['us', 'eu', 'jp', 'mm']

function RingSizeCalc({ onSave }: { onSave: SaveFn }) {
  const { t } = useI18n()
  const c = t.tools.ringSize
  const [scale, setScale] = useState<RingScale>('us')
  const [value, setValue] = useState('7')
  const n = parseNum(value)
  const r = n == null ? null : convertRingSize(scale, n)

  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{c.title}</h2>
      <p className="text-xs text-muted">{c.help}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">{c.fromScale}</span>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value as RingScale)}
            className="block w-full rounded-md border border-border bg-card px-2 py-2 text-sm text-foreground focus:border-blue focus:outline-none"
          >
            {RING_SCALES.map((s) => (
              <option key={s} value={s}>
                {c.scales[s]}
              </option>
            ))}
          </select>
        </label>
        <Num label={c.size} value={value} onChange={setValue} step={scale === 'mm' ? '0.1' : '0.25'} />
      </div>
      {r ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Out label={c.scales.us} value={`${r.us} (${nearestUsQuarter(r.us)})`} big />
          <Out label={c.scales.eu} value={String(r.eu)} big />
          <Out label={c.scales.jp} value={String(r.jp)} big />
          <Out label={c.diameter} value={`${r.diameterMm} mm`} />
          <Out label={c.circumference} value={`${r.circumferenceMm} mm`} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{c.invalid}</p>
      )}
      <div className="mt-3">
        <SaveButton
          disabled={!r}
          onClick={() =>
            r &&
            onSave(
              'ring_size',
              `${c.scales[scale]} ${value} → US ${r.us} · EU ${r.eu} · JP ${r.jp} · ${r.diameterMm} mm`,
              { scale, value: n },
              { ...r },
            )
          }
        />
      </div>
      <Formula text={c.formula} />
    </div>
  )
}

// ── Weight units ───────────────────────────────────────────────────────────

function WeightCalc({ onSave }: { onSave: SaveFn }) {
  const { t } = useI18n()
  const c = t.tools.weight
  const [unit, setUnit] = useState<WeightUnit>('g')
  const [value, setValue] = useState('31.1035')
  const n = parseNum(value)
  const r = n == null ? null : convertWeight(n, unit)
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{c.title}</h2>
      <p className="text-xs text-muted">{c.help}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Num label={c.value} value={value} onChange={setValue} step="0.0001" />
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">{c.unit}</span>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as WeightUnit)}
            className="block w-full rounded-md border border-border bg-card px-2 py-2 text-sm text-foreground focus:border-blue focus:outline-none"
          >
            {WEIGHT_UNITS.map((u) => (
              <option key={u} value={u}>
                {c.units[u]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {r ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {WEIGHT_UNITS.map((u) => (
            <Out key={u} label={c.units[u]} value={String(r[u])} big={u !== unit} />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{c.invalid}</p>
      )}
      <div className="mt-3">
        <SaveButton
          disabled={!r}
          onClick={() =>
            r &&
            onSave(
              'weight',
              `${value} ${unit} = ${r.g} g · ${r.dwt} dwt · ${r.ozt} ozt · ${r.oz} oz`,
              { unit, value: n },
              { ...r },
            )
          }
        />
      </div>
      <Formula text={c.formula} />
    </div>
  )
}

// ── Alloy down ─────────────────────────────────────────────────────────────

function AlloyDownCalc({ onSave }: { onSave: SaveFn }) {
  const { t } = useI18n()
  const c = t.tools.alloyDown
  const [w, setW] = useState('10')
  const [from, setFrom] = useState('18')
  const [to, setTo] = useState('14')
  const r = alloyDown(parseNum(w) ?? NaN, parseNum(from) ?? NaN, parseNum(to) ?? NaN)
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{c.title}</h2>
      <p className="text-xs text-muted">{c.help}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Num label={c.weight} value={w} onChange={setW} step="0.001" suffix="g" />
        <Num label={c.fromKarat} value={from} onChange={setFrom} step="0.1" suffix="K" />
        <Num label={c.toKarat} value={to} onChange={setTo} step="0.1" suffix="K" />
      </div>
      {r ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Out label={c.alloyToAdd} value={g4(r.alloyToAddG)} big />
          <Out label={c.newTotal} value={g4(r.newTotalG)} />
          <Out label={t.tools.fineGold} value={g4(r.fineGoldG)} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{c.invalid}</p>
      )}
      <div className="mt-3">
        <SaveButton
          disabled={!r}
          onClick={() =>
            r &&
            onSave(
              'alloy_down',
              `${w} g ${from}K → ${to}K: +${r.alloyToAddG} g ${c.alloyWord} = ${r.newTotalG} g`,
              { weightG: parseNum(w), fromKarat: parseNum(from), toKarat: parseNum(to) },
              { ...r },
            )
          }
        />
      </div>
      <Formula text={c.formula} />
    </div>
  )
}

// ── Raise karat ────────────────────────────────────────────────────────────

function RaiseKaratCalc({ onSave }: { onSave: SaveFn }) {
  const { t } = useI18n()
  const c = t.tools.raiseKarat
  const [w, setW] = useState('10')
  const [from, setFrom] = useState('10')
  const [to, setTo] = useState('14')
  const r = raiseKarat(parseNum(w) ?? NaN, parseNum(from) ?? NaN, parseNum(to) ?? NaN)
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{c.title}</h2>
      <p className="text-xs text-muted">{c.help}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Num label={c.weight} value={w} onChange={setW} step="0.001" suffix="g" />
        <Num label={c.fromKarat} value={from} onChange={setFrom} step="0.1" suffix="K" />
        <Num label={c.toKarat} value={to} onChange={setTo} step="0.1" suffix="K" />
      </div>
      {r ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Out label={c.pureToAdd} value={g4(r.pureGoldToAddG)} big />
          <Out label={c.newTotal} value={g4(r.newTotalG)} />
          <Out label={t.tools.fineGold} value={g4(r.fineGoldG)} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{c.invalid}</p>
      )}
      <div className="mt-3">
        <SaveButton
          disabled={!r}
          onClick={() =>
            r &&
            onSave(
              'raise_karat',
              `${w} g ${from}K → ${to}K: +${r.pureGoldToAddG} g 24K = ${r.newTotalG} g`,
              { weightG: parseNum(w), fromKarat: parseNum(from), toKarat: parseNum(to) },
              { ...r },
            )
          }
        />
      </div>
      <Formula text={c.formula} />
    </div>
  )
}

// ── Mix lots ───────────────────────────────────────────────────────────────

type LotRow = { uid: number; w: string; k: string }
let lotSeq = 1

function MixLotsCalc({ onSave }: { onSave: SaveFn }) {
  const { t } = useI18n()
  const c = t.tools.mixLots
  const [lots, setLots] = useState<LotRow[]>(() => [
    { uid: lotSeq++, w: '10', k: '14' },
    { uid: lotSeq++, w: '5', k: '18' },
  ])
  const r = useMemo(
    () => mixLots(lots.map((l) => ({ weightG: parseNum(l.w) ?? NaN, karat: parseNum(l.k) ?? NaN }))),
    [lots],
  )
  const patch = (uid: number, p: Partial<LotRow>) =>
    setLots((rows) => rows.map((l) => (l.uid === uid ? { ...l, ...p } : l)))

  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{c.title}</h2>
      <p className="text-xs text-muted">{c.help}</p>
      <div className="mt-3 space-y-2">
        {lots.map((l, i) => (
          <div key={l.uid} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2">
            <span className="pb-2 font-mono text-xs text-muted">{i + 1}</span>
            <Num label={c.weight} value={l.w} onChange={(v) => patch(l.uid, { w: v })} step="0.001" suffix="g" />
            <Num label={c.karat} value={l.k} onChange={(v) => patch(l.uid, { k: v })} step="0.1" suffix="K" />
            <button
              type="button"
              onClick={() => setLots((rows) => (rows.length > 1 ? rows.filter((x) => x.uid !== l.uid) : rows))}
              disabled={lots.length <= 1}
              className="mb-1 rounded-md p-1.5 text-muted hover:bg-background hover:text-danger disabled:opacity-40"
              aria-label={t.common.remove}
            >
              <Trash size={14} weight="bold" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLots((rows) => [...rows, { uid: lotSeq++, w: '', k: '14' }])}
          disabled={lots.length >= 20}
          className="rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-foreground hover:bg-background disabled:opacity-50"
        >
          + {c.addLot}
        </button>
      </div>
      {r ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Out label={c.resultKarat} value={`${r.karat} K`} big />
          <Out label={c.fineness} value={`${(r.fineness * 1000).toFixed(1)}‰`} />
          <Out label={c.total} value={g4(r.totalG)} />
          <Out label={t.tools.fineGold} value={g4(r.fineGoldG)} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{c.invalid}</p>
      )}
      <div className="mt-3">
        <SaveButton
          disabled={!r}
          onClick={() =>
            r &&
            onSave(
              'mix_lots',
              `${lots.map((l) => `${l.w}g@${l.k}K`).join(' + ')} = ${r.totalG} g @ ${r.karat}K`,
              { lots: lots.map((l) => ({ weightG: parseNum(l.w), karat: parseNum(l.k) })) },
              { ...r },
            )
          }
        />
      </div>
      <Formula text={c.formula} />
    </div>
  )
}

// ── Melt / payout quick calc ───────────────────────────────────────────────

function MeltCalc({ rates, onSave }: { rates: RateMaps; onSave: SaveFn }) {
  const { t } = useI18n()
  const c = t.tools.melt
  const [combo, setCombo] = useState('gold::14k')
  const [w, setW] = useState('10')
  const [metal, purity] = combo.split('::') as [
    (typeof COUNTER_COMBOS_CLIENT)[number]['metalType'],
    (typeof COUNTER_COMBOS_CLIENT)[number]['purity'],
  ]
  const pay = resolveRate(rates, metal, purity, 'pay')
  const sell = resolveRate(rates, metal, purity, 'sell')
  const grams = parseNum(w)
  const ok = grams != null && grams > 0 && pay.spotPerGram != null
  const melt = ok ? dollarsFromGrams(grams, pay.spotPerGram!) : null
  const payout = ok && pay.perGram != null ? dollarsFromGrams(grams, pay.perGram) : null
  const sellAt = ok && sell.perGram != null ? dollarsFromGrams(grams, sell.perGram) : null

  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{c.title}</h2>
      <p className="text-xs text-muted">{c.help}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">{c.metal}</span>
          <select
            value={combo}
            onChange={(e) => setCombo(e.target.value)}
            className="block w-full rounded-md border border-border bg-card px-2 py-2 text-sm text-foreground focus:border-blue focus:outline-none"
          >
            {COUNTER_COMBOS_CLIENT.map((cb) => (
              <option key={`${cb.metalType}::${cb.purity}`} value={`${cb.metalType}::${cb.purity}`}>
                {t.spotPrices.metals[cb.metalType]} · {t.spotPrices.purities[cb.purity]}
              </option>
            ))}
          </select>
        </label>
        <Num label={c.weight} value={w} onChange={setW} step="0.001" suffix="g" />
      </div>
      {ok && melt != null ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Out label={c.spotMelt} value={formatMoney(melt)} />
          <Out label={`${c.payout} (${pctLabel(pay.multiplier)}%)`} value={payout == null ? '—' : formatMoney(payout)} big />
          <Out
            label={sell.configured ? `${c.sellAt} (${pctLabel(sell.multiplier)}%)` : c.sellUnset}
            value={sell.configured && sellAt != null ? formatMoney(sellAt) : '—'}
          />
          <p className="col-span-full font-mono text-[11px] text-muted">
            {c.rateLine
              .replace('{spot}', formatMoney(pay.spotPerGram ?? 0))
              .replace('{pay}', formatMoney(pay.perGram ?? 0))}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{pay.spotPerGram == null ? c.noSpot : c.invalid}</p>
      )}
      <div className="mt-3">
        <SaveButton
          disabled={!ok || payout == null}
          onClick={() =>
            ok &&
            payout != null &&
            onSave(
              'melt',
              `${w} g ${t.spotPrices.metals[metal]} ${t.spotPrices.purities[purity]} → ${formatMoney(payout)} (${pctLabel(pay.multiplier)}% · spot ${formatMoney(pay.spotPerGram ?? 0)}/g)`,
              { metal, purity, grams, spotPerGram: pay.spotPerGram, payMultiplier: pay.multiplier },
              { melt, payout, sellAt },
            )
          }
        />
      </div>
      <Formula text={c.formula} />
    </div>
  )
}
