/**
 * What the customer page of a pawn ticket shows (/p/<token>, patches/0127).
 * Server only.
 *
 * The token is the ONLY input: it names one live link, which names one loan;
 * the tenant comes from the loan (rule 8). Unknown, revoked, voided or
 * deleted loans and inactive shops all give the same null, so the page
 * cannot be used to probe.
 *
 * Shows the ticket, never the customer: no name, address, phone or ID —
 * only their language, to open the page in it. The payoff is figured by the
 * same code as the counter and the portal (payoffFromLoan with the shop's
 * ChargeModel, rule 18), on the shop's today. Photos are signed for 1h
 * (rule 12).
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { INVENTORY_PHOTOS_BUCKET, getSignedUrl } from '@/lib/supabase/storage'
import { daysBetween, liveEvents, payoffFromLoan } from '@/lib/pawn/math'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { chargeModelOf, lastRedemptionDate, todayInTimezone } from '@/lib/jurisdictions/rules'
import { shopDateTime } from '@/lib/compliance/police-report/formats/fl-leadsonline-xml'
import { isValidPawnToken } from './public-link'

export type PublicPawnStatus = 'open' | 'redeemed' | 'forfeited'

export type PublicPawn = {
  ticketNumber: string
  status: PublicPawnStatus
  issueDate: string
  dueDate: string
  /** Due date + the state's grace period: the last day to pick up. */
  lastDay: string
  today: string
  /** Positive = days until due; negative = days past due. */
  daysToDue: number
  principal: number
  /** Open loans only. */
  payoff: number | null
  principalOutstanding: number | null
  chargeSoFar: number | null
  items: Array<{ description: string; photoUrl: string | null }>
  /** Newest first. */
  history: Array<{ date: string; kind: 'issued' | 'payment' | 'extension' | 'redemption' | 'forfeiture'; amount: number | null }>
  language: 'en' | 'es'
  shop: { name: string; logoUrl: string | null; phone: string | null; publicSlug: string | null }
}

const OPEN = new Set(['active', 'extended', 'partial_paid'])
const SHOWN_EVENTS = new Set(['issued', 'payment', 'extension', 'redemption', 'forfeiture'])

export async function loadPublicPawn(token: string): Promise<PublicPawn | null> {
  if (!isValidPawnToken(token)) return null
  const admin = createAdminClient()

  const { data: link } = await admin
    .from('loan_public_links')
    .select('loan_id, tenant_id')
    .eq('token', token)
    .is('revoked_at', null)
    .maybeSingle()
  if (!link) return null

  const [{ data: loan }, { data: tenant }] = await Promise.all([
    admin
      .from('loans')
      .select(
        `id, tenant_id, customer_id, ticket_number, principal, interest_rate_monthly,
         min_monthly_charge, issue_date, due_date, status, deleted_at,
         collateral:loan_collateral_items(description, photo_path, position, deleted_at),
         events:loan_events(id, reverses_event_id, event_type, amount, principal_paid,
           interest_paid, fees_paid, interest_waived, occurred_at)`,
      )
      .eq('id', link.loan_id)
      .eq('tenant_id', link.tenant_id)
      .maybeSingle(),
    admin
      .from('tenants')
      .select('name, dba, logo_url, phone, public_slug, public_landing_enabled, is_active, has_pawn')
      .eq('id', link.tenant_id)
      .maybeSingle(),
  ])
  if (!loan || loan.deleted_at || loan.status === 'voided') return null
  if (!tenant || !tenant.is_active || !tenant.has_pawn) return null

  const { data: customer } = await admin.from('customers').select('language').eq('id', loan.customer_id).maybeSingle()

  const rules = await loadTenantRules(admin, link.tenant_id)
  const today = todayInTimezone(rules.timezone)
  const events = liveEvents(loan.events ?? [])
  const open = OPEN.has(loan.status)
  const payoff = open
    ? payoffFromLoan(
        {
          principal: loan.principal,
          interest_rate_monthly: loan.interest_rate_monthly,
          issue_date: loan.issue_date,
          min_monthly_charge: loan.min_monthly_charge,
        },
        events,
        today,
        chargeModelOf(rules),
      )
    : null

  const collateral = (loan.collateral ?? [])
    .filter((c) => !c.deleted_at)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const items = await Promise.all(
    collateral.map(async (c) => ({
      description: c.description ?? '',
      photoUrl: c.photo_path
        ? await getSignedUrl({ bucket: INVENTORY_PHOTOS_BUCKET, path: c.photo_path, ttlSeconds: 3600 })
        : null,
    })),
  )

  const history = events
    .filter((e) => SHOWN_EVENTS.has(e.event_type))
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
    .map((e) => ({
      date: shopDateTime(e.occurred_at, rules.timezone).slice(0, 10),
      kind: e.event_type as PublicPawn['history'][number]['kind'],
      amount: e.amount == null ? null : Number(e.amount),
    }))

  return {
    ticketNumber: loan.ticket_number ?? '',
    status: open ? 'open' : loan.status === 'redeemed' ? 'redeemed' : 'forfeited',
    issueDate: loan.issue_date,
    dueDate: loan.due_date,
    lastDay: lastRedemptionDate(loan.due_date, rules.graceDays, rules.jurisdiction?.grace_rolls_to_business_day ?? false),
    today,
    daysToDue: daysBetween(today, loan.due_date),
    principal: Number(loan.principal),
    payoff: payoff ? payoff.payoff : null,
    principalOutstanding: payoff ? payoff.principalOutstanding : null,
    chargeSoFar: payoff ? payoff.interestAccrued : null,
    items,
    history,
    language: customer?.language === 'es' ? 'es' : 'en',
    shop: {
      name: tenant.dba?.trim() || tenant.name,
      logoUrl: tenant.logo_url,
      phone: tenant.phone,
      publicSlug: tenant.public_landing_enabled ? tenant.public_slug : null,
    },
  }
}
