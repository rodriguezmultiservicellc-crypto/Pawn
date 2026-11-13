'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ListChecks, Play, Vault } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { absoluteTimestamp } from '@/lib/format/datetime'
import { categoryLabel, locationLabel } from '@/lib/inventory/labels'
import { inventoryCategorySchema, inventoryLocationSchema } from '@/lib/validations/inventory'
import type { CountSession, PledgeAlert } from '@/lib/counts/server'
import type { CountError } from '@/lib/counts/types'
import { countScopeLabel, STATUS_TONE } from '@/components/counts/labels'
import { PledgeAlertBanner } from '@/components/counts/PledgeAlertBanner'
import { startCountAction } from './actions'

type Location = (typeof inventoryLocationSchema.options)[number]
type Category = (typeof inventoryCategorySchema.options)[number]

// 'transfer' is a status of an item in transit, not a place to count.
const COUNTABLE_LOCATIONS = inventoryLocationSchema.options.filter((l) => l !== 'transfer')

export default function CountsContent({
  sessions,
  hasPawn,
  pledgeAlert,
}: {
  sessions: CountSession[]
  hasPawn: boolean
  pledgeAlert: PledgeAlert | null
}) {
  const { t } = useI18n()
  const open = sessions.filter((s) => s.status === 'open')
  const history = sessions.filter((s) => s.status !== 'open')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListChecks size={28} weight="regular" className="text-gold" />
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{t.counts.title}</h1>
          <p className="text-sm text-muted">{t.counts.subtitle}</p>
        </div>
      </div>

      {pledgeAlert && pledgeAlert.count > 0 ? <PledgeAlertBanner alert={pledgeAlert} /> : null}

      <StartCount hasPawn={hasPawn} />

      {open.length > 0 ? (
        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">{t.counts.list.open}</h2>
          <SessionTable rows={open} />
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">{t.counts.list.history}</h2>
        {history.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">{t.counts.list.empty}</p>
        ) : (
          <SessionTable rows={history} />
        )}
      </section>
    </div>
  )
}

function StartCount({ hasPawn }: { hasPawn: boolean }) {
  const { t } = useI18n()
  const [kind, setKind] = useState<'case' | 'vault'>('case')
  const [location, setLocation] = useState<Location>('case')
  const [shelf, setShelf] = useState('')
  const [category, setCategory] = useState<Category | ''>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<CountError | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res =
        kind === 'vault'
          ? await startCountAction({ kind: 'vault', note })
          : await startCountAction({ kind: 'case', location, shelf, category, note })
      // Success navigates to the new count; only failures return here.
      if (res && !res.ok) setError(res.error)
    })
  }

  const inputCls =
    'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none'

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{t.counts.start.title}</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KindCard
          active={kind === 'case'}
          onClick={() => setKind('case')}
          icon={<ListChecks size={20} />}
          title={t.counts.kinds.case}
          help={t.counts.start.caseHelp}
        />
        {hasPawn ? (
          <KindCard
            active={kind === 'vault'}
            onClick={() => setKind('vault')}
            icon={<Vault size={20} />}
            title={t.counts.kinds.vault}
            help={t.counts.start.vaultHelp}
          />
        ) : null}
      </div>

      {kind === 'case' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-foreground">{t.counts.start.location}</span>
            <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value as Location)}>
              {COUNTABLE_LOCATIONS.map((l) => (
                <option key={l} value={l}>{locationLabel(l, t)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-foreground">{t.counts.start.shelf}</span>
            <input
              className={inputCls}
              value={shelf}
              maxLength={60}
              placeholder={t.counts.start.shelfPlaceholder}
              onChange={(e) => setShelf(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-foreground">{t.counts.start.category}</span>
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
              <option value="">{t.counts.start.anyCategory}</option>
              {inventoryCategorySchema.options.map((c) => (
                <option key={c} value={c}>{categoryLabel(c, t)}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <label className="block space-y-1 text-sm">
        <span className="font-semibold text-foreground">{t.counts.start.note}</span>
        <input
          className={inputCls}
          value={note}
          maxLength={500}
          placeholder={t.counts.start.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {error ? <p className="text-sm text-danger">{t.counts.errors[error]}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
      >
        <Play size={16} weight="fill" />
        {pending ? t.counts.start.starting : t.counts.start.submit}
      </button>
    </form>
  )
}

function KindCard(props: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; help: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        props.active ? 'border-blue bg-blue/5' : 'border-border bg-card hover:bg-background'
      }`}
    >
      <span className={props.active ? 'text-blue' : 'text-muted'}>{props.icon}</span>
      <span>
        <span className="block text-sm font-semibold text-foreground">{props.title}</span>
        <span className="mt-1 block text-xs text-muted">{props.help}</span>
      </span>
    </button>
  )
}

function SessionTable({ rows }: { rows: CountSession[] }) {
  const { t } = useI18n()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-5 py-2 font-semibold">{t.counts.list.number}</th>
            <th className="px-3 py-2 font-semibold">{t.counts.list.kind}</th>
            <th className="px-3 py-2 font-semibold">{t.counts.list.scope}</th>
            <th className="px-3 py-2 font-semibold">{t.counts.list.started}</th>
            <th className="px-3 py-2 font-semibold">{t.counts.list.status}</th>
            <th className="px-3 py-2 text-right font-semibold">{t.counts.list.progress}</th>
            <th className="px-3 py-2 text-right font-semibold">{t.counts.list.missing}</th>
            <th className="px-3 py-2 text-right font-semibold">{t.counts.list.unexpected}</th>
            <th className="px-5 py-2 text-right font-semibold">{t.counts.list.value}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-background">
              <td className="px-5 py-2">
                <Link href={`/inventory/counts/${s.id}`} className="font-mono text-blue hover:text-blue-2">
                  {s.count_number}
                </Link>
              </td>
              <td className="px-3 py-2 text-foreground">{t.counts.kinds[s.kind]}</td>
              <td className="px-3 py-2 text-muted">{countScopeLabel(s, t)}</td>
              <td className="px-3 py-2 text-muted">{absoluteTimestamp(s.started_at)}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s.status]}`}>
                  {t.counts.statuses[s.status]}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {s.status === 'closed' ? `${s.seen_count ?? 0}/${s.expected_count ?? 0}` : '—'}
              </td>
              <td className={`px-3 py-2 text-right font-mono ${(s.missing_count ?? 0) > 0 ? 'text-danger' : ''}`}>
                {s.status === 'closed' ? s.missing_count ?? 0 : '—'}
              </td>
              <td className={`px-3 py-2 text-right font-mono ${(s.unexpected_count ?? 0) > 0 ? 'text-warning' : ''}`}>
                {s.status === 'closed' ? s.unexpected_count ?? 0 : '—'}
              </td>
              <td className="px-5 py-2 text-right font-mono">
                {s.status === 'closed' ? formatMoney(s.missing_value ?? 0) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
