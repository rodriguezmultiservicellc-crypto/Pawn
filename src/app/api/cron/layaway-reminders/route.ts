/**
 * Cron — layaway payment reminders.
 *
 * For every tenant with `has_retail = TRUE`, find layaways with status 'active'
 * whose first_payment_due is in {today − 1, today, today + 3} (i.e. 1 day past
 * due, due today, or 3 days out). 24h idempotency per (customer, kind, layaway).
 *
 * NOTE: layaways v1 only tracks first_payment_due + final_due_date, not a
 * full per-installment schedule. This cron uses first_payment_due as the
 * trigger column. When per-installment scheduling lands, this route
 * iterates over a layaway_payment_schedule child table.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchMessage } from '@/lib/comms/dispatch'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'
import type { MessageKind } from '@/types/database-aliases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TARGETS: Array<{ offset: number; kind: MessageKind }> = [
  { offset: 3, kind: 'layaway_payment_due' }, // first_payment_due = today + 3
  { offset: 0, kind: 'layaway_payment_due' }, // first_payment_due = today
  { offset: -1, kind: 'layaway_overdue' },    // first_payment_due = today - 1
]

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return new NextResponse('unauthorized', { status: 401 })

  const admin = createAdminClient()
  const today = todayDateString()

  const { data: tenants } = await admin
    .from('tenants')
    .select('id')
    .eq('has_retail', true)
    .eq('is_active', true)

  let queued = 0
  let skipped = 0
  let failed = 0

  for (const tenant of tenants ?? []) {
    for (const target of TARGETS) {
      const dueDate = addDaysIso(today, target.offset)

      const { data: rows } = await admin
        .from('layaways')
        .select('id, tenant_id, customer_id, layaway_number, first_payment_due, balance_remaining, status')
        .eq('tenant_id', tenant.id)
        .eq('status', 'active')
        .eq('first_payment_due', dueDate)
        .is('deleted_at', null)

      for (const lay of rows ?? []) {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
        const recent = await checkRecentSend({
          tenantId: lay.tenant_id,
          customerId: lay.customer_id,
          relatedLayawayId: lay.id,
          kind: target.kind,
          sinceIso: since,
        })
        if (recent) {
          skipped++
          continue
        }

        const res = await dispatchMessage({
          tenantId: lay.tenant_id,
          customerId: lay.customer_id,
          kind: target.kind,
          vars: {
            ticket_number: lay.layaway_number ?? '',
            due_date: lay.first_payment_due ?? '',
            amount: formatUsd(Number(lay.balance_remaining ?? 0)),
          },
          related: { layawayId: lay.id },
        })
        if (res.ok) queued++
        else failed++
      }
    }
  }

  return NextResponse.json({ ok: true, today, queued, skipped, failed })
}

function authorizeCron(req: NextRequest): boolean {
  // Authorization: Bearer ${CRON_SECRET} only. Vercel Cron sets this header
  // when CRON_SECRET is configured at the project level. The `x-vercel-cron`
  // header is NOT a security check — any external HTTP caller can set it.
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

async function checkRecentSend(args: {
  tenantId: string
  customerId: string
  relatedLayawayId: string
  kind: MessageKind
  sinceIso: string
}): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('message_log')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('customer_id', args.customerId)
    .eq('related_layaway_id', args.relatedLayawayId)
    .eq('kind', args.kind)
    .gte('created_at', args.sinceIso)
    .limit(1)
  return !!(data && data.length > 0)
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}
