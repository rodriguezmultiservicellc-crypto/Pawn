'use client'

import Link from 'next/link'
import {
  Barcode,
  ShoppingBag,
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
  Tag,
  UploadSimple,
  Scales,
  Wallet,
  HandCoins,
  ListChecks,
  Sparkle,
  Lightning,
  Trophy,
  CalendarCheck,
  Bank,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { QUICK_SALE_EDIT_ROLES } from '@/lib/pos/quick-sale'
import { LAYAWAY_TERMS_EDIT_ROLES } from '@/lib/pos/layaway-terms'
import { SALES_TAX_EDIT_ROLES } from '@/lib/pos/sales-tax'
import { fractionToPercent } from '@/lib/format/money'

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
  legalRules: {
    jurisdictionName: string | null
    graceDays: number
    buyHoldDays: number
  }
  /** Total sales tax rate (fraction) — the sum of the shop's active tax_rates. */
  salesTax: { rate: number }
  loyalty: { enabled: boolean }
  storeCredit: { enabled: boolean }
  consignment: { enabled: boolean; defaultCommissionPct: number }
  /** Paired Stripe Terminal reader (patches/0086), or null. */
  cardReader: { label: string | null } | null
}

type CardStatus = 'configured' | 'needs_setup' | 'partial'

const OWNER_ROLES = new Set(['owner', 'chain_admin'])

