'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  closeRegisterSchema,
  openRegisterSchema,
} from '@/lib/validations/pos'
import { logAudit } from '@/lib/audit'
import { cashVariance } from '@/lib/pos/register'
import { expectedDrawerCash, loadDrawerCash, type DrawerCashLines } from '@/lib/pos/drawer-cash'

/**
 * Register-session actions (open / close). Sale + return + layaway actions
 * live next to their detail pages.
 *
 * Roles: opening / closing requires owner / manager / chain_admin.
 */

export type RegisterActionResult = { error?: string; ok?: boolean }

const OPEN_CLOSE_ROLES = ['owner', 'manager', 'chain_admin'] as const

// ── Open register ──────────────────────────────────────────────────────────

export async function openRegisterAction(
  formData: FormData,
): Promise<RegisterActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_retail) return { error: 'not_authorized' }

  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    OPEN_CLOSE_ROLES,
  )

  const parsed = openRegisterSchema.safeParse({
    opening_cash: formData.get('opening_cash'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  // Defense in depth — the trigger also blocks this.
  const { data: existing } = await supabase
    .from('register_sessions')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .maybeSingle()
  if (existing) return { error: 'sessionAlreadyOpen' }

  const { data: row, error } = await supabase
    .from('register_sessions')
    .insert({
      tenant_id: ctx.tenantId,
      status: 'open',
      opened_by: userId,
      opening_cash: v.opening_cash,
      notes: v.notes,
    })
    .select('id')
    .single()
  if (error || !row) return { error: error?.message ?? 'open_failed' }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'register_open',
    tableName: 'register_sessions',
    recordId: row.id,
    changes: { opening_cash: v.opening_cash, notes: v.notes ?? null },
  })

  revalidatePath('/pos')
  return { ok: true }
}

// ── Close register ─────────────────────────────────────────────────────────

export async function closeRegisterAction(
  formData: FormData,
): Promise<RegisterActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    OPEN_CLOSE_ROLES,
  )

  const parsed = closeRegisterSchema.safeParse({
    session_id: formData.get('session_id'),
    closing_cash_counted: formData.get('closing_cash_counted'),
    card_batch_total: formData.get('card_batch_total'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  // Look up session and confirm it's open + scoped to the active tenant.
  const { data: session } = await supabase
    .from('register_sessions')
    .select('id, tenant_id, opening_cash, opened_at, status, notes')
    .eq('id', v.session_id)
    .maybeSingle()
  if (!session) return { error: 'session_not_found' }
  if (session.tenant_id !== ctx.tenantId) return { error: 'not_authorized' }
  if (session.status !== 'open') return { error: 'session_not_open' }

  // Every cash movement of the shop since the drawer opened — POS, pawn,
  // repairs, buys, payouts (one drawer at a time; loadDrawerCash). The
  // same function feeds the open-drawer card and the Daily register report.
  const closedAt = new Date().toISOString()
  let cash: DrawerCashLines
  try {
    cash = await loadDrawerCash({ supabase, tenantId: ctx.tenantId, from: session.opened_at, to: closedAt })
  } catch (err) {
    console.error('[pos.closeRegister] drawer cash failed', err)
    return { error: 'drawer_cash_failed' }
  }
  const expected = expectedDrawerCash(session.opening_cash, cash)
  const variance = cashVariance({
    counted: v.closing_cash_counted,
    expected,
  })

  const { error: upErr } = await supabase
    .from('register_sessions')
    .update({
      status: 'closed',
      closed_by: userId,
      closed_at: closedAt,
      closing_cash_counted: v.closing_cash_counted,
      card_batch_total: v.card_batch_total,
      expected_cash: expected,
      cash_variance: variance,
      notes: v.notes ?? session.notes,
    })
    .eq('id', session.id)
    .eq('tenant_id', ctx.tenantId)
  if (upErr) return { error: upErr.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'register_close',
    tableName: 'register_sessions',
    recordId: session.id,
    changes: {
      counted: v.closing_cash_counted,
      expected,
      variance,
      card_batch_total: v.card_batch_total,
      cash,
    },
  })

  revalidatePath('/pos')
  return { ok: true }
}
