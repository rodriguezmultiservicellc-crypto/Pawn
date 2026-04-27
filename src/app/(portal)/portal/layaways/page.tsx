import { resolvePortalCustomer } from '@/lib/portal/customer'
import { createAdminClient } from '@/lib/supabase/admin'
import LayawaysList, { type PortalLayawayView } from './content'
import type { LayawayRow, LayawayStatus } from '@/types/database-aliases'

export const dynamic = 'force-dynamic'

export default async function PortalLayawaysPage() {
  const { tenantId, customerId } = await resolvePortalCustomer()
  const admin = createAdminClient()

  const { data: rows } = await admin
    .from('layaways')
    .select(
      `id, layaway_number, status, total_due, paid_total, balance_remaining,
       schedule_kind, first_payment_due, final_due_date, created_at,
       deleted_at`,
    )
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const layaways: PortalLayawayView[] = (rows ?? []).map((l) => {
    const r = l as unknown as LayawayRow
    return {
      id: r.id,
      layawayNumber: r.layaway_number ?? '',
      status: r.status as LayawayStatus,
      totalDue: Number(r.total_due ?? 0),
      paidTotal: Number(r.paid_total ?? 0),
      balanceRemaining: Number(r.balance_remaining ?? 0),
      scheduleKind: (r.schedule_kind as PortalLayawayView['scheduleKind']) ?? 'monthly',
      firstPaymentDue: r.first_payment_due ?? null,
      finalDueDate: r.final_due_date ?? null,
      createdAt: r.created_at,
    }
  })

  return <LayawaysList layaways={layaways} />
}
