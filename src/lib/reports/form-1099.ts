/**
 * Form 1099-MISC year-end helper.
 *
 * IRS rule: when a pawn shop pays an individual seller $600 or more in cash
 * during a calendar year (buy-outright), the shop must file a 1099-MISC
 * for that recipient. The actual filing is the accountant's job. This
 * helper does the data work:
 *
 *   1. Find every customer whose total buy-outright payouts in the tax
 *      year hit the threshold.
 *   2. Compose a single row per customer with totals + transaction count
 *      + first/last payment date + ID info from the customer_snapshot at
 *      transaction time.
 *   3. Surface current contact info by joining back to `customers`. If
 *      the customer was hard-deleted (rare — see Rule 13 retention),
 *      `customer_active=false` and live fields are null.
 *
 * Source: compliance_log (Rule 15 — police-report data is the source of
 * truth for buy-outright transactions; we read from the same table for
 * 1099 totals so the IRS picture and the police picture can never drift).
 *
 * v1 scope:
 *   - Single tenant only — no chain rollup. Each tenant files its own
 *     1099s with its own EIN.
 *   - No SSN/TIN field on customers yet. The CSV says "(collect via W-9)"
 *     for the recipient TIN; the accountant gathers W-9s before filing.
 *   - Threshold defaults to 600 but is overridable (in case the IRS
 *     bumps it; or for stress-testing on small datasets).
 */

import type { ComplianceLogRow } from '@/types/database-aliases'
import { createAdminClient } from '@/lib/supabase/admin'

export const FORM_1099_DEFAULT_THRESHOLD = 600

export type Form1099Candidate = {
  /** From customer_snapshot.id (UUID). null when the snapshot row didn't
   *  carry an id — should not happen post-Phase 2 but we keep grouping
   *  resilient against pre-launch test rows. */
  customer_id: string | null
  /** "Last, First Middle" composed from the snapshot at transaction time. */
  customer_name: string
  /** Snapshot address joined with commas. */
  address: string
  id_type: string | null
  id_number: string | null
  date_of_birth: string | null
  /** Sum of compliance_log.amount for this customer in the tax year. */
  total_paid: number
  /** Number of compliance_log rows that contributed. */
  transaction_count: number
  /** Earliest occurred_at across the contributing rows (ISO timestamp). */
  first_payment_date: string
  /** Latest occurred_at across the contributing rows (ISO timestamp). */
  last_payment_date: string
  /** True when the customer row still exists (not hard-deleted). */
  customer_active: boolean
  /** Live customer.phone — may differ from snapshot.phone. */
  current_phone: string | null
  /** Live customer.email — may differ from snapshot.email. */
  current_email: string | null
}

export type Form1099Report = {
  tenantId: string
  taxYear: number
  generatedAt: string
  threshold: number
  candidates: Form1099Candidate[]
  /** Sum of every contributing payout, including those below the threshold
   *  (so the operator can see how much volume is below the line). */
  totalPaidAcrossAll: number
  /** = candidates.length, surfaced as a top-level metric for headers. */
  totalCandidatesAboveThreshold: number
}

// ---------------------------------------------------------------------------
// Snapshot type guards. compliance_log.customer_snapshot is `Json | null`,
// so we narrow defensively. Mirrors the s() helper pattern in
// lib/compliance/police-report/formats/fl-leadsonline.ts.
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  return {}
}

