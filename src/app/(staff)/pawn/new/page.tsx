import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewPawnLoanForm, { type LoanRateOption } from './form'
import type { PawnIntakeCategory } from '@/components/pawn/CategoryPicker'

export default async function NewPawnLoanPage() {
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
  // tenant. Two-level hierarchy: top-levels have parent_id IS NULL,
  // sub-categories point to a parent. Firearms-flagged tiles
  // (top-level OR sub) are filtered when has_firearms is FALSE.
  const { data: catRows } = await ctx.supabase
    .from('pawn_intake_categories')
    .select('id, slug, label, icon, requires_ffl, parent_id')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const visible = (catRows ?? []).filter(
    (c) => !c.requires_ffl || hasFirearms,
  )

  // Group subs by parent_id.
  const subsByParent = new Map<string, typeof visible>()
  for (const r of visible) {
    if (r.parent_id != null) {
      const arr = subsByParent.get(r.parent_id) ?? []
      arr.push(r)
      subsByParent.set(r.parent_id, arr)
    }
  }

  const categories: PawnIntakeCategory[] = visible
    .filter((r) => r.parent_id == null)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      label: r.label,
      icon: r.icon,
      requires_ffl: r.requires_ffl,
      subcategories: (subsByParent.get(r.id) ?? []).map((s) => ({
        id: s.id,
        slug: s.slug,
        label: s.label,
        icon: s.icon,
        requires_ffl: s.requires_ffl,
      })),
    }))

  return (
    <NewPawnLoanForm
      rates={rates}
      minLoanAmount={minLoanAmount}
      categories={categories}
    />
  )
}
