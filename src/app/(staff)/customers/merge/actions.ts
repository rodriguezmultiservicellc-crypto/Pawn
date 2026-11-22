'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { CUSTOMER_MERGE_ROLES } from '@/lib/customers/merge'

/**
 * Customer merge — collapse a duplicate record into the one that stays.
 * Same tool as Luna Azul's /clients/merge. The work happens in the
 * merge_customers() Postgres function (patches/0091): one transaction
 * that moves every reference, fills the kept record's blanks, moves
 * store credit / loyalty points as compensating ledger rows, soft-deletes
 * the duplicate and writes customer_merges + audit_log.
 *
 * Owner / manager / chain_admin only: a merge rewrites who a printed pawn
 * ticket belongs to, which is not a clerk-level action.
 */

/** Tables that reference customers.id, shown in the preview. Mirror of
 *  the UPDATE list in merge_customers() — keep the two in sync. */
const COUNT_TABLES = [
  'loans',
  'sales',
  'repair_tickets',
  'layaways',
  'appraisals',
  'custom_quotes',
  'online_orders',
  'customer_documents',
  'message_log',
  'ofac_screenings',
  'consignors',
  'stripe_payment_links',
  'customer_portal_invites',
] as const
export type MergeCountTable = (typeof COUNT_TABLES)[number]

/** Tokens merge_customers() raises verbatim; anything else → merge_failed. */
const MERGE_ERRORS = [
  'merge_same_customer',
  'merge_customer_not_found',
  'merge_already_merged',
  'merge_both_consignors',
] as const
export type MergeError = (typeof MERGE_ERRORS)[number] | 'merge_failed'

export type MergeWarning = 'different_id_numbers' | 'both_portal' | 'banned_carries_over'

export type MergeSide = {
  id: string
  first_name: string
  last_name: string
  middle_name: string | null
  phone: string | null
  phone_alt: string | null
  email: string | null
  address: string | null
  id_number: string | null
  date_of_birth: string | null
  created_at: string
  imported: boolean
  is_banned: boolean
  has_portal: boolean
  store_credit_balance: number
  loyalty_points_balance: number
}

export type MergePreview =
  | {
      ok: true
      keep: MergeSide
      remove: MergeSide
      counts: Array<{ table: MergeCountTable; keep: number; remove: number }>
      warnings: MergeWarning[]
      blocked: MergeError | null
    }
  | { ok: false; error: MergeError }

const pairSchema = z.object({
  keepId: z.string().uuid(),
  removeId: z.string().uuid(),
})

const SIDE_COLUMNS =
  'id, first_name, last_name, middle_name, phone, phone_alt, email, address1, address2, city, state, zip, id_number, date_of_birth, created_at, legacy_ref, is_banned, auth_user_id, store_credit_balance, loyalty_points_balance'

async function guard() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { userId } = await requireRoleInTenant(ctx.tenantId, CUSTOMER_MERGE_ROLES)
  return { tenantId: ctx.tenantId, userId }
}

function idDigits(n: string | null): string {
  return (n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function getMergePreviewAction(input: {
  keepId: string
  removeId: string
}): Promise<MergePreview> {
  // Guard FIRST, admin client SECOND (Rule 10).
  const { tenantId } = await guard()
  const parsed = pairSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'merge_customer_not_found' }
  const { keepId, removeId } = parsed.data
  if (keepId === removeId) return { ok: false, error: 'merge_same_customer' }

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('customers')
    .select(SIDE_COLUMNS)
    .in('id', [keepId, removeId])
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  const keepRow = rows?.find((r) => r.id === keepId)
  const removeRow = rows?.find((r) => r.id === removeId)
  if (!keepRow || !removeRow) return { ok: false, error: 'merge_customer_not_found' }

  const toSide = (r: NonNullable<typeof keepRow>): MergeSide => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    middle_name: r.middle_name,
    phone: r.phone,
    phone_alt: r.phone_alt,
    email: r.email,
    address:
      [r.address1, r.address2, [r.city, r.state, r.zip].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ') || null,
    id_number: r.id_number,
    date_of_birth: r.date_of_birth,
    created_at: r.created_at,
    imported: !!r.legacy_ref,
    is_banned: r.is_banned,
    has_portal: !!r.auth_user_id,
    store_credit_balance: Number(r.store_credit_balance ?? 0),
    loyalty_points_balance: r.loyalty_points_balance ?? 0,
  })

  const counts = await Promise.all(
    COUNT_TABLES.map(async (table) => {
      const [k, r] = await Promise.all([
        admin.from(table).select('id', { count: 'exact', head: true }).eq('customer_id', keepId),
        admin.from(table).select('id', { count: 'exact', head: true }).eq('customer_id', removeId),
      ])
      return { table, keep: k.count ?? 0, remove: r.count ?? 0 }
    }),
  )

  const keep = toSide(keepRow)
  const remove = toSide(removeRow)
  const warnings: MergeWarning[] = []
  if (keep.id_number && remove.id_number && idDigits(keep.id_number) !== idDigits(remove.id_number))
    warnings.push('different_id_numbers')
  if (keep.has_portal && remove.has_portal) warnings.push('both_portal')
  if (remove.is_banned && !keep.is_banned) warnings.push('banned_carries_over')

  const consignors = counts.find((c) => c.table === 'consignors')
  const blocked: MergeError | null =
    consignors && consignors.keep > 0 && consignors.remove > 0 ? 'merge_both_consignors' : null

  return { ok: true, keep, remove, counts, warnings, blocked }
}

export async function mergeCustomersAction(input: {
  keepId: string
  removeId: string
  notes?: string
}): Promise<{ ok: true; keepId: string } | { ok: false; error: MergeError }> {
  const { tenantId, userId } = await guard()
  const parsed = pairSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'merge_customer_not_found' }
  const { keepId, removeId } = parsed.data
  if (keepId === removeId) return { ok: false, error: 'merge_same_customer' }

  const admin = createAdminClient()
  // The function re-checks that both customers belong to this tenant.
  const { data, error } = await admin.rpc('merge_customers', {
    p_tenant_id: tenantId,
    p_winner_id: keepId,
    p_loser_id: removeId,
    p_actor: userId,
    p_notes: (input.notes ?? '').slice(0, 1000),
  })
  if (error) {
    const hit = MERGE_ERRORS.find((tok) => error.message.includes(tok))
    if (!hit) console.error('[customer-merge] rpc failed', error)
    return { ok: false, error: hit ?? 'merge_failed' }
  }
  if (!(data as { ok?: boolean } | null)?.ok) return { ok: false, error: 'merge_failed' }

  revalidatePath('/customers')
  revalidatePath(`/customers/${keepId}`)
  revalidatePath(`/customers/${removeId}`)
  revalidatePath('/customers/merge')
  return { ok: true, keepId }
}
