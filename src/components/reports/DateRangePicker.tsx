'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useI18n } from '@/lib/i18n/context'

/**
 * Date-range picker. Drives the report queries via ?from=&to= search params.
 *
 * Quick presets: Today / Yesterday / Last 7 / Last 30 / Month-to-date.
 * Free-form date inputs let staff cover arbitrary ranges. Submitting
 * pushes the new params; the page is a server component so it re-fetches.
 */

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoOffset(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function monthToDate(): { from: string; to: string } {
  const now = new Date()
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return {
    from: first.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

export function DateRangePicker({
  from,
  to,
}: {
  from: string
  to: string
}) {
  const { t } = useI18n()
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo] = useState(to)

  function pushParams(nextFrom: string, nextTo: string) {
    const sp = new URLSearchParams(params.toString())
    sp.set('from', nextFrom)
    sp.set('to', nextTo)
    startTransition(() => router.push(`?${sp.toString()}`))
  }

  function applyPreset(preset: 'today' | 'yest' | '7' | '30' | 'mtd') {
    let nextFrom = localFrom
    let nextTo = localTo
    if (preset === 'today') {
      nextFrom = isoToday()
      nextTo = isoToday()
    } else if (preset === 'yest') {
      nextFrom = isoOffset(1)
      nextTo = isoOffset(1)
    } else if (preset === '7') {
      nextFrom = isoOffset(6)
      nextTo = isoToday()
    } else if (preset === '30') {
      nextFrom = isoOffset(29)
      nextTo = isoToday()
    } else if (preset === 'mtd') {
      const r = monthToDate()
      nextFrom = r.from
      nextTo = r.to
    }
    setLocalFrom(nextFrom)
    setLocalTo(nextTo)
    pushParams(nextFrom, nextTo)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    pushParams(localFrom, localTo)
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4"
    >
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span>{t.reports.range.from}</span>
        <input
          type="date"
          value={localFrom}
          onChange={(e) => setLocalFrom(e.target.value)}
          className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span>{t.reports.range.to}</span>
        <input
          type="date"
          value={localTo}
          onChange={(e) => setLocalTo(e.target.value)}
          className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground disabled:opacity-50"
      >
        {t.reports.range.apply}
      </button>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['today', t.reports.range.today],
            ['yest', t.reports.range.yesterday],
            ['7', t.reports.range.last7],
            ['30', t.reports.range.last30],
            ['mtd', t.reports.range.mtd],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => applyPreset(key)}
            disabled={pending}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground hover:border-foreground disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
    </form>
  )
}