export default function SettingsContent({ view }: { view: SettingsHubView }) {
  const { t } = useI18n()
  const h = t.settingsHub
  const integrationsConfigured = [
    view.integrations.stripeConnect.connected,
    view.integrations.twilio.connected,
    view.integrations.resend.connected,
    view.integrations.ebay.connected,
  ].filter(Boolean).length

  const enabledModules = [
    view.modules.pawn && h.modules.pawn,
    view.modules.repair && h.modules.repair,
    view.modules.retail && h.modules.retailShort,
  ].filter(Boolean) as string[]

  // Enum values from the DB; an unknown one falls back to its raw text.
  const tenantTypeLabel =
    (h.tenantTypes as Record<string, string>)[view.tenantType] ??
    view.tenantType.replace('_', ' ')
  const subscriptionDetail = view.subscription
    ? [
        view.subscription.planName ?? '—',
        (h.billing.statuses as Record<string, string>)[view.subscription.status] ??
          view.subscription.status,
        (h.billing.cycles as Record<string, string>)[view.subscription.cycle] ??
          view.subscription.cycle,
      ].join(' · ')
    : h.billing.noSubscription
  const tenantInfoDetail = [
    view.contactFilled ? h.tenantInfo.contactOk : h.tenantInfo.contactMissing,
    view.addressFilled ? h.tenantInfo.addressOk : h.tenantInfo.addressMissing,
  ].join(' · ')
  const tenantInfoStatus: CardStatus =
    view.contactFilled && view.addressFilled ? 'configured' : 'partial'
  const [configureBefore, configureAfter = ''] = h.configure.split('{name}')

  const isOwner = !!view.role && OWNER_ROLES.has(view.role)
  const canEditQuickSale =
    !!view.role && (QUICK_SALE_EDIT_ROLES as readonly string[]).includes(view.role)
  const canEditLayawayTerms =
    !!view.role && (LAYAWAY_TERMS_EDIT_ROLES as readonly string[]).includes(view.role)
  const canEditSalesTax =
    !!view.role && (SALES_TAX_EDIT_ROLES as readonly string[]).includes(view.role)
  const canImport =
    !!view.role && ['owner', 'manager', 'chain_admin'].includes(view.role)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-foreground">{h.title}</h1>
        <p className="text-sm text-muted">
          {configureBefore}
          <span className="font-medium text-foreground">{view.tenantName}</span>
          {configureAfter}
          {view.tenantType !== 'standalone' ? (
            <span className="ml-1 rounded-full bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
              {tenantTypeLabel}
            </span>
          ) : null}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Card
          href="/settings/communications"
          icon={<ChatCircleText size={20} weight="regular" />}
          title={h.communications.title}
          description={h.communications.description}
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
            return labels.length ? labels.join(' · ') : h.communications.noProviders
          })()}
        />

        <Card
          href="/settings/integrations"
          icon={<Plug size={20} weight="regular" />}
          title={h.integrations.title}
          description={h.integrations.description}
          status={integrationsConfigured > 0 ? 'configured' : 'needs_setup'}
          statusDetail={h.integrations.connectedCount
            .replace('{n}', String(integrationsConfigured))
            .replace('{total}', '4')}
        />

        {canImport ? (
          <Card
            href="/settings/import"
            icon={<UploadSimple size={20} weight="regular" />}
            title={h.dataImport.title}
            description={h.dataImport.description}
            status="configured"
            statusDetail={h.dataImport.detail}
          />
        ) : null}

        {isOwner ? (
          <Card
            href="/billing"
            icon={<CreditCard size={20} weight="regular" />}
            title={h.billing.title}
            description={h.billing.description}
            status={
              view.subscription?.status === 'active' ||
              view.subscription?.status === 'trialing'
                ? 'configured'
                : 'needs_setup'
            }
            statusDetail={subscriptionDetail}
          />
        ) : null}

        <Card
          href="/inventory/spot-prices"
          icon={<Coins size={20} weight="regular" />}
          title={h.spotPrices.title}
          description={h.spotPrices.description}
          status="configured"
          statusDetail={h.spotPrices.detail}
        />

        {view.modules.pawn ? (
          <Card
            href="/settings/loan-rates"
            icon={<Percent size={20} weight="regular" />}
            title={h.loanRates.title}
            description={h.loanRates.description}
            status="configured"
            statusDetail={h.loanRates.detail}
          />
        ) : null}

        {view.modules.pawn ? (
          <Card
            href="/settings/pawn-categories"
            icon={<Tag size={20} weight="regular" />}
            title={h.pawnCategories.title}
            description={h.pawnCategories.description}
            status="configured"
            statusDetail={h.pawnCategories.detail}
          />
        ) : null}

        {view.modules.repair ? (
          <Card
            href="/settings/repair-stages"
            icon={<ListChecks size={20} weight="regular" />}
            title={t.settingsRepairStages.hubTitle}
            description={t.settingsRepairStages.hubDescription}
            status="configured"
            statusDetail={t.settingsRepairStages.hubDetail}
          />
        ) : null}

        {view.modules.repair ? (
          <Card
            href="/settings/custom-quotes"
            icon={<Sparkle size={20} weight="regular" />}
            title={t.settingsCustomQuotes.hubTitle}
            description={t.settingsCustomQuotes.hubDescription}
            status="configured"
            statusDetail={t.settingsCustomQuotes.hubDetail}
          />
        ) : null}

        {view.modules.retail ? (
          <Card
            href="/settings/store"
            icon={<ShoppingBag size={20} weight="regular" />}
            title={t.storeSettings.title}
            description={t.storeSettings.hubDescription}
            status="configured"
            statusDetail={t.storeSettings.checkout}
          />
        ) : null}

        {view.modules.retail && canEditQuickSale ? (
          <Card
            href="/settings/quick-sale"
            icon={<Lightning size={20} weight="regular" />}
            title={t.quickSale.title}
            description={t.quickSale.hubDescription}
            status="configured"
            statusDetail={t.quickSale.label}
          />
        ) : null}

        {view.modules.retail && canEditSalesTax ? (
          <Card
            href="/settings/sales-tax"
            icon={<Bank size={20} weight="regular" />}
            title={t.salesTax.title}
            description={t.salesTax.hubDescription}
            status={view.salesTax.rate > 0 ? 'configured' : 'needs_setup'}
            statusDetail={
              view.salesTax.rate > 0
                ? t.salesTax.hubTotal.replace('{rate}', fractionToPercent(view.salesTax.rate))
                : t.salesTax.hubNone
            }
          />
        ) : null}

        {view.modules.retail && canEditLayawayTerms ? (
          <Card
            href="/settings/layaway-terms"
            icon={<CalendarCheck size={20} weight="regular" />}
            title={t.layawayTerms.title}
            description={t.layawayTerms.hubDescription}
            status="configured"
            statusDetail={t.layawayTerms.hubDetail}
          />
        ) : null}

        {view.modules.retail && canEditQuickSale ? (
          <Card
            href="/settings/card-reader"
            icon={<CreditCard size={20} weight="regular" />}
            title={t.cardReader.title}
            description={t.cardReader.hubDescription}
            status={view.cardReader ? 'configured' : 'needs_setup'}
            statusDetail={
              view.cardReader
                ? t.cardReader.hubPaired.replace('{label}', view.cardReader.label ?? '')
                : t.cardReader.hubNotPaired
            }
          />
        ) : null}

        <Card
          href="/settings/tags"
          icon={<Barcode size={20} weight="regular" />}
          title={t.tags.settings.hubTitle}
          description={t.tags.settings.hubDescription}
          status="configured"
          statusDetail={t.tags.settings.hubDetail}
        />

        {isOwner ? (
          <Card
            href="/settings/general"
            icon={<Buildings size={20} weight="regular" />}
            title={h.tenantInfo.title}
            description={h.tenantInfo.description}
            status={tenantInfoStatus}
            statusDetail={tenantInfoDetail}
          />
        ) : (
          <SectionCard
            icon={<Buildings size={20} weight="regular" />}
            title={h.tenantInfo.title}
            status={tenantInfoStatus}
            statusDetail={tenantInfoDetail}
          >
            <p className="mt-2 text-xs text-muted">{h.tenantInfo.readOnlyNote}</p>
            <div className="mt-2 text-[11px] text-muted">
              {h.tenantInfo.modulesLine.replace(
                '{list}',
                enabledModules.length
                  ? enabledModules.join(' · ')
                  : h.tenantInfo.noModules,
              )}
            </div>
          </SectionCard>
        )}

        <Card
          href="/settings/compliance"
          icon={<Scales size={20} weight="regular" />}
          title={t.jurisdiction.settings.title}
          description={t.jurisdiction.settings.cardDescription}
          status={view.legalRules.jurisdictionName ? 'configured' : 'needs_setup'}
          statusDetail={
            view.legalRules.jurisdictionName
              ? t.jurisdiction.settings.cardStatus
                  .replace('{name}', view.legalRules.jurisdictionName)
                  .replace('{grace}', String(view.legalRules.graceDays))
                  .replace('{hold}', String(view.legalRules.buyHoldDays))
              : t.jurisdiction.settings.jurisdictionNone
          }
        />

        {isOwner && (
          <Card
            href="/settings/loyalty"
            icon={<Trophy size={20} weight="regular" />}
            title={h.loyalty.title}
            description={h.loyalty.description}
            status={view.loyalty.enabled ? 'configured' : 'needs_setup'}
            statusDetail={
              view.loyalty.enabled ? h.loyalty.enabled : h.loyalty.disabled
            }
          />
        )}

        {isOwner && (
          <Card
            href="/settings/store-credit"
            icon={<Wallet size={20} weight="regular" />}
            title={t.storeCredit.settings.title}
            description={t.storeCredit.settings.subtitle}
            status={view.storeCredit.enabled ? 'configured' : 'needs_setup'}
            statusDetail={
              view.storeCredit.enabled
                ? t.storeCredit.settings.toggle
                : t.storeCredit.disabled
            }
          />
        )}

        {isOwner && (
          <Card
            href="/settings/consignment"
            icon={<HandCoins size={20} weight="regular" />}
            title={t.consignment.settings.title}
            description={t.consignment.settings.subtitle}
            status={view.consignment.enabled ? 'configured' : 'needs_setup'}
            statusDetail={
              view.consignment.enabled
                ? `${(view.consignment.defaultCommissionPct * 100).toFixed(0)}%`
                : t.consignment.disabled
            }
          />
        )}

        <SectionCard
          icon={<Wrench size={20} weight="regular" />}
          title={h.modules.title}
          status={enabledModules.length > 0 ? 'configured' : 'needs_setup'}
          statusDetail={h.modules.enabledCount
            .replace('{n}', String(enabledModules.length))
            .replace('{total}', '3')}
        >
          <ul className="mt-2 space-y-1 text-[11px]">
            <ModuleLine
              icon={<Coins size={12} weight="bold" />}
              name={h.modules.pawn}
              enabled={view.modules.pawn}
            />
            <ModuleLine
              icon={<Wrench size={12} weight="bold" />}
              name={h.modules.repair}
              enabled={view.modules.repair}
            />
            <ModuleLine
              icon={<CashRegister size={12} weight="bold" />}
              name={h.modules.retail}
              enabled={view.modules.retail}
            />
          </ul>
          <p className="mt-2 text-[11px] text-muted">{h.modules.note}</p>
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
  status: CardStatus
  statusDetail: string
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-border bg-card p-4 transition hover:bg-background hover:text-foreground/30 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-foreground">{icon}</span>
        <StatusPill status={status} />
      </div>
      <h2 className="mt-3 flex items-center justify-between gap-1 text-sm font-semibold text-foreground">
        {title}
        <ArrowRight
          size={14}
          weight="bold"
          className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </h2>
      <p className="mt-1 flex-1 text-xs text-muted">{description}</p>
      <p className="mt-2 truncate text-[10px] font-mono text-foreground/70">
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
  status: CardStatus
  statusDetail: string
  children: React.ReactNode
}) {
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-foreground">{icon}</span>
        <StatusPill status={status} />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-[10px] font-mono text-foreground/70">{statusDetail}</p>
      <div className="flex-1">{children}</div>
    </article>
  )
}

function StatusPill({ status }: { status: CardStatus }) {
  const { t } = useI18n()
  const labels = t.settingsHub.status
  if (status === 'configured') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
        <CheckCircle size={10} weight="bold" />
        {labels.configured}
      </span>
    )
  }
  if (status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
        <Clock size={10} weight="bold" />
        {labels.partial}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
      <WarningCircle size={10} weight="bold" />
      {labels.needsSetup}
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
  const { t } = useI18n()
  return (
    <li
      className={`flex items-center gap-1.5 ${enabled ? 'text-foreground' : 'text-muted/60'}`}
    >
      <span className={enabled ? 'text-success' : 'text-muted/40'}>{icon}</span>
      <span>{name}</span>
      <span className="ml-auto font-mono">
        {enabled ? t.settingsHub.modules.on : t.settingsHub.modules.off}
      </span>
    </li>
  )
}

