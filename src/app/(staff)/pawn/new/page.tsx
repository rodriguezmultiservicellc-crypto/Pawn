import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewPawnLoanForm, { type LoanRateOption } from './form'
import type { PawnIntakeCategory } from '@/components/pawn/CategoryPicker'

export default async function NewPawnLoanPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate + firearms gate. has_firearms lands in generated types
  // after `npm run db:types` post-migration 0037 — boundary cast until.
  const { data: tenantRaw } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_firearms')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  const tenant = tenantRaw as
    | { has_pawn: boolean; has_firearms: boolean | null }
    | null
  if (!tenant?.has_pawn) redirect('/dashboard')
  const hasFirearms = !!tenant?.has_firearms

  const [ratesRes, settingsRes] = await Promise.all([
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

  // Pawn intake categories — operator-editable, RLS-scoped to this
  // tenant. Firearms-flagged tiles are filtered out when has_firearms
  // is FALSE on the tenant. Boundary cast: the table lands in
  // generated types only after `npm run db:types` runs post-migration
  // 0037 — code uses an inline cast until then.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picBuilder = (ctx.supabase.from as any)('pawn_intake_categories')
  const { data: catRows } = await picBuilder
    .select('id, slug, label, icon, requires_ffl')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const categories: PawnIntakeCategory[] = ((catRows ?? []) as Array<{
    id: string
    slug: string
    label: string
    icon: string
    requires_ffl: boolean
  }>)
    .filter((c) => !c.requires_ffl || hasFirearms)
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      label: c.label,
      icon: c.icon,
      requires_ffl: c.requires_ffl,
    }))

  return (
    <NewPawnLoanForm
      rates={rates}
      minLoanAmount={minLoanAmount}
      categories={categories}
    />
  )
}
