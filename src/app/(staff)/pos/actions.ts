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
import { expectedCash, cashVariance } from '@/lib/pos/register'
import { r4, toMoney } from '@/lib/pos/cart'

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
    .select('id, tenant_id, opening_cash, status, notes')
    .eq('id', v.session_id)
    .maybeSingle()
  if (!session) return { error: 'session_not_found' }
  if (session.tenant_id !== ctx.tenantId) return { error: 'not_authorized' }
  if (session.status !== 'open') return { error: 'session_not_open' }

  // Aggregate cash sale_payments + layaway_payments + cash refunds during
  // this session window. The session opened at register_sessions.opened_at;
  // we conservatively use the row's created_at as the session boundary.
  const { data: openedRow } = await supabase
    .from('register_sessions')
    .select('opened_at')
    .eq('id', session.id)
    .maybeSingle()
  const openedAt = openedRow?.opened_at ?? new Date(0).toISOString()
  const closedAt = new Date().toISOString()

  // Sale payments (cash) since session opened.
  const { data: salePayments } = await supabase
    .from('sale_payments')
    .select('amount, payment_method')
    .eq('tenant_id', ctx.tenantId)
    .eq('payment_method', 'cash')
    .gte('occurred_at', openedAt)
    .is('deleted_at', null)

  // Layaway payments (cash) since session opened. Negative amounts (refunds)
  // are subtracted naturally.
  const { data: layawayPayments } = await supabase
    .from('layaway_payments')
    .select('amount, payment_method')
    .eq('tenant_id', ctx.tenantId)
    .eq('payment_method', 'cash')
    .gte('occurred_at', openedAt)
    .is('deleted_at', null)

  // Cash refunds = returns with refund_method='cash' since session opened.
  const { data: cashReturns } = await supabase
    .from('returns')
    .select('total, refund_method')
    .eq('tenant_id', ctx.tenantId)
    .eq('refund_method', 'cash')
    .gte('created_at', openedAt)
    .is('deleted_at', null)

  let cashSales = 0
  for (const p of salePayments ?? []) {
    cashSales = r4(cashSales + toMoney(p.amount))
  }
  for (const p of layawayPayments ?? []) {
    cashSales = r4(cashSales + toMoney(p.amount))
  }
  let cashRefunds = 0
  for (const r of cashReturns ?? []) {
    cashRefunds = r4(cashRefunds + toMoney(r.total))
  }

  const expected = expectedCash({
    opening_cash: session.opening_cash,
    cash_payments: cashSales,
    cash_refunds: cashRefunds,
  })
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
      cash_sales: cashSales,
      cash_refunds: cashRefunds,
    },
  })

  revalidatePath('/pos')
  return { ok: true }
}
