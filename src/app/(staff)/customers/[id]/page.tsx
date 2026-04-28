import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  CUSTOMER_DOCUMENTS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import CustomerDetail, { type CustomerDocumentItem } from './content'
import type {
  LayawayStatus,
  Language,
  RepairStatus,
  SaleKind,
  SaleStatus,
  ServiceType,
} from '@/types/database-aliases'

const PORTAL_MANAGE_ROLES = new Set(['owner', 'chain_admin', 'manager'])

type Params = Promise<{ id: string }>

export default async function CustomerDetailPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: customer } = await ctx.supabase
    .from('customers')
    .select(
      'id, tenant_id, first_name, last_name, middle_name, date_of_birth, photo_url, phone, phone_alt, email, address1, address2, city, state, zip, country, id_type, id_number, id_state, id_country, id_expiry, comm_preference, language, marketing_opt_in, height_inches, weight_lbs, sex, hair_color, eye_color, identifying_marks, place_of_employment, notes, tags, is_banned, banned_reason, banned_at, banned_by, auth_user_id, created_at, updated_at',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) redirect('/customers')

  // Portal-invite status: most-recent invite + whether the customer has
  // a live client membership at this tenant. Both queries via admin
  // client because user_tenants/customer_portal_invites RLS would hide
  // the auth.users-linked rows from a non-member context for the
  // portal user.
  const admin = createAdminClient()
  const { data: lastInviteRow } = await admin
    .from('customer_portal_invites')
    .select('created_at, expires_at, consumed_at')
    .eq('customer_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      created_at: string
      expires_at: string
      consumed_at: string | null
    }>()

  let hasPortalAccess = false
  if (customer.auth_user_id) {
    const { data: membership } = await admin
      .from('user_tenants')
      .select('role, is_active')
      .eq('user_id', customer.auth_user_id)
      .eq('tenant_id', customer.tenant_id)
      .eq('role', 'client')
      .eq('is_active', true)
      .maybeSingle()
    hasPortalAccess = !!membership
  }

  const canManagePortal =
    !!ctx.tenantRole && PORTAL_MANAGE_ROLES.has(ctx.tenantRole)

  // Portal-login URL: prefer NEXT_PUBLIC_APP_URL when it doesn't point at
  // localhost, otherwise derive from the request headers (Vercel auto-
  // injects x-forwarded-*). Same heuristic the portal-invite action uses.
  const envUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  let baseUrl = envUrl && !envUrl.includes('localhost') ? envUrl : ''
  if (!baseUrl) {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
    const proto =
      h.get('x-forwarded-proto') ??
      (host.includes('localhost') ? 'http' : 'https')
    if (host) baseUrl = `${proto}://${host}`.replace(/\/$/, '')
  }
  if (!baseUrl) baseUrl = envUrl
  const portalLoginUrl = `${baseUrl}/portal/login`

  const photoSignedUrl = customer.photo_url
    ? await getSignedUrl({
        bucket: CUSTOMER_DOCUMENTS_BUCKET,
        path: customer.photo_url,
        ttlSeconds: 3600,
      })
    : null

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_repair, has_retail')
    .eq('id', customer.tenant_id)
    .maybeSingle()
  const hasPawn = tenant?.has_pawn ?? false
  const hasRepair = tenant?.has_repair ?? false
  const hasRetail = tenant?.has_retail ?? false

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

  // Pull the customer's recent sales (Phase 4). Only when has_retail. Excludes
  // voided sales — completed + open + return states only.
  const { data: saleRows } = hasRetail
    ? await ctx.supabase
        .from('sales')
        .select(
          'id, sale_number, sale_kind, status, total, completed_at, created_at',
        )
        .eq('customer_id', id)
        .is('deleted_at', null)
        .neq('status', 'voided')
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: null }

  const { data: layawayRows } = hasRetail
    ? await ctx.supabase
        .from('layaways')
        .select(
          'id, layaway_number, status, total_due, paid_total, balance_remaining, first_payment_due, created_at',
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
      hasRetail={hasRetail}
      photoSignedUrl={photoSignedUrl}
      portal={{
        hasPortalAccess,
        lastInvite: lastInviteRow
          ? {
              sentAt: lastInviteRow.created_at,
              expiresAt: lastInviteRow.expires_at,
              consumedAt: lastInviteRow.consumed_at,
            }
          : null,
        canManage: canManagePortal,
        portalLoginUrl,
      }}
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
      sales={(saleRows ?? []).map((s) => ({
        id: s.id,
        sale_number: s.sale_number ?? '',
        sale_kind: s.sale_kind as SaleKind,
        status: s.status as SaleStatus,
        total: Number(s.total),
        completed_at: s.completed_at,
        created_at: s.created_at,
      }))}
      layaways={(layawayRows ?? []).map((l) => ({
        id: l.id,
        layaway_number: l.layaway_number ?? '',
        status: l.status as LayawayStatus,
        total_due: Number(l.total_due),
        paid_total: Number(l.paid_total),
        balance_remaining: Number(l.balance_remaining),
        first_payment_due: l.first_payment_due,
        created_at: l.created_at,
      }))}
    />
  )
}
