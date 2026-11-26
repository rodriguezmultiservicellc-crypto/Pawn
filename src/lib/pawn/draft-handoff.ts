import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { buildDraftPayload } from '@/lib/pawn/intake-form'

/**
 * Pawn drafts on the server: saving one from the New pawn form, and moving
 * one to another device with a QR code (patches/0117; Eddy, 2026-11-26).
 * The handoff functions take the table: repair drafts move the same way
 * (patches/0118, /repair/new; saved by lib/repair/draft-save).
 *
 * Handoff: the computer saves the draft and gets a one-time code (only its
 * SHA-256 is stored) that is good for HANDOFF_MINUTES. The QR code is the
 * link /pawn/new?draft=<id>&handoff=<code>. The device that opens it claims
 * the draft (claimHandoff) — once — and the computer, which asks every few
 * seconds (handoffStatus), closes its copy. The code is not a login: the
 * device must be signed in as staff of the shop.
 */

export const HANDOFF_MINUTES = 10

/** The drafts that can move: pawn tickets (0117) and repair tickets (0118).
 *  Both tables have the same handoff columns. */
export type DraftTable = 'loan_drafts' | 'repair_drafts'

/** loan_drafts is reached through a generic client (see drafts/actions). */
const asDb = (s: unknown) => s as SupabaseClient

export function hashHandoffCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Save (or update) the draft from the New pawn form. Null when the customer
 *  is missing or not this shop's. */
export async function upsertLoanDraft(args: {
  supabase: unknown
  tenantId: string
  userId: string
  formData: FormData
}): Promise<string | null> {
  const db = asDb(args.supabase)
  const { tenantId, userId, formData } = args
  const customerId = String(formData.get('customer_id') ?? '').trim()
  if (!customerId) return null
  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return null

  const payload = buildDraftPayload(formData)
  const draftId = String(formData.get('draft_id') ?? '').trim()

  if (draftId) {
    const { data: updated } = await db
      .from('loan_drafts')
      .update({ customer_id: customerId, payload, updated_by: userId })
      .eq('id', draftId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()
    if (updated) {
      await logAudit({
        tenantId,
        userId,
        action: 'update',
        tableName: 'loan_drafts',
        recordId: draftId,
        changes: { customer_id: customerId, item_count: payload.collateral.length },
      })
      return draftId
    }
  }

  const { data: inserted } = await db
    .from('loan_drafts')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      payload,
      created_by: userId,
      updated_by: userId,
    })
    .select('id')
    .single()
  const newId = (inserted as { id: string } | null)?.id ?? null
  if (newId) {
    await logAudit({
      tenantId,
      userId,
      action: 'create',
      tableName: 'loan_drafts',
      recordId: newId,
      changes: { customer_id: customerId, item_count: payload.collateral.length },
    })
  }
  return newId
}

/** Arm a handoff on a saved draft: a fresh one-time code, the old one gone. */
export async function startHandoff(args: {
  supabase: unknown
  table: DraftTable
  tenantId: string
  userId: string
  draftId: string
}): Promise<{ code: string; expiresAt: string } | null> {
  const code = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + HANDOFF_MINUTES * 60_000).toISOString()
  const { data } = await asDb(args.supabase)
    .from(args.table)
    .update({
      handoff_token_hash: hashHandoffCode(code),
      handoff_expires_at: expiresAt,
      handoff_claimed_at: null,
      handoff_claimed_by: null,
    })
    .eq('id', args.draftId)
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (!data) return null
  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'update',
    tableName: args.table,
    recordId: args.draftId,
    changes: { kind: 'handoff_start', expires_at: expiresAt },
  })
  return { code, expiresAt }
}

export type HandoffStatus = 'waiting' | 'claimed' | 'expired' | 'gone'

export async function handoffStatus(
  supabase: unknown,
  table: DraftTable,
  tenantId: string,
  draftId: string,
): Promise<HandoffStatus> {
  const { data } = await asDb(supabase)
    .from(table)
    .select('handoff_token_hash, handoff_expires_at, handoff_claimed_at, deleted_at')
    .eq('id', draftId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const d = data as {
    handoff_token_hash: string | null
    handoff_expires_at: string | null
    handoff_claimed_at: string | null
    deleted_at: string | null
  } | null
  if (!d) return 'gone'
  if (d.handoff_claimed_at) return 'claimed'
  // Issued on the other device already (the draft is closed).
  if (d.deleted_at) return 'gone'
  if (!d.handoff_token_hash || !d.handoff_expires_at) return 'expired'
  return new Date(d.handoff_expires_at).getTime() <= Date.now() ? 'expired' : 'waiting'
}

/** The computer kept the ticket: the code stops working. */
export async function cancelHandoff(
  supabase: unknown,
  table: DraftTable,
  tenantId: string,
  draftId: string,
) {
  await asDb(supabase)
    .from(table)
    .update({ handoff_token_hash: null, handoff_expires_at: null })
    .eq('id', draftId)
    .eq('tenant_id', tenantId)
    .is('handoff_claimed_at', null)
}

export type ClaimResult = 'claimed' | 'expired' | 'used'

/**
 * The scanning device takes the draft: only with the right code, before it
 * expires, and once (the update matches the code and an unclaimed row, so
 * two devices scanning at the same moment cannot both win).
 */
export async function claimHandoff(args: {
  supabase: unknown
  table: DraftTable
  tenantId: string
  userId: string
  draftId: string
  code: string
}): Promise<ClaimResult> {
  const db = asDb(args.supabase)
  const now = new Date().toISOString()
  const { data } = await db
    .from(args.table)
    .update({
      handoff_claimed_at: now,
      handoff_claimed_by: args.userId,
      handoff_token_hash: null,
    })
    .eq('id', args.draftId)
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
    .is('handoff_claimed_at', null)
    .eq('handoff_token_hash', hashHandoffCode(args.code))
    .gt('handoff_expires_at', now)
    .select('id')
    .maybeSingle()
  if (data) {
    await logAudit({
      tenantId: args.tenantId,
      userId: args.userId,
      action: 'update',
      tableName: args.table,
      recordId: args.draftId,
      changes: { kind: 'handoff_claim' },
    })
    return 'claimed'
  }
  const status = await handoffStatus(db, args.table, args.tenantId, args.draftId)
  return status === 'expired' ? 'expired' : 'used'
}
