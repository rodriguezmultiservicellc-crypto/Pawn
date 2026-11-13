'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { storeSettingsSchema, toSettingsPatch, type StoreSettingsInput } from '@/lib/store/settings'
import { createAdminClient } from '@/lib/supabase/admin'
import { cleanDomainInput, isAppHost, verificationRecordName } from '@/lib/store/custom-domain'
import { randomBytes } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'

type Result = { ok: true } | { ok: false; error: 'invalid' | 'generic' }

/** Owners only (settings RLS: owner write). */
export async function saveStoreSettingsAction(input: StoreSettingsInput): Promise<Result> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireOwner(ctx.tenantId)

  const parsed = storeSettingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const patch = toSettingsPatch(parsed.data)

  const { error } = await supabase.from('settings').update(patch).eq('tenant_id', ctx.tenantId)
  if (error) {
    console.error('[settings.store] save failed', error.message)
    return { ok: false, error: 'generic' }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'update',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: { section: 'online_store', ...patch },
  })

  revalidatePath('/settings/store')
  return { ok: true }
}

// ── Custom domain (patches/0079) ───────────────────────────────────────────

type DomainResult = { ok: true } | { ok: false; error: 'invalid_domain' | 'domain_taken' | 'not_verified' | 'generic' }

async function ownerForDomain() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { userId } = await requireOwner(ctx.tenantId)
  return { tenantId: ctx.tenantId, userId }
}

/** Set (or change) the shop's domain. A new random token must be put in DNS. */
export async function setCustomDomainAction(raw: string): Promise<DomainResult> {
  const { tenantId, userId } = await ownerForDomain()
  const domain = cleanDomainInput(raw)
  if (!domain || isAppHost(domain, { appUrl: process.env.NEXT_PUBLIC_APP_URL, baseDomain: process.env.NEXT_PUBLIC_BASE_DOMAIN })) {
    return { ok: false, error: 'invalid_domain' }
  }
  const token = `solpawn-${randomBytes(16).toString('hex')}`
  const { error } = await createAdminClient()
    .from('tenants')
    .update({ custom_domain: domain, custom_domain_token: token, custom_domain_verified_at: null })
    .eq('id', tenantId)
  if (error) return { ok: false, error: error.code === '23505' ? 'domain_taken' : 'generic' }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'tenants', recordId: tenantId, changes: { custom_domain: domain, verified: false } })
  revalidatePath('/settings/store')
  return { ok: true }
}

/** Look up _solpawn.<domain> TXT; on a match the proxy starts routing the domain. */
export async function verifyCustomDomainAction(): Promise<DomainResult> {
  const { tenantId, userId } = await ownerForDomain()
  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tenants')
    .select('custom_domain, custom_domain_token')
    .eq('id', tenantId)
    .maybeSingle()
  if (!t?.custom_domain || !t.custom_domain_token) return { ok: false, error: 'invalid_domain' }

  let records: string[][] = []
  try {
    records = await resolveTxt(verificationRecordName(t.custom_domain))
  } catch {
    return { ok: false, error: 'not_verified' }
  }
  if (!records.some((parts) => parts.join('') === t.custom_domain_token)) return { ok: false, error: 'not_verified' }

  const { error } = await admin
    .from('tenants')
    .update({ custom_domain_verified_at: new Date().toISOString() })
    .eq('id', tenantId)
    .eq('custom_domain', t.custom_domain)
  if (error) return { ok: false, error: 'generic' }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'tenants', recordId: tenantId, changes: { custom_domain: t.custom_domain, verified: true } })
  revalidatePath('/settings/store')
  return { ok: true }
}

export async function removeCustomDomainAction(): Promise<DomainResult> {
  const { tenantId, userId } = await ownerForDomain()
  const { error } = await createAdminClient()
    .from('tenants')
    .update({ custom_domain: null, custom_domain_token: null, custom_domain_verified_at: null })
    .eq('id', tenantId)
  if (error) return { ok: false, error: 'generic' }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'tenants', recordId: tenantId, changes: { custom_domain: null } })
  revalidatePath('/settings/store')
  return { ok: true }
}
