/**
 * Server-side renderer for the bilingual repair ticket PDF. Caller MUST
 * gate with requireRoleInTenant() first (the API route does).
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { todayDateString } from '@/lib/pawn/math'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { trackingUrl } from '@/lib/repair/stages'
import { registerPdfFonts } from './fonts'
import RepairTicketPDF, { type RepairTicketPDFData } from './RepairTicketPDF'

export async function renderRepairTicketPdf(args: {
  admin: SupabaseClient<Database>
  ticketId: string
  tenantId: string
}): Promise<{ buffer: Buffer; ticketNumber: string }> {
  const { admin, ticketId, tenantId } = args

  const { data: t, error } = await admin
    .from('repair_tickets')
    .select(
      `id, ticket_number, created_at, promised_date, status, service_type, title, item_description,
       quote_amount, deposit_amount, paid_amount, balance_due, assigned_to, public_token,
       customer:customers(first_name, last_name, middle_name, phone, email)`,
    )
    .eq('id', ticketId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`ticket_lookup_failed: ${error.message}`)
  if (!t) throw new Error('ticket_not_found')

  const [{ data: tenant }, { data: lineItems }, { data: stones }, rules] = await Promise.all([
    admin
      .from('tenants')
      .select('name, dba, address, city, state, zip, phone, email')
      .eq('id', tenantId)
      .maybeSingle(),
    admin
      .from('repair_ticket_line_items')
      .select('title, work_needed, weight_grams')
      .eq('ticket_id', ticketId)
      .is('deleted_at', null)
      .order('line_index'),
    admin
      .from('repair_ticket_stones')
      .select('stone_index, stone_type, shape, size_mm, weight_carats, source')
      .eq('ticket_id', ticketId)
      .is('deleted_at', null)
      .order('stone_index'),
    loadTenantRules(admin, tenantId),
  ])
  if (!tenant) throw new Error('tenant_not_found')

  let technicianName: string | null = null
  if (t.assigned_to) {
    const { data: p } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', t.assigned_to)
      .maybeSingle()
    technicianName = p?.full_name?.trim() || p?.email || null
  }

  const c = (t as unknown as {
    customer: { first_name: string; last_name: string; middle_name: string | null; phone: string | null; email: string | null } | null
  }).customer

  const data: RepairTicketPDFData = {
    ticket_number: t.ticket_number ?? '',
    created_at: t.created_at,
    promised_date: t.promised_date,
    status: t.status,
    service_type: t.service_type,
    title: t.title,
    item_description: t.item_description,
    quote_amount: t.quote_amount == null ? null : Number(t.quote_amount),
    deposit_amount: Number(t.deposit_amount ?? 0),
    paid_amount: Number(t.paid_amount ?? 0),
    balance_due: t.balance_due == null ? null : Number(t.balance_due),
    technician_name: technicianName,
    customer: {
      full_name: c ? [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(' ') : '—',
      phone: c?.phone ?? null,
      email: c?.email ?? null,
    },
    tenant: {
      name: tenant.name,
      dba: tenant.dba,
      address: tenant.address,
      city: tenant.city,
      state: tenant.state,
      zip: tenant.zip,
      phone: tenant.phone,
      email: tenant.email,
    },
    line_items: (lineItems ?? []).map((li) => ({
      title: li.title,
      work_needed: li.work_needed,
      weight_grams: li.weight_grams == null ? null : Number(li.weight_grams),
    })),
    stones: (stones ?? []).map((st) => ({
      stone_index: st.stone_index,
      stone_type: st.stone_type,
      shape: st.shape,
      size_mm: st.size_mm == null ? null : Number(st.size_mm),
      weight_carats: st.weight_carats == null ? null : Number(st.weight_carats),
      source: st.source as 'customer_supplied' | 'shop_supplied',
    })),
    abandon_days: rules.jurisdiction?.repair_abandon_days ?? null,
    tracking_url: trackingUrl(t.public_token),
    i18n: { en, es },
    printed_on: todayDateString(),
  }

  registerPdfFonts()
  const buffer = await renderToBuffer(<RepairTicketPDF data={data} />)
  return { buffer, ticketNumber: data.ticket_number }
}
