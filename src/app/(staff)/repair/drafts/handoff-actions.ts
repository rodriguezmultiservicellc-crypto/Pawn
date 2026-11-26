'use server'

import QRCode from 'qrcode'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { siteOrigin } from '@/lib/http/site-origin'
import {
  cancelHandoff,
  HANDOFF_MINUTES,
  handoffStatus,
  startHandoff,
  type HandoffStatus,
} from '@/lib/pawn/draft-handoff'
import { upsertRepairDraft } from '@/lib/repair/draft-save'

/** Who may open a repair ticket (same list as createRepairTicketAction). */
const REPAIR_ROLES = ['owner', 'manager', 'pawn_clerk', 'repair_tech', 'chain_admin'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function draftScope() {
  const ctx = await getCtx()
  if (!ctx?.tenantId) return null
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) return null
  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, [...REPAIR_ROLES])
  return { supabase, userId, tenantId: ctx.tenantId }
}

/**
 * "Continue on another device" on New repair ticket: save it as a draft and
 * return the QR code that opens it on the other device (patches/0118).
 */
export async function startRepairHandoffAction(
  formData: FormData,
): Promise<
  | { ok: true; draftId: string; qrSvg: string; minutes: number }
  | { ok: false; error: 'no_customer' | 'failed' }
> {
  const scope = await draftScope()
  if (!scope) return { ok: false, error: 'failed' }
  const draftId = await upsertRepairDraft({ ...scope, formData })
  if (!draftId) return { ok: false, error: 'no_customer' }
  const started = await startHandoff({ ...scope, table: 'repair_drafts', draftId })
  if (!started) return { ok: false, error: 'failed' }
  const url = `${await siteOrigin()}/repair/new?draft=${draftId}&handoff=${started.code}`
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return { ok: true, draftId, qrSvg, minutes: HANDOFF_MINUTES }
}

/** Asked every few seconds by the computer showing the code. */
export async function repairHandoffStatusAction(draftId: string): Promise<HandoffStatus> {
  if (!UUID.test(draftId)) return 'gone'
  const scope = await draftScope()
  if (!scope) return 'gone'
  return handoffStatus(scope.supabase, 'repair_drafts', scope.tenantId, draftId)
}

/** The computer keeps the ticket: the code stops working. */
export async function cancelRepairHandoffAction(draftId: string): Promise<void> {
  if (!UUID.test(draftId)) return
  const scope = await draftScope()
  if (!scope) return
  await cancelHandoff(scope.supabase, 'repair_drafts', scope.tenantId, draftId)
}
