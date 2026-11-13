import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { shopReportRange } from '@/lib/reports/shop-range'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getPoliceReportRows } from '@/lib/reports/police-report'
import { flattenComplianceRow } from '@/lib/compliance/police-report/formats/fl-leadsonline'
import { buildNcicBySlug } from '@/lib/compliance/ncic'
import type { PoliceReportFormat } from '@/types/database-aliases'
import PoliceReportContent from './content'

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
    .select('id, name, dba, police_report_format')
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

  const result = await getPoliceReportRows({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
    range,
  })

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

  return (
    <PoliceReportContent
      from={from}
      to={to}
      format={format}
      storeId={scope.storeId}
      previewRows={previewRows}
      complianceRowCount={result.rows.length}
      flattenedRowCount={totalFlattened}
      counts={{
        rows: result.totals?.rows ?? 0,
        pawn_intakes: result.totals?.pawn_intakes ?? 0,
        buy_outrights: result.totals?.buy_outrights ?? 0,
      }}
    />
  )
}
