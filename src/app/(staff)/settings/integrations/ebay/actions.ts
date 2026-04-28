'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { markDisconnected } from '@/lib/ebay/auth'
import { syncListing } from '@/lib/ebay/listings'
import type { EbayListingRow } from '@/types/database-aliases'

export type ActionResult = { ok: true } | { ok: false; error: string }

const OWNER_ROLES = ['owner', 'chain_admin', 'manager'] as const

/**
 * Disconnect eBay — wipes tokens but keeps the row. The row's
 * disconnected_at flips, audit row written, settings page revalidated.
 */
export async function disconnectEbayAction(): Promise<ActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireRoleInTenant(ctx.tenantId, OWNER_ROLES)

  await markDisconnected(ctx.tenantId)

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'ebay_oauth_disconnected',
    tableName: 'tenant_ebay_credentials',
    recordId: ctx.tenantId,
    changes: null,
  })

  revalidatePath('/settings/integrations/ebay')
  return { ok: true }
}

/**
 * Update merchant location key + policy ids — these are required before
 * publishing. Operator looks them up in eBay Seller Hub and pastes them
 * here.
 */
export async function updateEbayConfigAction(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireRoleInTenant(ctx.tenantId, OWNER_ROLES)

  const merchantLocationKey =
    (formData.get('merchant_location_key') as string | null)?.trim() || null
  const fulfillmentPolicyId =
    (formData.get('fulfillment_policy_id') as string | null)?.trim() || null
  const paymentPolicyId =
    (formData.get('payment_policy_id') as string | null)?.trim() || null
  const returnPolicyId =
    (formData.get('return_policy_id') as string | null)?.trim() || null
  const siteId =
    (formData.get('site_id') as string | null)?.trim() || 'EBAY_US'

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any
  const { error } = await supa
    .from('tenant_ebay_credentials')
    .update({
      merchant_location_key: merchantLocationKey,
      fulfillment_policy_id: fulfillmentPolicyId,
      payment_policy_id: paymentPolicyId,
      return_policy_id: returnPolicyId,
      site_id: siteId,
    })
    .eq('tenant_id', ctx.tenantId)

  if (error) return { ok: false, error: 'update_failed' }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update',
    tableName: 'tenant_ebay_credentials',
    recordId: ctx.tenantId,
    changes: {
      merchant_location_key: merchantLocationKey,
      fulfillment_policy_id: fulfillmentPolicyId,
      payment_policy_id: paymentPolicyId,
      return_policy_id: returnPolicyId,
      site_id: siteId,
    },
  })

  revalidatePath('/settings/integrations/ebay')
  return { ok: true }
}

/**
 * Run the per-tenant sync now — same control flow as the cron, but
 * scoped to one tenant and triggered by a button. STUB underneath.
 */
export async function runSyncNowAction(): Promise<
  | { ok: true; synced: number; failed: number }
  | { ok: false; error: string }
> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireRoleInTenant(ctx.tenantId, OWNER_ROLES)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any
  const { data: listings } = (await supa
    .from('ebay_listings')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'active')
    .is('deleted_at', null)) as { data: Array<Pick<EbayListingRow, 'id'>> | null }

  let synced = 0
  let failed = 0
  for (const listing of listings ?? []) {
    try {
      await syncListing({ tenantId: ctx.tenantId, listingId: listing.id })
      synced++
    } catch {
      failed++
    }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'ebay_listing_sync',
    tableName: 'ebay_listings',
    recordId: ctx.tenantId, // tenant-level run; no single listing
    changes: { synced, failed, manual: true },
  })

  revalidatePath('/settings/integrations/ebay')
  return { ok: true, synced, failed }
}
