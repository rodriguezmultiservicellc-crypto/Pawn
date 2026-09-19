/**
 * Cron-side runner for automated messages (patches/0050). Evaluates each
 * tenant's comm_automations config against loans / customers and
 * dispatches through dispatchMessage(). Idempotency: every send first
 * claims a deterministic automation_key in comm_automation_sends (UNIQUE);
 * a lost claim means someone already handled it.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { LoanEventType, MessageKind } from '@/types/database-aliases'
import { dispatchMessage, type DispatchResult } from './dispatch'
import {
  CATCHUP_DAYS,
  daysBetweenIso,
  loanStepsDueToday,
  mergeAutomations,
  type AutomationConfig,
} from './automations'
import { addDaysIso, payoffFromLoan } from '@/lib/pawn/math'
import { loanForfeitEligibility, type EffectiveRules } from '@/lib/jurisdictions/rules'
import { buildUnsubscribeUrl, ensureUnsubscribeToken } from '@/lib/email/campaigns'

type Admin = SupabaseClient<Database>

export type RunCounts = { sent: number; skipped: number; failed: number }

const PAGE = 1000
/** No customer gets more than one marketing message in this many days. */
const MARKETING_COOLDOWN_DAYS = 7

/** Dispatch failures that are config gaps — release the claim so a later
 *  run (inside the catch-up window) can retry once the shop fixes it. */
const RETRYABLE: ReadonlySet<string> = new Set([
  'template_missing',
  'template_disabled',
  'tenant_not_found',
])

export async function loadAutomationConfigs(
  admin: Admin,
  tenantId: string,
): Promise<AutomationConfig[]> {
  const { data } = await admin
    .from('comm_automations')
    .select('kind, is_enabled, offset_days')
    .eq('tenant_id', tenantId)
  return mergeAutomations(data ?? [])
}

