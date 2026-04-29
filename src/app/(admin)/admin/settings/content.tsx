'use client'

import Link from 'next/link'
import {
  Buildings,
  CheckCircle,
  CreditCard,
  Database,
  Envelope,
  GitBranch,
  Lightning,
  Pulse,
  Wrench,
  XCircle,
} from '@phosphor-icons/react'

export type EnvVar = { name: string; required: boolean; set: boolean }
export type EnvGroup = { group: string; vars: EnvVar[] }

export type AdminStats = {
  tenantsTotal: number
  tenantsByType: { chain_hq: number; shop: number; standalone: number }
  moduleCounts: { pawn: number; repair: number; retail: number }
  activeSubscriptions: number
  plans: Array<{ code: string; name: string; monthly: number; yearly: number }>
  messagesLast24h: number
  auditEventsLast24h: number
}

export type VercelInfo = {
  commitSha: string | null
  commitMessage: string | null
  branch: string | null
  environment: string
  deployUrl: string | null
}

export default function SettingsContent({
  envPresence,
  stats,
  migrations,
  vercel,
  operatorEmail,
}: {
  envPresence: EnvGroup[]
  stats: AdminStats
  migrations: string[]
  vercel: VercelInfo
  operatorEmail: string | null
}) {
  const requiredMissing = envPresence.flatMap((g) =>
    g.vars.filter((v) => v.required && !v.set).map((v) => v.name),
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Platform settings</h1>
        <p className="mt-1 text-sm text-ash">
          Read-only platform health overview. Edit subscription plans on{' '}
          <Link href="/admin/billing" className="underline">
            /admin/billing
          </Link>
          , manage tenants on{' '}
          <Link href="/admin/tenants" className="underline">
            /admin/tenants
          </Link>
          .
        </p>
      </header>

      {requiredMissing.length > 0 ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-start gap-2">
            <XCircle size={18} weight="bold" className="mt-0.5 text-warning" />
            <div>
              <div className="font-semibold text-warning">
                {requiredMissing.length} required env var
                {requiredMissing.length === 1 ? '' : 's'} missing
              </div>
              <ul className="mt-1 text-xs font-mono text-ink">
                {requiredMissing.map((name) => (
                  <li key={name}>• {name}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ash">
                Set these in Vercel Project Settings → Environment Variables
                → Production. Some platform behaviors will silently no-op
                until they are configured.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          <CheckCircle size={16} weight="bold" />
          <span>All required env vars set.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Quick stats */}
        <Card title="Tenants" icon={<Buildings size={16} weight="regular" />}>
          <DefRow label="Total" value={stats.tenantsTotal.toString()} />
          <DefRow label="Chain HQ" value={stats.tenantsByType.chain_hq.toString()} />
          <DefRow label="Shops (under chain)" value={stats.tenantsByType.shop.toString()} />
          <DefRow label="Standalone" value={stats.tenantsByType.standalone.toString()} />
          <hr className="my-2 border-hairline" />
          <DefRow label="With pawn module" value={stats.moduleCounts.pawn.toString()} />
          <DefRow label="With repair module" value={stats.moduleCounts.repair.toString()} />
          <DefRow label="With retail module" value={stats.moduleCounts.retail.toString()} />
          <Link
            href="/admin/tenants"
            className="mt-2 inline-block text-xs text-rausch hover:text-rausch-deep"
          >
            Manage tenants →
          </Link>
        </Card>

        <Card title="Subscriptions" icon={<CreditCard size={16} weight="regular" />}>
          <DefRow
            label="Active or trialing"
            value={stats.activeSubscriptions.toString()}
          />
          <hr className="my-2 border-hairline" />
          {stats.plans.map((p) => (
            <DefRow
              key={p.code}
              label={p.name}
              value={`$${p.monthly}/mo · $${p.yearly}/yr`}
            />
          ))}
          <Link
            href="/admin/billing"
            className="mt-2 inline-block text-xs text-rausch hover:text-rausch-deep"
          >
            Open billing console →
          </Link>
        </Card>

        <Card title="Activity (last 24h)" icon={<Pulse size={16} weight="regular" />}>
          <DefRow
            label="Messages sent"
            value={stats.messagesLast24h.toString()}
          />
          <DefRow
            label="Audit events"
            value={stats.auditEventsLast24h.toString()}
          />
          <p className="mt-2 text-xs text-ash">
            Detailed audit log per tenant on the staff side at{' '}
            <span className="font-mono">/audit</span>.
          </p>
        </Card>

        <Card
          title="Build & deploy"
          icon={<GitBranch size={16} weight="regular" />}
        >
          <DefRow label="Environment" value={vercel.environment} />
          <DefRow label="Commit" value={vercel.commitSha ?? 'unknown'} mono />
          {vercel.commitMessage ? (
            <DefRow label="Subject" value={vercel.commitMessage} />
          ) : null}
          <DefRow label="Branch" value={vercel.branch ?? 'unknown'} mono />
          {vercel.deployUrl ? (
            <DefRow label="Deploy URL" value={vercel.deployUrl} mono />
          ) : null}
          <DefRow label="Operator" value={operatorEmail ?? '—'} />
        </Card>

        <Card
          title="Schema migrations"
          icon={<Database size={16} weight="regular" />}
          className="md:col-span-2"
        >
          <p className="text-xs text-ash">
            {migrations.length} migrations checked into{' '}
            <span className="font-mono">patches/</span>. All migrations in
            this list have been applied to the linked Supabase project.
          </p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-hairline p-2">
            {migrations.map((m) => (
              <li
                key={m}
                className="font-mono text-[11px] text-ink"
              >
                {m}
              </li>
            ))}
            {migrations.length === 0 ? (
              <li className="italic text-ash text-xs">No migrations found.</li>
            ) : null}
          </ul>
        </Card>

        <Card title="Quick links" icon={<Lightning size={16} weight="regular" />}>
          <ExtLink
            label="Vercel dashboard"
            href="https://vercel.com"
            hint="Deploys, env vars, domains"
          />
          <ExtLink
            label="Supabase dashboard"
            href="https://supabase.com/dashboard"
            hint="DB, Auth, Storage, RLS policies"
          />
          <ExtLink
            label="Stripe dashboard"
            href="https://dashboard.stripe.com"
            hint="SaaS subscriptions + per-tenant Connect"
          />
          <ExtLink
            label="Resend dashboard"
            href="https://resend.com/emails"
            hint="Platform email logs"
          />
        </Card>
      </div>

      {/* Env presence — full table */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">
          Environment variables
        </h2>
        <p className="mb-3 text-xs text-ash">
          Values are never displayed — only whether the variable is set.
          Required vars are flagged with a red badge if missing.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {envPresence.map((g) => (
            <div
              key={g.group}
              className="rounded-lg border border-hairline bg-canvas p-3"
            >
              <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-ink">
                <Envelope size={12} weight="regular" className="text-ash" />
                <span>{g.group}</span>
              </div>
              <ul className="space-y-1 text-[11px]">
                {g.vars.map((v) => (
                  <li
                    key={v.name}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-mono text-ink">
                      {v.name}
                    </span>
                    <EnvBadge varEntry={v} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Pre-flight reminders */}
      <section>
        <h2 className="mb-3 flex items-center gap-1 text-sm font-semibold text-ink">
          <Wrench size={14} weight="regular" />
          <span>Operator pre-flight reminders</span>
        </h2>
        <ul className="space-y-2 text-sm text-ink">
          <Reminder
            label="Stripe SaaS webhook configured?"
            help="dashboard.stripe.com → Webhooks → endpoint /api/stripe/saas/webhook → events: customer.subscription.{created,updated,deleted,trial_will_end} + invoice.{paid,payment_failed}"
          />
          <Reminder
            label='"Sync Stripe products" run on /admin/billing?'
            help="Provisions the 3 plans (basic / pro / chain) into the platform Stripe account so the checkout button works."
          />
          <Reminder
            label="CRON_SECRET set in Vercel?"
            help="Without it all 5 cron routes 401 silently. Vercel Cron sets the Authorization header automatically once it's configured at the project level."
          />
          <Reminder
            label="Per-tenant Stripe Connect onboarded?"
            help="Each tenant needs to OAuth into Stripe via /settings/integrations → Stripe. Until then portal payoff and comm cron silently no-op."
          />
        </ul>
      </section>
    </div>
  )
}

function Card({
  title,
  icon,
  children,
  className = '',
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-hairline bg-canvas p-4 ${className}`}
    >
      <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-ink">
        <span className="text-rausch">{icon}</span>
        <span>{title}</span>
      </h2>
      {children}
    </div>
  )
}

function DefRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-ash">{label}</span>
      <span className={`text-right text-ink ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function EnvBadge({ varEntry }: { varEntry: EnvVar }) {
  if (varEntry.set) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
        <CheckCircle size={10} weight="bold" />
        set
      </span>
    )
  }
  if (varEntry.required) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-error/10 px-1.5 py-0.5 text-[10px] font-medium text-error">
        <XCircle size={10} weight="bold" />
        required
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-cloud px-1.5 py-0.5 text-[10px] font-medium text-ash">
      not set
    </span>
  )
}

function ExtLink({
  label,
  href,
  hint,
}: {
  label: string
  href: string
  hint: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-md border border-hairline px-3 py-2 text-xs hover:border-ink"
    >
      <div className="font-medium text-ink">{label} ↗</div>
      <div className="text-ash">{hint}</div>
    </a>
  )
}

function Reminder({ label, help }: { label: string; help: string }) {
  return (
    <li className="rounded-md border border-hairline bg-canvas p-3">
      <div className="font-medium text-ink">{label}</div>
      <p className="mt-1 text-xs text-ash">{help}</p>
    </li>
  )
}
