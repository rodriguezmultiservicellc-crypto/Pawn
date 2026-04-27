import { resolvePortalCustomer } from '@/lib/portal/customer'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  REPAIR_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import RepairsList, { type PortalRepairView } from './content'
import type {
  RepairStatus,
  RepairTicketRow,
  ServiceType,
} from '@/types/database-aliases'

export const dynamic = 'force-dynamic'

/**
 * /portal/repairs — read-only status of the active client's repair tickets.
 * Photos surface only when status='ready' (and via signed URLs only).
 */
export default async function PortalRepairsPage() {
  const { tenantId, customerId } = await resolvePortalCustomer()
  const admin = createAdminClient()

  const { data: rows } = await admin
    .from('repair_tickets')
    .select(
      `id, ticket_number, service_type, title, status, promised_date,
       created_at, deposit_amount, paid_amount, quote_amount, balance_due,
       item_description, description, deleted_at,
       photos:repair_ticket_photos(id, kind, storage_path, deleted_at, created_at)`,
    )
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  type PhotoLite = {
    id: string
    kind: string
    storage_path: string | null
    deleted_at: string | null
    created_at: string
  }
  type TicketWithPhotos = RepairTicketRow & {
    photos?: PhotoLite[] | null
  }

  const tickets = (rows ?? []) as unknown as TicketWithPhotos[]

  const enriched: PortalRepairView[] = await Promise.all(
    tickets.map(async (tk) => {
      const status = tk.status as RepairStatus
      const showPhotos = status === 'ready' || status === 'picked_up'
      const photoRows = showPhotos
        ? (tk.photos ?? [])
            .filter((p) => !p.deleted_at)
            .filter(
              (p) =>
                p.kind === 'final' ||
                p.kind === 'in_progress' ||
                p.kind === 'reference',
            )
            .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        : []

      const photoUrls: string[] = (
        await Promise.all(
          photoRows.slice(0, 6).map(async (p) =>
            p.storage_path
              ? await getSignedUrl({
                  bucket: REPAIR_PHOTOS_BUCKET,
                  path: p.storage_path,
                  ttlSeconds: 3600,
                })
              : null,
          ),
        )
      ).filter((u): u is string => typeof u === 'string')

      return {
        id: tk.id,
        ticketNumber: tk.ticket_number ?? '',
        serviceType: tk.service_type as ServiceType,
        title: tk.title ?? null,
        itemDescription: tk.item_description ?? null,
        workNeeded: tk.description ?? null,
        status,
        promisedDate: tk.promised_date ?? null,
        createdAt: tk.created_at,
        depositPaid: tk.deposit_amount == null ? 0 : Number(tk.deposit_amount),
        totalDue:
          tk.quote_amount == null ? 0 : Number(tk.quote_amount),
        balanceDue:
          tk.balance_due == null ? 0 : Number(tk.balance_due),
        photoUrls,
      }
    }),
  )

  return <RepairsList tickets={enriched} />
}
