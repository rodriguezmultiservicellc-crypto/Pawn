import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { buildForm1099Report, FORM_1099_DEFAULT_THRESHOLD } from '@/lib/reports/form-1099'
import Form1099Content from './content'

/**
 * /staff/reports/1099 — year-end 1099-MISC helper.
 *
 * Identifies customers who hit the IRS reporting threshold ($600 by default)
 * via buy-outright payouts in a calendar year. Output is fed to the shop's
 * accountant; we don't generate the actual 1099-MISC PDF.
 *
 * Role-gated: owner / manager / chain_admin only. pawn_clerks / repair_techs
 * shouldn't see year-end totals.
 */

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ year?: string; threshold?: string }>

function parseYear(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return fallback
  return n
}

function parseThreshold(raw: string | undefined): number {
  if (!raw) return FORM_1099_DEFAULT_THRESHOLD
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return FORM_1099_DEFAULT_THRESHOLD
  return n
}

export default async function Form1099Page(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Role gate: pawn_clerks and repair_techs are excluded from 1099 totals.
  await requireRoleInTenant(ctx.tenantId, ['owner', 'manager', 'chain_admin'])

  const params = await props.searchParams
  const currentYear = new Date().getUTCFullYear()
  const taxYear = parseYear(params.year, currentYear)
  const threshold = parseThreshold(params.threshold)

  const report = await buildForm1099Report({
    tenantId: ctx.tenantId,
    taxYear,
    threshold,
  })

  return (
    <Form1099Content
      taxYear={taxYear}
      currentYear={currentYear}
      threshold={threshold}
      candidates={report.candidates}
      totalCandidatesAboveThreshold={report.totalCandidatesAboveThreshold}
      totalPaidAcrossAll={report.totalPaidAcrossAll}
    />
  )
}
