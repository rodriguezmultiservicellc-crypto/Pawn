/**
 * Send tickets to the LeadsOnline web service, from compliance_log rows only
 * (rule 15), and keep LeadsOnline's answer in leadsonline_submissions
 * (patches/0123).
 *
 *   - A ticket not yet accepted in this environment → SubmitTransaction.
 *   - A ticket already accepted there → UpdateTransaction with its own key
 *     (a second Submit of the same key is error 13). That is how a pawn
 *     voided after it was reported goes again, isVoid = true.
 *   - Voided before it was ever sent → one Submit, already isVoid = true —
 *     as xPawn's files never held a voided ticket back.
 *
 * Images ride inside the ticket: every item photo (inventory-photos), the
 * customer's ID scan (customer-documents, the newest one taken by the ticket's
 * time) and, for a pawn, the signature. A type LeadsOnline does not take
 * (webp, heic) is left out. Sending writes nothing to compliance_log: the
 * daily file's exported_* stamps stay the file's.
 *
 * Server only; the caller has already checked the role (rule 10).
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildNcicBySlug } from '@/lib/compliance/ncic'
import { logAudit } from '@/lib/audit'
import { CUSTOMER_DOCUMENTS_BUCKET, INVENTORY_PHOTOS_BUCKET } from '@/lib/supabase/storage'
import type { ComplianceLogRow } from '@/types/database-aliases'
import { callLeadsOnline, loadLeadsOnlineConfig } from './client'
import {
  imageTypeOfPath,
  itemPhotoPaths,
  parseResponse,
  submitTransactionEnvelope,
  ticketFromComplianceRow,
  updateTransactionEnvelope,
  type ImageCategory,
  type LeadsOnlineEnv,
  type SoapImage,
  type TicketImages,
} from './soap'

export type SendResult = {
  complianceLogId: string
  ticketNumber: string
  method: 'SubmitTransaction' | 'UpdateTransaction'
  isVoid: boolean
  ok: boolean
  errorCode: number | null
  errorResponse: string
}

/** Most tickets per press: each one is a slow call to the sandbox. */
export const LEADSONLINE_SEND_MAX = 25

/** Images per ticket stop here (base64 grows a third on the wire). */
const IMAGE_BYTES_MAX = 8 * 1024 * 1024

type Admin = ReturnType<typeof createAdminClient>

