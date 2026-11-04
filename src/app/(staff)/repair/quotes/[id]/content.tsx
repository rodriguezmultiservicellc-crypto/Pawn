'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowSquareOut,
  ChatText,
  CheckCircle,
  Copy,
  CopySimple,
  FilePdf,
  LinkBreak,
  LinkSimple,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  Wrench,
  XCircle,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import { QuoteStatusBadge } from '@/components/custom-quotes/QuoteStatusBadge'
import type { QuoteDetailView } from '@/lib/custom-quotes/load'
import { quoteLinkAction, quoteStatusAction, type QuoteActionState } from '../actions'

export default function QuoteDetailContent({
  quote: q,
  photoUrl,
  link,
  showBreakdown,
}: {
  quote: QuoteDetailView
  photoUrl: string | null
  link: string | null
  showBreakdown: boolean
}) {
  const { t } = useI18n()
  const tq = t.quotes
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<'copied' | 'sent' | null>(null)
  const [currentLink, setCurrentLink] = useState<string | null>(link)

  const editable = q.status === 'draft' || q.status === 'sent'
  const expired = q.effective_status === 'expired'
  const errText = error == null ? null : (tq.errors as Record<string, string>)[error] ?? error

  function run(
    action: (fd: FormData) => Promise<QuoteActionState>,
    fields: Record<string, string>,
    onOk?: (r: QuoteActionState) => void,
  ) {
    setError(null)
    setNotice(null)
    const fd = new FormData()
    fd.set('quote_id', q.id)
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    startTransition(async () => {
      const res = await action(fd)
      if (res.error) setError(res.error)
      else {
        onOk?.(res)
        if (res.quoteId && res.quoteId !== q.id) router.push(`/repair/quotes/${res.quoteId}`)
      }
    })
  }
  const status = (action: string, confirm?: string) => () => {
    if (confirm && !window.confirm(confirm)) return
    run(quoteStatusAction, { action })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/repair/quotes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft size={14} weight="bold" />
          {tq.backToList}
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/api/print/quote/${q.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-background"
          >
            <FilePdf size={12} weight="bold" />
            {tq.actions.pdf}
          </a>
          <QuoteStatusBadge status={q.effective_status} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">{tq.list.number}</div>
            <h1 className="font-display font-mono text-2xl font-bold text-foreground">{q.quote_number}</h1>
            <div className="mt-1 text-base text-foreground">
              <span className="text-muted">{tq.categories[q.category]} · </span>
              {q.description}
            </div>
            {q.size ? (
              <div className="text-xs text-muted">
                {tq.detail.size}: {q.size}
              </div>
            ) : null}
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs uppercase tracking-wide text-muted">{tq.detail.customer}</div>
            <Link href={`/customers/${q.customer_id}`} className="text-base font-semibold text-foreground hover:underline">
              {q.customer_name}
            </Link>
            <div className="text-xs text-muted">{[q.customer_phone, q.customer_email].filter(Boolean).join(' · ') || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">{tq.list.expires}</div>
            <div className={`font-mono text-sm ${expired ? 'text-warning' : 'text-foreground'}`}>{q.expires_on ?? '—'}</div>
            {q.spot_price_per_gram != null && q.spot_priced_at ? (
              <div className="mt-1 text-xs text-muted">
                {tq.detail.pricedAt
                  .replace('{price}', formatMoney(q.spot_price_per_gram))
                  .replace('{date}', shortDateTime(q.spot_priced_at))}
                {q.spot_metal_label ? ` · ${q.spot_metal_label}` : ''}
              </div>
            ) : null}
          </div>
        </div>
        {expired ? <p className="mt-3 text-sm text-warning">{tq.detail.expired}</p> : null}
        {q.repair_ticket_id ? (
          <p className="mt-3 text-sm">
            <span className="text-muted">{tq.detail.ticket}: </span>
            <Link href={`/repair/${q.repair_ticket_id}`} className="font-mono font-semibold text-blue hover:underline">
              {q.repair_ticket_number ?? q.repair_ticket_id}
            </Link>
          </p>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {editable ? (
          <Link href={`/repair/quotes/${q.id}/edit`} className={btn()}>
            <PencilSimple size={14} weight="bold" />
            {tq.edit}
          </Link>
        ) : null}
        {q.status === 'draft' && !expired ? (
          <button type="button" onClick={status('send')} disabled={pending} className={btn()}>
            <PaperPlaneTilt size={14} weight="bold" />
            {tq.actions.send}
          </button>
        ) : null}
        {editable && !expired ? (
          <button type="button" onClick={status('accept')} disabled={pending} className={btn('success')}>
            <CheckCircle size={14} weight="bold" />
            {tq.actions.accept}
          </button>
        ) : null}
        {q.status === 'accepted' && !q.repair_ticket_id ? (
          <button
            type="button"
            onClick={status('convert', tq.actions.confirmConvert)}
            disabled={pending}
            className={btn('primary')}
            title={tq.actions.convertHelp}
          >
            <Wrench size={14} weight="bold" />
            {tq.actions.convert}
          </button>
        ) : null}
        {editable ? (
          <button type="button" onClick={status('decline', tq.actions.confirmDecline)} disabled={pending} className={btn('warning')}>
            <XCircle size={14} weight="bold" />
            {tq.actions.decline}
          </button>
        ) : null}
        <button type="button" onClick={status('duplicate')} disabled={pending} className={btn()}>
          <CopySimple size={14} weight="bold" />
          {tq.duplicate}
        </button>
        {q.status !== 'voided' && q.status !== 'converted' ? (
          <button type="button" onClick={status('void', tq.actions.confirmVoid)} disabled={pending} className={btn('error')}>
            <Prohibit size={14} weight="bold" />
            {tq.actions.void}
          </button>
        ) : null}
      </div>
      {q.status === 'accepted' && !q.repair_ticket_id ? (
        <p className="text-xs text-muted">{tq.actions.convertHelp}</p>
      ) : null}

      {errText ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          {errText}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Summary */}
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{tq.detail.summary}</h2>
          </header>
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
            <Row label={tq.detail.total} value={formatMoney(q.price_total)} strong />
            <Row label={tq.detail.cost} value={formatMoney(q.cost_total)} />
            <Row label={tq.detail.keep} value={formatMoney(q.price_total - q.cost_total)} />
            <Row label={tq.detail.margin} value={`${Math.round(q.margin_pct * 100)}%`} />
            <Row label={tq.detail.depositDue} value={`${formatMoney(q.deposit_amount)} (${Math.round(q.deposit_pct * 100)}%)`} />
            <Row label={tq.detail.balance} value={formatMoney(q.balance_due)} />
            <Row
              label={tq.detail.payment}
              value={
                q.payment_method
                  ? ((t.pos.payment as unknown as Record<string, string>)[
                      `method${q.payment_method.charAt(0).toUpperCase()}${q.payment_method.slice(1)}`
                    ] ?? q.payment_method)
                  : '—'
              }
            />
          </dl>
          {q.notes_internal ? (
            <div className="border-t border-border px-4 py-3 text-sm">
              <div className="text-xs uppercase tracking-wide text-muted">{tq.detail.internalNotes}</div>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{q.notes_internal}</p>
            </div>
          ) : null}
        </section>

        {/* Lines */}
        <section className="rounded-xl border border-border bg-card lg:col-span-2">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{tq.detail.lines}</h2>
            <span className="text-xs text-muted">{showBreakdown ? tq.detail.breakdownOn : tq.detail.breakdownOff}</span>
          </header>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-semibold">{tq.list.piece}</th>
                <th className="px-2 py-2 text-right font-semibold">{tq.price.qty}</th>
                <th className="px-2 py-2 text-right font-semibold">{tq.detail.cost}</th>
                <th className="px-4 py-2 text-right font-semibold">{tq.detail.priceCol}</th>
              </tr>
            </thead>
            <tbody>
              {q.lines.map((l) => (
                <tr key={l.id} className="border-b border-border/60">
                  <td className="px-4 py-2 text-foreground">
                    {l.label}
                    {l.price_locked ? <span className="ml-2 text-[10px] uppercase text-muted">{tq.price.locked}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-muted">{l.quantity}</td>
                  <td className="px-2 py-2 text-right font-mono text-muted">{formatMoney(l.cost_total)}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{formatMoney(l.price_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Link */}
        <section className="rounded-xl border border-border bg-card lg:col-span-2">
          <header className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <LinkSimple size={16} weight="bold" />
              {tq.detail.link}
            </h2>
            <p className="mt-1 text-xs text-muted">{tq.detail.linkHelp}</p>
          </header>
          <div className="space-y-2 p-4">
            {currentLink ? (
              <>
                <input
                  readOnly
                  value={currentLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
                  aria-label={tq.detail.link}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(currentLink)
                        setNotice('copied')
                      } catch {
                        setNotice(null)
                      }
                    }}
                    className={btn()}
                  >
                    <Copy size={14} weight="bold" />
                    {notice === 'copied' ? tq.actions.copied : tq.actions.copyLink}
                  </button>
                  <a href={currentLink} target="_blank" rel="noopener noreferrer" className={btn()}>
                    <ArrowSquareOut size={14} weight="bold" />
                    {tq.actions.open}
                  </a>
                  <button
                    type="button"
                    onClick={() => run(quoteLinkAction, { op: 'send' }, () => setNotice('sent'))}
                    disabled={pending}
                    className={btn('primary')}
                  >
                    <ChatText size={14} weight="bold" />
                    {pending ? tq.actions.sending : notice === 'sent' ? tq.actions.sent : tq.actions.sendSms}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(tq.actions.confirmNewLink)) run(quoteLinkAction, { op: 'regenerate' }, (r) => setCurrentLink(r.link ?? null))
                    }}
                    disabled={pending}
                    className={btn()}
                  >
                    <LinkSimple size={14} weight="bold" />
                    {tq.actions.newLink}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(tq.actions.confirmRevoke)) run(quoteLinkAction, { op: 'revoke' }, () => setCurrentLink(null))
                    }}
                    disabled={pending}
                    className={btn('error')}
                  >
                    <LinkBreak size={14} weight="bold" />
                    {tq.actions.revoke}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">{tq.detail.revoked}</p>
                <button
                  type="button"
                  onClick={() => run(quoteLinkAction, { op: 'regenerate' }, (r) => setCurrentLink(r.link ?? null))}
                  disabled={pending}
                  className={btn('primary')}
                >
                  <LinkSimple size={14} weight="bold" />
                  {tq.actions.newLink}
                </button>
              </>
            )}
          </div>
        </section>

        {/* Photo */}
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{tq.detail.photo}</h2>
          </header>
          <div className="p-4">
            {photoUrl ? (
              // Signed URL (1h) from the private bucket.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="aspect-square w-full rounded-xl border border-border object-cover" />
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-mono text-foreground ${strong ? 'text-lg font-bold' : ''}`}>{value}</dd>
    </div>
  )
}

function btn(tone?: 'primary' | 'success' | 'warning' | 'error'): string {
  let cls = 'inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50'
  if (tone === 'primary') cls += ' border-gold bg-gold text-navy hover:bg-gold-2'
  else if (tone === 'success') cls += ' border-success/30 bg-success/5 text-success hover:bg-success/10'
  else if (tone === 'warning') cls += ' border-warning/30 bg-warning/5 text-warning hover:bg-warning/10'
  else if (tone === 'error') cls += ' border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
  else cls += ' border-border bg-card text-foreground hover:bg-background'
  return cls
}
