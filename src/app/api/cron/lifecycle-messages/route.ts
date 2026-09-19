/**
 * Cron — customer lifecycle messages (patches/0050): birthday greeting,
 * dormant win-back, post-forfeiture win-back, post-redemption thank-you.
 *
 * All four are marketing: disabled until the shop turns them on in
 * Settings → Communications, and they only reach customers with
 * marketing_opt_in = TRUE (re-checked at send time, 7-day frequency cap).
 * Idempotent via comm_automation_sends keys.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCron } from '@/lib/cron/auth'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import {
  loadAutomationConfigs,
  runLifecycleAutomations,
  type RunCounts,
} from '@/lib/comms/automation-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return new NextResponse('unauthorized', { status: 401 })

  const admin = createAdminClient()
  const { data: tenants } = await admin
    .from('tenants')
    .select('id, timezone')
    .eq('is_active', true)

  const total: RunCounts = { sent: 0, skipped: 0, failed: 0 }
  const errors: Array<{ tenantId: string; error: string }> = []

  for (const tenant of tenants ?? []) {
    try {
      const configs = await loadAutomationConfigs(admin, tenant.id)
      if (!configs.some((c) => c.group === 'lifecycle' && c.isEnabled)) continue
      const counts = await runLifecycleAutomations({
        admin,
        tenantId: tenant.id,
        configs,
        today: todayInTimezone(tenant.timezone),
      })
      total.sent += counts.sent
      total.skipped += counts.skipped
      total.failed += counts.failed
    } catch (err) {
      errors.push({
        tenantId: tenant.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ok: errors.length === 0, ...total, errors })
}
