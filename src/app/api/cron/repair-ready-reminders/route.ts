/**
 * Cron — repair "ready for pickup" reminders.
 *
 * For every tenant with `has_repair = TRUE`, find repair_tickets where:
 *   - status = 'ready'
 *   - last reminder (loan-scoped to this ticket via related_repair_ticket_id)
 *     is more than 24h ago, OR no reminder yet.
 *
 * On the first ready event we send `repair_ready` (kind). Subsequent
 * reminders use `repair_pickup_reminder`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchMessage } from '@/lib/comms/dispatch'
import type { MessageKind } from '@/types/database-aliases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return new NextResponse('unauthorized', { status: 401 })

  const admin = createAdminClient()

  const { data: tenants } = await admin
    .from('tenants')
    .select('id')
    .eq('has_repair', true)
    .eq('is_active', true)

  let queued = 0
  let skipped = 0
  let failed = 0

  for (const tenant of tenants ?? []) {
    const { data: tickets } = await admin
      .from('repair_tickets')
      .select('id, tenant_id, customer_id, ticket_number, status, balance_due, completed_at')
      .eq('tenant_id', tenant.id)
      .eq('status', 'ready')
      .is('deleted_at', null)

    for (const ticket of tickets ?? []) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

      const priorReady = await checkPriorSend({
        tenantId: ticket.tenant_id,
        customerId: ticket.customer_id,
        relatedRepairTicketId: ticket.id,
        kind: 'repair_ready',
      })
      const recentAny = await checkRecentSendAny({
        tenantId: ticket.tenant_id,
        customerId: ticket.customer_id,
        relatedRepairTicketId: ticket.id,
        sinceIso: since,
      })

      if (recentAny) {
        skipped++
        continue
      }

      const kind: MessageKind = priorReady ? 'repair_pickup_reminder' : 'repair_ready'

      const res = await dispatchMessage({
        tenantId: ticket.tenant_id,
        customerId: ticket.customer_id,
        kind,
        vars: {
          ticket_number: ticket.ticket_number ?? '',
          amount: formatUsd(Number(ticket.balance_due ?? 0)),
        },
        related: { repairTicketId: ticket.id },
      })
      if (res.ok) queued++
      else failed++
    }
  }

  return NextResponse.json({ ok: true, queued, skipped, failed })
}

function authorizeCron(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

async function checkPriorSend(args: {
  tenantId: string
  customerId: string
  relatedRepairTicketId: string
  kind: MessageKind
}): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await (admin as unknown as {
    from: (t: 'message_log') => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => {
            eq: (k: string, v: string) => {
              eq: (k: string, v: string) => {
                limit: (n: number) => Promise<{ data: { id: string }[] | null }>
              }
            }
          }
        }
      }
    }
  })
    .from('message_log')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('customer_id', args.customerId)
    .eq('related_repair_ticket_id', args.relatedRepairTicketId)
    .eq('kind', args.kind)
    .limit(1)
  return !!(data && data.length > 0)
}

async function checkRecentSendAny(args: {
  tenantId: string
  customerId: string
  relatedRepairTicketId: string
  sinceIso: string
}): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await (admin as unknown as {
    from: (t: 'message_log') => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => {
            eq: (k: string, v: string) => {
              gte: (k: string, v: string) => {
                limit: (n: number) => Promise<{ data: { id: string }[] | null }>
              }
            }
          }
        }
      }
    }
  })
    .from('message_log')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('customer_id', args.customerId)
    .eq('related_repair_ticket_id', args.relatedRepairTicketId)
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