async function download(admin: Admin, bucket: string, path: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(bucket).download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

async function ticketImages(admin: Admin, tenantId: string, row: ComplianceLogRow): Promise<{ images: TicketImages; count: number }> {
  let budget = IMAGE_BYTES_MAX
  let count = 0
  const take = async (bucket: string, path: string, category: ImageCategory): Promise<SoapImage | null> => {
    const type = imageTypeOfPath(path)
    // Only this shop's files (every bucket here is <tenant_id>/...).
    if (!type || !path.startsWith(`${tenantId}/`)) return null
    const bytes = await download(admin, bucket, path)
    if (!bytes || bytes.length > budget) return null
    budget -= bytes.length
    count += 1
    return { category, type, base64: bytes.toString('base64') }
  }

  const items = Array.isArray(row.items_snapshot) ? (row.items_snapshot as Record<string, unknown>[]) : []
  const itemImages: SoapImage[][] = []
  for (const it of items) {
    const list: SoapImage[] = []
    for (const p of itemPhotoPaths(it)) {
      const im = await take(INVENTORY_PHOTOS_BUCKET, p, 'Item')
      if (im) list.push(im)
    }
    itemImages.push(list)
  }

  const customer: SoapImage[] = []
  const customerId = (row.customer_snapshot as Record<string, unknown> | null)?.id
  if (typeof customerId === 'string') {
    const { data: docs } = await admin
      .from('customer_documents')
      .select('storage_path, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('kind', 'id_scan')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10)
    // The ID on file when the ticket was written; else the first one after.
    const scan = (docs ?? []).find((d) => d.created_at <= row.occurred_at) ?? (docs ?? []).at(-1)
    if (scan) {
      const im = await take(CUSTOMER_DOCUMENTS_BUCKET, scan.storage_path, 'CustomerID')
      if (im) customer.push(im)
    }
  }
  if (row.event_type === 'pawn_intake') {
    const { data: loan } = await admin
      .from('loans')
      .select('signature_path')
      .eq('tenant_id', tenantId)
      .eq('id', row.source_id)
      .maybeSingle()
    if (loan?.signature_path) {
      const im = await take(CUSTOMER_DOCUMENTS_BUCKET, loan.signature_path, 'Signature')
      if (im) customer.push(im)
    }
  }
  return { images: { customer, items: itemImages }, count }
}

export async function sendTicketsToLeadsOnline(args: {
  tenantId: string
  userId: string
  complianceLogIds: ReadonlyArray<string>
}): Promise<{ ok: true; env: LeadsOnlineEnv; results: SendResult[] } | { ok: false; error: 'not_configured' | 'too_many' | 'no_tickets' }> {
  const { tenantId, userId } = args
  const ids = [...new Set(args.complianceLogIds)]
  if (ids.length === 0) return { ok: false, error: 'no_tickets' }
  if (ids.length > LEADSONLINE_SEND_MAX) return { ok: false, error: 'too_many' }

  const cfg = await loadLeadsOnlineConfig(tenantId)
  if (!cfg.ok) return { ok: false, error: 'not_configured' }
  const { env, login } = cfg.config

  const admin = createAdminClient()
  const [{ data: tenant }, { data: rows }] = await Promise.all([
    admin.from('tenants').select('timezone').eq('id', tenantId).maybeSingle(),
    admin
      .from('compliance_log')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', ids)
      .in('event_type', ['pawn_intake', 'buy_outright'])
      .order('occurred_at', { ascending: true }),
  ])
  const tickets = (rows ?? []) as ComplianceLogRow[]
  if (tickets.length === 0) return { ok: false, error: 'no_tickets' }
  const timeZone = tenant?.timezone || 'America/New_York'

  const pawnIds = tickets.filter((r) => r.event_type === 'pawn_intake').map((r) => r.source_id)
  const [{ data: voids }, { data: accepted }, ncicBySlug] = await Promise.all([
    pawnIds.length
      ? admin.from('compliance_log').select('source_id').eq('tenant_id', tenantId).eq('event_type', 'pawn_void').in('source_id', pawnIds)
      : Promise.resolve({ data: [] as Array<{ source_id: string }> }),
    admin
      .from('leadsonline_submissions')
      .select('compliance_log_id')
      .eq('tenant_id', tenantId)
      .eq('environment', env)
      .eq('ok', true)
      .in('compliance_log_id', tickets.map((r) => r.id)),
    buildNcicBySlug({ supabase: admin, tenantIds: [tenantId] }),
  ])
  const voided = new Set((voids ?? []).map((v) => v.source_id))
  const alreadyIn = new Set((accepted ?? []).map((a) => a.compliance_log_id))

  const results: SendResult[] = []
  for (const row of tickets) {
    const isVoid = row.event_type === 'pawn_intake' && voided.has(row.source_id)
    const { images, count } = await ticketImages(admin, tenantId, row)
    const ticket = ticketFromComplianceRow({ row, voided: isVoid, timeZone, ncicBySlug, images })
    const method = alreadyIn.has(row.id) ? 'UpdateTransaction' : 'SubmitTransaction'
    const body =
      method === 'UpdateTransaction'
        ? updateTransactionEnvelope(login, ticket.key, ticket)
        : submitTransactionEnvelope(login, ticket)

    const call = await callLeadsOnline(env, method, body)
    const answer = call.ok ? parseResponse(call.xml) : ({ kind: 'fault', message: call.message } as const)
    const ok = answer.kind === 'response' && answer.errorCode === 0
    const result: SendResult = {
      complianceLogId: row.id,
      ticketNumber: ticket.key.ticketnumber,
      method,
      isVoid,
      ok,
      errorCode: answer.kind === 'response' ? answer.errorCode : null,
      errorResponse: (answer.kind === 'response' ? answer.errorResponse : answer.message).slice(0, 1000),
    }
    results.push(result)

    const { error: logErr } = await admin.from('leadsonline_submissions').insert({
      tenant_id: tenantId,
      compliance_log_id: row.id,
      environment: env,
      method,
      ticket_type: ticket.key.ticketType,
      ticket_number: ticket.key.ticketnumber,
      ticket_datetime: ticket.key.ticketDateTime,
      is_void: isVoid,
      images_sent: count,
      ok,
      error_code: result.errorCode,
      error_response: result.errorResponse || null,
      submitted_by: userId,
    })
    if (logErr) console.error('[leadsonline] submission log insert failed', logErr.message)
    if (ok) alreadyIn.add(row.id)
  }

  await logAudit({
    tenantId,
    userId,
    action: 'leadsonline_send',
    tableName: 'leadsonline_submissions',
    recordId: tenantId,
    changes: {
      environment: env,
      tickets: results.map((r) => ({ ticket: r.ticketNumber, method: r.method, void: r.isVoid, ok: r.ok, code: r.errorCode })),
    },
  })

  return { ok: true, env, results }
}
