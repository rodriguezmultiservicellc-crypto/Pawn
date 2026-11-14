'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowLeft, ArrowUp, Lightning, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { QUICK_SALE_MAX } from '@/lib/pos/quick-sale'
import {
  createQuickSaleAction,
  moveQuickSaleAction,
  removeQuickSaleAction,
  updateQuickSaleAction,
} from './actions'

export type QuickSaleRow = { id: string; name: string; price: number; is_active: boolean }

const inputCls =
  'h-11 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:border-blue focus:outline-none focus-visible:outline-3 focus-visible:outline-blue'

export default function QuickSaleSettingsContent({ rows }: { rows: QuickSaleRow[] }) {
  const { t } = useI18n()
  const q = t.quickSale
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [draft, setDraft] = useState({ name: '', price: '' })

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

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    run(
      () => createQuickSaleAction({ name: draft.name, price: draft.price, is_active: true }),
      () => setDraft({ name: '', price: '' }),
    )
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

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-5">
        <label className="block space-y-1 text-sm">
          <span className="font-semibold text-foreground">{q.name}</span>
          <input
            required
            maxLength={60}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className={`${inputCls} w-64`}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-semibold text-foreground">{q.price}</span>
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
        <button
          type="submit"
          disabled={pending || rows.length >= QUICK_SALE_MAX}
          className="h-11 rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
        >
          {q.add}
        </button>
        {msg ? <span className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</span> : null}
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
  onSave: (v: { name: string; price: string; is_active: boolean }) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const q = t.quickSale
  const [name, setName] = useState(row.name)
  const [price, setPrice] = useState(row.price.toFixed(2))
  const [active, setActive] = useState(row.is_active)
  const dirty = name !== row.name || Number(price) !== row.price || active !== row.is_active
  const iconBtn =
    'grid h-11 w-11 place-items-center rounded-md border border-border text-foreground hover:bg-background disabled:opacity-40'

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
      <input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label={q.name} className={`${inputCls} w-64`} />
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
      <label className="flex h-11 items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {q.active}
      </label>
      <button
        type="button"
        disabled={pending || !dirty}
        onClick={() => onSave({ name, price, is_active: active })}
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
