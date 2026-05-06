'use client'

import { useState, useTransition } from 'react'
import { ArrowsClockwise, CaretDown, Check } from '@phosphor-icons/react'
import {
  setTenantPlanAction,
  syncStripePlansAction,
  type SyncStripePlansState,
} from './actions'
import {
  formatCents,
  statusTone,
  type SubscriptionPlan,
  type TenantBillingRow,
} from '@/lib/saas/types'

export default function BillingContent({
  rows,
  plans,
}: {
  rows: TenantBillingRow[]
  plans: SubscriptionPlan[]
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Billing</h1>
          <p className="text-sm text-muted">
            Per-tenant subscription state. The webhook keeps these rows in
            sync with Stripe; the manual &ldquo;Set plan&rdquo; controls below are an
            override for support cases.
          </p>
        </div>
        <SyncStripeButton plans={plans} />
      </header>

      <PlanSummary plans={plans} />

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Cycle</th>
              <th className="px-3 py-2">Trial / period ends</th>
              <th className="px-3 py-2">Last invoice</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  No tenants yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <BillingRow
                  key={r.tenant.id}
                  row={r}
                  plans={plans}
                  open={openId === r.tenant.id}
                  onToggle={() =>
                    setOpenId(openId === r.tenant.id ? null : r.tenant.id)
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function PlanSummary({ plans }: { plans: SubscriptionPlan[] }) {
  if (plans.length === 0) return null
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {plans.map((p) => (
        <article
          key={p.id}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">{p.name}</h2>
            <span className="rounded-full bg-background px-2 py-0.5 font-mono text-xs text-muted">
              {p.code}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">{p.description}</p>
          <p className="mt-3 font-mono text-2xl text-foreground">
            {formatCents(p.price_monthly_cents)}
            <span className="ml-1 text-xs text-muted">/ mo</span>
          </p>
          {p.price_yearly_cents != null ? (
            <p className="text-xs text-muted">
              {formatCents(p.price_yearly_cents)} / yr
            </p>
          ) : null}
          <dl className="mt-3 space-y-0.5 font-mono text-[10px] text-muted">
            <div className="flex justify-between">
              <dt>product</dt>
              <dd className={p.stripe_product_id ? 'text-foreground' : 'text-warning'}>
                {p.stripe_product_id ?? 'not synced'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>price/mo</dt>
              <dd
                className={
                  p.stripe_price_monthly_id ? 'text-foreground' : 'text-warning'
                }
              >
                {p.stripe_price_monthly_id ?? 'not synced'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>price/yr</dt>
              <dd
                className={
                  p.stripe_price_yearly_id ? 'text-foreground' : 'text-warning'
                }
              >
                {p.stripe_price_yearly_id ?? 'not synced'}
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </section>
  )
}

function SyncStripeButton({ plans }: { plans: SubscriptionPlan[] }) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<SyncStripePlansState>({})

  const allSynced =
    plans.length > 0 &&
    plans.every(
      (p) =>
        p.stripe_product_id &&
        p.stripe_price_monthly_id &&
        p.stripe_price_yearly_id,
    )

  const onClick = () => {
    setState({})
    startTransition(async () => {
      const res = await syncStripePlansAction({}, new FormData())
      setState(res)
    })
  }

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-background disabled:opacity-50"
        title="Idempotent fetch-or-create of Stripe products + prices for every plan."
      >
        <ArrowsClockwise
          size={14}
          weight="bold"
          className={pending ? 'animate-spin' : ''}
        />
        {pending
          ? 'Syncing…'
          : allSynced
            ? 'Re-sync Stripe'
            : 'Sync Stripe products'}
      </button>
      {state.error ? (
        <span className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs text-danger">
          {state.error}
        </span>
      ) : null}
      {state.report ? (
        <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
          <div className="font-semibold">
            Synced {state.report.plans.length} plan
            {state.report.plans.length === 1 ? '' : 's'}
          </div>
          <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
            {state.report.plans.map((p) => (
              <li key={p.code}>
                <span className="font-bold">{p.code}</span>: product{' '}
                {p.productAction} · monthly {p.monthlyAction} · yearly{' '}
                {p.yearlyAction}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function BillingRow({
  row,
  plans,
  open,
  onToggle,
}: {
  row: TenantBillingRow
  plans: SubscriptionPlan[]
  open: boolean
  onToggle: () => void
}) {
  const sub = row.subscription
  const status = sub?.status ?? null
  const tone = status ? statusTone(status) : 'muted'
  const toneClass =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : tone === 'error'
          ? 'bg-danger/10 text-danger'
          : 'bg-background text-muted'

  const periodEndsAt = sub?.trial_ends_at ?? sub?.current_period_end ?? null

  return (
    <>
      <tr className="hover:bg-background/40">
        <td className="px-3 py-2">
          <div className="font-medium text-foreground">{row.tenant.name}</div>
          <div className="font-mono text-xs text-muted">
            {row.tenant.id.slice(0, 8)} · {row.tenant.tenant_type ?? '—'}
          </div>
        </td>
        <td className="px-3 py-2">
          {row.plan ? (
            <span className="rounded-md bg-background px-2 py-0.5 text-xs">
              {row.plan.name}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="px-3 py-2">
          {status ? (
            <span
              className={`rounded-md px-2 py-0.5 text-xs uppercase tracking-wide ${toneClass}`}
            >
              {status.replace(/_/g, ' ')}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-muted">
          {sub?.billing_cycle ?? '—'}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-foreground">
          {periodEndsAt ? new Date(periodEndsAt).toLocaleDateString() : '—'}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-foreground">
          {sub?.last_invoice_amount_cents != null
            ? formatCents(sub.last_invoice_amount_cents)
            : '—'}
          {sub?.last_invoice_paid_at ? (
            <span className="ml-1 text-muted">
              · {new Date(sub.last_invoice_paid_at).toLocaleDateString()}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
          >
            {open ? 'Close' : 'Set plan'}
            <CaretDown
              size={12}
              weight="bold"
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} className="border-t border-border bg-background/30 p-4">
            <SetPlanForm
              tenantId={row.tenant.id}
              currentPlanId={row.plan?.id ?? null}
              currentStatus={sub?.status ?? 'trialing'}
              currentCycle={sub?.billing_cycle ?? 'monthly'}
              plans={plans}
              onDone={onToggle}
            />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function SetPlanForm({
  tenantId,
  currentPlanId,
  currentStatus,
  currentCycle,
  plans,
  onDone,
}: {
  tenantId: string
  currentPlanId: string | null
  currentStatus: string
  currentCycle: string
  plans: SubscriptionPlan[]
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<{ error?: string; ok?: boolean }>({})

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await setTenantPlanAction({}, formData)
      setState(result)
      if (result.ok) {
        setTimeout(onDone, 600)
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-5">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <Field label="Plan">
        <select
          name="plan_id"
          defaultValue={currentPlanId ?? plans[0]?.id ?? ''}
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          required
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status">
        <select
          name="status"
          defaultValue={currentStatus}
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
        >
          <option value="trialing">trialing</option>
          <option value="active">active</option>
          <option value="past_due">past_due</option>
          <option value="cancelled">cancelled</option>
          <option value="unpaid">unpaid</option>
          <option value="incomplete">incomplete</option>
          <option value="incomplete_expired">incomplete_expired</option>
        </select>
      </Field>
      <Field label="Cycle">
        <select
          name="billing_cycle"
          defaultValue={currentCycle}
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
        >
          <option value="monthly">monthly</option>
          <option value="yearly">yearly</option>
        </select>
      </Field>
      <Field label="Trial days (if trialing)">
        <input
          type="number"
          name="trial_days"
          min={0}
          max={365}
          defaultValue={14}
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm font-mono"
        />
      </Field>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Apply'}
        </button>
        {state.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check size={14} weight="bold" /> Saved
          </span>
        ) : null}
        {state.error ? (
          <span className="text-xs text-danger">{state.error}</span>
        ) : null}
      </div>
    </form>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  )
}
