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
import { requireOwner, requireSuperAdmin } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret, setTenantSecret } from '@/lib/secrets/vault'
import { logAudit } from '@/lib/audit'
import { loadShopReader } from '@/lib/pos/reader-server'
import {
  createTerminalLocation,
  getTerminalReader,
  registerTerminalReader,
  stripeAccountInfo,
  stripeTarget,
  tenantStripeReady,
  verifyStripeKey,
  type StripeChargeMode,
} from '@/lib/stripe/terminal'
import { pairReaderSchema, type PairReaderInput } from '@/lib/pos/reader'

export type ReaderActionResult =
  | { ok: true }
  | {
      ok: false
      error:
        | 'invalid'
        | 'notConnected'
        | 'stripeMissing'
        | 'addressMissing'
        | 'pairFailed'
        | 'keyInvalid'
        | 'keyRejected'
        | 'notAllowed'
        | 'generic'
      detail?: string
    }

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
  if (!(await tenantStripeReady(tenantId))) return { ok: false, error: 'notConnected' }

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

    // Replacing a reader only unlinks the old one from Pawn. It is NOT
    // deleted on Stripe — a reader can be shared with another app.

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

  // Unlink only. The reader stays registered on Stripe: it may be shared
  // with another app (e.g. Luna Azul), and deleting it there would take it
  // away from that app too. Remove it in the Stripe dashboard if wanted.
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

const STRIPE_SECRET_KEY_RE = /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/

/**
 * Choose which Stripe account the shop's card charges run on (patches/0087).
 *   connect   owner — the shop's Express account (Settings → Integrations)
 *   own_key   owner — the shop's own secret key, checked against Stripe and
 *             stored in Vault; blank keeps a key already saved
 *   platform  SUPERADMIN only — the RMS account; written with the service
 *             role, which is the only role the 0087 trigger lets into this
 *             mode
 * A reader + Terminal Location belong to one Stripe account, so a real
 * change of account clears them (pair the reader again on the new account).
 */
export async function setChargeModeAction(input: { mode: StripeChargeMode; key?: string }): Promise<ReaderActionResult> {
  const mode = input.mode
  if (mode !== 'connect' && mode !== 'own_key' && mode !== 'platform') return { ok: false, error: 'invalid' }

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const tenantId = ctx.tenantId

  let userId: string
  if (mode === 'platform') {
    if (ctx.globalRole !== 'superadmin') return { ok: false, error: 'notAllowed' }
    userId = (await requireSuperAdmin()).userId
  } else {
    userId = (await requireOwner(tenantId)).userId
  }

  const before = await stripeTarget(tenantId).catch(() => null)
  // The Stripe account charges run on now — a reader belongs to exactly one.
  const beforeAccount = (await stripeAccountInfo(tenantId))?.id ?? null
  let newAccount: string | null = null

  if (mode === 'own_key') {
    const key = (input.key ?? '').trim()
    if (key) {
      if (!STRIPE_SECRET_KEY_RE.test(key)) return { ok: false, error: 'keyInvalid' }
      const v = await verifyStripeKey(key)
      if (!v.ok) return { ok: false, error: 'keyRejected', detail: v.error }
      newAccount = v.id
      const saved = await setTenantSecret(tenantId, 'stripe_own_secret_key', key)
      if (!saved.ok) return { ok: false, error: 'generic' }
    } else {
      // Blank keeps a key already saved; own_key with no key at all is refused.
      if (!(await getTenantSecret(tenantId, 'stripe_own_secret_key'))) return { ok: false, error: 'keyInvalid' }
    }
  }

  // service_role write (guarded above): the only path into 'platform'.
  const admin = createAdminClient()
  // Clear the reader only when the Stripe ACCOUNT really changes: another
  // mode, or a new own key that belongs to a different account.
  const changed = !before || before.mode !== mode || (newAccount !== null && newAccount !== beforeAccount)
  const { error } = await admin
    .from('settings')
    .update({
      stripe_charge_mode: mode,
      ...(changed
        ? { stripe_terminal_reader_id: null, stripe_terminal_reader_label: null, stripe_terminal_location_id: null }
        : {}),
    })
    .eq('tenant_id', tenantId)
  if (error) {
    console.error('[card-reader] charge mode save failed', error.message)
    return { ok: false, error: 'generic' }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'stripe_charge_mode_change',
    tableName: 'settings',
    recordId: tenantId,
    changes: { from: before?.mode ?? null, to: mode, key_replaced: mode === 'own_key' && !!(input.key ?? '').trim(), reader_cleared: changed },
  })
  revalidatePath('/settings/card-reader')
  revalidatePath('/pos/sales/new')
  return { ok: true }
}

/**
 * Use a reader that is ALREADY registered on the shop's Stripe account (e.g.
 * one another RMS app paired) — no pairing code. Owners / chain admins. The
 * reader must exist on the account this shop charges on; its Terminal
 * Location comes with it.
 */
export async function adoptReaderAction(readerId: string): Promise<ReaderActionResult> {
  const { supabase, userId, tenantId } = await owner()
  if (!/^tmr_[A-Za-z0-9]+$/.test(readerId)) return { ok: false, error: 'invalid' }
  if (!(await tenantStripeReady(tenantId))) return { ok: false, error: 'notConnected' }

  let reader: Awaited<ReturnType<typeof getTerminalReader>>
  try {
    reader = await getTerminalReader({ tenantId, readerId })
  } catch (e) {
    return { ok: false, error: 'pairFailed', detail: e instanceof Error ? e.message : undefined }
  }

  const { error } = await supabase
    .from('settings')
    .update({
      stripe_terminal_reader_id: reader.id,
      stripe_terminal_reader_label: (reader.label ?? reader.id).slice(0, 60),
      stripe_terminal_location_id: reader.location ?? null,
    })
    .eq('tenant_id', tenantId)
  if (error) {
    console.error('[card-reader] use existing failed', error.message)
    return { ok: false, error: 'generic' }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'terminal_reader_pair',
    tableName: 'settings',
    recordId: tenantId,
    changes: { reader_id: reader.id, label: reader.label, device_type: reader.device_type, existing: true },
  })
  revalidatePath('/settings/card-reader')
  revalidatePath('/pos/sales/new')
  return { ok: true }
}