function s(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function sOrNull(v: unknown): string | null {
  const out = s(v)
  return out === '' ? null : out
}

function composeName(snap: Record<string, unknown>): string {
  const last = s(snap.last_name)
  const first = s(snap.first_name)
  const middle = s(snap.middle_name)
  const given = [first, middle].filter(Boolean).join(' ')
  if (last && given) return `${last}, ${given}`
  if (last) return last
  if (given) return given
  return '(unknown)'
}

function composeAddress(snap: Record<string, unknown>): string {
  return [
    s(snap.address1),
    s(snap.address2),
    s(snap.city),
    s(snap.state),
    s(snap.zip),
    s(snap.country),
  ]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * Stable grouping key: prefer customer_snapshot.id (UUID); fall back to
 * "unknown_<phone||name||row.id>" so we never silently merge unrelated
 * transactions, even if the operator was running pre-launch tests with
 * incomplete snapshots.
 */
function groupKey(snap: Record<string, unknown>, fallbackRowId: string): {
  customerId: string | null
  key: string
} {
  const idCandidate = s(snap.id)
  if (idCandidate) {
    return { customerId: idCandidate, key: idCandidate }
  }
  const phone = s(snap.phone)
  if (phone) return { customerId: null, key: `unknown_phone_${phone}` }
  const name = composeName(snap)
  if (name && name !== '(unknown)') {
    return { customerId: null, key: `unknown_name_${name}` }
  }
  return { customerId: null, key: `unknown_row_${fallbackRowId}` }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

type Bucket = {
  customerId: string | null
  snapshot: Record<string, unknown>
  totalPaid: number
  transactionCount: number
  firstPaymentDate: string
  lastPaymentDate: string
}

export async function buildForm1099Report(args: {
  tenantId: string
  taxYear: number
  threshold?: number
}): Promise<Form1099Report> {
  const tenantId = args.tenantId
  const taxYear = args.taxYear
  const threshold = args.threshold ?? FORM_1099_DEFAULT_THRESHOLD

  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
    throw new Error(`form_1099_invalid_tax_year:${taxYear}`)
  }

  const fromIso = `${taxYear}-01-01T00:00:00.000Z`
  const toExclusiveIso = `${taxYear + 1}-01-01T00:00:00.000Z`

  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from('compliance_log')
    .select(
      'id, occurred_at, amount, customer_snapshot, event_type, tenant_id',
    )
    .eq('tenant_id', tenantId)
    .eq('event_type', 'buy_outright')
    .gte('occurred_at', fromIso)
    .lt('occurred_at', toExclusiveIso)

  if (error) throw new Error(`form_1099_query_failed:${error.message}`)

  const complianceRows = (rows ?? []) as ComplianceLogRow[]

  const buckets = new Map<string, Bucket>()
  let totalPaidAcrossAll = 0

  for (const row of complianceRows) {
    const snap = asRecord(row.customer_snapshot)
    const { customerId, key } = groupKey(snap, row.id)
    const amount = row.amount == null ? 0 : Number(row.amount)
    if (!isFinite(amount)) continue
    totalPaidAcrossAll += amount

    const occurredAt = row.occurred_at ?? ''
    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, {
        customerId,
        // Keep the most-recent snapshot so the surfaced address/ID reflects
        // the latest data the customer presented (we'll overwrite below).
        snapshot: snap,
        totalPaid: amount,
        transactionCount: 1,
        firstPaymentDate: occurredAt,
        lastPaymentDate: occurredAt,
      })
    } else {
      existing.totalPaid += amount
      existing.transactionCount += 1
      if (occurredAt && (!existing.firstPaymentDate || occurredAt < existing.firstPaymentDate)) {
        existing.firstPaymentDate = occurredAt
      }
      if (occurredAt && occurredAt > existing.lastPaymentDate) {
        existing.lastPaymentDate = occurredAt
        // Latest transaction wins for surfaced snapshot fields.
        existing.snapshot = snap
      }
    }
  }

  // Filter by threshold first so we only join for the customers we'll
  // actually emit.
  const qualifying = [...buckets.values()].filter(
    (b) => b.totalPaid >= threshold,
  )

  // Look up live customer rows for the qualifying customer IDs in one shot.
  const liveCustomerIds = qualifying
    .map((b) => b.customerId)
    .filter((v): v is string => !!v)

  type LiveRow = {
    id: string
    phone: string | null
    email: string | null
    deleted_at: string | null
  }

  let liveById = new Map<string, LiveRow>()
  if (liveCustomerIds.length > 0) {
    const { data: live, error: liveErr } = await admin
      .from('customers')
      .select('id, phone, email, deleted_at')
      .eq('tenant_id', tenantId)
      .in('id', liveCustomerIds)
    if (liveErr) {
      throw new Error(`form_1099_customers_lookup_failed:${liveErr.message}`)
    }
    liveById = new Map(
      (live ?? []).map((r) => [r.id, r as unknown as LiveRow]),
    )
  }

  const candidates: Form1099Candidate[] = qualifying.map((b) => {
    const live = b.customerId ? liveById.get(b.customerId) : undefined
    const customerActive = !!live && live.deleted_at == null
    return {
      customer_id: b.customerId,
      customer_name: composeName(b.snapshot),
      address: composeAddress(b.snapshot),
      id_type: sOrNull(b.snapshot.id_type),
      id_number: sOrNull(b.snapshot.id_number),
      date_of_birth: sOrNull(b.snapshot.date_of_birth),
      total_paid: round2(b.totalPaid),
      transaction_count: b.transactionCount,
      first_payment_date: b.firstPaymentDate,
      last_payment_date: b.lastPaymentDate,
      customer_active: customerActive,
      current_phone: customerActive ? (live?.phone ?? null) : null,
      current_email: customerActive ? (live?.email ?? null) : null,
    }
  })

  candidates.sort((a, b) => b.total_paid - a.total_paid)

  return {
    tenantId,
    taxYear,
    generatedAt: new Date().toISOString(),
    threshold,
    candidates,
    totalPaidAcrossAll: round2(totalPaidAcrossAll),
    totalCandidatesAboveThreshold: candidates.length,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
