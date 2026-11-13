'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import {
  COUNT_RESOLVE_ROLES,
  COUNT_ROLES,
  resolveExceptionSchema,
  startCountSchema,
  type CountError,
  type StartCountInput,
} from '@/lib/counts/types'
import {
  loadCountSession,
  rpcCancelCount,
  rpcCloseCount,
  rpcResolveException,
  rpcStartCount,
} from '@/lib/counts/server'

type Result = { ok: true } | { ok: false; error: CountError }

async function activeTenant(): Promise<string> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  return ctx.tenantId
}

/** Start a count; on success navigates to it. */
export async function startCountAction(input: StartCountInput): Promise<Result> {
  const tenantId = await activeTenant()
  const { userId } = await requireRoleInTenant(tenantId, COUNT_ROLES)

  const parsed = startCountSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'count_bad_kind' }
  const v = parsed.data

  const r = await rpcStartCount({
    tenantId,
    userId,
    kind: v.kind,
    location: v.kind === 'case' ? v.location : null,
    shelf: v.kind === 'case' ? v.shelf : null,
    category: v.kind === 'case' ? v.category : null,
    transferId: v.kind === 'transfer' ? v.transferId : null,
    note: v.note ?? null,
  })
  if (!r.ok) return r

  await logAudit({
    tenantId,
    userId,
    action: 'count_start',
    tableName: 'count_sessions',
    recordId: r.data,
    changes: { ...v },
  })

  revalidatePath('/inventory/counts')
  if (v.kind === 'transfer') revalidatePath(`/inventory/transfers/${v.transferId}`)
  redirect(`/inventory/counts/${r.data}`)
}

/** Close a count. `notes` maps collateral/inventory item id to a note; pledges require one. */
export async function closeCountAction(sessionId: string, notes: Record<string, string>): Promise<Result> {
  const tenantId = await activeTenant()
  const { supabase, userId } = await requireRoleInTenant(tenantId, COUNT_ROLES)

  const session = await loadCountSession(supabase, tenantId, sessionId)
  if (!session) return { ok: false, error: 'count_not_found' }
  if (session.status !== 'open') return { ok: false, error: 'count_not_open' }

  const clean: Record<string, string> = {}
  for (const [k, val] of Object.entries(notes ?? {})) {
    if (typeof val === 'string' && /^[0-9a-f-]{36}$/i.test(k)) clean[k] = val.trim().slice(0, 500)
  }

  const r = await rpcCloseCount({ tenantId, userId, sessionId, notes: clean })
  if (!r.ok) return r

  await logAudit({
    tenantId,
    userId,
    action: 'count_close',
    tableName: 'count_sessions',
    recordId: sessionId,
    changes: { kind: session.kind, count_number: session.count_number, ...r.data },
  })

  revalidatePath('/inventory/counts')
  revalidatePath(`/inventory/counts/${sessionId}`)
  revalidatePath('/dashboard')
  if (session.transfer_id) revalidatePath(`/inventory/transfers/${session.transfer_id}`)
  return { ok: true }
}

export async function cancelCountAction(sessionId: string): Promise<Result> {
  const tenantId = await activeTenant()
  const { supabase, userId } = await requireRoleInTenant(tenantId, COUNT_ROLES)

  const session = await loadCountSession(supabase, tenantId, sessionId)
  if (!session) return { ok: false, error: 'count_not_found' }

  const r = await rpcCancelCount({ tenantId, userId, sessionId })
  if (!r.ok) return r

  await logAudit({
    tenantId,
    userId,
    action: 'count_cancel',
    tableName: 'count_sessions',
    recordId: sessionId,
    changes: { kind: session.kind, count_number: session.count_number },
  })

  revalidatePath('/inventory/counts')
  revalidatePath(`/inventory/counts/${sessionId}`)
  if (session.transfer_id) revalidatePath(`/inventory/transfers/${session.transfer_id}`)
  return { ok: true }
}

export async function resolveExceptionAction(input: {
  exceptionId: string
  resolution: string
  note?: string
}): Promise<Result> {
  const tenantId = await activeTenant()
  const { userId } = await requireRoleInTenant(tenantId, COUNT_RESOLVE_ROLES)

  const parsed = resolveExceptionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'count_bad_resolution' }
  const v = parsed.data

  const r = await rpcResolveException({
    tenantId,
    userId,
    exceptionId: v.exceptionId,
    resolution: v.resolution,
    note: v.note ?? null,
  })
  if (!r.ok) return r

  await logAudit({
    tenantId,
    userId,
    action: 'count_exception_resolve',
    tableName: 'count_exceptions',
    recordId: v.exceptionId,
    changes: { resolution: v.resolution, note: v.note ?? null },
  })

  revalidatePath('/inventory/counts', 'layout')
  revalidatePath('/dashboard')
  return { ok: true }
}
