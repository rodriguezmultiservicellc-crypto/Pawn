'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { dispatchMessage } from '@/lib/comms/dispatch'
import { newPawnToken, pawnTrackingUrl } from '@/lib/pawn/public-link'

/**
 * The customer page link of a pawn ticket (/p/<token>, patches/0127).
 * Any pawn staff role; the link table has no staff policy, so it is written
 * with the service role AFTER the role check (rule 10). A link is made the
 * first time it is copied, opened or sent.
 */

export type PawnLinkResult = {
  ok?: boolean
  /** t.pawn.detail.customerLink.errors[code] */
  error?: string
  link?: string | null
}

const PAWN_ROLES = ['owner', 'chain_admin', 'manager', 'pawn_clerk'] as const

async function resolveLoan(loanIdRaw: unknown) {
  const parsed = z.string().uuid().safeParse(loanIdRaw)
  if (!parsed.success) return null
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { data: tenant } = await ctx.supabase.from('tenants').select('has_pawn').eq('id', ctx.tenantId).maybeSingle()
  if (!tenant?.has_pawn) return null
  const { userId } = await requireRoleInTenant(ctx.tenantId, PAWN_ROLES)
  const { data: loan } = await ctx.supabase
    .from('loans')
    .select('id, tenant_id, customer_id, ticket_number, status')
    .eq('id', parsed.data)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!loan || loan.status === 'voided') return null
  return { loan, userId, tenantId: ctx.tenantId }
}

type Admin = ReturnType<typeof createAdminClient>

async function liveToken(admin: Admin, tenantId: string, loanId: string): Promise<string | null> {
  const { data } = await admin
    .from('loan_public_links')
    .select('token')
    .eq('tenant_id', tenantId)
    .eq('loan_id', loanId)
    .is('revoked_at', null)
    .maybeSingle()
  return data?.token ?? null
}

async function createToken(admin: Admin, tenantId: string, loanId: string, userId: string): Promise<string | null> {
  const token = newPawnToken()
  const { error } = await admin
    .from('loan_public_links')
    .insert({ tenant_id: tenantId, loan_id: loanId, token, created_by: userId })
  if (error) {
    // Two presses at once: the other one made it.
    if (error.code === '23505') return liveToken(admin, tenantId, loanId)
    console.error('[pawn-link] insert failed', error.message)
    return null
  }
  await logAudit({ tenantId, userId, action: 'pawn_link_create', tableName: 'loan_public_links', recordId: loanId })
  return token
}

async function ensureToken(admin: Admin, tenantId: string, loanId: string, userId: string): Promise<string | null> {
  return (await liveToken(admin, tenantId, loanId)) ?? (await createToken(admin, tenantId, loanId, userId))
}

async function revokeLive(admin: Admin, tenantId: string, loanId: string, userId: string): Promise<void> {
  await admin
    .from('loan_public_links')
    .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq('tenant_id', tenantId)
    .eq('loan_id', loanId)
    .is('revoked_at', null)
}

/** The link, made now if the ticket has none (Copy / Open). */
export async function ensurePawnLinkAction(loanId: string): Promise<PawnLinkResult> {
  const scope = await resolveLoan(loanId)
  if (!scope) return { error: 'not_found' }
  const token = await ensureToken(createAdminClient(), scope.tenantId, scope.loan.id, scope.userId)
  if (!token) return { error: 'failed' }
  revalidatePath(`/pawn/${scope.loan.id}`)
  return { ok: true, link: pawnTrackingUrl(token) }
}

/** A new link; the old one stops working. */
export async function newPawnLinkAction(loanId: string): Promise<PawnLinkResult> {
  const scope = await resolveLoan(loanId)
  if (!scope) return { error: 'not_found' }
  const admin = createAdminClient()
  await revokeLive(admin, scope.tenantId, scope.loan.id, scope.userId)
  const token = await createToken(admin, scope.tenantId, scope.loan.id, scope.userId)
  if (!token) return { error: 'failed' }
  revalidatePath(`/pawn/${scope.loan.id}`)
  return { ok: true, link: pawnTrackingUrl(token) }
}

/** The link stops working; none until a new one is made. */
export async function revokePawnLinkAction(loanId: string): Promise<PawnLinkResult> {
  const scope = await resolveLoan(loanId)
  if (!scope) return { error: 'not_found' }
  await revokeLive(createAdminClient(), scope.tenantId, scope.loan.id, scope.userId)
  await logAudit({
    tenantId: scope.tenantId,
    userId: scope.userId,
    action: 'pawn_link_revoke',
    tableName: 'loan_public_links',
    recordId: scope.loan.id,
  })
  revalidatePath(`/pawn/${scope.loan.id}`)
  return { ok: true, link: null }
}

/** Text the link to the customer: the 'pawn_tracking_link' template through
 *  the shop's messaging (Settings → Communications). */
export async function sendPawnLinkAction(loanId: string): Promise<PawnLinkResult> {
  const scope = await resolveLoan(loanId)
  if (!scope) return { error: 'not_found' }
  const { loan, tenantId, userId } = scope
  const token = await ensureToken(createAdminClient(), tenantId, loan.id, userId)
  const link = pawnTrackingUrl(token)
  if (!link) return { error: 'failed' }

  const res = await dispatchMessage({
    tenantId,
    customerId: loan.customer_id,
    kind: 'pawn_tracking_link',
    channelOverride: 'sms',
    vars: { ticket_number: loan.ticket_number ?? '', tracking_link: link },
    related: { loanId: loan.id },
  })
  if (!res.ok) return { error: res.reason, link }

  await logAudit({
    tenantId,
    userId,
    action: 'pawn_link_send',
    tableName: 'loan_public_links',
    recordId: loan.id,
    changes: { channel: res.channel, message_log_id: res.messageLogId },
  })
  revalidatePath(`/pawn/${loan.id}`)
  return { ok: true, link }
}
