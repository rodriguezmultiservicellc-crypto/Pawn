'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

const ROLES = ['owner', 'chain_admin', 'manager'] as const

// Empty string from a blank optional money input must become null BEFORE
// the inner schema runs — same pattern as the loan validators.
const optionalMoney = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.coerce.number().nonnegative().finite().nullable().optional(),
  )
  .transform((v) => (v === null || v === undefined ? null : v))

const rateSchema = z
  .object({
    rate_monthly: z.coerce.number().min(0).max(0.25),
    // Optional floor on monthly interest. NULL = no floor.
    min_monthly_charge: optionalMoney,
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
    min_monthly_charge: formData.get('min_monthly_charge'),
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
        min_monthly_charge: v.min_monthly_charge,
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
      min_monthly_charge: v.min_monthly_charge,
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
      min_monthly_charge: v.min_monthly_charge,
      label: v.label,
      is_default: v.is_default,
      is_active: v.is_active,
    },
  })

  revalidatePath('/settings/loan-rates')
  revalidatePath('/pawn/new')
  return { ok: true }
}

// ── Tenant-wide loan policy ──────────────────────────────────────────────

const policySchema = z.object({
  min_loan_amount: optionalMoney,
})

export type SavePolicyState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

/**
 * Save tenant-wide loan policy (currently just min_loan_amount). Lives on
 * /settings/loan-rates because it's the same audience and same blast
 * radius as editing the rate menu.
 */
export async function saveTenantLoanPolicyAction(
  _prev: SavePolicyState,
  formData: FormData,
): Promise<SavePolicyState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId } = await requireRoleInTenant(ctx.tenantId, [...ROLES])

  const parsed = policySchema.safeParse({
    min_loan_amount: formData.get('min_loan_amount'),
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
  const { error } = await admin
    .from('settings')
    .update({
      min_loan_amount: v.min_loan_amount,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'update',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: { min_loan_amount: v.min_loan_amount },
  })

  revalidatePath('/settings/loan-rates')
  revalidatePath('/pawn/new')
  return { ok: true }
}

// ── Pawn ticket backpage (English-only legal disclosure) ────────────────

const backpageSchema = z.object({
  // Empty / whitespace-only → null = revert to renderer default.
  pawn_ticket_backpage: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(20000).nullable().optional(),
    )
    .transform((v) => v ?? null),
})

export type SaveBackpageState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

/**
 * Save the per-tenant pawn-ticket reverse-side legal disclosure. NULL =
 * fall back to the FL Ch. 539 default shipped in
 * src/lib/pdf/pawn-ticket-backpage-default.ts. The field is English-only
 * by operator policy — the ticket is a legal document.
 */
export async function saveTicketBackpageAction(
  _prev: SaveBackpageState,
  formData: FormData,
): Promise<SaveBackpageState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId } = await requireRoleInTenant(ctx.tenantId, [...ROLES])

  const parsed = backpageSchema.safeParse({
    pawn_ticket_backpage: formData.get('pawn_ticket_backpage'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('settings')
    .update({
      pawn_ticket_backpage: parsed.data.pawn_ticket_backpage,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'update',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: {
      kind: 'pawn_ticket_backpage',
      length: parsed.data.pawn_ticket_backpage?.length ?? 0,
    },
  })

  revalidatePath('/settings/loan-rates')
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
