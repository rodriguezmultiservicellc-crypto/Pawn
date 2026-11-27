'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { setTenantSecret } from '@/lib/secrets/vault'
import { logAudit } from '@/lib/audit'
import { checkDoNotBuy, checkLogin, loadLeadsOnlineConfig } from '@/lib/leadsonline/client'
import type { DoNotBuyInfo } from '@/lib/leadsonline/soap'

/**
 * LeadsOnline web service login (patches/0123). Owner / chain admin only.
 * The password goes to Vault and nowhere else; it is never sent back.
 */

export type LeadsOnlineState = {
  ok?: boolean
  /** t.leadsonline.errors[code] */
  error?: string
  detail?: string
  fieldErrors?: Record<string, string>
}

async function ownerScope() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireRoleInTenant(ctx.tenantId, ['owner', 'chain_admin'])
  return { tenantId: ctx.tenantId, userId: ctx.userId }
}

const schema = z.object({
  store_id: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null),
    z.union([z.null(), z.string().regex(/^\d{1,9}$/, 'invalid_store_id')]),
  ),
  username: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null),
    z.union([z.null(), z.string().max(120, 'invalid_username')]),
  ),
  // blank = keep · '__CLEAR__' = clear · value = replace
  password: z.preprocess((v) => {
    if (typeof v !== 'string' || v === '') return undefined
    if (v === '__CLEAR__') return null
    return v
  }, z.union([z.string().max(200), z.null(), z.undefined()])),
  env: z.enum(['sandbox', 'production']),
})

export async function saveLeadsOnlineAction(_prev: LeadsOnlineState, formData: FormData): Promise<LeadsOnlineState> {
  const { tenantId, userId } = await ownerScope()
  const parsed = schema.safeParse({
    store_id: formData.get('store_id'),
    username: formData.get('username'),
    password: formData.get('password'),
    env: formData.get('env'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '')
      if (k && !fieldErrors[k]) fieldErrors[k] = issue.message
    }
    return { error: 'invalid', fieldErrors }
  }
  const v = parsed.data

  const admin = createAdminClient()
  const { data: prior } = await admin
    .from('settings')
    .select('leadsonline_api_store_id, leadsonline_api_username, leadsonline_api_env')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const { error } = await admin
    .from('settings')
    .update({
      leadsonline_api_store_id: v.store_id == null ? null : parseInt(v.store_id, 10),
      leadsonline_api_username: v.username,
      leadsonline_api_env: v.env,
    })
    .eq('tenant_id', tenantId)
  if (error) return { error: 'remote', detail: error.message }

  let password: 'set' | 'cleared' | null = null
  if (v.password !== undefined) {
    const r = await setTenantSecret(tenantId, 'leadsonline_api_password', v.password)
    if (!r.ok) return { error: 'remote', detail: r.error }
    password = v.password === null ? 'cleared' : 'set'
  }

  await logAudit({
    tenantId,
    userId,
    action: 'leadsonline_settings',
    tableName: 'settings',
    recordId: tenantId,
    changes: {
      store_id_before: prior?.leadsonline_api_store_id ?? null,
      store_id_after: v.store_id,
      username_before: prior?.leadsonline_api_username ?? null,
      username_after: v.username,
      env_before: prior?.leadsonline_api_env ?? null,
      env_after: v.env,
      password,
    },
  })

  revalidatePath('/settings/integrations')
  revalidatePath('/settings/integrations/leadsonline')
  return { ok: true }
}

/** CheckLogin: LeadsOnline says whether the saved login is accepted. */
export async function testLeadsOnlineAction(_prev: LeadsOnlineState, _formData: FormData): Promise<LeadsOnlineState> {
  const { tenantId } = await ownerScope()
  const cfg = await loadLeadsOnlineConfig(tenantId)
  if (!cfg.ok) return { error: 'not_configured' }
  const r = await checkLogin(cfg.config)
  if (r.kind === 'fault') return { error: 'remote', detail: r.message }
  if (r.errorCode !== 0) return { error: 'code', detail: `${r.errorCode}: ${r.errorResponse}` }
  return { ok: true }
}

export type DoNotBuyState = {
  hits?: DoNotBuyInfo[]
  error?: string
  detail?: string
}

/** CheckDoNotBuy2: the ID alone, or at least two of ID / name / birth date. */
export async function checkDoNotBuyAction(_prev: DoNotBuyState, formData: FormData): Promise<DoNotBuyState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireRoleInTenant(ctx.tenantId, ['owner', 'chain_admin', 'manager', 'pawn_clerk'])

  const id = String(formData.get('id') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const dobIso = String(formData.get('dob') ?? '').trim()
  const given = [id, name, dobIso].filter(Boolean).length
  if (!id && given < 2) return { error: 'dnb_need_two' }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobIso)
  const birthDate = m ? `${m[2]}/${m[3]}/${m[1]}` : ''

  const cfg = await loadLeadsOnlineConfig(ctx.tenantId)
  if (!cfg.ok) return { error: 'not_configured' }
  const r = await checkDoNotBuy(cfg.config, { id, name: name.toUpperCase(), birthDate })
  if (r.kind === 'fault') return { error: 'remote', detail: r.message }
  return { hits: r.hits }
}
