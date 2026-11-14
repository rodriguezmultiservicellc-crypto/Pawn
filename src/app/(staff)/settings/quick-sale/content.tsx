'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowLeft, ArrowUp, Lightning, Package, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { QUICK_SALE_MAX } from '@/lib/pos/quick-sale'
import { AddInventoryItemDialog, type InventoryPickRow } from '@/components/pos/AddInventoryItemDialog'
import {
  createQuickSaleAction,
  createQuickSaleProductAction,
  moveQuickSaleAction,
  removeQuickSaleAction,
  updateQuickSaleAction,
} from './actions'

export type QuickSaleRow =
  | { kind: 'plain'; id: string; name: string; is_active: boolean; price: number }
  | { kind: 'product'; id: string; name: string; is_active: boolean; inStock: number }

const inputCls =
  'h-11 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:border-blue focus:outline-none focus-visible:outline-3 focus-visible:outline-blue'
const goldBtn =
  'h-11 rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50'

type Mode = 'product' | 'plain'

export default function QuickSaleSettingsContent({
  rows,
  inventory,
}: {
  rows: QuickSaleRow[]
  inventory: InventoryPickRow[]
}) {
  const { t } = useI18n()
  const q = t.quickSale
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [mode, setMode] = useState<Mode>('product')
  const [draft, setDraft] = useState({ name: '', price: '' })
  const [picked, setPicked] = useState<InventoryPickRow | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const full = rows.length >= QUICK_SALE_MAX

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: keyof typeof q.errors }>, onOk?: () => void) => {
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.ok) {
        onOk?.()
        setMsg({ ok: true, text: q.saved })
      } else setMsg({ ok: false, text: q.errors[r.error] })
    })
  }

  const reset = () => {
    setDraft({ name: '', price: '' })
    setPicked(null)
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'product') {
      if (!picked) return
      run(() => createQuickSaleProductAction({ inventory_item_id: picked.id, name: draft.name }), reset)
    } else {
      run(() => createQuickSaleAction({ name: draft.name, price: draft.price, is_active: true }), reset)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Lightning size={28} className="text-gold" />
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{q.title}</h1>
          <p className="text-sm text-muted">{q.subtitle}</p>
        </div>
        <Link href="/pos/sales/new" className="ml-auto inline-flex items-center gap-1 text-sm text-blue hover:text-blue-2">
          <ArrowLeft size={14} /> {q.backToSale}
        </Link>
      </div>

      <form onSubmit={add} className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div role="radiogroup" aria-label={q.kindLabel} className="inline-flex overflow-hidden rounded-md border border-foreground">
          {(['product', 'plain'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m)
                reset()
              }}
              className={`h-11 border-l border-foreground px-4 text-sm font-bold first:border-l-0 ${
                mode === m ? 'bg-foreground text-white' : 'bg-card text-foreground hover:bg-background'
              }`}
            >
              {m === 'product' ? q.kindProduct : q.kindPlain}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{mode === 'product' ? q.kindProductHelp : q.kindPlainHelp}</p>

        <div className="flex flex-wrap items-end gap-3">
          {mode === 'product' ? (
            <div className="space-y-1 text-sm">
              <span className="block font-semibold text-foreground">{q.inventoryItem}</span>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="inline-flex h-11 max-w-[22rem] items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-sm text-foreground hover:bg-background"
              >
                <Package size={16} className="shrink-0 text-muted" />
                <span className="truncate">
                  {picked ? `${picked.sku} · ${picked.description}` : q.pickItem}
                </span>
              </button>
            </div>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span className="block font-semibold text-foreground">{mode === 'product' ? q.nameOptional : q.name}</span>
            <input
              required={mode === 'plain'}
              maxLength={60}
              value={draft.name}
              placeholder={mode === 'product' ? picked?.description.slice(0, 60) : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className={`${inputCls} w-64`}
            />
          </label>
          {mode === 'plain' ? (
            <label className="block space-y-1 text-sm">
              <span className="block font-semibold text-foreground">{q.price}</span>
              <input
                required
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                className={`${inputCls} w-32 text-right font-mono`}
              />
            </label>
          ) : null}
          <button type="submit" disabled={pending || full || (mode === 'product' && !picked)} className={goldBtn}>
            {q.add}
          </button>
          {msg ? <span className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</span> : null}
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{q.empty}</p>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <Row
                key={r.id}
                row={r}
                first={i === 0}
                last={i === rows.length - 1}
                pending={pending}
                onSave={(v) => run(() => updateQuickSaleAction(r.id, v))}
                onMove={(dir) => run(() => moveQuickSaleAction(r.id, dir))}
                onRemove={() => {
                  if (confirm(q.removeConfirm.replace('{name}', r.name))) run(() => removeQuickSaleAction(r.id))
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {showPicker ? (
        <AddInventoryItemDialog
          items={inventory}
          initialQuery=""
          onClose={() => setShowPicker(false)}
          onPick={(it) => setPicked(it)}
        />
      ) : null}
    </div>
  )
}

function Row({
  row,
  first,
  last,
  pending,
  onSave,
  onMove,
  onRemove,
}: {
  row: QuickSaleRow
  first: boolean
  last: boolean
  pending: boolean
  onSave: (v: { name: string; price?: string; is_active: boolean }) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const q = t.quickSale
  const [name, setName] = useState(row.name)
  const [price, setPrice] = useState(row.kind === 'plain' ? row.price.toFixed(2) : '')
  const [active, setActive] = useState(row.is_active)
  const dirty =
    name !== row.name ||
    active !== row.is_active ||
    (row.kind === 'plain' && Number(price) !== row.price)
  const iconBtn =
    'grid h-11 w-11 place-items-center rounded-md border border-border text-foreground hover:bg-background disabled:opacity-40'

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
      <input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label={q.name} className={`${inputCls} w-64`} />
      {row.kind === 'plain' ? (
        <input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          aria-label={q.price}
          className={`${inputCls} w-32 text-right font-mono`}
        />
      ) : (
        <span className="inline-flex h-11 items-center gap-1.5 text-sm text-muted">
          <Package size={16} />
          {q.linkedInStock.replace('{count}', String(row.inStock))}
        </span>
      )}
      <label className="flex h-11 items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {q.active}
      </label>
      <button
        type="button"
        disabled={pending || !dirty}
        onClick={() => onSave(row.kind === 'plain' ? { name, price, is_active: active } : { name, is_active: active })}
        className="h-11 rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-background disabled:opacity-40"
      >
        {q.save}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" disabled={pending || first} onClick={() => onMove(-1)} aria-label={q.moveUp} className={iconBtn}>
          <ArrowUp size={16} />
        </button>
        <button type="button" disabled={pending || last} onClick={() => onMove(1)} aria-label={q.moveDown} className={iconBtn}>
          <ArrowDown size={16} />
        </button>
        <button type="button" disabled={pending} onClick={onRemove} aria-label={q.remove} className={`${iconBtn} text-danger`}>
          <Trash size={16} />
        </button>
      </div>
    </li>
  )
}
