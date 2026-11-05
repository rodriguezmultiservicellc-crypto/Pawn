'use client'

import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle,
  ChatCircleText,
  Coins,
  CreditCard,
  EnvelopeSimple,
  PaperPlaneTilt,
  Star,
  Storefront,
  WarningCircle,
  WhatsappLogo,
  Plug,
  Clock,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  CONNECT_PATHS,
  type ConnectRedirectFlag,
  type ConnectStatus,
} from '@/lib/stripe/connect-status'

export type IntegrationsView = {
  tenantId: string
  role: string | null
  hasRetail: boolean
  stripeConnect: {
    status: ConnectStatus
    /** Last 4 of the connected account id — never the full id. */
    accountIdSuffix: string | null
    connectedAt: string | null
    terminalLocationId: string | null
    chargesEnabled: boolean
    payoutsEnabled: boolean
    statusSyncedAt: string | null
    /** `?stripe=` flag set by the Connect routes on redirect back here. */
    flag: ConnectRedirectFlag | null
  }
  twilio: {
    connected: boolean
    accountSid: string | null
    smsFrom: string | null
    whatsappFrom: string | null
    messagingServiceSid: string | null
  }
  resend: {
    connected: boolean
    fromEmail: string | null
  }
  ebay: {
    connected: boolean
    ebayUserId: string | null
    environment: 'sandbox' | 'production' | null
    connectedAt: string | null
    disconnectedAt: string | null
  }
  googleReviews: {
    configured: boolean
    connected: boolean
    rating: number | null
    totalReviewCount: number | null
    lastError: string | null
  }
}

const OWNER_ROLES = new Set(['owner', 'chain_admin'])

