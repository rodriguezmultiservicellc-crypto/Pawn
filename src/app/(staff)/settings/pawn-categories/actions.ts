'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { SUPPORTED_ICONS } from '@/components/pawn/CategoryPicker'

const ROLES = ['owner', 'chain_admin', 'manager'] as const

const slugSchema = z
  .string()
  .trim()
  .min(2, 'slug too short')
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits, underscore only')

const categorySchema = z.object({
  slug: slugSchema,
  label: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).refine(
    (v) => SUPPORTED_ICONS.includes(v),
    'unsupported icon',
  ),
  sort_order: z.coerce.number().int().min(0).max(9999).default(100),
  requires_ffl: z.coerce.boolean().default(false),
  is_active: z.coerce.boolean().default(true),
  // Empty / 'none' / missing → null = top-level. Otherwise a UUID
  // referring to another row in this same tenant's category list.
  parent_id: z
    .preprocess(
      (v) => {
        if (v == null) return null
        const s = String(v).trim()
        if (s === '' || s === 'none') return null
        return s
      },
      z.string().uuid().nullable(),
    )
    .nullable()
    .default(null),
})

export type SaveCategoryState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

export async function saveCategoryAction(
  _prev: SaveCategoryState,
  formData: FormData,
): Promise<SaveCategoryState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId } = await requireRoleInTenant(ctx.tenantId, [...ROLES])

  const id = String(formData.get('id') ?? '').trim()
  const parsed = categorySchema.safeParse({
    slug: formData.get('slug'),
    label: formData.get('label'),
    icon: formData.get('icon'),
    sort_order: formData.get('sort_order'),
    requires_ffl: formData.get('requires_ffl') === 'on',
    is_active: formData.get('is_active') !== 'off',
    parent_id: formData.get('parent_id'),
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
  // Boundary cast — table lands in generated types after `npm run db:types`
  // post-migration 0037.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = (admin.from as any)('pawn_intake_categories')

  if (id) {
    const { error } = await builder
      .update({
        slug: v.slug,
        label: v.label,
        icon: v.icon,
        sort_order: v.sort_order,
        requires_ffl: v.requires_ffl,
        is_active: v.is_active,
        parent_id: v.parent_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
    if (error) return { error: error.message }
  } else {
    const { error } = await builder.insert({
      tenant_id: ctx.tenantId,
      slug: v.slug,
      label: v.label,
      icon: v.icon,
      sort_order: v.sort_order,
      requires_ffl: v.requires_ffl,
      is_active: v.is_active,
      parent_id: v.parent_id,
    })
    if (error) return { error: error.message }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: id ? 'update' : 'create',
    tableName: 'pawn_intake_categories',
    recordId: id || 'new',
    changes: {
      slug: v.slug,
      label: v.label,
      icon: v.icon,
      requires_ffl: v.requires_ffl,
      is_active: v.is_active,
      parent_id: v.parent_id,
    },
  })

  revalidatePath('/settings/pawn-categories')
  revalidatePath('/pawn/new')
  return { ok: true }
}

export async function deactivateCategoryAction(
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = (admin.from as any)('pawn_intake_categories')
  const { error } = await builder
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'soft_delete',
    tableName: 'pawn_intake_categories',
    recordId: id,
    changes: { kind: 'deactivate' },
  })

  revalidatePath('/settings/pawn-categories')
  revalidatePath('/pawn/new')
  return { ok: true }
}

// ── Tenant-level firearms gate ────────────────────────────────────────

const firearmsSchema = z.object({
  has_firearms: z.coerce.boolean(),
})

export type SaveFirearmsState = {
  ok?: boolean
  error?: string
}

export async function saveHasFirearmsAction(
  _prev: SaveFirearmsState,
  formData: FormData,
): Promise<SaveFirearmsState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Only owners + chain_admins can flip this — it has compliance
  // implications (FFL).
  const { userId } = await requireRoleInTenant(ctx.tenantId, ['owner', 'chain_admin'])

  const parsed = firearmsSchema.safeParse({
    has_firearms: formData.get('has_firearms') === 'on',
  })
  if (!parsed.success) return { error: 'invalid' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('tenants')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ has_firearms: parsed.data.has_firearms } as any)
    .eq('id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'update',
    tableName: 'tenants',
    recordId: ctx.tenantId,
    changes: { has_firearms: parsed.data.has_firearms },
  })

  revalidatePath('/settings/pawn-categories')
  revalidatePath('/pawn/new')
  return { ok: true }
}
