/**
 * Cron — LeadsOnline "No Transactions Day" (patches/0124).
 *
 * Every shop with its LeadsOnline login set up: each finished day (shop
 * time) since Sol Pawn's first accepted ticket in that environment with no
 * pawn and no buy is sent as a day with no transactions
 * (lib/leadsonline/no-transaction-days.ts). Runs after midnight in every US
 * timezone; a missed night is caught up (14 days).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { sendNoTransactionDays } from '@/lib/leadsonline/no-transaction-days'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!auth || !expected || auth !== `Bearer ${expected}`) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('settings')
    .select('tenant_id, tenants!inner(is_active)')
    .not('leadsonline_api_store_id', 'is', null)
    .not('leadsonline_api_username', 'is', null)
    .eq('tenants.is_active', true)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 })

  const summary: Array<{ tenant_id: string; env?: string; sent: number; failed: number; skipped?: string }> = []
  for (const { tenant_id } of rows ?? []) {
    try {
      const r = await sendNoTransactionDays(tenant_id)
      if (!r.ok) {
        summary.push({ tenant_id, sent: 0, failed: 0, skipped: r.error })
        continue
      }
      const sent = r.results.filter((x) => x.ok).length
      const failed = r.results.length - sent
      summary.push({ tenant_id, env: r.env, sent, failed })
      if (r.results.length > 0) {
        await logAudit({
          tenantId: tenant_id,
          userId: null,
          action: 'leadsonline_no_transaction_days',
          tableName: 'leadsonline_no_transaction_days',
          recordId: tenant_id,
          changes: { environment: r.env, days: r.results.map((x) => ({ day: x.day, ok: x.ok, code: x.errorCode })), via: 'cron' },
        })
      }
    } catch (err) {
      summary.push({ tenant_id, sent: 0, failed: 0, skipped: err instanceof Error ? err.message : 'failed' })
    }
  }
  return NextResponse.json({ ok: true, tenants: summary })
}