export default function IntegrationsContent({
  view,
}: {
  view: IntegrationsView
}) {
  const { t } = useI18n()
  const isOwner = !!view.role && OWNER_ROLES.has(view.role)

  const sc = view.stripeConnect
  const stripeAction = (() => {
    switch (sc.status) {
      case 'connected':
        return {
          href: CONNECT_PATHS.dashboard,
          label: t.stripeConnect.action.openDashboard,
        }
      case 'onboarding_incomplete':
        return {
          href: CONNECT_PATHS.start,
          label: t.stripeConnect.action.continueOnboarding,
        }
      default:
        return { href: CONNECT_PATHS.start, label: t.stripeConnect.action.connect }
    }
  })()
  const stripePill: PillStatus =
    sc.status === 'connected'
      ? 'connected'
      : sc.status === 'onboarding_incomplete'
        ? 'incomplete'
        : 'disconnected'
  const bannerTone: 'ok' | 'warn' | 'error' | null = sc.flag
    ? sc.flag === 'connected'
      ? 'ok'
      : sc.flag === 'incomplete' || sc.flag === 'not_connected'
        ? 'warn'
        : 'error'
    : null

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Link href="/settings" className="hover:text-foreground">
            Settings
          </Link>
          <span>/</span>
          <span className="text-foreground">Integrations</span>
        </div>
        <h1 className="font-display mt-1 flex items-center gap-2 text-2xl font-bold text-foreground">
          <Plug size={22} weight="bold" />
          Integrations
        </h1>
        <p className="text-sm text-muted">
          Connect external services. Each integration uses per-tenant
          credentials — RMS never sees your secrets, and disconnecting one
          service has no effect on the others.
        </p>
      </header>

      {sc.flag && bannerTone ? (
        <div
          role="status"
          className={
            bannerTone === 'ok'
              ? 'rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-foreground'
              : bannerTone === 'warn'
                ? 'rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground'
                : 'rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-foreground'
          }
        >
          {t.stripeConnect.banner[sc.flag]}
        </div>
      ) : null}

      <section className="space-y-3">
        <Card
          icon={<CreditCard size={22} weight="regular" />}
          title={t.stripeConnect.title}
          tagline={t.stripeConnect.tagline}
          status={stripePill}
          statusLabel={t.stripeConnect.status[sc.status]}
          actionHref={stripeAction.href}
          actionLabel={stripeAction.label}
          actionExternal
          actionDisabled={!isOwner}
          actionDisabledReason={t.stripeConnect.ownerOnly}
        >
          <p className="mt-2 text-xs text-muted">
            {t.stripeConnect.help[sc.status]}
          </p>
          {sc.status !== 'not_connected' ? (
            <KvList
              rows={[
                {
                  k: t.stripeConnect.rows.account,
                  v: sc.accountIdSuffix
                    ? t.stripeConnect.rows.accountValue.replace(
                        '{suffix}',
                        sc.accountIdSuffix,
                      )
                    : '—',
                },
                {
                  k: t.stripeConnect.rows.connectedOn,
                  v: dateOnly(sc.connectedAt),
                },
                {
                  k: t.stripeConnect.rows.charges,
                  v: sc.chargesEnabled
                    ? t.stripeConnect.rows.enabled
                    : t.stripeConnect.rows.pending,
                  icon: sc.chargesEnabled ? (
                    <CheckCircle size={11} weight="bold" />
                  ) : (
                    <Clock size={11} weight="bold" />
                  ),
                },
                {
                  k: t.stripeConnect.rows.payouts,
                  v: sc.payoutsEnabled
                    ? t.stripeConnect.rows.enabled
                    : t.stripeConnect.rows.pending,
                  icon: sc.payoutsEnabled ? (
                    <CheckCircle size={11} weight="bold" />
                  ) : (
                    <Clock size={11} weight="bold" />
                  ),
                },
                {
                  k: t.stripeConnect.rows.terminalLocation,
                  v: sc.terminalLocationId
                    ? shortId(sc.terminalLocationId)
                    : t.stripeConnect.rows.notPaired,
                },
                {
                  k: t.stripeConnect.rows.lastChecked,
                  v: sc.statusSyncedAt
                    ? dateOnly(sc.statusSyncedAt)
                    : t.stripeConnect.rows.never,
                },
              ]}
            />
          ) : null}
        </Card>

        <Card
          icon={<ChatCircleText size={22} weight="regular" />}
          title="Twilio"
          tagline="SMS + WhatsApp customer reminders"
          status={view.twilio.connected ? 'connected' : 'disconnected'}
          actionHref="/settings/communications"
          actionLabel={view.twilio.connected ? 'Manage' : 'Configure'}
        >
          {view.twilio.connected ? (
            <KvList
              rows={[
                { k: 'Account SID', v: shortId(view.twilio.accountSid) },
                {
                  k: 'SMS from',
                  v: view.twilio.smsFrom ?? '—',
                  icon: <PaperPlaneTilt size={11} weight="bold" />,
                },
                {
                  k: 'WhatsApp from',
                  v: view.twilio.whatsappFrom ?? '—',
                  icon: <WhatsappLogo size={11} weight="bold" />,
                },
                {
                  k: 'Messaging service',
                  v: view.twilio.messagingServiceSid
                    ? shortId(view.twilio.messagingServiceSid)
                    : 'none',
                },
              ]}
            />
          ) : (
            <p className="mt-2 text-xs text-muted">
              Configure your Twilio account SID + auth token + sender numbers
              to enable SMS and WhatsApp reminder cron jobs.
            </p>
          )}
        </Card>

        <Card
          icon={<EnvelopeSimple size={22} weight="regular" />}
          title="Resend"
          tagline="Transactional email — pawn maturity, repair-ready, layaway"
          status={view.resend.connected ? 'connected' : 'disconnected'}
          actionHref="/settings/communications"
          actionLabel={view.resend.connected ? 'Manage' : 'Configure'}
        >
          {view.resend.connected ? (
            <KvList
              rows={[
                { k: 'From', v: view.resend.fromEmail ?? '—' },
                { k: 'API key', v: 'set' },
              ]}
            />
          ) : (
            <p className="mt-2 text-xs text-muted">
              Add a Resend API key + verified From address to enable email
              reminders.
            </p>
          )}
        </Card>

        {view.hasRetail ? (
          <Card
            icon={<Storefront size={22} weight="regular" />}
            title="eBay"
            tagline="Publish forfeited inventory to eBay listings"
            status={
              view.ebay.connected
                ? view.ebay.environment === 'production'
                  ? 'connected'
                  : 'sandbox'
                : 'disconnected'
            }
            actionHref="/settings/integrations/ebay"
            actionLabel={view.ebay.connected ? 'Manage' : 'Connect eBay'}
            actionDisabled={!isOwner && !view.ebay.connected}
            actionDisabledReason="Owner-only"
          >
            {view.ebay.connected ? (
              <KvList
                rows={[
                  { k: 'eBay user', v: view.ebay.ebayUserId ?? '—' },
                  { k: 'Environment', v: view.ebay.environment ?? '—' },
                  { k: 'Connected', v: dateOnly(view.ebay.connectedAt) },
                ]}
              />
            ) : (
              <p className="mt-2 text-xs text-muted">
                Listings are scaffolded but real publish requires production
                eBay developer approval. See the eBay setup page for the
                12-step go-live checklist.
              </p>
            )}
          </Card>
        ) : null}

        <Card
          icon={<Star size={22} weight="regular" />}
          title="Google Reviews"
          tagline="Show your Google rating and recent reviews on your public landing page"
          status={
            view.googleReviews.connected
              ? 'connected'
              : 'disconnected'
          }
          actionHref="/settings/integrations/google-reviews"
          actionLabel="Manage"
          actionDisabled={!isOwner}
          actionDisabledReason="Owner-only"
        >
          {view.googleReviews.connected ? (
            <KvList
              rows={[
                {
                  k: 'Rating',
                  v:
                    view.googleReviews.rating != null
                      ? `${view.googleReviews.rating.toFixed(1)} ★`
                      : '—',
                },
                {
                  k: 'Reviews',
                  v:
                    view.googleReviews.totalReviewCount != null
                      ? String(view.googleReviews.totalReviewCount)
                      : '—',
                },
              ]}
            />
          ) : view.googleReviews.configured && view.googleReviews.lastError ? (
            <p className="text-sm text-danger">
              Last sync failed: {view.googleReviews.lastError}
            </p>
          ) : (
            <p className="text-sm text-muted">Not connected</p>
          )}
        </Card>

        <Card
          icon={<Coins size={22} weight="regular" />}
          title="Bullion spot prices"
          tagline="Live gold / silver / platinum / palladium prices for melt-value math"
          status="available"
          actionHref="/inventory/spot-prices"
          actionLabel="Manage overrides"
        >
          <p className="mt-2 text-xs text-muted">
            Spot prices are pulled platform-wide on a cron — every tenant
            sees the same source-of-truth values. Configure your shop&apos;s
            pay-rate multiplier (e.g. 0.85 of spot) on the spot-prices
            page.
          </p>
        </Card>
      </section>
    </div>
  )
}