function portalLink(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/portal` : ''
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

async function claim(
  admin: Admin,
  args: {
    tenantId: string
    key: string
    kind: MessageKind
    customerId: string
    loanId?: string | null
  },
): Promise<string | null> {
  const { data, error } = await admin
    .from('comm_automation_sends')
    .insert({
      tenant_id: args.tenantId,
      automation_key: args.key,
      kind: args.kind,
      customer_id: args.customerId,
      related_loan_id: args.loanId ?? null,
      status: 'skipped',
      reason: 'in_progress',
    })
    .select('id')
    .single()
  if (error || !data) return null // 23505 = already claimed
  return data.id
}

async function settle(
  admin: Admin,
  claimId: string,
  res: DispatchResult,
  counts: RunCounts,
): Promise<void> {
  if (res.ok) {
    counts.sent++
    await admin
      .from('comm_automation_sends')
      .update({ status: 'sent', reason: null, message_log_id: res.messageLogId })
      .eq('id', claimId)
    return
  }
  if (RETRYABLE.has(res.reason)) {
    counts.skipped++
    await admin.from('comm_automation_sends').delete().eq('id', claimId)
    return
  }
  if (res.reason === 'provider_failed') counts.failed++
  else counts.skipped++
  await admin
    .from('comm_automation_sends')
    .update({
      status: res.reason === 'provider_failed' ? 'failed' : 'skipped',
      reason: res.reason,
      message_log_id: res.messageLogId,
    })
    .eq('id', claimId)
}

// ── Loan reminders + final notice (transactional) ──────────────────────────

export async function runLoanAutomations(args: {
  admin: Admin
  tenantId: string
  rules: EffectiveRules
  configs: ReadonlyArray<AutomationConfig>
  today: string
}): Promise<RunCounts> {
  const { admin, tenantId, rules, configs, today } = args
  const counts: RunCounts = { sent: 0, skipped: 0, failed: 0 }
  if (!configs.some((c) => c.group === 'loan' && c.isEnabled)) return counts

  for (let from = 0; ; from += PAGE) {
    const { data: loans, error: loansErr } = await admin
      .from('loans')
      .select(
        'id, customer_id, ticket_number, principal, interest_rate_monthly, min_monthly_charge, issue_date, due_date',
      )
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'extended', 'partial_paid'])
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (loansErr) throw new Error(`loans: ${loansErr.message}`)
    if (!loans || loans.length === 0) break

    for (const loan of loans) {
      const eligibility = loanForfeitEligibility(rules, loan.due_date, today)
      const steps = loanStepsDueToday({
        configs,
        dueDate: loan.due_date,
        forfeitEligibleOn: eligibility.eligibleOn,
        today,
      })
      if (steps.length === 0) continue

      let payoffAmount: string | null = null
      for (const step of steps) {
        const claimId = await claim(admin, {
          tenantId,
          key: `loan:${loan.id}:${step.kind}:${loan.due_date}`,
          kind: step.kind,
          customerId: loan.customer_id,
          loanId: loan.id,
        })
        if (!claimId) continue

        if (payoffAmount == null) {
          const { data: events } = await admin
            .from('loan_events')
            .select('event_type, principal_paid, interest_paid, fees_paid, occurred_at')
            .eq('loan_id', loan.id)
            .order('occurred_at', { ascending: true })
          const payoff = payoffFromLoan(
            {
              principal: Number(loan.principal),
              interest_rate_monthly: Number(loan.interest_rate_monthly),
              issue_date: loan.issue_date,
              min_monthly_charge:
                loan.min_monthly_charge == null ? null : Number(loan.min_monthly_charge),
            },
            (events ?? []).map((e) => ({
              event_type: e.event_type as LoanEventType,
              principal_paid: Number(e.principal_paid ?? 0),
              interest_paid: Number(e.interest_paid ?? 0),
              fees_paid: Number(e.fees_paid ?? 0),
              occurred_at: e.occurred_at,
            })),
            today,
          )
          payoffAmount = formatUsd(payoff.payoff)
        }

        const days = Math.abs(daysBetweenIso(loan.due_date, today))
        const res = await dispatchMessage({
          tenantId,
          customerId: loan.customer_id,
          kind: step.kind,
          vars: {
            ticket_number: loan.ticket_number ?? '',
            due_date: loan.due_date,
            amount: payoffAmount,
            days: String(days),
            forfeit_date: eligibility.eligibleOn,
            portal_link: portalLink(),
          },
          related: { loanId: loan.id },
        })
        await settle(admin, claimId, res, counts)
      }
    }
    if (loans.length < PAGE) break
  }
  return counts
}

// ── Lifecycle (marketing) ──────────────────────────────────────────────────

type MarketingCustomer = { id: string; email_unsubscribe_token: string | null }

/** Re-check marketing eligibility at send time + the frequency cap. */
async function marketingEligible(
  admin: Admin,
  tenantId: string,
  customerIds: string[],
  today: string,
): Promise<Map<string, MarketingCustomer>> {
  const out = new Map<string, MarketingCustomer>()
  if (customerIds.length === 0) return out
  const since = `${addDaysIso(today, -MARKETING_COOLDOWN_DAYS)}T00:00:00Z`
  for (let i = 0; i < customerIds.length; i += 200) {
    const slice = customerIds.slice(i, i + 200)
    const [{ data: rows }, { data: recent }] = await Promise.all([
      admin
        .from('customers')
        .select('id, email_unsubscribe_token')
        .eq('tenant_id', tenantId)
        .in('id', slice)
        .is('deleted_at', null)
        .eq('is_banned', false)
        .eq('marketing_opt_in', true)
        .neq('comm_preference', 'none'),
      admin
        .from('comm_automation_sends')
        .select('customer_id')
        .eq('tenant_id', tenantId)
        .in('customer_id', slice)
        .in('kind', ['birthday_greeting', 'dormant_winback', 'forfeiture_winback', 'redemption_thankyou'])
        .eq('status', 'sent')
        .gte('created_at', since),
    ])
    const cooling = new Set((recent ?? []).map((r) => r.customer_id))
    for (const r of rows ?? []) if (!cooling.has(r.id)) out.set(r.id, r)
  }
  return out
}

async function sendMarketing(args: {
  admin: Admin
  tenantId: string
  cfg: AutomationConfig
  customer: MarketingCustomer
  key: string
  loanId?: string | null
  vars?: Record<string, string>
  counts: RunCounts
  /** Customers already messaged in this run (cooldown applies within a run too). */
  touched: Set<string>
}): Promise<void> {
  const { admin, tenantId, cfg, customer, key, counts, touched } = args
  if (touched.has(customer.id)) return
  const claimId = await claim(admin, {
    tenantId,
    key,
    kind: cfg.kind,
    customerId: customer.id,
    loanId: args.loanId,
  })
  if (!claimId) return
  touched.add(customer.id)
  const token = await ensureUnsubscribeToken(customer.id, customer.email_unsubscribe_token)
  const res = await dispatchMessage({
    tenantId,
    customerId: customer.id,
    kind: cfg.kind,
    vars: {
      ...(args.vars ?? {}),
      unsubscribe_url: token ? buildUnsubscribeUrl(token) : '',
      portal_link: portalLink(),
    },
    related: { loanId: args.loanId ?? null },
  })
  await settle(admin, claimId, res, counts)
}

/** Loan events of one type whose occurred_at date is in [from, to]. */
async function loanEventsBetween(
  admin: Admin,
  tenantId: string,
  eventType: 'forfeiture' | 'redemption',
  from: string,
  to: string,
): Promise<Array<{ loanId: string; customerId: string; ticket: string }>> {
  const { data, error } = await admin
    .from('loan_events')
    .select('loan_id, loans!inner(customer_id, ticket_number)')
    .eq('tenant_id', tenantId)
    .eq('event_type', eventType)
    .gte('occurred_at', `${from}T00:00:00Z`)
    .lt('occurred_at', `${addDaysIso(to, 1)}T00:00:00Z`)
  if (error) throw new Error(`loan_events ${eventType}: ${error.message}`)
  const seen = new Set<string>()
  const out: Array<{ loanId: string; customerId: string; ticket: string }> = []
  for (const r of (data ?? []) as unknown as Array<{
    loan_id: string
    loans: { customer_id: string; ticket_number: string | null }
  }>) {
    if (seen.has(r.loan_id)) continue
    seen.add(r.loan_id)
    out.push({
      loanId: r.loan_id,
      customerId: r.loans.customer_id,
      ticket: r.loans.ticket_number ?? '',
    })
  }
  return out
}

export async function runLifecycleAutomations(args: {
  admin: Admin
  tenantId: string
  configs: ReadonlyArray<AutomationConfig>
  today: string
}): Promise<RunCounts> {
  const { admin, tenantId, configs, today } = args
  const counts: RunCounts = { sent: 0, skipped: 0, failed: 0 }
  const touched = new Set<string>()
  const cfg = (kind: MessageKind) =>
    configs.find((c) => c.kind === kind && c.isEnabled) ?? null

  // Birthday — the greeting goes out `offset` days before; catch up missed days.
  const bday = cfg('birthday_greeting')
  if (bday) {
    for (let lag = 0; lag <= CATCHUP_DAYS; lag++) {
      const birthday = addDaysIso(today, bday.offsetDays - lag)
      const { data, error } = await admin.rpc('lifecycle_birthday_customers', {
        p_tenant_id: tenantId,
        p_on: birthday,
      })
      if (error) throw new Error(`lifecycle_birthday_customers: ${error.message}`)
      const ids = (data ?? []).map((r) => r.customer_id)
      const eligible = await marketingEligible(admin, tenantId, ids, today)
      for (const c of eligible.values()) {
        await sendMarketing({
          admin,
          tenantId,
          cfg: bday,
          customer: c,
          key: `birthday:${c.id}:${birthday.slice(0, 4)}`,
          counts,
          touched,
        })
      }
    }
  }

  // Dormant — last activity exactly `offset` days ago (plus catch-up).
  const dormant = cfg('dormant_winback')
  if (dormant) {
    const to = addDaysIso(today, -dormant.offsetDays)
    const from = addDaysIso(to, -CATCHUP_DAYS)
    const { data, error } = await admin.rpc('lifecycle_dormant_customers', {
      p_tenant_id: tenantId,
      p_from: from,
      p_to: to,
    })
    if (error) throw new Error(`lifecycle_dormant_customers: ${error.message}`)
    const rows = data ?? []
    const eligible = await marketingEligible(
      admin,
      tenantId,
      rows.map((r) => r.customer_id),
      today,
    )
    for (const r of rows) {
      const c = eligible.get(r.customer_id)
      if (!c) continue
      await sendMarketing({
        admin,
        tenantId,
        cfg: dormant,
        customer: c,
        key: `dormant:${c.id}:${r.last_activity}`,
        counts,
        touched,
      })
    }
  }

  // Event-anchored: after a forfeiture / after a redemption.
  const eventKinds: Array<{
    kind: MessageKind
    event: 'forfeiture' | 'redemption'
    keyPrefix: string
  }> = [
    { kind: 'forfeiture_winback', event: 'forfeiture', keyPrefix: 'forfeit_winback' },
    { kind: 'redemption_thankyou', event: 'redemption', keyPrefix: 'redeem_thanks' },
  ]
  for (const ek of eventKinds) {
    const c = cfg(ek.kind)
    if (!c) continue
    const to = addDaysIso(today, -c.offsetDays)
    const from = addDaysIso(to, -CATCHUP_DAYS)
    const events = await loanEventsBetween(admin, tenantId, ek.event, from, to)
    const eligible = await marketingEligible(
      admin,
      tenantId,
      [...new Set(events.map((e) => e.customerId))],
      today,
    )
    for (const e of events) {
      const customer = eligible.get(e.customerId)
      if (!customer) continue
      await sendMarketing({
        admin,
        tenantId,
        cfg: c,
        customer,
        key: `${ek.keyPrefix}:${e.loanId}`,
        loanId: e.loanId,
        vars: { ticket_number: e.ticket },
        counts,
        touched,
      })
    }
  }

  return counts
}
