import { redirect } from 'next/navigation'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import SettingsContent from './content'

/**
 * /admin/settings — superadmin platform-health hub.
 *
 * One-stop surface for the operator to confirm: which env vars are
 * configured, how many tenants exist, what the current platform Stripe
 * sync state looks like, which migrations have been applied, and
 * direct links to the external dashboards that drive the platform.
 *
 * Read-only. Editing happens on the dedicated subpages
 * (/admin/billing for plans, /admin/tenants for tenant lifecycle).
 */
export default async function AdminSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (ctx.globalRole !== 'superadmin') redirect('/no-tenant')

  // Env-var presence (NEVER include the actual values — just whether
  // they're set). The booleans are computed server-side and the page
  // renders only the redacted labels.
  const envPresence = checkEnvPresence()

  // Quick platform stats from the admin client (bypasses RLS — superadmin
  // is gated above, so the data exposure is acceptable).
  const admin = createAdminClient()
  // Server component, single render per request — Date.now() is safe.
  // eslint-disable-next-line react-hooks/purity
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [
    tenantsRes,
    activeSubsRes,
    plansRes,
    recentMessagesRes,
    recentAuditRes,
  ] = await Promise.all([
    admin
      .from('tenants')
      .select('id, tenant_type, has_pawn, has_repair, has_retail', {
        count: 'exact',
      })
      .is('deleted_at', null),
    admin
      .from('tenant_subscriptions')
      .select('id, status', { count: 'exact', head: true })
      .in('status', ['trialing', 'active']),
    admin
      .from('subscription_plans')
      .select(
        'id, code, name, price_monthly_cents, price_yearly_cents, sort_order',
      )
      .eq('is_active', true)
      .order('sort_order'),
    admin
      .from('message_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso),
    admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso),
  ])

  const tenantRows = tenantsRes.data ?? []
  const tenantsByType = {
    chain_hq: tenantRows.filter((t) => t.tenant_type === 'chain_hq').length,
    shop: tenantRows.filter((t) => t.tenant_type === 'shop').length,
    standalone: tenantRows.filter((t) => t.tenant_type === 'standalone').length,
  }
  const moduleCounts = {
    pawn: tenantRows.filter((t) => t.has_pawn).length,
    repair: tenantRows.filter((t) => t.has_repair).length,
    retail: tenantRows.filter((t) => t.has_retail).length,
  }

  // Migrations applied = list patches/*.sql alphabetically. Best-effort —
  // we don't track actually-applied state in the DB, but every migration
  // checked into the repo has been applied to this project (Eddy's
  // workflow). Filter out hidden / temporary files.
  let migrations: string[] = []
  try {
    migrations = readdirSync(resolve(process.cwd(), 'patches'))
      .filter((f) => /^\d{4}-.+\.sql$/.test(f))
      .sort()
  } catch {
    migrations = []
  }

  const vercelInfo = {
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    commitMessage:
      process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    environment: process.env.VERCEL_ENV ?? 'local',
    deployUrl: process.env.VERCEL_URL ?? null,
  }

  return (
    <SettingsContent
      envPresence={envPresence}
      stats={{
        tenantsTotal: tenantsRes.count ?? tenantRows.length,
        tenantsByType,
        moduleCounts,
        activeSubscriptions: activeSubsRes.count ?? 0,
        plans: (plansRes.data ?? []).map((p) => ({
          code: p.code,
          name: p.name,
          monthly: Math.round(p.price_monthly_cents ?? 0) / 100,
          yearly: Math.round(p.price_yearly_cents ?? 0) / 100,
        })),
        messagesLast24h: recentMessagesRes.count ?? 0,
        auditEventsLast24h: recentAuditRes.count ?? 0,
      }}
      migrations={migrations}
      vercel={vercelInfo}
      operatorEmail={ctx.email ?? null}
    />
  )
}

type EnvPresence = {
  group: string
  vars: Array<{ name: string; required: boolean; set: boolean }>
}

function checkEnvPresence(): EnvPresence[] {
  const has = (k: string) => Boolean(process.env[k]?.trim())
  return [
    {
      group: 'Supabase',
      vars: [
        { name: 'NEXT_PUBLIC_SUPABASE_URL', required: true, set: has('NEXT_PUBLIC_SUPABASE_URL') },
        { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', required: true, set: has('NEXT_PUBLIC_SUPABASE_ANON_KEY') },
        { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, set: has('SUPABASE_SERVICE_ROLE_KEY') },
        { name: 'DATABASE_URL', required: false, set: has('DATABASE_URL') },
        { name: 'SUPABASE_PROJECT_ID', required: false, set: has('SUPABASE_PROJECT_ID') },
        { name: 'SUPABASE_ACCESS_TOKEN', required: false, set: has('SUPABASE_ACCESS_TOKEN') },
      ],
    },
    {
      group: 'App URL',
      vars: [
        { name: 'NEXT_PUBLIC_APP_URL', required: true, set: has('NEXT_PUBLIC_APP_URL') },
        { name: 'NEXT_PUBLIC_BASE_DOMAIN', required: false, set: has('NEXT_PUBLIC_BASE_DOMAIN') },
      ],
    },
    {
      group: 'Anthropic',
      vars: [
        { name: 'ANTHROPIC_API_KEY', required: false, set: has('ANTHROPIC_API_KEY') },
      ],
    },
    {
      group: 'Stripe (platform — SaaS billing)',
      vars: [
        { name: 'STRIPE_SECRET_KEY', required: true, set: has('STRIPE_SECRET_KEY') },
        { name: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', required: true, set: has('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY') },
        { name: 'STRIPE_SAAS_WEBHOOK_SECRET', required: true, set: has('STRIPE_SAAS_WEBHOOK_SECRET') },
        { name: 'STRIPE_WEBHOOK_SECRET', required: false, set: has('STRIPE_WEBHOOK_SECRET') },
      ],
    },
    {
      group: 'Email (platform Resend)',
      vars: [
        { name: 'RESEND_API_KEY', required: true, set: has('RESEND_API_KEY') },
        { name: 'RESEND_PLATFORM_FROM_EMAIL', required: true, set: has('RESEND_PLATFORM_FROM_EMAIL') },
        { name: 'RESEND_PLATFORM_FROM_NAME', required: false, set: has('RESEND_PLATFORM_FROM_NAME') },
      ],
    },
    {
      group: 'Cron',
      vars: [
        { name: 'CRON_SECRET', required: true, set: has('CRON_SECRET') },
      ],
    },
    {
      group: 'eBay (Phase 10 Path B — stubbed)',
      vars: [
        { name: 'EBAY_CLIENT_ID', required: false, set: has('EBAY_CLIENT_ID') },
        { name: 'EBAY_CLIENT_SECRET', required: false, set: has('EBAY_CLIENT_SECRET') },
        { name: 'EBAY_RU_NAME', required: false, set: has('EBAY_RU_NAME') },
        { name: 'EBAY_ENV', required: false, set: has('EBAY_ENV') },
      ],
    },
  ]
}
