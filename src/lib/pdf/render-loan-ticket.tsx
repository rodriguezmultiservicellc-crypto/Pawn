/**
 * Server-side renderer for the bilingual pawn ticket PDF.
 *
 * Pure function: takes a loanId + tenantId + the user-scoped Supabase client
 * (so RLS + tenant scoping apply at the DB layer) and returns a Buffer that
 * the route handler streams back to the browser.
 *
 * Data resolution policy:
 *   - Loan, customer, collateral items, tenant: user-scoped client. RLS
 *     enforces tenant isolation. The route handler ALSO calls
 *     requireRoleInTenant() before invoking us — defense in depth.
 *   - Signature image: fetched as raw bytes via the admin client's signed
 *     URL. Storage RLS keys off the tenant_id folder; the admin client
 *     simplifies the byte fetch without setting up cookie-bound storage
 *     policies. The signature_path was already validated as belonging to
 *     this loan's tenant in step (1).
 *
 * Math: total interest at term + total payoff at term are computed from
 * principal + monthly rate + term_days using the existing pawn/math
 * helpers so the PDF matches the on-screen payoff calculator.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import {
  CUSTOMER_DOCUMENTS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import {
  dailyRateFromMonthly,
  interestAccrued,
  r4,
  todayDateString,
  toMoney,
} from '@/lib/pawn/math'
import { registerPdfFonts } from './fonts'
import PawnTicketPDF, {
  type PawnTicketCollateral,
  type PawnTicketCustomer,
  type PawnTicketData,
  type PawnTicketTenant,
} from './PawnTicketPDF'
import type {
  InventoryCategory,
  LoanStatus,
  MetalType,
} from '@/types/database-aliases'

export type RenderLoanTicketResult = {
  buffer: Buffer
  ticketNumber: string
}

/**
 * Resolve the full PawnTicketData for a loan from Supabase, then render
 * the PDF and return the bytes.
 *
 * Caller is responsible for gating: requireRoleInTenant() before invoking.
 */
export async function renderLoanTicketPdf(args: {
  supabase: SupabaseClient<Database>
  loanId: string
  tenantId: string
}): Promise<RenderLoanTicketResult> {
  const { supabase, loanId, tenantId } = args

  // ── 1. Loan + customer (single round-trip via embedded select)
  const { data: loan, error: loanErr } = await supabase
    .from('loans')
    .select(
      `id, tenant_id, customer_id, ticket_number, principal,
       interest_rate_monthly, term_days, issue_date, due_date, status,
       is_printed, signature_path, notes,
       customer:customers(
         id, first_name, last_name, middle_name, date_of_birth,
         address1, address2, city, state, zip,
         phone, email,
         id_type, id_number, id_state, id_expiry
       )`,
    )
    .eq('id', loanId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (loanErr) throw new Error(`loan_lookup_failed: ${loanErr.message}`)
  if (!loan) throw new Error('loan_not_found')

  // ── 2. Tenant
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, dba, address, city, state, zip, phone, email')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantErr) throw new Error(`tenant_lookup_failed: ${tenantErr.message}`)
  if (!tenant) throw new Error('tenant_not_found')

  // ── 3. Collateral items
  const { data: collateralRows } = await supabase
    .from('loan_collateral_items')
    .select(
      'description, category, metal_type, karat, weight_grams, est_value, photo_path, position',
    )
    .eq('loan_id', loanId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: true })

  const collateral: PawnTicketCollateral[] = (collateralRows ?? []).map(
    (c) => ({
      description: c.description,
      category: c.category as InventoryCategory,
      metal_type: (c.metal_type as MetalType | null) ?? null,
      karat: c.karat == null ? null : Number(c.karat),
      weight_grams: c.weight_grams == null ? null : Number(c.weight_grams),
      est_value: c.est_value == null ? 0 : Number(c.est_value),
      has_photo: Boolean(c.photo_path),
    }),
  )

  // ── 4. Signature image (best-effort — absence is OK)
  let signatureImage: string | null = null
  if (loan.signature_path) {
    signatureImage = await fetchSignatureAsDataUrl(loan.signature_path)
  }

  // ── 5. Build customer view
  const c = (
    loan as unknown as {
      customer: {
        first_name: string
        last_name: string
        middle_name: string | null
        date_of_birth: string | null
        address1: string | null
        address2: string | null
        city: string | null
        state: string | null
        zip: string | null
        phone: string | null
        email: string | null
        id_type: string | null
        id_number: string | null
        id_state: string | null
        id_expiry: string | null
      } | null
    }
  ).customer

  const fullName = c
    ? [c.first_name, c.middle_name, c.last_name]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join(' ')
    : '—'

  const customer: PawnTicketCustomer = {
    full_name: fullName,
    date_of_birth: c?.date_of_birth ?? null,
    address1: c?.address1 ?? null,
    address2: c?.address2 ?? null,
    city: c?.city ?? null,
    state: c?.state ?? null,
    zip: c?.zip ?? null,
    phone: c?.phone ?? null,
    email: c?.email ?? null,
    id_type: c?.id_type ?? null,
    id_number: c?.id_number ?? null,
    id_state: c?.id_state ?? null,
    id_expiry: c?.id_expiry ?? null,
  }

  const tenantView: PawnTicketTenant = {
    name: tenant.name,
    dba: tenant.dba,
    address: tenant.address,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    phone: tenant.phone,
    email: tenant.email,
  }

  // ── 6. Compute end-of-term interest + payoff
  const principal = toMoney(loan.principal)
  const monthlyRate = toMoney(loan.interest_rate_monthly)
  const termInterest = interestAccrued(principal, monthlyRate, loan.term_days)
  const totalPayoffAtTerm = r4(principal + termInterest)
  const dailyRate = dailyRateFromMonthly(monthlyRate)

  // ── 7. Assemble + render
  const data: PawnTicketData = {
    ticket_number: loan.ticket_number ?? '',
    status: loan.status as LoanStatus,
    is_printed: loan.is_printed,
    principal,
    interest_rate_monthly: monthlyRate,
    term_days: loan.term_days,
    issue_date: loan.issue_date,
    due_date: loan.due_date,
    total_interest_at_term: termInterest,
    total_payoff_at_term: totalPayoffAtTerm,
    daily_rate: dailyRate,
    notes: loan.notes ?? null,
    customer,
    tenant: tenantView,
    collateral,
    signatureImage,
    i18n: { en, es },
    printed_on: todayDateString(),
  }

  registerPdfFonts()
  const buffer = await renderToBuffer(<PawnTicketPDF data={data} />)
  return { buffer, ticketNumber: data.ticket_number }
}

/**
 * Fetch a Storage object as a data URL so React-PDF can embed it without
 * making its own network call. Uses the admin client (gated upstream by
 * requireRoleInTenant in the route handler) and a 60-second signed URL.
 *
 * Returns null on any failure — the renderer treats a missing signature
 * as "no signature on file" and prints a blank line.
 */
async function fetchSignatureAsDataUrl(
  signaturePath: string,
): Promise<string | null> {
  try {
    const url = await getSignedUrl({
      bucket: CUSTOMER_DOCUMENTS_BUCKET,
      path: signaturePath,
      ttlSeconds: 60,
    })
    if (!url) return null
    const res = await fetch(url)
    if (!res.ok) return null
    const contentType =
      res.headers.get('content-type') ?? guessMimeFromPath(signaturePath)
    const arrayBuffer = await res.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch (err) {
    console.error('[pdf.signature] fetch failed', err)
    return null
  }
}

function guessMimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}
