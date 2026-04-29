'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

const ROLES = ['owner', 'chain_admin', 'manager'] as const

const rateSchema = z
  .object({
    rate_monthly: z.coerce.number().min(0).max(0.25),
    label: z.string().trim().min(1).max(80),
    description: z
      .preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
        z.string().min(1).max(500).nullable().optional(),
      )
      .transform((v) => v ?? null),
    sort_order: z.coerce.number().int().min(0).max(9999).default(100),
    is_default: z.coerce.boolean().default(false),
    is_active: z.coerce.boolean().default(true),
  })

export type SaveRateState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

export async function saveLoanRateAction(
  _prev: SaveRateState,
  formData: FormData,
): Promise<SaveRateState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId } = await requireRoleInTenant(ctx.tenantId, [...ROLES])

  const id = String(formData.get('id') ?? '').trim()

  const parsed = rateSchema.safeParse({
    rate_monthly: formData.get('rate_monthly'),
    label: formData.get('label'),
    description: formData.get('description'),
    sort_order: formData.get('sort_order'),
    is_default: formData.get('is_default') === 'on',
    is_active: formData.get('is_active') !== 'off',
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }
  const v = parsed.data

  const admin = createAdminClient()

  // Enforce single-default invariant — if the new/edited row is being
  // marked default, clear is_default on every other row first. RLS on
  // this table allows manager+ writes via my_role_in_tenant; we use
  // admin client to keep these two writes in a tight pair (no
  // transaction wrapper available across .update() calls in supabase-
  // js, but ordering is still safer than letting the unique index
  // bounce one of them).
  if (v.is_default) {
    await admin
      .from('tenant_loan_rates')
      .update({ is_default: false })
      .eq('tenant_id', ctx.tenantId)
      .neq('id', id || '00000000-0000-0000-0000-000000000000')
  }

  if (id) {
    const { error } = await admin
      .from('tenant_loan_rates')
      .update({
        rate_monthly: v.rate_monthly,
        label: v.label,
        description: v.description,
        sort_order: v.sort_order,
        is_default: v.is_default,
        is_active: v.is_active,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('tenant_loan_rates').insert({
      tenant_id: ctx.tenantId,
      rate_monthly: v.rate_monthly,
      label: v.label,
      description: v.description,
      sort_order: v.sort_order,
      is_default: v.is_default,
      is_active: v.is_active,
      created_by: userId,
      updated_by: userId,
    })
    if (error) return { error: error.message }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: id ? 'update' : 'create',
    tableName: 'tenant_loan_rates',
    recordId: id || 'new',
    changes: {
      rate_monthly: v.rate_monthly,
      label: v.label,
      is_default: v.is_default,
      is_active: v.is_active,
    },
  })

  revalidatePath('/settings/loan-rates')
  revalidatePath('/pawn/new')
  return { ok: true }
}

export async function deleteLoanRateAction(
  _prev: { ok?: boolean; error?: string },
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId } = await requireRoleInTenant(ctx.tenantId, [...ROLES])

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'invalid' }

  const admin = createAdminClient()

  // Refuse to delete the default — operator must promote another rate
  // first. Otherwise the pawn-new form has nothing to default to.
  const { data: target } = await admin
    .from('tenant_loan_rates')
    .select('is_default')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!target) return { error: 'not_found' }
  if (target.is_default) return { error: 'cannot_delete_default' }

  // Soft-delete via is_active=false. Existing loans still reference
  // the rate value (copied to loans.interest_rate_monthly at intake)
  // so we never need a hard delete.
  const { error } = await admin
    .from('tenant_loan_rates')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'soft_delete',
    tableName: 'tenant_loan_rates',
    recordId: id,
    changes: { kind: 'deactivate_loan_rate' },
  })

  revalidatePath('/settings/loan-rates')
  revalidatePath('/pawn/new')
  return { ok: true }
}
