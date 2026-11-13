/**
 * Server side of report ranges: look up the shop's timezone, then build the
 * range in it (see range.ts). A chain HQ uses its own timezone for the
 * rollup.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { buildRange } from './range'
import type { ReportRange } from './types'

export async function shopReportRange(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  from?: string | null
  to?: string | null
  defaultFromDays?: number
  defaultToDays?: number
}): Promise<ReportRange> {
  const { timezone } = await loadTenantRules(args.supabase, args.tenantId)
  return buildRange({
    from: args.from,
    to: args.to,
    timezone,
    defaultFromDays: args.defaultFromDays,
    defaultToDays: args.defaultToDays,
  })
}
