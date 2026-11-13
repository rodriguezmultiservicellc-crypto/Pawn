'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { storeSettingsSchema, toSettingsPatch, type StoreSettingsInput } from '@/lib/store/settings'

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
