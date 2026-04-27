import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  CUSTOMER_DOCUMENTS_BUCKET,
  INVENTORY_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import { payoffFromLoan, todayDateString } from '@/lib/pawn/math'
import PawnLoanDetail, {
  type LoanCollateralView,
  type LoanEventView,
  type LoanView,
} from './content'
import type { LoanEventType, LoanStatus } from '@/types/database-aliases'

type Params = Promise<{ id: string }>

export default async function PawnLoanDetailPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: loan } = await ctx.supabase
    .from('loans')
    .select(
      `id, tenant_id, customer_id, ticket_number, principal, interest_rate_monthly,
       term_days, issue_date, due_date, status, is_printed, printed_at,
       signature_path, notes, created_at, updated_at,
       customer:customers(id, first_name, last_name, phone, email)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!loan) redirect('/pawn')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', loan.tenant_id)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  const [
    { data: collateralRows },
    { data: eventRows },
    signatureSignedUrl,
  ] = await Promise.all([
    ctx.supabase
      .from('loan_collateral_items')
      .select(
        'id, description, category, metal_type, karat, weight_grams, est_value, photo_path, position',
      )
      .eq('loan_id', id)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    ctx.supabase
      .from('loan_events')
      .select(
        'id, event_type, amount, principal_paid, interest_paid, fees_paid, payment_method, new_due_date, notes, occurred_at',
      )
      .eq('loan_id', id)
      .order('occurred_at', { ascending: false }),
    loan.signature_path
      ? getSignedUrl({
          bucket: CUSTOMER_DOCUMENTS_BUCKET,
          path: loan.signature_path,
          ttlSeconds: 3600,
        })
      : Promise.resolve(null),
  ])

  const collateral: LoanCollateralView[] = await Promise.all(
    (collateralRows ?? []).map(async (c) => ({
      id: c.id,
      description: c.description,
      category: c.category,
      metal_type: c.metal_type,
      karat: c.karat == null ? null : Number(c.karat),
      weight_grams: c.weight_grams == null ? null : Number(c.weight_grams),
      est_value: c.est_value == null ? 0 : Number(c.est_value),
      photo_path: c.photo_path,
      photo_signed_url: c.photo_path
        ? await getSignedUrl({
            bucket: INVENTORY_PHOTOS_BUCKET,
            path: c.photo_path,
            ttlSeconds: 3600,
          })
        : null,
      position: c.position,
    })),
  )

  const events: LoanEventView[] = (eventRows ?? []).map((e) => ({
    id: e.id,
    event_type: e.event_type as LoanEventType,
    amount: e.amount == null ? null : Number(e.amount),
    principal_paid: Number(e.principal_paid ?? 0),
    interest_paid: Number(e.interest_paid ?? 0),
    fees_paid: Number(e.fees_paid ?? 0),
    payment_method: e.payment_method,
    new_due_date: e.new_due_date,
    notes: e.notes,
    occurred_at: e.occurred_at,
  }))

  const today = todayDateString()
  const payoff = payoffFromLoan(
    {
      principal: loan.principal,
      interest_rate_monthly: loan.interest_rate_monthly,
      issue_date: loan.issue_date,
    },
    events,
    today,
  )

  const c = (loan as unknown as { customer: { id: string; first_name: string; last_name: string; phone: string | null; email: string | null } | null }).customer

  const view: LoanView = {
    id: loan.id,
    tenant_id: loan.tenant_id,
    customer_id: loan.customer_id,
    customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
    customer_phone: c?.phone ?? null,
    customer_email: c?.email ?? null,
    ticket_number: loan.ticket_number ?? '',
    principal: Number(loan.principal),
    interest_rate_monthly: Number(loan.interest_rate_monthly),
    term_days: loan.term_days,
    issue_date: loan.issue_date,
    due_date: loan.due_date,
    status: loan.status as LoanStatus,
    is_printed: loan.is_printed,
    printed_at: loan.printed_at,
    signature_signed_url: signatureSignedUrl,
    notes: loan.notes,
    created_at: loan.created_at,
  }

  return (
    <PawnLoanDetail
      loan={view}
      collateral={collateral}
      events={events}
      payoff={payoff}
      today={today}
    />
  )
}
