'use client'

import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, ArrowSquareOut, CheckCircle, Warning } from '@phosphor-icons/react'
import {
  formatCents,
  isTrialing,
  planFeatures,
  planLimit,
  statusTone,
  trialDaysRemaining,
  type SubscriptionPlan,
  type TenantSubscription,
} from '@/lib/saas/types'
import type { Database } from '@/types/database'

type BillingInvoice = Database['public']['Tables']['billing_invoices']['Row']

export default function BillingContent({
  tenantId,
  tenantName,
  plans,
  subscription,
  currentPlan,
  invoices,
}: {
  tenantId: string
  tenantName: string
  plans: SubscriptionPlan[]
  subscription: TenantSubscription | null
  currentPlan: SubscriptionPlan | null
  invoices: BillingInvoice[]
}) {
  const params = useSearchParams()
  const showSuccess = params.get('session_id') !== null
  const showCancelled = params.get('cancelled') === '1'
  const showChanged = params.get('changed') === '1'

  const [cycle, setCycle] = useState<'monthly' | 'yearly'>(
    subscription?.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
  )

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-ink">Billing</h1>
        <p className="text-sm text-ash">
          Subscription plan and invoices for{' '}
          <span className="font-medium text-ink">{tenantName}</span>.
        </p>
      </header>

      {showSuccess ? (
        <Banner kind="success">
          Checkout completed — your plan will update once Stripe confirms the
          subscription (usually within a few seconds).
        </Banner>
      ) : null}
      {showCancelled ? (
        <Banner kind="warning">
          Checkout was cancelled. No charge was made.
        </Banner>
      ) : null}
      {showChanged ? (
        <Banner kind="success">
          Plan change submitted. Stripe will reflect the new plan within
          a few seconds. The pro-rated invoice (if any) will appear in
          your invoice history below.
        </Banner>
      ) : null}

      <CurrentPlanCard
        subscription={subscription}
        currentPlan={currentPlan}
        invoices={invoices}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">
            {currentPlan ? 'Change plan' : 'Choose a plan'}
          </h2>
          <CycleToggle value={cycle} onChange={setCycle} />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              cycle={cycle}
              isCurrent={p.id === currentPlan?.id}
              hasActiveSubscription={
                !!subscription?.stripe_subscription_id &&
                (subscription.status === 'active' ||
                  subscription.status === 'trialing' ||
                  subscription.status === 'past_due')
              }
              currentCycle={subscription?.billing_cycle ?? null}
              tenantId={tenantId}
            />
          ))}
        </div>
      </section>

      <InvoicesSection invoices={invoices} />
    </div>
  )
}

