'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowsLeftRight,
  CheckCircle,
  GitMerge,
  Prohibit,
  Warning,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import CustomerPicker, { type CustomerPickerHandle } from '@/components/customers/CustomerPicker'
import type { PickerCustomerResult } from '@/lib/customers/picker-search'
import type { DuplicateCandidate, DuplicateGroup } from '@/lib/customers/duplicates'
import { formatCalendarDate } from '@/lib/format/date'
import { formatMoney, formatNumber, shortDate } from '@/lib/format/money'
import {
  getMergePreviewAction,
  mergeCustomersAction,
  type MergeError,
  type MergePreview,
  type MergeSide,
} from './actions'

type Ready = Extract<MergePreview, { ok: true }>

function pickerLabel(c: Pick<DuplicateCandidate, 'id' | 'first_name' | 'last_name' | 'phone'>): PickerCustomerResult {
  return { id: c.id, label: `${c.last_name}, ${c.first_name}${c.phone ? ` · ${c.phone}` : ''}` }
}

export default function MergeContent({
  initialKeepId,
  initialRemoveId,
  duplicates,
}: {
  initialKeepId: string | null
  initialRemoveId: string | null
  duplicates: DuplicateGroup[]
}) {
  const { t } = useI18n()
  const tm = t.customers.merge
  const router = useRouter()

  const keepRef = useRef<CustomerPickerHandle>(null)
  const removeRef = useRef<CustomerPickerHandle>(null)
  const [keep, setKeep] = useState<PickerCustomerResult | null>(null)
  const [remove, setRemove] = useState<PickerCustomerResult | null>(null)

  const [actionError, setActionError] = useState<MergeError | null>(null)
  const [loading, startLoading] = useTransition()
  const [merging, startMerging] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [notes, setNotes] = useState('')

  const keepId = keep?.id ?? null
  const removeId = remove?.id ?? null
  const pairKey = keepId && removeId && keepId !== removeId ? `${keepId}:${removeId}` : null

  // A preview / error only counts for the pair it was fetched for, so a
  // changed picker never shows the previous pair's numbers.
  const [result, setResult] = useState<{ key: string; preview: Ready | null; error: MergeError | null } | null>(null)
  const current = result && result.key === pairKey ? result : null
  const preview = current?.preview ?? null
  const error: MergeError | null =
    actionError ?? (keepId && keepId === removeId ? 'merge_same_customer' : (current?.error ?? null))

  useEffect(() => {
    if (!pairKey || !keepId || !removeId) return
    let live = true
    startLoading(async () => {
      const res = await getMergePreviewAction({ keepId, removeId })
      if (!live) return
      setResult(res.ok ? { key: pairKey, preview: res, error: null } : { key: pairKey, preview: null, error: res.error })
    })
    return () => {
      live = false
    }
  }, [pairKey, keepId, removeId])

  function pickKeep(c: PickerCustomerResult | null) {
    setKeep(c)
    setConfirming(false)
    setActionError(null)
  }
  function pickRemove(c: PickerCustomerResult | null) {
    setRemove(c)
    setConfirming(false)
    setActionError(null)
  }

  function swap() {
    const k = keep
    const r = remove
    if (r) keepRef.current?.set(r)
    else keepRef.current?.clear()
    if (k) removeRef.current?.set(k)
    else removeRef.current?.clear()
  }

  function review(keepC: DuplicateCandidate, removeC: DuplicateCandidate) {
    keepRef.current?.set(pickerLabel(keepC))
    removeRef.current?.set(pickerLabel(removeC))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function runMerge() {
    if (!preview) return
    startMerging(async () => {
      const res = await mergeCustomersAction({
        keepId: preview.keep.id,
        removeId: preview.remove.id,
        notes,
      })
      if (res.ok) router.push(`/customers/${res.keepId}?merged=1`)
      else {
        setConfirming(false)
        setActionError(res.error)
      }
    })
  }

  const moving = preview ? preview.counts.reduce((s, c) => s + c.remove, 0) : 0
  const fullName = (s: MergeSide) => `${s.first_name}${s.middle_name ? ` ${s.middle_name}` : ''} ${s.last_name}`

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/customers"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.customers.backToList}
        </Link>
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold">{tm.title}</h1>
        <p className="mt-1 text-sm text-text-secondary">{tm.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-xl border border-success/40 bg-card p-4">
          <div className="mb-1 text-sm font-semibold text-success">{tm.keepTitle}</div>
          <p className="mb-3 text-xs text-muted">{tm.keepHint}</p>
          <CustomerPicker
            ref={keepRef}
            name="keep_customer_id"
            initialCustomerId={initialKeepId}
            onChange={pickKeep}
          />
        </div>
        <button
          type="button"
          onClick={swap}
          disabled={!keep && !remove}
          title={tm.swap}
          aria-label={tm.swap}
          className="mx-auto mt-2 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-foreground hover:border-blue disabled:opacity-40 md:mt-12"
        >
          <ArrowsLeftRight size={18} weight="bold" />
        </button>
        <div className="rounded-xl border border-danger/40 bg-card p-4">
          <div className="mb-1 text-sm font-semibold text-danger">{tm.removeTitle}</div>
          <p className="mb-3 text-xs text-muted">{tm.removeHint}</p>
          <CustomerPicker
            ref={removeRef}
            name="remove_customer_id"
            initialCustomerId={initialRemoveId}
            onChange={pickRemove}
          />
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Warning size={16} weight="bold" className="mt-0.5 shrink-0" />
          <span>{tm.errors[error]}</span>
        </div>
      ) : null}

      {loading && !preview ? <div className="text-sm text-muted">{tm.loadingPreview}</div> : null}

      {preview ? (
        <section className="space-y-5 rounded-xl border border-border bg-card p-5">
          <div>
            <h2 className="text-lg font-semibold">{tm.previewTitle}</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {moving > 0 ? tm.movesSummary.replace('{n}', formatNumber(moving)) : tm.noMoves}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SideCard side={preview.remove} tone="danger" title={tm.removeTitle} name={fullName(preview.remove)} />
            <SideCard side={preview.keep} tone="success" title={tm.keepTitle} name={fullName(preview.keep)} />
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-12 bg-background px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <div className="col-span-6">{tm.colRecords}</div>
              <div className="col-span-3 text-right">{tm.colRemove}</div>
              <div className="col-span-3 text-right">{tm.colKeep}</div>
            </div>
            <div className="divide-y divide-border">
              {preview.counts.filter((c) => c.keep > 0 || c.remove > 0).length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted">{tm.noRecords}</div>
              ) : (
                preview.counts
                  .filter((c) => c.keep > 0 || c.remove > 0)
                  .map((c) => (
                    <div key={c.table} className="grid grid-cols-12 items-center px-3 py-1.5 text-sm">
                      <div className="col-span-6 text-text-secondary">{tm.tables[c.table]}</div>
                      <div
                        className={`col-span-3 text-right font-mono tabular-nums ${c.remove > 0 ? 'font-semibold text-danger' : 'text-muted'}`}
                      >
                        {c.remove}
                      </div>
                      <div className="col-span-3 text-right font-mono tabular-nums">{c.keep}</div>
                    </div>
                  ))
              )}
            </div>
          </div>

          {preview.warnings.length > 0 ? (
            <ul className="space-y-2">
              {preview.warnings.map((w) => (
                <li
                  key={w}
                  className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-2 text-sm text-foreground"
                >
                  <Warning size={16} weight="bold" className="mt-0.5 shrink-0 text-warning" />
                  <span>{tm.warnings[w]}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="rounded-xl bg-background p-4 text-sm text-text-secondary">
            <div className="mb-2 font-semibold text-foreground">{tm.whatHappensTitle}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{tm.happenMove}</li>
              <li>{tm.happenFill}</li>
              <li>{tm.happenMoney}</li>
              <li>{tm.happenHide}</li>
            </ul>
          </div>

          {preview.blocked ? (
            <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <Prohibit size={16} weight="bold" className="mt-0.5 shrink-0" />
              <span>{tm.errors[preview.blocked]}</span>
            </div>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-foreground">{tm.notesLabel}</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder={tm.notesPlaceholder}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue"
                />
              </label>

              {confirming ? (
                <div className="space-y-3 rounded-xl border border-danger/40 bg-danger/5 p-4">
                  <div className="font-semibold text-foreground">
                    {tm.confirmTitle
                      .replace('{remove}', fullName(preview.remove))
                      .replace('{keep}', fullName(preview.keep))}
                  </div>
                  <p className="text-sm text-text-secondary">{tm.confirmBody}</p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={merging}
                      className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:border-blue disabled:opacity-50"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={runMerge}
                      disabled={merging}
                      className="inline-flex items-center gap-2 rounded-xl bg-danger px-4 py-2 text-sm font-bold text-white hover:bg-danger/90 disabled:opacity-50"
                    >
                      <GitMerge size={16} weight="bold" />
                      {merging ? tm.merging : tm.confirmYes}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-gold px-5 py-2.5 font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
                  >
                    <GitMerge size={16} weight="bold" />
                    {tm.mergeButton}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{tm.duplicatesTitle}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {duplicates.length > 0
              ? tm.duplicatesCount.replace('{n}', formatNumber(duplicates.length))
              : tm.duplicatesEmpty}
          </p>
        </div>
        {duplicates.length > 0 ? <p className="text-xs text-muted">{tm.duplicatesHint}</p> : null}
        <div className="space-y-3">
          {duplicates.map((g) => {
            const first = g.customers[0]!
            return (
              <div key={g.customers.map((c) => c.id).join(':')} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 inline-flex items-center rounded-full border border-info/30 bg-info/5 px-2 py-0.5 text-xs font-medium text-info">
                  {tm.signals[g.signal]}
                </div>
                <div className="divide-y divide-border">
                  {g.customers.map((c, i) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link href={`/customers/${c.id}`} className="font-semibold text-blue hover:underline">
                          {c.last_name}, {c.first_name}
                        </Link>
                        <div className="text-xs text-text-secondary">
                          {[c.phone, c.email, c.id_number ? `${tm.fields.idNumber} ${c.id_number}` : null]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                          {' · '}
                          {tm.fields.created} {shortDate(c.created_at)}
                        </div>
                      </div>
                      {i === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                          <CheckCircle size={14} weight="bold" />
                          {tm.oldest}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => review(first, c)}
                          className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:border-blue"
                        >
                          {tm.reviewMerge}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function SideCard({
  side,
  tone,
  title,
  name,
}: {
  side: MergeSide
  tone: 'success' | 'danger'
  title: string
  name: string
}) {
  const { t, lang } = useI18n()
  const tm = t.customers.merge
  const rows: Array<[string, string | null]> = [
    [tm.fields.phone, side.phone],
    [tm.fields.phoneAlt, side.phone_alt],
    [tm.fields.email, side.email],
    [tm.fields.address, side.address],
    [tm.fields.idNumber, side.id_number],
    [tm.fields.dob, side.date_of_birth ? formatCalendarDate(side.date_of_birth, lang) : null],
    [tm.fields.created, shortDate(side.created_at)],
    [tm.fields.storeCredit, side.store_credit_balance > 0 ? formatMoney(side.store_credit_balance) : null],
    [tm.fields.points, side.loyalty_points_balance > 0 ? formatNumber(side.loyalty_points_balance) : null],
  ]
  return (
    <div className={`rounded-xl border bg-background p-4 ${tone === 'success' ? 'border-success/40' : 'border-danger/40'}`}>
      <div className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone === 'success' ? 'text-success' : 'text-danger'}`}>
        {title}
      </div>
      <Link href={`/customers/${side.id}`} className="font-semibold text-blue hover:underline">
        {name}
      </Link>
      <div className="mt-1 flex flex-wrap gap-1">
        {side.imported ? <Badge>{tm.badges.imported}</Badge> : null}
        {side.has_portal ? <Badge>{tm.badges.portal}</Badge> : null}
        {side.is_banned ? <Badge danger>{tm.badges.banned}</Badge> : null}
      </div>
      <dl className="mt-2 space-y-0.5 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="shrink-0 text-muted">{label}:</dt>
              <dd className="min-w-0 break-words text-foreground">{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}

function Badge({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        danger ? 'border-danger/30 bg-danger/5 text-danger' : 'border-info/30 bg-info/5 text-info'
      }`}
    >
      {children}
    </span>
  )
}
