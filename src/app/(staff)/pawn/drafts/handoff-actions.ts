'use server'

import QRCode from 'qrcode'
import { siteOrigin } from '@/lib/http/site-origin'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  cancelHandoff,
  HANDOFF_MINUTES,
  handoffStatus,
  startHandoff,
  upsertLoanDraft,
  type HandoffStatus,
} from '@/lib/pawn/draft-handoff'

const DRAFT_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function draftScope() {
  const ctx = await getCtx()
  if (!ctx?.tenantId) return null
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) return null
  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, [...DRAFT_ROLES])
  return { supabase, userId, tenantId: ctx.tenantId }
}

/**
 * "Continue on another device": save the ticket as a draft and return the QR
 * code that opens it on the other device (lib/pawn/draft-handoff).
 */
export async function startDraftHandoffAction(
  formData: FormData,
): Promise<
  | { ok: true; draftId: string; qrSvg: string; minutes: number }
  | { ok: false; error: 'no_customer' | 'failed' }
> {
  const scope = await draftScope()
  if (!scope) return { ok: false, error: 'failed' }
  const draftId = await upsertLoanDraft({ ...scope, formData })
  if (!draftId) return { ok: false, error: 'no_customer' }
  const started = await startHandoff({ ...scope, table: 'loan_drafts', draftId })
  if (!started) return { ok: false, error: 'failed' }
  const url = `${await siteOrigin()}/pawn/new?draft=${draftId}&handoff=${started.code}`
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return { ok: true, draftId, qrSvg, minutes: HANDOFF_MINUTES }
}

/** Asked every few seconds by the computer showing the code. */
export async function draftHandoffStatusAction(draftId: string): Promise<HandoffStatus> {
  if (!UUID.test(draftId)) return 'gone'
  const scope = await draftScope()
  if (!scope) return 'gone'
  return handoffStatus(scope.supabase, 'loan_drafts', scope.tenantId, draftId)
}

/** The computer keeps the ticket: the code stops working. */
export async function cancelDraftHandoffAction(draftId: string): Promise<void> {
  if (!UUID.test(draftId)) return
  const scope = await draftScope()
  if (!scope) return
  await cancelHandoff(scope.supabase, 'loan_drafts', scope.tenantId, draftId)
}
