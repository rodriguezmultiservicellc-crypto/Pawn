/**
 * Server-side renderer for the customer-facing custom quote PDF. Caller
 * MUST gate with requireRoleInTenant() first (the API route does). Costs
 * and margin are never passed to the component.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { todayDateString } from '@/lib/pawn/math'
import { loadQuoteDetail } from '@/lib/custom-quotes/load'
import { loadCustomQuoteSettings } from '@/lib/custom-quotes/settings'
import { registerPdfFonts } from './fonts'
import CustomQuotePDF, { type CustomQuotePDFData } from './CustomQuotePDF'

export async function renderCustomQuotePdf(args: {
  admin: SupabaseClient<Database>
  quoteId: string
  tenantId: string
}): Promise<{ buffer: Buffer; quoteNumber: string }> {
  const { admin, quoteId, tenantId } = args
  const today = todayDateString()
  const [q, settings, { data: tenant }] = await Promise.all([
    loadQuoteDetail({ client: admin, tenantId, quoteId, today }),
    loadCustomQuoteSettings(admin, tenantId),
    admin
      .from('tenants')
      .select('name, dba, address, city, state, zip, phone, email')
      .eq('id', tenantId)
      .maybeSingle(),
  ])
  if (!q) throw new Error('quote_not_found')
  if (!tenant) throw new Error('tenant_not_found')

  const data: CustomQuotePDFData = {
    quote_number: q.quote_number,
    created_at: q.created_at,
    expires_on: q.expires_on,
    status: q.effective_status,
    category: q.category,
    description: q.description,
    size: q.size,
    price_total: q.price_total,
    deposit_amount: q.deposit_amount,
    balance_due: q.balance_due,
    spot_priced_at: q.spot_priced_at,
    spot_price_per_gram: q.spot_price_per_gram,
    spot_metal_label: q.spot_metal_label,
    // "Last, First" in the staff view → "First Last" for the customer.
    customer_name: q.customer_name.includes(', ')
      ? q.customer_name.split(', ').reverse().join(' ')
      : q.customer_name,
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
    lines: settings.showCostBreakdown
      ? q.lines.map((l) => ({ label: l.label, quantity: l.quantity, price_total: l.price_total }))
      : [],
    i18n: { en, es },
    printed_on: today,
  }

  registerPdfFonts()
  const buffer = await renderToBuffer(<CustomQuotePDF data={data} />)
  return { buffer, quoteNumber: q.quote_number }
}
