'use client'

import Link from 'next/link'
import {
  ChatCircleText,
  CreditCard,
  Percent,
  Plug,
  Coins,
  Wrench,
  CashRegister,
  CheckCircle,
  WarningCircle,
  Clock,
  ArrowRight,
  Buildings,
} from '@phosphor-icons/react'

export type SettingsHubView = {
  tenantId: string
  tenantName: string
  tenantType: string
  parentTenantId: string | null
  addressFilled: boolean
  contactFilled: boolean
  modules: { pawn: boolean; repair: boolean; retail: boolean }
  role: string | null
  integrations: {
    stripeConnect: { connected: boolean; billingEnabled: boolean }
    twilio: { connected: boolean }
    resend: { connected: boolean }
    ebay: { connected: boolean; environment: 'sandbox' | 'production' | null }
  }
  subscription: {
    planName: string | null
    status: string
    cycle: string
    trialEndsAt: string | null
    periodEndsAt: string | null
  } | null
  pawnDefaults: {
    interestRateMonthly: number
    termDays: number
    abandonedRepairDays: number
    buyHoldPeriodDays: number
  } | null
}

const OWNER_ROLES = new Set(['owner', 'chain_admin'])

export default function SettingsContent({ view }: { view: SettingsHubView }) {
  const integrationsConfigured = [
    view.integrations.stripeConnect.connected,
    view.integrations.twilio.connected,
    view.integrations.resend.connected,
    view.integrations.ebay.connected,
  ].filter(Boolean).length

  const enabledModules = [
    view.modules.pawn && 'Pawn',
    view.modules.repair && 'Repair',
    view.modules.retail && 'Retail',
  ].filter(Boolean) as string[]

  const isOwner = !!view.role && OWNER_ROLES.has(view.role)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        <p className="text-sm text-ash">
          Configure <span className="font-medium text-ink">{view.tenantName}</span>
          {view.tenantType !== 'standalone' ? (
            <span className="ml-1 rounded-full bg-cloud px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ash">
              {view.tenantType.replace('_', ' ')}
            </span>
          ) : null}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Card
          href="/settings/communications"
          icon={<ChatCircleText size={20} weight="regular" />}
          title="Communications"
          description="Twilio SMS / WhatsApp + Resend email — per-tenant credentials and templates for customer reminders."
          status={
            view.integrations.twilio.connected || view.integrations.resend.connected
              ? 'configured'
              : 'needs_setup'
          }
          statusDetail={(() => {
            const s = view.integrations
            const labels: string[] = []
            if (s.twilio.connected) labels.push('Twilio')
            if (s.resend.connected) labels.push('Resend')
            return labels.length ? labels.join(' · ') : 'No providers configured'
          })()}
        />

        <Card
          href="/settings/integrations"
          icon={<Plug size={20} weight="regular" />}
          title="Integrations"
          description="Stripe Connect, Twilio, Resend, eBay, and other connectable services."
          status={integrationsConfigured > 0 ? 'configured' : 'needs_setup'}
          statusDetail={`${integrationsConfigured} of 4 connected`}
        />

        {isOwner ? (
          <Card
            href="/billing"
            icon={<CreditCard size={20} weight="regular" />}
            title="Subscription & Billing"
            description="Your Pawn subscription plan, recent invoices, and payment method."
            status={
              view.subscription?.status === 'active' ||
              view.subscription?.status === 'trialing'
                ? 'configured'
                : 'needs_setup'
            }
            statusDetail={
              view.subscription
                ? `${view.subscription.planName ?? '—'} · ${view.subscription.status} · ${view.subscription.cycle}`
                : 'No subscription'
            }
          />
        ) : null}

        <Card
          href="/inventory/spot-prices"
          icon={<Coins size={20} weight="regular" />}
          title="Bullion spot prices"
          description="Per-tenant pay-rate multipliers on top of platform spot prices. Used by the melt-value panel."
          status="configured"
          statusDetail="Manage overrides"
        />

        {view.modules.pawn ? (
          <Card
            href="/settings/loan-rates"
            icon={<Percent size={20} weight="regular" />}
            title="Loan rates"
            description="Variable interest-rate menu shown on /pawn/new. One rate is marked default. Custom-rate fallback always available."
            status="configured"
            statusDetail="Manage rate menu"
          />
        ) : null}

        {isOwner ? (
          <Card
            href="/settings/general"
            icon={<Buildings size={20} weight="regular" />}
            title="Tenant info"
            description="Legal name, DBA, address, phone, email. Edits flow back into invoices, receipts, and customer comms."
            status={
              view.contactFilled && view.addressFilled
                ? 'configured'
                : 'partial'
            }
            statusDetail={[
              view.contactFilled ? 'contact ✓' : 'no contact',
              view.addressFilled ? 'address ✓' : 'no address',
            ].join(' · ')}
          />
        ) : (
          <SectionCard
            icon={<Buildings size={20} weight="regular" />}
            title="Tenant info"
            status={
              view.contactFilled && view.addressFilled
                ? 'configured'
                : 'partial'
            }
            statusDetail={[
              view.contactFilled ? 'contact ✓' : 'no contact',
              view.addressFilled ? 'address ✓' : 'no address',
            ].join(' · ')}
          >
            <p className="mt-2 text-xs text-ash">
              Tenant name, address, phone, modules. Owner-only edit at{' '}
              <span className="font-mono">/settings/general</span>.
            </p>
            <div className="mt-2 text-[11px] text-ash">
              Modules:{' '}
              {enabledModules.length ? enabledModules.join(' · ') : 'none'}
            </div>
          </SectionCard>
        )}

        {view.modules.pawn && view.pawnDefaults ? (
          <SectionCard
            icon={<Coins size={20} weight="regular" />}
            title="Pawn defaults"
            status="configured"
            statusDetail={`${(view.pawnDefaults.interestRateMonthly * 100).toFixed(2)}% / mo · ${view.pawnDefaults.termDays}d`}
          >
            <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <Stat
                label="Interest"
                value={`${(view.pawnDefaults.interestRateMonthly * 100).toFixed(2)}%/mo`}
              />
              <Stat
                label="Term"
                value={`${view.pawnDefaults.termDays} days`}
              />
              <Stat
                label="Buy hold"
                value={`${view.pawnDefaults.buyHoldPeriodDays} days`}
              />
              <Stat
                label="Repair abandon"
                value={`${view.pawnDefaults.abandonedRepairDays} days`}
              />
            </dl>
          </SectionCard>
        ) : null}

        <SectionCard
          icon={<Wrench size={20} weight="regular" />}
          title="Modules"
          status={enabledModules.length > 0 ? 'configured' : 'needs_setup'}
          statusDetail={`${enabledModules.length} of 3 enabled`}
        >
          <ul className="mt-2 space-y-1 text-[11px]">
            <ModuleLine
              icon={<Coins size={12} weight="bold" />}
              name="Pawn"
              enabled={view.modules.pawn}
            />
            <ModuleLine
              icon={<Wrench size={12} weight="bold" />}
              name="Repair"
              enabled={view.modules.repair}
            />
            <ModuleLine
              icon={<CashRegister size={12} weight="bold" />}
              name="Retail / POS"
              enabled={view.modules.retail}
            />
          </ul>
          <p className="mt-2 text-[11px] text-ash">
            Module flags are set when the tenant is provisioned. Toggle from
            the platform admin console.
          </p>
        </SectionCard>
      </section>
    </div>
  )
}

