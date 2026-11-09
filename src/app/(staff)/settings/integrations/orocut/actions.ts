'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret, setTenantSecret } from '@/lib/secrets/vault'
import { logAudit } from '@/lib/audit'
import { probeToken } from '@/lib/orocut/client'
import { orocutSettingsSchema } from '@/lib/validations/laser-order'

/**
 * OroCut (orocut.com) connection — settings actions. Async functions only
 * in this file. The order token goes to the vault and nowhere else.
 */

export type OrocutSettingsState = {
  ok?: boolean
  /** Translated through t.orocut.errors[code] when it matches. */
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

export async function updateOrocutSettingsAction(
  _prev: OrocutSettingsState,
  formData: FormData,
): Promise<OrocutSettingsState> {
  const { tenantId, userId } = await ownerScope()

  const parsed = orocutSettingsSchema.safeParse({
    orocut_order_token: formData.get('orocut_order_token'),
    orocut_webhook_secret: formData.get('orocut_webhook_secret'),
    orocut_style_names: String(formData.get('orocut_style_names') ?? ''),
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
    .select('orocut_style_names')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const { error } = await admin
    .from('settings')
    .update({ orocut_style_names: v.orocut_style_names })
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  // blank = no change · '__CLEAR__' = clear · value = replace
  let tokenChange: 'set' | 'cleared' | null = null
  if (v.orocut_order_token !== undefined) {
    const r = await setTenantSecret(tenantId, 'orocut_order_token', v.orocut_order_token)
    if (!r.ok) return { error: r.error }
    tokenChange = v.orocut_order_token === null ? 'cleared' : 'set'
  }
  let secretChange: 'set' | 'cleared' | null = null
  if (v.orocut_webhook_secret !== undefined) {
    const r = await setTenantSecret(tenantId, 'orocut_webhook_secret', v.orocut_webhook_secret)
    if (!r.ok) return { error: r.error }
    secretChange = v.orocut_webhook_secret === null ? 'cleared' : 'set'
  }

  await logAudit({
    tenantId,
    userId,
    action: 'orocut_settings',
    tableName: 'settings',
    recordId: tenantId,
    changes: {
      style_names_before: prior?.orocut_style_names ?? [],
      style_names_after: v.orocut_style_names,
      token: tokenChange,
      webhook_secret: secretChange,
    },
  })

  revalidatePath('/settings/integrations')
  revalidatePath('/settings/integrations/orocut')
  return { ok: true }
}

/** Ask orocut.com whether the saved token is accepted. Reads nothing else. */
export async function testOrocutTokenAction(
  _prev: OrocutSettingsState,
  _formData: FormData,
): Promise<OrocutSettingsState> {
  const { tenantId } = await ownerScope()
  const token = await getTenantSecret(tenantId, 'orocut_order_token')
  if (!token) return { error: 'not_configured' }
  const r = await probeToken(token)
  if (!r.ok) {
    if (r.kind === 'unauthorized') return { error: 'unauthorized_token' }
    if (r.kind === 'network') return { error: 'network' }
    return { error: 'remote', detail: r.detail }
  }
  return { ok: true }
}
