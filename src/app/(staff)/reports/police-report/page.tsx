import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { shopReportRange } from '@/lib/reports/shop-range'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getPoliceReportRows, getVoidedAfterReport } from '@/lib/reports/police-report'
import { flattenComplianceRow } from '@/lib/compliance/police-report/formats/fl-leadsonline'
import { buildNcicBySlug } from '@/lib/compliance/ncic'
import type { PoliceReportFormat } from '@/types/database-aliases'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecretConfigured } from '@/lib/secrets/vault'
import { shopDateTime } from '@/lib/compliance/police-report/formats/fl-leadsonline-xml'
import { ticketKeyOf } from '@/lib/leadsonline/soap'
import PoliceReportContent from './content'
import type { LeadsOnlineTicketView } from './leadsonline-panel'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  from?: string
  to?: string
  format?: string
}>

const PREVIEW_MAX_FLATTENED_ROWS = 50

export default async function PoliceReportPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  // Dates in the shop's timezone (REVIEW-2026-11-11 finding 10).
  const range = await shopReportRange({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    from: params.from,
    to: params.to,
    defaultFromDays: -7,
    defaultToDays: 0,
  })
  const { from, to } = range

  // Resolve the active tenant's configured format. v1: only fl_leadsonline.
  const { data: tenantRow } = await ctx.supabase
    .from('tenants')
    .select('id, name, dba, police_report_format, timezone')
    .eq('id', ctx.tenantId)
    .maybeSingle()

  const format =
    (params.format as PoliceReportFormat | undefined) ??
    (tenantRow?.police_report_format as PoliceReportFormat | undefined) ??
    'fl_leadsonline'

  const scope = await resolveReportScope({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
  })

  const [result, voidedAfterReport] = await Promise.all([
    getPoliceReportRows({
      supabase: ctx.supabase,
      tenantIds: scope.tenantIds,
      range,
    }),
    getVoidedAfterReport({ supabase: ctx.supabase, tenantIds: scope.tenantIds }),
  ])

  const ncicBySlug = await buildNcicBySlug({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
  })

  // Build a flattened preview (one row per item, capped).
  const previewRows = result.rows.slice(0, 25).flatMap((r) =>
    flattenComplianceRow(r, { tenantStoreId: scope.storeId, ncicBySlug }),
  ).slice(0, PREVIEW_MAX_FLATTENED_ROWS)

  // Total flattened count (so the operator knows what to expect post-export).
  const totalFlattened = result.rows.reduce(
    (acc, r) =>
      acc + flattenComplianceRow(r, { tenantStoreId: scope.storeId, ncicBySlug }).length,
    0,
  )

  // LeadsOnline web service (patches/0123): this shop's tickets in the range
  // and the last time each went to the environment it is set up for. The
  // service client: leadsonline_submissions has no staff policy, and only
  // this shop's rows are read.
  const admin = createAdminClient()
  const [{ data: loSettings }, loPassword] = await Promise.all([
    admin
      .from('settings')
      .select('leadsonline_api_store_id, leadsonline_api_username, leadsonline_api_env')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    isSecretConfigured(ctx.tenantId, 'leadsonline_api_password'),
  ])
  const loEnv: 'sandbox' | 'production' = loSettings?.leadsonline_api_env === 'production' ? 'production' : 'sandbox'
  const loConfigured = !!loSettings?.leadsonline_api_store_id && !!loSettings.leadsonline_api_username && loPassword
  const timeZone = tenantRow?.timezone || 'America/New_York'
  const ownRows = result.rows.filter((r) => r.tenant_id === ctx.tenantId)
  type LastSend = { compliance_log_id: string; ok: boolean; error_code: number | null; error_response: string | null; created_at: string }
  let sends: LastSend[] = []
  if (ownRows.length > 0) {
    const { data } = await admin
      .from('leadsonline_submissions')
      .select('compliance_log_id, ok, error_code, error_response, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('environment', loEnv)
      .in('compliance_log_id', ownRows.map((r) => r.id))
      .order('created_at', { ascending: false })
    sends = data ?? []
  }
  const lastSend = new Map<string, LastSend>()
  for (const x of sends) if (!lastSend.has(x.compliance_log_id)) lastSend.set(x.compliance_log_id, x)
  const shopTime = (iso: string) => shopDateTime(iso, timeZone).replace('T', ' ').slice(0, 16)
  const loTickets: LeadsOnlineTicketView[] = ownRows.map((r) => {
    const c = (r.customer_snapshot ?? {}) as Record<string, unknown>
    const last = lastSend.get(r.id)
    return {
      id: r.id,
      ticketType: r.event_type === 'buy_outright' ? 'Buy' : 'Pawn',
      ticketNumber: ticketKeyOf(r, timeZone).ticketnumber,
      when: shopTime(r.occurred_at),
      customer: [c.first_name, c.last_name].filter((v) => typeof v === 'string' && v).join(' '),
      voided: r.event_type === 'pawn_intake' && !!result.voidRowBySource[r.source_id],
      last: last
        ? {
            ok: last.ok,
            at: shopTime(last.created_at),
            text: [last.error_code != null ? `${last.error_code}:` : '', last.error_response ?? ''].join(' ').trim(),
          }
        : null,
    }
  })
  const canSend = ctx.tenantRole === 'owner' || ctx.tenantRole === 'chain_admin' || ctx.tenantRole === 'manager'

  return (
    <PoliceReportContent
      leadsOnline={{ configured: loConfigured, canSend, env: loEnv, tickets: loTickets }}
      from={from}
      to={to}
      format={format}
      storeId={scope.storeId}
      previewRows={previewRows}
      complianceRowCount={result.rows.length}
      flattenedRowCount={totalFlattened}
      voidedAfterReport={voidedAfterReport}
      counts={{
        rows: result.totals?.rows ?? 0,
        pawn_intakes: result.totals?.pawn_intakes ?? 0,
        buy_outrights: result.totals?.buy_outrights ?? 0,
      }}
    />
  )
}
