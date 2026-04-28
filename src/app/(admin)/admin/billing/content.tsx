'use client'

import { useState, useTransition } from 'react'
import { CaretDown, Check } from '@phosphor-icons/react'
import { setTenantPlanAction } from './actions'
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
          <h1 className="text-2xl font-bold text-ink">Billing</h1>
          <p className="text-sm text-ash">
            Per-tenant subscription state. Stripe integration is pending —
            until the platform webhook lands, plans are set manually here.
          </p>
        </div>
      </header>

      <PlanSummary plans={plans} />

      <section className="overflow-hidden rounded-lg border border-hairline bg-canvas">
        <table className="w-full text-sm">
          <thead className="border-b border-hairline bg-cloud text-left text-xs uppercase tracking-wide text-ash">
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
          <tbody className="divide-y divide-hairline">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ash">
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
          className="rounded-lg border border-hairline bg-canvas p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">{p.name}</h2>
            <span className="rounded-full bg-cloud px-2 py-0.5 font-mono text-xs text-ash">
              {p.code}
            </span>
          </div>
          <p className="mt-1 text-xs text-ash">{p.description}</p>
          <p className="mt-3 font-mono text-2xl text-ink">
            {formatCents(p.price_monthly_cents)}
            <span className="ml-1 text-xs text-ash">/ mo</span>
          </p>
          {p.price_yearly_cents != null ? (
            <p className="text-xs text-ash">
              {formatCents(p.price_yearly_cents)} / yr
            </p>
          ) : null}
        </article>
      ))}
    </section>
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
          ? 'bg-error/10 text-error'
          : 'bg-cloud text-ash'

  const periodEndsAt = sub?.trial_ends_at ?? sub?.current_period_end ?? null

  return (
    <>
      <tr className="hover:bg-cloud/40">
        <td className="px-3 py-2">
          <div className="font-medium text-ink">{row.tenant.name}</div>
          <div className="font-mono text-xs text-ash">
            {row.tenant.id.slice(0, 8)} · {row.tenant.tenant_type ?? '—'}
          </div>
        </td>
        <td className="px-3 py-2">
          {row.plan ? (
            <span className="rounded-md bg-cloud px-2 py-0.5 text-xs">
              {row.plan.name}
            </span>
          ) : (
            <span className="text-ash">—</span>
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
            <span className="text-ash">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-ash">
          {sub?.billing_cycle ?? '—'}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-ink">
          {periodEndsAt ? new Date(periodEndsAt).toLocaleDateString() : '—'}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-ink">
          {sub?.last_invoice_amount_cents != null
            ? formatCents(sub.last_invoice_amount_cents)
            : '—'}
          {sub?.last_invoice_paid_at ? (
            <span className="ml-1 text-ash">
              · {new Date(sub.last_invoice_paid_at).toLocaleDateString()}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-xs text-ink hover:bg-cloud"
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
          <td colSpan={7} className="border-t border-hairline bg-cloud/30 p-4">
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
          className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm"
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
          className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm"
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
          className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm"
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
          className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm font-mono"
        />
      </Field>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rausch px-3 py-1.5 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Apply'}
        </button>
        {state.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check size={14} weight="bold" /> Saved
          </span>
        ) : null}
        {state.error ? (
          <span className="text-xs text-error">{state.error}</span>
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
      <span className="text-xs uppercase tracking-wide text-ash">{label}</span>
      {children}
    </label>
  )
}
