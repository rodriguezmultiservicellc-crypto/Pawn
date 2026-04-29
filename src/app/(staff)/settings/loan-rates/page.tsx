import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import LoanRatesContent, { type LoanRateRow } from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin', 'manager'])

/**
 * /settings/loan-rates — per-tenant interest-rate menu.
 *
 * Read access: owner / chain_admin / manager.
 * Write access: same set, gated server-side via the RLS policy on
 * tenant_loan_rates (my_role_in_tenant ∈ {owner,chain_admin,manager}).
 */
export default async function LoanRatesPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('tenant_loan_rates')
    .select(
      'id, rate_monthly, label, description, sort_order, is_default, is_active, created_at, updated_at',
    )
    .eq('tenant_id', ctx.tenantId)
    .order('is_active', { ascending: false })
    .order('sort_order')
    .order('rate_monthly')

  const items: LoanRateRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    // NUMERIC → string in the generated types; coerce.
    rateMonthly: Number(r.rate_monthly),
    label: r.label,
    description: r.description,
    sortOrder: r.sort_order,
    isDefault: r.is_default,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))

  return <LoanRatesContent rows={items} />
}
