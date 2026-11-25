/**
 * The pawnbroker transaction form for a PURCHASE (patches/0115): the same
 * form as a pawn ticket, "Purchase" checked, the amount paid where a pawn
 * prints its lending boxes (FL § 539.001(8)(b)7), no maturity, default date,
 * pawn-only statement or reverse. Customer and store copies; the Spanish
 * courtesy translation after them for a customer who reads Spanish (rule 6).
 *
 * Printed from the buy's compliance_log row — what the police were told,
 * frozen (rule 15) — so a reprint can never describe a different seller or
 * different pieces. Only the customer's language (which copies print) and a
 * second phone missing from an older snapshot come from the live record.
 *
 * Caller gates with requireRoleInTenant() first. Admin client, as the buy
 * receipt: compliance_log reads.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { r4 } from '@/lib/pawn/math'
import { registerPdfFonts } from './fonts'
import PawnTicketPDF, { type PawnTicketData } from './PawnTicketPDF'
import { num, purchaseItemFromSnapshot, str } from './purchase-items'

type Obj = Record<string, unknown>


export async function renderPurchaseTicketPdf(args: {
  admin: SupabaseClient<Database>
  /** The buy's first inventory item (the /buy/<id> anchor). */
  anchorItemId: string
  tenantId: string
  /** 'spanish' = only the stamped courtesy translation. */
  copies?: 'ticket' | 'spanish'
}): Promise<{ buffer: Buffer; ticketNumber: string }> {
  const { admin, anchorItemId, tenantId } = args

  const { data: row, error } = await admin
    .from('compliance_log')
    .select('reference_number, occurred_at, amount, customer_snapshot, items_snapshot')
    .eq('tenant_id', tenantId)
    .eq('source_table', 'inventory_items')
    .eq('source_id', anchorItemId)
    .eq('event_type', 'buy_outright')
    .maybeSingle()
  if (error) throw new Error(`compliance_lookup_failed: ${error.message}`)
  if (!row) throw new Error('buy_transaction_not_found')

  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .select('name, dba, address, city, state, zip, phone')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantErr) throw new Error(`tenant_lookup_failed: ${tenantErr.message}`)
  if (!tenant) throw new Error('tenant_not_found')

  const rules = await loadTenantRules(admin, tenantId)
  const c = (row.customer_snapshot ?? {}) as Obj
  const customerId = str(c.id)
  const { data: live } = customerId
    ? await admin
        .from('customers')
        .select('language, phone_alt')
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
    : { data: null }

  const items = (Array.isArray(row.items_snapshot) ? row.items_snapshot : []) as Obj[]
  const collateral = items
    .slice()
    .sort((a, b) => (num(a.position) ?? 0) - (num(b.position) ?? 0))
    .map(purchaseItemFromSnapshot)
  const paid = row.amount != null ? r4(Number(row.amount)) : r4(collateral.reduce((s, it) => s + it.est_value, 0))
  const when = new Date(row.occurred_at)

  const data: PawnTicketData = {
    transaction: 'purchase',
    ticket_number: row.reference_number ?? '',
    status: 'active',
    // A purchase's `principal` is the amount paid; the lending figures are
    // not printed.
    principal: paid,
    issue_date: todayInTimezone(rules.timezone, when),
    due_date: '',
    total_interest_at_term: 0,
    total_payoff_at_term: 0,
    apr: 0,
    transaction_time: when.toLocaleTimeString('en-US', {
      timeZone: rules.timezone,
      hour: 'numeric',
      minute: '2-digit',
    }),
    default_date: '',
    amount_at_default: 0,
    jurisdiction_name: rules.jurisdiction?.name ?? null,
    customer: {
      first_name: str(c.first_name) ?? '',
      last_name: str(c.last_name) ?? '',
      middle_name: str(c.middle_name),
      sex: str(c.sex),
      race: str(c.race),
      height_inches: num(c.height_inches),
      weight_lbs: num(c.weight_lbs),
      eye_color: str(c.eye_color),
      hair_color: str(c.hair_color),
      identifying_marks: str(c.identifying_marks),
      place_of_employment: str(c.place_of_employment),
      phone_alt: str(c.phone_alt) ?? live?.phone_alt ?? null,
      date_of_birth: str(c.date_of_birth),
      address1: str(c.address1),
      address2: str(c.address2),
      city: str(c.city),
      state: str(c.state),
      zip: str(c.zip),
      phone: str(c.phone),
      id_type: str(c.id_type),
      id_number: str(c.id_number),
      id_state: str(c.id_state),
    },
    tenant: {
      name: tenant.name,
      dba: tenant.dba,
      address: tenant.address,
      city: tenant.city,
      state: tenant.state,
      zip: tenant.zip,
      phone: tenant.phone,
    },
    collateral,
    signatureImage: null,
    i18n: { en, es },
    backpage_text: '',
    legal_notices: rules.jurisdiction?.ticket_notices ?? [],
    spanish_copy: live?.language === 'es',
    spanish_only: args.copies === 'spanish',
  }

  registerPdfFonts()
  const buffer = await renderToBuffer(<PawnTicketPDF data={data} />)
  return { buffer, ticketNumber: data.ticket_number }
}
