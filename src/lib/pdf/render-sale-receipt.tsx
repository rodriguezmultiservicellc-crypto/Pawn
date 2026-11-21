/**
 * Server-side renderer for the bilingual sale receipt PDF.
 *
 * Data comes from loadSaleReceiptData (the same loader the Letter / Thermal
 * print pages use), so every receipt format prints the same numbers.
 *
 * Caller MUST gate with requireRoleInTenant() before invoking — admin
 * paths aren't used here, so RLS does the heavy lifting, but the route
 * handler still owns the gate (defense in depth + audit logging).
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { loadSaleReceiptData } from '@/lib/pos/receipt-data'
import { registerPdfFonts } from './fonts'
import SaleReceiptPDF from './SaleReceiptPDF'

export type RenderSaleReceiptResult = {
  buffer: Buffer
  saleNumber: string
}

export async function renderSaleReceiptPdf(args: {
  supabase: SupabaseClient<Database>
  saleId: string
  tenantId: string
}): Promise<RenderSaleReceiptResult> {
  const data = await loadSaleReceiptData(args)
  registerPdfFonts()
  const buffer = await renderToBuffer(<SaleReceiptPDF data={data} />)
  return { buffer, saleNumber: data.sale_number }
}
