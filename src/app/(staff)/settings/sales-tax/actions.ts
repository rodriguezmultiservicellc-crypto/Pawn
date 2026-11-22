'use server'

/**
 * /settings/sales-tax — the shop's sales tax rates by district (patches/0094).
 * Owners, chain admins and managers. Writes go through the user's own client
 * so the table's RLS write rule is the second check after the guard. The
 * total (settings.default_tax_rate) is kept by a database trigger — this file
 * never writes it.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import {
  SALES_TAX_EDIT_ROLES,
  SALES_TAX_MAX,
  taxRateInputSchema,
  type TaxRateInput,
} from '@/lib/pos/sales-tax'

type Result =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'precision' | 'limit' | 'total_too_high' | 'not_found' | 'generic' }

async function editor() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, SALES_TAX_EDIT_ROLES)
  return { supabase, userId, tenantId: ctx.tenantId }
}

function done(): Result {
  revalidatePath('/settings/sales-tax')
  revalidatePath('/settings')
  revalidatePath('/settings/store')
  revalidatePath('/pos/sales/new')
  return { ok: true }
}

/** Form fields → table columns, or the reason they were refused. */
function columns(input: TaxRateInput) {
  const parsed = taxRateInputSchema.safeParse(input)
  if (!parsed.success) {
    const precision = parsed.error.issues.some((i) => i.message === 'precision')
    return { ok: false as const, error: precision ? ('precision' as const) : ('invalid' as const) }
  }
  const v = parsed.data
  return { ok: true as const, row: { name: v.name, level: v.level, rate: v.percent, item_cap: v.item_cap, is_active: v.is_active } }
}

/** The trigger refuses a stack that adds up to more than 100%. */
function writeError(message: string | undefined): Result {
  if (message?.includes('tax_total_too_high')) return { ok: false, error: 'total_too_high' }
  console.error('[sales-tax] write failed', message)
  return { ok: false, error: 'generic' }
}

export async function createTaxRateAction(input: TaxRateInput): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const c = columns(input)
  if (!c.ok) return { ok: false, error: c.error }

  const { count } = await supabase
    .from('tax_rates')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  if ((count ?? 0) >= SALES_TAX_MAX) return { ok: false, error: 'limit' }

  const { data, error } = await supabase
    .from('tax_rates')
    .insert({ tenant_id: tenantId, ...c.row, created_by: userId, updated_by: userId })
    .select('id')
    .maybeSingle()
  if (error || !data) return writeError(error?.message)
  await logAudit({ tenantId, userId, action: 'create', tableName: 'tax_rates', recordId: data.id, changes: c.row })
  return done()
}

export async function updateTaxRateAction(id: string, input: TaxRateInput): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const c = columns(input)
  if (!c.ok) return { ok: false, error: c.error }

  const { data, error } = await supabase
    .from('tax_rates')
    .update({ ...c.row, updated_by: userId })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) return writeError(error.message)
  if (!data) return { ok: false, error: 'not_found' }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'tax_rates', recordId: id, changes: c.row })
  return done()
}

/**
 * Soft delete. Sales already rung up keep the rate they were charged — it is
 * stored on each sale — so removing a rate only changes sales from now on.
 */
export async function removeTaxRateAction(id: string): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const { data, error } = await supabase
    .from('tax_rates')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) return writeError(error.message)
  if (!data) return { ok: false, error: 'not_found' }
  await logAudit({ tenantId, userId, action: 'soft_delete', tableName: 'tax_rates', recordId: id, changes: {} })
  return done()
}