type PillStatus =
  | 'connected'
  | 'incomplete'
  | 'disconnected'
  | 'sandbox'
  | 'available'

function Card({
  icon,
  title,
  tagline,
  status,
  statusLabel,
  actionHref,
  actionLabel,
  actionExternal,
  actionDisabled,
  actionDisabledReason,
  children,
}: {
  icon: React.ReactNode
  title: string
  tagline: string
  status: PillStatus
  /** Override the pill text (i18n). Defaults to the English status word. */
  statusLabel?: string
  actionHref: string
  actionLabel: string
  /**
   * Render a plain anchor instead of <Link>. Required for route handlers
   * that 302 off-site (Stripe onboarding / dashboard) — a client-side
   * navigation would try to fetch an RSC payload from the redirect target.
   */
  actionExternal?: boolean
  actionDisabled?: boolean
  actionDisabledReason?: string
  children?: React.ReactNode
}) {
  const actionClass =
    'inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background'
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
              <p className="text-xs text-muted">{tagline}</p>
            </div>
            <StatusPill status={status} label={statusLabel} />
          </div>
          {children}
        </div>
        <div className="shrink-0">
          {actionDisabled ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted/70"
              title={actionDisabledReason ?? 'Disabled'}
            >
              {actionLabel}
            </span>
          ) : actionExternal ? (
            <a href={actionHref} className={actionClass}>
              {actionLabel}
              <ArrowRight size={11} weight="bold" />
            </a>
          ) : (
            <Link href={actionHref} className={actionClass}>
              {actionLabel}
              <ArrowRight size={11} weight="bold" />
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}

function StatusPill({
  status,
  label,
}: {
  status: PillStatus
  label?: string
}) {
  switch (status) {
    case 'connected':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
          <CheckCircle size={10} weight="bold" />
          {label ?? 'Connected'}
        </span>
      )
    case 'incomplete':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
          <Clock size={10} weight="bold" />
          {label ?? 'Incomplete'}
        </span>
      )
    case 'sandbox':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
          <CheckCircle size={10} weight="bold" />
          {label ?? 'Sandbox'}
        </span>
      )
    case 'available':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
          {label ?? 'Available'}
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
          <WarningCircle size={10} weight="bold" />
          {label ?? 'Disconnected'}
        </span>
      )
  }
}

function KvList({
  rows,
}: {
  rows: Array<{ k: string; v: string; icon?: React.ReactNode }>
}) {
  return (
    <dl className="mt-2 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <dt className="text-muted">{r.k}:</dt>
          <dd className="flex items-center gap-1 truncate font-mono text-foreground">
            {r.icon ? <span className="text-muted">{r.icon}</span> : null}
            <span className="truncate">{r.v}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

function shortId(id: string | null): string {
  if (!id) return '—'
  if (id.length <= 12) return id
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}

function dateOnly(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}
