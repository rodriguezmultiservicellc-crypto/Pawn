import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  CUSTOMER_DOCUMENTS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import CustomerDetail, { type CustomerDocumentItem } from './content'
import type {
  Language,
  RepairStatus,
  ServiceType,
} from '@/types/database-aliases'

type Params = Promise<{ id: string }>

export default async function CustomerDetailPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: customer } = await ctx.supabase
    .from('customers')
    .select(
      'id, tenant_id, first_name, last_name, middle_name, date_of_birth, photo_url, phone, phone_alt, email, address1, address2, city, state, zip, country, id_type, id_number, id_state, id_country, id_expiry, comm_preference, language, marketing_opt_in, height_inches, weight_lbs, sex, hair_color, eye_color, identifying_marks, place_of_employment, notes, tags, is_banned, banned_reason, banned_at, banned_by, created_at, updated_at',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) redirect('/customers')

  const photoSignedUrl = customer.photo_url
    ? await getSignedUrl({
        bucket: CUSTOMER_DOCUMENTS_BUCKET,
        path: customer.photo_url,
        ttlSeconds: 3600,
      })
    : null

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_repair')
    .eq('id', customer.tenant_id)
    .maybeSingle()
  const hasPawn = tenant?.has_pawn ?? false
  const hasRepair = tenant?.has_repair ?? false

  // Pull the customer's recent pawn loans (Phase 2). Only when has_pawn —
  // jewelry-only / repair-only shops never see this section.
  const { data: loanRows } = hasPawn
    ? await ctx.supabase
        .from('loans')
        .select(
          'id, ticket_number, principal, due_date, status, created_at',
        )
        .eq('customer_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: null }

  // Pull the customer's recent repair tickets (Phase 3). Only when has_repair.
  const { data: repairRows } = hasRepair
    ? await ctx.supabase
        .from('repair_tickets')
        .select(
          'id, ticket_number, service_type, title, promised_date, status, balance_due, created_at',
        )
        .eq('customer_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: null }

  const { data: docs } = await ctx.supabase
    .from('customer_documents')
    .select('id, kind, storage_path, mime_type, id_type, id_number, id_state, id_expiry, created_at')
    .eq('customer_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const documents: CustomerDocumentItem[] = await Promise.all(
    (docs ?? []).map(async (d) => ({
      id: d.id,
      kind: d.kind,
      mime_type: d.mime_type,
      id_type: d.id_type,
      id_number: d.id_number,
      id_state: d.id_state,
      id_expiry: d.id_expiry,
      created_at: d.created_at,
      signed_url: await getSignedUrl({
        bucket: CUSTOMER_DOCUMENTS_BUCKET,
        path: d.storage_path,
        ttlSeconds: 3600,
      }),
    })),
  )

  // The DB column `language` has a CHECK ('en','es') constraint but is
  // typed as plain string by Supabase's generator. Narrow it to Language.
  const customerNarrowed = {
    ...customer,
    language: (customer.language === 'es' ? 'es' : 'en') as Language,
  }

  return (
    <CustomerDetail
      customer={customerNarrowed}
      documents={documents}
      hasPawn={hasPawn}
      hasRepair={hasRepair}
      photoSignedUrl={photoSignedUrl}
      loans={(loanRows ?? []).map((l) => ({
        id: l.id,
        ticket_number: l.ticket_number ?? '',
        principal: Number(l.principal),
        due_date: l.due_date,
        status: l.status as
          | 'active'
          | 'extended'
          | 'partial_paid'
          | 'redeemed'
          | 'forfeited'
          | 'voided',
        created_at: l.created_at,
      }))}
      repairs={(repairRows ?? []).map((r) => ({
        id: r.id,
        ticket_number: r.ticket_number ?? '',
        service_type: r.service_type as ServiceType,
        title: r.title,
        promised_date: r.promised_date,
        status: r.status as RepairStatus,
        balance_due: r.balance_due == null ? null : Number(r.balance_due),
        created_at: r.created_at,
      }))}
    />
  )
}
