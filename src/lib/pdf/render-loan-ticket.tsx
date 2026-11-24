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
  interestAccrued,
  payoffBalance,
  r4,
  toMoney,
} from '@/lib/pawn/math'
import { registerPdfFonts } from './fonts'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { chargeModelOf, loanForfeitEligibility } from '@/lib/jurisdictions/rules'
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
  /** Add (true) or leave out (false) the Spanish courtesy copy regardless
   *  of the customer's language. Default: the customer's language decides. */
  spanishCopy?: boolean
  /** 'spanish' = only the stamped Spanish courtesy translation. Default:
   *  the full ticket. */
  copies?: 'ticket' | 'spanish'
}): Promise<RenderLoanTicketResult> {
  const { supabase, loanId, tenantId } = args

  // ── 1. Loan + customer (single round-trip via embedded select)
  const { data: loan, error: loanErr } = await supabase
    .from('loans')
    .select(
      `id, tenant_id, customer_id, ticket_number, principal,
       interest_rate_monthly, min_monthly_charge, term_days, issue_date,
       due_date, status, signature_path, created_at,
       customer:customers(
         id, first_name, last_name, middle_name, date_of_birth,
         address1, address2, city, state, zip,
         phone, phone_alt,
         id_type, id_number, id_state,
         sex, race, height_inches, weight_lbs, eye_color, hair_color,
         identifying_marks, place_of_employment, language
       )`,
    )
    .eq('id', loanId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (loanErr) throw new Error(`loan_lookup_failed: ${loanErr.message}`)
  if (!loan) throw new Error('loan_not_found')

  // ── 2. Tenant + per-tenant backpage override (single round-trip pair)
  const [tenantRes, settingsRes] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, dba, address, city, state, zip, phone')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('settings')
      .select('pawn_ticket_backpage')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  const { data: tenant, error: tenantErr } = tenantRes
  if (tenantErr) throw new Error(`tenant_lookup_failed: ${tenantErr.message}`)
  if (!tenant) throw new Error('tenant_not_found')

  // Reverse side: tenant override, else the jurisdiction's statutory text
  // (patches/0048), else none.
  const rules = await loadTenantRules(supabase, tenantId)
  const backpageOverride = settingsRes.data?.pawn_ticket_backpage ?? null
  const backpageText =
    backpageOverride && backpageOverride.trim()
      ? backpageOverride
      : rules.jurisdiction?.ticket_backpage ?? ''

  // ── 3. Collateral items
  const { data: collateralRows } = await supabase
    .from('loan_collateral_items')
    .select(
      `description, category, metal_type, karat, weight_grams, est_value,
       position, jewelry_size, color, gemstone_description,
       unique_marks, firearm_make, firearm_model, firearm_caliber,
       firearm_serial_number, firearm_type, firearm_barrel_length_inches,
       firearm_action_type, firearm_capacity, firearm_finish,
       firearm_number_of_barrels, electronic_brand, electronic_model,
       electronic_serial, tool_brand, tool_model,
       jewelry_gender, jewelry_style, jewelry_brand, jewelry_model, jewelry_serial,
       tool_serial, general_brand, general_model, general_serial, item_size`,
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
      jewelry_size: c.jewelry_size,
      color: c.color,
      gemstone_description: c.gemstone_description,
      jewelry_gender: c.jewelry_gender,
      jewelry_style: c.jewelry_style,
      jewelry_brand: c.jewelry_brand,
      jewelry_model: c.jewelry_model,
      jewelry_serial: c.jewelry_serial,
      unique_marks: c.unique_marks,
      firearm_make: c.firearm_make,
      firearm_model: c.firearm_model,
      firearm_caliber: c.firearm_caliber,
      firearm_serial_number: c.firearm_serial_number,
      firearm_type: c.firearm_type,
      firearm_barrel_length_inches:
        c.firearm_barrel_length_inches == null
          ? null
          : Number(c.firearm_barrel_length_inches),
      firearm_action_type: c.firearm_action_type,
      firearm_capacity:
        c.firearm_capacity == null ? null : Number(c.firearm_capacity),
      firearm_finish: c.firearm_finish,
      firearm_number_of_barrels:
        c.firearm_number_of_barrels == null
          ? null
          : Number(c.firearm_number_of_barrels),
      electronic_brand: c.electronic_brand,
      electronic_model: c.electronic_model,
      electronic_serial: c.electronic_serial,
      tool_serial: c.tool_serial,
      general_brand: c.general_brand,
      general_model: c.general_model,
      general_serial: c.general_serial,
      item_size: c.item_size,
      tool_brand: c.tool_brand,
      tool_model: c.tool_model,
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
        id_type: string | null
        id_number: string | null
        id_state: string | null
        phone_alt: string | null
        sex: string | null
        race: string | null
        height_inches: number | null
        weight_lbs: number | null
        eye_color: string | null
        hair_color: string | null
        identifying_marks: string | null
        place_of_employment: string | null
        language: string | null
      } | null
    }
  ).customer


  const customer: PawnTicketCustomer = {
    first_name: c?.first_name ?? '',
    last_name: c?.last_name ?? '',
    middle_name: c?.middle_name ?? null,
    sex: c?.sex ?? null,
    race: c?.race ?? null,
    height_inches: c?.height_inches ?? null,
    weight_lbs: c?.weight_lbs ?? null,
    eye_color: c?.eye_color ?? null,
    hair_color: c?.hair_color ?? null,
    identifying_marks: c?.identifying_marks ?? null,
    place_of_employment: c?.place_of_employment ?? null,
    phone_alt: c?.phone_alt ?? null,
    date_of_birth: c?.date_of_birth ?? null,
    address1: c?.address1 ?? null,
    address2: c?.address2 ?? null,
    city: c?.city ?? null,
    state: c?.state ?? null,
    zip: c?.zip ?? null,
    phone: c?.phone ?? null,
    id_type: c?.id_type ?? null,
    id_number: c?.id_number ?? null,
    id_state: c?.id_state ?? null,
  }

  const tenantView: PawnTicketTenant = {
    name: tenant.name,
    dba: tenant.dba,
    address: tenant.address,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    phone: tenant.phone,
  }

  // ── 6. Compute end-of-term interest + payoff
  const principal = toMoney(loan.principal)
  const monthlyRate = toMoney(loan.interest_rate_monthly)
  const minMonthlyCharge =
    loan.min_monthly_charge == null ? 0 : toMoney(loan.min_monthly_charge)
  const charge = chargeModelOf(rules)
  const termInterest = interestAccrued(
    principal,
    monthlyRate,
    loan.term_days,
    minMonthlyCharge,
    charge,
  )
  const totalPayoffAtTerm = r4(principal + termInterest)

  // The form's lending boxes. Statutory values come from the tenant's
  // jurisdiction (rule 18); the money is the app's own loan math, so the
  // ticket never promises a figure the payoff screen would not charge.
  const defaultDate = loanForfeitEligibility(rules, loan.due_date).lastRedemptionDate
  // What redeeming costs on the default date: the payoff screen's own figure
  // for that day — so a ticket reprinted after payments or extensions counts
  // what was already paid.
  const { data: paidEvents, error: paidErr } = await supabase
    .from('loan_events')
    .select('id, reverses_event_id, principal_paid, interest_paid, fees_paid, interest_waived, occurred_at')
    .eq('loan_id', loanId)
    .eq('tenant_id', tenantId)
    .limit(1000)
  if (paidErr) throw new Error(`loan_events_failed: ${paidErr.message}`)
  const amountAtDefault = payoffBalance({
    principal,
    monthlyRate,
    issueDate: loan.issue_date,
    today: defaultDate,
    events: paidEvents ?? [],
    minMonthlyCharge,
    charge,
  }).payoff
  const apr = principal > 0 && loan.term_days > 0 ? r4((termInterest / principal) * (365 / loan.term_days)) : 0
  const transactionTime = new Date(loan.created_at).toLocaleTimeString('en-US', {
    timeZone: rules.timezone,
    hour: 'numeric',
    minute: '2-digit',
  })

  // ── 7. Assemble + render
  const data: PawnTicketData = {
    ticket_number: loan.ticket_number ?? '',
    status: loan.status as LoanStatus,
    principal,
    issue_date: loan.issue_date,
    due_date: loan.due_date,
    total_interest_at_term: termInterest,
    total_payoff_at_term: totalPayoffAtTerm,
    apr,
    transaction_time: transactionTime,
    default_date: defaultDate,
    amount_at_default: amountAtDefault,
    jurisdiction_name: rules.jurisdiction?.name ?? null,
    customer,
    tenant: tenantView,
    collateral,
    signatureImage,
    i18n: { en, es },
    backpage_text: backpageText,
    legal_notices: rules.jurisdiction?.ticket_notices ?? [],
    // A Spanish-speaking customer also gets the stamped courtesy translation.
    spanish_copy: args.spanishCopy ?? c?.language === 'es',
    spanish_only: args.copies === 'spanish',
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
