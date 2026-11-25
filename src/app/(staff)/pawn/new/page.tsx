import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCtx } from '@/lib/supabase/ctx'
import NewPawnLoanForm, {
  type LoanRateOption,
  type DraftInitial,
  type IntakeLoanRules,
} from './form'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { parseDraftPayload } from '@/lib/pawn/intake-form'
import { getSpotFreshness } from '@/lib/spot-prices/lookup'
import { canConfirmStaleSpot } from '@/lib/spot-prices/stale-gate'
import { loadRateMaps } from '@/lib/metal-counter/rates'
import { loadPawnIntakeCategories } from '@/lib/pawn/intake-categories'

type SearchParams = Promise<{ draft?: string }>

export default async function NewPawnLoanPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate + firearms gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_firearms')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')
  const hasFirearms = !!tenant?.has_firearms

  const [ratesRes, settingsRes, spotFreshness, metalRates] = await Promise.all([
    // Per-tenant rate menu — patches/0021 + 0022 (min_monthly_charge).
    // Active rates only, sorted by sort_order then rate_monthly so the
    // dropdown matches the configured menu order.
    ctx.supabase
      .from('tenant_loan_rates')
      .select(
        'id, rate_monthly, min_monthly_charge, label, description, is_default, sort_order',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('is_active', true)
      .order('sort_order')
      .order('rate_monthly'),
    // Tenant-wide loan policy — patches/0022. min_loan_amount is the
    // company-wide floor on principal.
    ctx.supabase
      .from('settings')
      .select('min_loan_amount')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    // 24h stale-price rule — banner + manager confirm on the form.
    getSpotFreshness(),
    // Spot per gram + this shop's pay percent per karat (the same maps Buy
    // outright uses): the item popup works out a piece's metal value.
    loadRateMaps(ctx.tenantId),
  ])

  // NUMERIC → string in the generated types; coerce.
  const rates: LoanRateOption[] = (ratesRes.data ?? []).map((r) => ({
    id: r.id,
    rateMonthly: Number(r.rate_monthly),
    minMonthlyCharge:
      r.min_monthly_charge == null ? null : Number(r.min_monthly_charge),
    label: r.label,
    description: r.description,
    isDefault: r.is_default,
  }))

  const minLoanAmount =
    settingsRes.data?.min_loan_amount == null
      ? null
      : Number(settingsRes.data.min_loan_amount)

  const rules = await loadTenantRules(ctx.supabase, ctx.tenantId)
  const j = rules.jurisdiction
  const loanRules: IntakeLoanRules = {
    jurisdictionName: j?.name ?? null,
    minTermDays: j?.min_term_days ?? null,
    maxTermDays: j?.max_term_days ?? null,
    rateCapMonthly: j?.rate_cap_monthly ?? null,
    rateTiers: j?.rate_tiers ?? null,
    today: todayInTimezone(rules.timezone),
  }

  // Pawn intake categories — operator-editable, RLS-scoped to this
  // tenant; firearms tiles are left out when has_firearms is FALSE.
  const categories = await loadPawnIntakeCategories(
    ctx.supabase,
    ctx.tenantId,
    hasFirearms,
  )

  // Resume a saved draft when ?draft=<id> is present. loan_drafts isn't in
  // the generated Database type until the next `npm run db:types` after
  // patches/0045; reach it via a generic client. RLS scopes to the tenant.
  const { draft: draftId } = await props.searchParams
  let initialDraft: DraftInitial | null = null
  if (draftId) {
    const db = ctx.supabase as unknown as SupabaseClient
    const { data: draftRow } = await db
      .from('loan_drafts')
      .select('id, customer_id, payload')
      .eq('id', draftId)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    const d = draftRow as
      | { id: string; customer_id: string; payload: unknown }
      | null
    if (d) {
      initialDraft = {
        id: d.id,
        customerId: d.customer_id,
        payload: parseDraftPayload(d.payload),
      }
    }
  }

  return (
    <NewPawnLoanForm
      rates={rates}
      minLoanAmount={minLoanAmount}
      loanRules={loanRules}
      categories={categories}
      initialDraft={initialDraft}
      spotFreshness={spotFreshness}
      metalRates={metalRates}
      canConfirmStale={canConfirmStaleSpot(ctx.tenantRole)}
    />
  )
}
