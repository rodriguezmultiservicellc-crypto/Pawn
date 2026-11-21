'use server'

/**
 * /settings/card-reader — pair or remove the shop's Stripe Terminal reader
 * (patches/0086). Owners and chain admins (settings RLS: owner write). The
 * reader lives on the shop's connected Stripe account; the app keeps only
 * its id, label and Terminal Location id on `settings`.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { loadShopReader } from '@/lib/pos/reader-server'
import {
  createTerminalLocation,
  deleteTerminalReader,
  registerTerminalReader,
  tenantHasStripeAccount,
} from '@/lib/stripe/terminal'
import { pairReaderSchema, type PairReaderInput } from '@/lib/pos/reader'

export type ReaderActionResult =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'notConnected' | 'stripeMissing' | 'addressMissing' | 'pairFailed' | 'generic'; detail?: string }

async function owner() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireOwner(ctx.tenantId)
  return { supabase, userId, tenantId: ctx.tenantId }
}

export async function pairReaderAction(input: PairReaderInput): Promise<ReaderActionResult> {
  const { supabase, userId, tenantId } = await owner()
  const parsed = pairReaderSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: 'stripeMissing' }
  if (!(await tenantHasStripeAccount(tenantId))) return { ok: false, error: 'notConnected' }

  // A Terminal Location is required per reader; create it once from the
  // shop's address and keep it.
  const current = await loadShopReader(tenantId)
  const { data: s } = await supabase
    .from('settings')
    .select('stripe_terminal_location_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  let locationId = s?.stripe_terminal_location_id ?? null
  try {
    if (!locationId) {
      const { data: t } = await supabase
        .from('tenants')
        .select('name, address, city, state, zip')
        .eq('id', tenantId)
        .maybeSingle()
      if (!t?.address || !t.city || !t.state || !t.zip) return { ok: false, error: 'addressMissing' }
      const loc = await createTerminalLocation({
        tenantId,
        displayName: t.name ?? 'Shop',
        address: { line1: t.address, city: t.city, state: t.state, postal_code: t.zip },
      })
      locationId = loc.id
    }

    const reader = await registerTerminalReader({
      tenantId,
      registrationCode: parsed.data.registration_code,
      label: parsed.data.label,
      locationId,
    })

    const { error } = await supabase
      .from('settings')
      .update({
        stripe_terminal_location_id: locationId,
        stripe_terminal_reader_id: reader.id,
        stripe_terminal_reader_label: parsed.data.label,
      })
      .eq('tenant_id', tenantId)
    if (error) {
      console.error('[card-reader] save failed', error.message)
      return { ok: false, error: 'generic' }
    }

    // Replacing a reader: remove the old one from Stripe (best effort).
    if (current && current.readerId !== reader.id) {
      await deleteTerminalReader({ tenantId, readerId: current.readerId }).catch(() => undefined)
    }

    await logAudit({
      tenantId,
      userId,
      action: 'terminal_reader_pair',
      tableName: 'settings',
      recordId: tenantId,
      changes: { reader_id: reader.id, label: parsed.data.label, device_type: reader.device_type, replaced: current?.readerId ?? null },
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : undefined
    console.error('[card-reader] pair failed', detail)
    return { ok: false, error: 'pairFailed', detail }
  }

  revalidatePath('/settings/card-reader')
  revalidatePath('/pos/sales/new')
  return { ok: true }
}

export async function removeReaderAction(): Promise<ReaderActionResult> {
  const { supabase, userId, tenantId } = await owner()
  const current = await loadShopReader(tenantId)
  if (!current) return { ok: true }

  if (process.env.STRIPE_SECRET_KEY) {
    await deleteTerminalReader({ tenantId, readerId: current.readerId }).catch((e) =>
      console.error('[card-reader] delete in Stripe failed', e instanceof Error ? e.message : e),
    )
  }
  const { error } = await supabase
    .from('settings')
    .update({ stripe_terminal_reader_id: null, stripe_terminal_reader_label: null })
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: 'generic' }

  await logAudit({
    tenantId,
    userId,
    action: 'terminal_reader_remove',
    tableName: 'settings',
    recordId: tenantId,
    changes: { reader_id: current.readerId },
  })
  revalidatePath('/settings/card-reader')
  revalidatePath('/pos/sales/new')
  return { ok: true }
}
