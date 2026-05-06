'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Certificate, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type {
  AppraisalPurpose,
  AppraisalStatus,
} from '@/types/database-aliases'

export type AppraisalListRow = {
  id: string
  appraisal_number: string
  customer_id: string | null
  customer_name: string
  customer_phone: string | null
  item_description: string
  purpose: AppraisalPurpose
  appraised_value: number
  valid_from: string
  valid_until: string | null
  status: AppraisalStatus
  appraiser_user_id: string | null
  appraiser_name: string | null
  is_printed: boolean
  created_at: string
}

export type Counts = {
  draft: number
  finalized: number
  voided: number
}

export default function AppraisalListContent({
  rows,
  query,
  statusFilter,
  purposeFilter,
  customerFilter,
  counts,
}: {
  rows: AppraisalListRow[]
  query: string
  statusFilter: string
  purposeFilter: string
  customerFilter: string
  counts: Counts
}) {
  const { t } = useI18n()
  const router = useRouter()
  const sp = useSearchParams()
  const [searchInput, setSearchInput] = useState(query)
  const [pending, startTransition] = useTransition()

  function pushParams(next: Record<string, string | null>) {
    const usp = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') usp.delete(k)
      else usp.set(k, v)
    }
    startTransition(() => {
      router.push(`/appraisals${usp.toString() ? `?${usp.toString()}` : ''}`)
    })
  }

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    pushParams({ q: searchInput.trim() })
  }

  const hasFilter =
    !!query ||
    statusFilter !== 'all' ||
    !!purposeFilter ||
    !!customerFilter

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{t.appraisal.title}</h1>
          <p className="text-sm text-muted">{t.appraisal.subtitle}</p>
        </div>
        <Link
          href="/appraisals/new"
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2"
        >
          <Plus size={16} weight="bold" />
          <span>{t.appraisal.new}</span>
        </Link>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        <Chip
          label={t.appraisal.list.filterDraft}
          count={counts.draft}
          active={statusFilter === 'draft'}
          onClick={() => pushParams({ status: 'draft' })}
        />
        <Chip
          label={t.appraisal.list.filterFinalized}
          count={counts.finalized}
          active={statusFilter === 'finalized'}
          tone="success"
          onClick={() => pushParams({ status: 'finalized' })}
        />
        <Chip
          label={t.appraisal.list.filterVoided}
          count={counts.voided}
          active={statusFilter === 'voided'}
          tone="error"
          onClick={() => pushParams({ status: 'voided' })}
        />
        <Chip
          label={t.appraisal.list.filterAll}
          count={null}
          active={statusFilter === 'all'}
          onClick={() => pushParams({ status: 'all' })}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <form
          onSubmit={onSearchSubmit}
          className="sm:col-span-7 flex items-center gap-2"
        >
          <div className="relative flex-1">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t.appraisal.list.searchPlaceholder}
              className="block w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground disabled:opacity-50"
          >
            {t.common.search}
          </button>
        </form>

        <select
          value={purposeFilter}
          onChange={(e) => pushParams({ purpose: e.target.value })}
          className="sm:col-span-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">{t.common.all}</option>
          <option value="insurance">
            {t.appraisal.purposes.insurance}
          </option>
          <option value="estate">{t.appraisal.purposes.estate}</option>
          <option value="sale">{t.appraisal.purposes.sale}</option>
          <option value="pawn_intake">
            {t.appraisal.purposes.pawn_intake}
          </option>
          <option value="collateral_review">
            {t.appraisal.purposes.collateral_review}
          </option>
          <option value="customer_request">
            {t.appraisal.purposes.customer_request}
          </option>
        </select>

        {hasFilter ? (
          <button
            type="button"
            onClick={() => {
              setSearchInput('')
              pushParams({
                q: null,
                status: null,
                purpose: null,
                customer: null,
              })
            }}
            className="sm:col-span-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground"
          >
            {t.common.clear}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Certificate
            size={32}
            weight="light"
            className="mx-auto mb-3 text-muted"
          />
          <p className="text-muted">
            {hasFilter
              ? t.appraisal.list.emptyForFilter
              : t.appraisal.list.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">
                  {t.appraisal.list.number}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.appraisal.list.customer}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.appraisal.list.item}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.appraisal.list.purpose}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.appraisal.list.appraiser}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.appraisal.list.validFrom}
                </th>
                <th className="px-4 py-3 font-medium text-right">
                  {t.appraisal.list.value}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.appraisal.list.status}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-background"
                  onClick={() => router.push(`/appraisals/${r.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {r.appraisal_number}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {r.customer_name}
                    </div>
                    {r.customer_phone ? (
                      <div className="text-xs text-muted">
                        {r.customer_phone}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <span className="line-clamp-1">{r.item_description}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground">
                    {t.appraisal.purposes[r.purpose]}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground">
                    {r.appraiser_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {r.valid_from}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-foreground">
                    {fmtMoney(r.appraised_value)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Chip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string
  count: number | null
  active: boolean
  tone?: 'error' | 'warning' | 'success'
  onClick: () => void
}) {
  const base =
    'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors'
  const toneBg =
    tone === 'error'
      ? 'border-danger/30 text-danger hover:bg-danger/5'
      : tone === 'warning'
      ? 'border-warning/30 text-warning hover:bg-warning/5'
      : tone === 'success'
      ? 'border-success/30 text-success hover:bg-success/5'
      : 'border-border text-foreground hover:bg-background'
  const activeRing = active ? 'ring-2 ring-ink/20 bg-background' : 'bg-card'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${toneBg} ${activeRing}`}
    >
      {label}
      {count != null ? (
        <span className="rounded-full bg-card/60 px-1.5 py-0.5 text-[10px] font-mono text-muted">
          {count}
        </span>
      ) : null}
    </button>
  )
}

function StatusBadge({ status }: { status: AppraisalStatus }) {
  const { t } = useI18n()
  const tone =
    status === 'finalized'
      ? 'border-success/30 bg-success/5 text-success'
      : status === 'voided'
      ? 'border-danger/30 bg-danger/5 text-danger'
      : 'border-border bg-background text-foreground'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {t.appraisal.statuses[status]}
    </span>
  )
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
