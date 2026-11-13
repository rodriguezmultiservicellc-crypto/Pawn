'use server'

/**
 * Scan lookups shared by every scan field (POS scan bar, inventory list,
 * transfers). Only async functions are exported from this file — a
 * 'use server' module that exports anything else breaks in production
 * (Progress items 447/448).
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { resolveScan, type ResolvedScan } from '@/lib/labels/resolve'

export async function resolveScanAction(raw: string): Promise<ResolvedScan> {
  const code = String(raw ?? '').slice(0, 80)
  const ctx = await getCtx()
  if (!ctx?.tenantId) return { kind: 'none', code }
  const { supabase } = await requireStaff(ctx.tenantId)
  return resolveScan(supabase, ctx.tenantId, code)
}
