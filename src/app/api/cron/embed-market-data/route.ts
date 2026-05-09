/**
 * Cron — embed pending market_data_points rows.
 *
 * Calls embedPendingMarketData() which pulls up to 50 rows where
 * item_embedding IS NULL, batches them through OpenAI text-embedding-
 * 3-small, and writes the vectors back. Idempotent.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only — same pattern as
 *       all other cron routes in this app. The `x-vercel-cron` header
 *       is NOT a security check.
 *
 * Recommended cadence (vercel.json):
 *   - Every 15 min: `*\/15 * * * *`
 *   The backlog drains FIFO; if intake outpaces 50/15min the queue
 *   will grow but the next run picks it up. At ~1k pawns/day (a busy
 *   shop), 15min cadence keeps the queue near zero.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedPendingMarketData } from '@/lib/market-data/embed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const summary = await embedPendingMarketData()
  await logCronAudit(summary)

  const status = summary.failed > 0 && summary.embedded === 0 ? 502 : 200
  return NextResponse.json(summary, { status })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

/**
 * Audit-log the run. market_data_points is platform-wide (cross-tenant
 * by design), so we write the audit row with tenant_id=NULL.
 */
async function logCronAudit(summary: {
  scanned: number
  embedded: number
  failed: number
  errors: string[]
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('audit_log').insert({
      tenant_id: null,
      user_id: null,
      action: 'market_data_embed',
      table_name: 'market_data_points',
      record_id: null,
      changes: {
        scanned: summary.scanned,
        embedded: summary.embedded,
        failed: summary.failed,
        errors: summary.errors,
      },
    })
    if (error) {
      console.error('[cron:embed-market-data] audit insert failed', error.message)
    }
  } catch (err) {
    console.error('[cron:embed-market-data] audit unexpected error', err)
  }
}
