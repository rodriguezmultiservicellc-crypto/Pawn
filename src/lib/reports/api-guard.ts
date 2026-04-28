/**
 * Common guard + scope resolver for the report API routes.
 *
 * Enforces staff role at the API layer (not just the page layer) — API
 * routes bypass the proxy, so a portal `client` user with a tenantId
 * could otherwise reach report endpoints and pull whatever RLS allowed.
 * Returns 401 if unauthenticated, 403 if not staff at the active tenant.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope, type ReportTenantScope } from './tenant-scope'
import { parseRange } from './http'
import type { ReportRange } from './types'

const STAFF_ROLES = new Set([
  'owner',
  'chain_admin',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'appraiser',
])

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
  if (!ctx.tenantRole || !STAFF_ROLES.has(ctx.tenantRole)) {
    return new Response('forbidden', { status: 403 })
  }

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