function Card({
  href,
  icon,
  title,
  description,
  status,
  statusDetail,
}: {
  href: string
  icon: React.ReactNode
  title: string
  description: string
  status: 'configured' | 'needs_setup' | 'partial'
  statusDetail: string
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-lg border border-hairline bg-canvas p-4 transition hover:border-ink/30 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-ink">{icon}</span>
        <StatusPill status={status} />
      </div>
      <h2 className="mt-3 flex items-center justify-between gap-1 text-sm font-semibold text-ink">
        {title}
        <ArrowRight
          size={14}
          weight="bold"
          className="text-ash transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
        />
      </h2>
      <p className="mt-1 flex-1 text-xs text-ash">{description}</p>
      <p className="mt-2 truncate text-[10px] font-mono text-ink/70">
        {statusDetail}
      </p>
    </Link>
  )
}

function SectionCard({
  icon,
  title,
  status,
  statusDetail,
  children,
}: {
  icon: React.ReactNode
  title: string
  status: 'configured' | 'needs_setup' | 'partial'
  statusDetail: string
  children: React.ReactNode
}) {
  return (
    <article className="flex flex-col rounded-lg border border-hairline bg-canvas p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-ink">{icon}</span>
        <StatusPill status={status} />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-[10px] font-mono text-ink/70">{statusDetail}</p>
      <div className="flex-1">{children}</div>
    </article>
  )
}

function StatusPill({
  status,
}: {
  status: 'configured' | 'needs_setup' | 'partial'
}) {
  if (status === 'configured') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
        <CheckCircle size={10} weight="bold" />
        Configured
      </span>
    )
  }
  if (status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
        <Clock size={10} weight="bold" />
        Partial
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-cloud px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ash">
      <WarningCircle size={10} weight="bold" />
      Needs setup
    </span>
  )
}

function ModuleLine({
  icon,
  name,
  enabled,
}: {
  icon: React.ReactNode
  name: string
  enabled: boolean
}) {
  return (
    <li
      className={`flex items-center gap-1.5 ${enabled ? 'text-ink' : 'text-ash/60'}`}
    >
      <span className={enabled ? 'text-success' : 'text-ash/40'}>{icon}</span>
      <span>{name}</span>
      <span className="ml-auto font-mono">
        {enabled ? 'on' : 'off'}
      </span>
    </li>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ash">{label}</dt>
      <dd className="font-mono text-ink">{value}</dd>
    </div>
  )
}

