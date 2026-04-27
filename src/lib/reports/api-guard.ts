/**
 * Common guard + scope resolver for the report API routes.
 *
 * Returns 401 if unauthenticated, 403 if no tenant role, plus the
 * resolved scope + range. Reports live behind staff access only —
 * pawn_clerks can run the daily register but the broader operational
 * reports are restricted to manager / owner / chain_admin upstream
 * (the page-level routes also redirect on insufficient role).
 *
 * Per-route note: this helper does NOT enforce role at the action
 * layer. The pages already redirect; the API endpoints rely on RLS
 * for read access AND require an authenticated session.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope, type ReportTenantScope } from './tenant-scope'
import { parseRange } from './http'
import type { ReportRange } from './types'

export type ReportApiCtx = {
  userId: string
  tenantId: string
  scope: ReportTenantScope
  range: ReportRange
  supabase: Awaited<ReturnType<typeof getCtx>> extends infer T
    ? T extends { supabase: infer S }
      ? S
      : never
    : never
}

export async function guardReportRequest(
  req: Request,
): Promise<ReportApiCtx | Response> {
  const ctx = await getCtx()
  if (!ctx) return new Response('unauthorized', { status: 401 })
  if (!ctx.tenantId) return new Response('no_tenant', { status: 403 })

  const url = new URL(req.url)
  const range = parseRange(url.searchParams)
  const scope = await resolveReportScope({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
  })

  return {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    scope,
    range,
    supabase: ctx.supabase,
  }
}