function Banner({
  kind,
  children,
}: {
  kind: 'success' | 'warning'
  children: React.ReactNode
}) {
  const cls =
    kind === 'success'
      ? 'border-success/30 bg-success/5 text-success'
      : 'border-warning/30 bg-warning/5 text-warning'
  const Icon = kind === 'success' ? CheckCircle : Warning
  return (
    <div
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${cls}`}
    >
      <Icon size={16} weight="bold" className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function CurrentPlanCard({
  subscription,
  currentPlan,
  invoices,
}: {
  subscription: TenantSubscription | null
  currentPlan: SubscriptionPlan | null
  invoices: BillingInvoice[]
}) {
  if (!subscription || !currentPlan) {
    return (
      <section className="rounded-lg border border-hairline bg-canvas p-5">
        <p className="text-sm text-ash">
          No subscription yet. Pick a plan below to start a Stripe Checkout.
        </p>
      </section>
    )
  }

  const tone = statusTone(subscription.status)
  const toneCls =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : tone === 'error'
          ? 'bg-error/10 text-error'
          : 'bg-cloud text-ash'

  const trialDays = isTrialing(subscription)
    ? trialDaysRemaining(subscription)
    : null

  const lastInvoice = invoices[0] ?? null

  return (
    <section className="rounded-lg border border-hairline bg-canvas p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-ink">{currentPlan.name}</h2>
        <span
          className={`rounded-md px-2 py-0.5 text-xs uppercase tracking-wide ${toneCls}`}
        >
          {subscription.status.replace(/_/g, ' ')}
        </span>
        <span className="rounded-full bg-cloud px-2 py-0.5 font-mono text-xs text-ash">
          {subscription.billing_cycle}
        </span>
      </div>

      <p className="mt-2 text-sm text-ash">{currentPlan.description}</p>

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Stat
          label="Price"
          value={
            subscription.billing_cycle === 'yearly'
              ? `${formatCents(currentPlan.price_yearly_cents)} / yr`
              : `${formatCents(currentPlan.price_monthly_cents)} / mo`
          }
        />
        {trialDays != null ? (
          <Stat
            label="Trial ends"
            value={`${trialDays} day${trialDays === 1 ? '' : 's'}`}
          />
        ) : subscription.current_period_end ? (
          <Stat
            label="Renews"
            value={new Date(
              subscription.current_period_end,
            ).toLocaleDateString()}
          />
        ) : null}
        {lastInvoice ? (
          <Stat
            label="Last invoice"
            value={`${formatCents(lastInvoice.amount_cents)}${
              lastInvoice.paid_at
                ? ` · ${new Date(lastInvoice.paid_at).toLocaleDateString()}`
                : ''
            }`}
          />
        ) : null}
        {subscription.cancel_at_period_end ? (
          <Stat label="Cancels" value="at period end" tone="warning" />
        ) : null}
      </dl>
    </section>
  )
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'warning'
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ash">{label}</dt>
      <dd
        className={`mt-0.5 font-mono text-sm ${
          tone === 'warning' ? 'text-warning' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

function CycleToggle({
  value,
  onChange,
}: {
  value: 'monthly' | 'yearly'
  onChange: (v: 'monthly' | 'yearly') => void
}) {
  return (
    <div className="inline-flex rounded-md border border-hairline bg-canvas p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={`rounded px-3 py-1 ${
          value === 'monthly'
            ? 'bg-ink text-canvas'
            : 'text-ash hover:text-ink'
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange('yearly')}
        className={`rounded px-3 py-1 ${
          value === 'yearly'
            ? 'bg-ink text-canvas'
            : 'text-ash hover:text-ink'
        }`}
      >
        Yearly
        <span className="ml-1 text-success/80">Save</span>
      </button>
    </div>
  )
}

function PlanCard({
  plan,
  cycle,
  isCurrent,
  hasActiveSubscription,
  currentCycle,
  tenantId,
}: {
  plan: SubscriptionPlan
  cycle: 'monthly' | 'yearly'
  isCurrent: boolean
  hasActiveSubscription: boolean
  currentCycle: 'monthly' | 'yearly' | null
  tenantId: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const priceCents =
    cycle === 'monthly' ? plan.price_monthly_cents : plan.price_yearly_cents
  const features = planFeatures(plan)
  const limits = ['max_locations', 'max_users', 'max_active_loans']

  // No-op: same plan + same cycle.
  const isExactMatch = isCurrent && currentCycle === cycle

  // Helper: same plan + different cycle → "Switch cycle" label.
  function cycleSwitchOnly(
    _plan: SubscriptionPlan,
    targetCycle: 'monthly' | 'yearly',
    cardIsCurrent: boolean,
  ): boolean {
    return cardIsCurrent && currentCycle !== null && currentCycle !== targetCycle
  }

  // Path branches:
  //   - Existing active sub + different plan/cycle → change-plan endpoint
  //     (mutates subscription, no Stripe redirect).
  //   - No active sub OR cancelled → checkout endpoint (Stripe redirect).
  const willChangeInPlace = hasActiveSubscription && !isExactMatch

  const onChoose = () => {
    setError(null)
    startTransition(async () => {
      try {
        if (willChangeInPlace) {
          const res = await fetch('/api/stripe/saas/change-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenant_id: tenantId,
              plan_code: plan.code,
              cycle,
            }),
          })
          const json = (await res.json()) as {
            ok?: boolean
            no_op?: boolean
            error?: string
          }
          if (!res.ok || !json.ok) {
            setError(json.error ?? `http_${res.status}`)
            return
          }
          window.location.href = '/billing?changed=1'
          return
        }

        const res = await fetch('/api/stripe/saas/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_id: tenantId,
            plan_code: plan.code,
            cycle,
            return_path: '/billing',
          }),
        })
        const json = (await res.json()) as { url?: string; error?: string }
        if (!res.ok || !json.url) {
          setError(json.error ?? `http_${res.status}`)
          return
        }
        window.location.href = json.url
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown'
        setError(msg)
      }
    })
  }

  const cardCls = isCurrent
    ? 'border-rausch/40 ring-2 ring-rausch/10'
    : 'border-hairline'

  return (
    <article
      className={`flex flex-col rounded-lg border bg-canvas p-4 ${cardCls}`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-ink">{plan.name}</h3>
        {isCurrent ? (
          <span className="rounded-full bg-rausch/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rausch">
            Current
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-ash">{plan.description}</p>
      <p className="mt-3 font-mono text-2xl text-ink">
        {priceCents == null ? (
          <span className="text-base text-ash">unavailable</span>
        ) : (
          <>
            {formatCents(priceCents)}
            <span className="ml-1 text-xs text-ash">
              / {cycle === 'monthly' ? 'mo' : 'yr'}
            </span>
          </>
        )}
      </p>

      {features.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-ink/80">
          {features.slice(0, 6).map((f) => (
            <li key={f} className="flex items-center gap-1.5">
              <Check size={12} weight="bold" className="text-success" />
              <span>{prettyFeature(f)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="mt-3 border-t border-hairline pt-3 text-[11px] text-ash space-y-0.5">
        {limits.map((k) => {
          const v = planLimit(plan, k)
          return (
            <li key={k} className="flex justify-between">
              <span>{prettyLimitLabel(k)}</span>
              <span className="font-mono text-ink">
                {v == null ? 'unlimited' : v}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-4">
        <button
          type="button"
          onClick={onChoose}
          disabled={pending || priceCents == null || isExactMatch}
          className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-rausch px-3 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
          title={
            isExactMatch
              ? 'You are already on this plan and cycle.'
              : undefined
          }
        >
          {pending
            ? willChangeInPlace
              ? 'Changing…'
              : 'Redirecting…'
            : isExactMatch
              ? 'Current plan'
              : willChangeInPlace
                ? cycleSwitchOnly(plan, cycle, isCurrent)
                  ? 'Switch cycle'
                  : 'Switch to this plan'
                : 'Choose'}
          {willChangeInPlace ? null : (
            <ArrowSquareOut size={12} weight="bold" />
          )}
        </button>
        {error ? (
          <p className="mt-1 text-xs text-error">{error}</p>
        ) : null}
      </div>
    </article>
  )
}

function InvoicesSection({ invoices }: { invoices: BillingInvoice[] }) {
  if (invoices.length === 0) {
    return null
  }
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-ink">Recent invoices</h2>
      <div className="overflow-hidden rounded-lg border border-hairline bg-canvas">
        <table className="w-full text-sm">
          <thead className="border-b border-hairline bg-cloud text-left text-xs uppercase tracking-wide text-ash">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2 text-right">Receipt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {invoices.map((inv) => {
              const tone =
                inv.status === 'paid'
                  ? 'bg-success/10 text-success'
                  : inv.status === 'open' || inv.status === 'draft'
                    ? 'bg-warning/10 text-warning'
                    : 'bg-error/10 text-error'
              const period =
                inv.period_start && inv.period_end
                  ? `${new Date(inv.period_start).toLocaleDateString()} – ${new Date(inv.period_end).toLocaleDateString()}`
                  : '—'
              return (
                <tr key={inv.id}>
                  <td className="px-3 py-2 font-mono text-xs text-ink">
                    {inv.paid_at
                      ? new Date(inv.paid_at).toLocaleDateString()
                      : new Date(inv.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink">
                    {formatCents(inv.amount_cents)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ash">
                    {period}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {inv.hosted_invoice_url ? (
                      <a
                        href={inv.hosted_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-ink hover:underline"
                      >
                        View <ArrowSquareOut size={11} weight="bold" />
                      </a>
                    ) : inv.invoice_pdf_url ? (
                      <a
                        href={inv.invoice_pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink hover:underline"
                      >
                        PDF
                      </a>
                    ) : (
                      <span className="text-ash">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const FEATURE_LABELS: Record<string, string> = {
  customers: 'Customer records',
  inventory: 'Inventory',
  pawn: 'Pawn loans',
  repair: 'Repair tickets',
  pos: 'Retail POS',
  reports: 'Reports',
  audit_log: 'Audit log',
  communications: 'SMS/WhatsApp/Email',
  customer_portal: 'Customer portal',
  appraisals: 'Appraisals',
  multi_shop: 'Multi-shop chain',
  chain_admin: 'Chain admin role',
  cross_shop_transfers: 'Cross-shop transfers',
  rollup_reporting: 'HQ rollup reporting',
}

function prettyFeature(code: string): string {
  return FEATURE_LABELS[code] ?? code.replace(/_/g, ' ')
}

const LIMIT_LABELS: Record<string, string> = {
  max_locations: 'Locations',
  max_users: 'Users',
  max_active_loans: 'Active loans',
}

function prettyLimitLabel(key: string): string {
  return LIMIT_LABELS[key] ?? key.replace(/_/g, ' ')
}
