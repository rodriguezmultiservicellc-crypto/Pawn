import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewPawnLoanForm, {
  type CustomerOption,
  type LoanRateOption,
} from './form'

export default async function NewPawnLoanPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  const [customersRes, ratesRes] = await Promise.all([
    ctx.supabase
      .from('customers')
      .select('id, first_name, last_name, phone')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('is_banned', false)
      .order('last_name', { ascending: true })
      .limit(500),
    // Per-tenant rate menu — added in patches/0021. Active rates only,
    // sorted by sort_order then rate_monthly so the dropdown matches the
    // configured menu order.
    ctx.supabase
      .from('tenant_loan_rates')
      .select('id, rate_monthly, label, description, is_default, sort_order')
      .eq('tenant_id', ctx.tenantId)
      .eq('is_active', true)
      .order('sort_order')
      .order('rate_monthly'),
  ])

  const options: CustomerOption[] = (customersRes.data ?? []).map((c) => ({
    id: c.id,
    label: `${c.last_name}, ${c.first_name}${c.phone ? ` · ${c.phone}` : ''}`,
  }))

  // NUMERIC → string in the generated types; coerce.
  const rates: LoanRateOption[] = (ratesRes.data ?? []).map((r) => ({
    id: r.id,
    rateMonthly: Number(r.rate_monthly),
    label: r.label,
    description: r.description,
    isDefault: r.is_default,
  }))

  return <NewPawnLoanForm customers={options} rates={rates} />
}
