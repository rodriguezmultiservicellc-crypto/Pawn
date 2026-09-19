import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { isConsignmentEnabled } from '@/lib/consignment/payables'
import {
  lifetimeCommission,
  lifetimeGross,
  openBalance,
  toMoney,
} from '@/lib/consignment/math'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import ConsignorDetail, {
  type ConsignorItemRow,
  type ConsignorPayableRow,
  type ConsignorPayoutRow,
} from './content'
import type { ConsignmentPayableKind } from '@/types/database-aliases'

const MANAGE_ROLES = new Set(['owner', 'manager', 'chain_admin'])

type Params = Promise<{ id: string }>

export default async function ConsignorDetailPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: consignor } = await ctx.supabase
    .from('consignors')
    .select(
      'id, tenant_id, consignor_number, business_name, default_commission_pct, default_payout_method, status, notes, customer:customers(id, first_name, last_name, phone, email)',
    )
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!consignor) redirect('/consignors')

  const admin = createAdminClient()

  const [
    enabled,
    rules,
    { data: itemRows },
    { data: payableRows },
    { data: payoutRows },
  ] = await Promise.all([
    isConsignmentEnabled(admin, ctx.tenantId),
    loadTenantRules(admin, ctx.tenantId),
    ctx.supabase
      .from('inventory_items')
      .select(
        'id, sku, description, list_price, status, consignment_min_price, consignment_expires_on',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('consignor_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    ctx.supabase
      .from('consignment_payables')
      .select(
        'id, kind, reason, gross_amount, commission_pct, commission_amount, payable_amount, status, created_at, sale_id, return_item_id, inventory_item:inventory_items(sku, description)',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('consignor_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
    ctx.supabase
      .from('consignment_payouts')
      .select('id, payout_number, amount, payout_method, reference, paid_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('consignor_id', id)
      .order('paid_at', { ascending: false })
      .limit(50),
  ])

  type PayableRow = {
    id: string
    kind: string
    reason: string | null
    gross_amount: number | string
    commission_pct: number | string
    commission_amount: number | string
    payable_amount: number | string
    status: string
    created_at: string
    sale_id: string
    return_item_id: string | null
    inventory_item: { sku: string; description: string } | null
  }
  const payables = (payableRows ?? []) as unknown as PayableRow[]

  const ledger: ConsignorPayableRow[] = payables.map((p) => ({
    id: p.id,
    kind: p.kind as ConsignmentPayableKind,
    reason: p.reason,
    gross_amount: toMoney(p.gross_amount),
    commission_amount: toMoney(p.commission_amount),
    payable_amount: toMoney(p.payable_amount),
    status: p.status === 'paid' ? 'paid' : 'open',
    created_at: p.created_at,
    sale_id: p.sale_id,
    // A reversal with a return_item_id came from a return; one without it
    // came from the sale being voided. The UI names them differently
    // because they mean different things to the consignor.
    from_return: p.return_item_id != null,
    sku: p.inventory_item?.sku ?? null,
    description: p.inventory_item?.description ?? null,
  }))

  const items: ConsignorItemRow[] = (itemRows ?? []).map((it) => ({
    id: it.id,
    sku: it.sku,
    description: it.description,
    list_price: it.list_price == null ? null : toMoney(it.list_price),
    min_price:
      it.consignment_min_price == null
        ? null
        : toMoney(it.consignment_min_price),
    expires_on: it.consignment_expires_on,
    status: it.status,
  }))

  const payouts: ConsignorPayoutRow[] = (payoutRows ?? []).map((p) => ({
    id: p.id,
    payout_number: p.payout_number ?? '',
    amount: toMoney(p.amount),
    payout_method: p.payout_method,
    reference: p.reference,
    paid_at: p.paid_at,
  }))

  const c = consignor as unknown as {
    id: string
    consignor_number: string | null
    business_name: string | null
    default_commission_pct: number | string
    default_payout_method: string
    status: string
    notes: string | null
    customer: {
      id: string
      first_name: string
      last_name: string
      phone: string | null
      email: string | null
    } | null
  }

  return (
    <ConsignorDetail
      consignor={{
        id: c.id,
        consignor_number: c.consignor_number ?? '',
        business_name: c.business_name,
        customer_id: c.customer?.id ?? null,
        customer_name: c.customer
          ? `${c.customer.last_name}, ${c.customer.first_name}`
          : '—',
        customer_contact:
          [c.customer?.phone, c.customer?.email].filter(Boolean).join(' · ') ||
          null,
        commission_pct: toMoney(c.default_commission_pct),
        payout_method: c.default_payout_method,
        status: c.status === 'inactive' ? 'inactive' : 'active',
        notes: c.notes,
      }}
      enabled={enabled}
      canManage={!!ctx.tenantRole && MANAGE_ROLES.has(ctx.tenantRole)}
      balance={openBalance(payables)}
      lifetimeGross={lifetimeGross(payables)}
      lifetimeCommission={lifetimeCommission(payables)}
      items={items}
      ledger={ledger}
      payouts={payouts}
      // Expiry is a calendar question in the SHOP's timezone, never UTC
      // (CLAUDE.md Rule 18).
      todayIso={todayInTimezone(rules.timezone)}
    />
  )
}
