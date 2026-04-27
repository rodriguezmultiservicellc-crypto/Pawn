import { redirect } from 'next/navigation'
import { resolvePortalCustomer } from '@/lib/portal/customer'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripeLinkStatusBySessionId } from '@/lib/portal/stripe-payment-links'
import LayawayDetail, {
  type PortalLayawayDetailView,
  type PortalLayawayPaymentView,
} from './content'
import type {
  LayawayPaymentRow,
  LayawayRow,
  LayawayStatus,
  PaymentMethod,
} from '@/types/database-aliases'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>
type SearchParams = Promise<{
  session_id?: string
  cancelled?: string
}>

export default async function PortalLayawayDetailPage(props: {
  params: Params
  searchParams: SearchParams
}) {
  const { id } = await props.params
  const sp = await props.searchParams
  const { tenantId, customerId } = await resolvePortalCustomer()

  const admin = createAdminClient()

  const lookup = await admin
    .from('layaways')
    .select(
      `id, tenant_id, customer_id, layaway_number, status, total_due,
       paid_total, balance_remaining, schedule_kind, down_payment,
       first_payment_due, final_due_date, created_at, deleted_at,
       payments:layaway_payments(id, amount, payment_method, occurred_at,
         deleted_at)`,
    )
    .eq('id', id)
    .maybeSingle()

  if (lookup.error || !lookup.data) redirect('/portal/layaways')

  type LayawayWithPayments = LayawayRow & {
    payments?: Array<
      Pick<
        LayawayPaymentRow,
        'id' | 'amount' | 'payment_method' | 'occurred_at' | 'deleted_at'
      >
    > | null
  }
  const r = lookup.data as unknown as LayawayWithPayments

  if (r.deleted_at) redirect('/portal/layaways')
  if (r.tenant_id !== tenantId) redirect('/portal/layaways')
  if (r.customer_id !== customerId) redirect('/portal/layaways')

  const payments: PortalLayawayPaymentView[] = (r.payments ?? [])
    .filter((p) => !p.deleted_at)
    .map((p) => ({
      id: p.id,
      amount: Number(p.amount ?? 0),
      paymentMethod: p.payment_method as PaymentMethod | null,
      occurredAt: p.occurred_at,
    }))
    .sort((a, b) =>
      a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
    )

  let banner: 'success' | 'cancelled' | 'processing' | null = null
  if (sp.session_id) {
    const status = await getStripeLinkStatusBySessionId(sp.session_id)
    banner = status === 'paid' ? 'success' : 'processing'
  } else if (sp.cancelled) {
    banner = 'cancelled'
  }

  const view: PortalLayawayDetailView = {
    id: r.id,
    layawayNumber: r.layaway_number ?? '',
    status: r.status as LayawayStatus,
    totalDue: Number(r.total_due ?? 0),
    paidTotal: Number(r.paid_total ?? 0),
    balanceRemaining: Number(r.balance_remaining ?? 0),
    scheduleKind:
      (r.schedule_kind as PortalLayawayDetailView['scheduleKind']) ?? 'monthly',
    downPayment: Number(r.down_payment ?? 0),
    firstPaymentDue: r.first_payment_due ?? null,
    finalDueDate: r.final_due_date ?? null,
    createdAt: r.created_at,
  }

  const isClosed =
    view.status === 'completed' || view.status === 'cancelled'

  return (
    <LayawayDetail
      layaway={view}
      payments={payments}
      banner={banner}
      payEnabled={!isClosed && view.balanceRemaining > 0}
    />
  )
}
