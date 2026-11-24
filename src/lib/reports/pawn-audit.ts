/**
 * Pawn audit — every pledge that should be in the shop right now, as a list
 * to check off against the safe.
 *
 * What is on it: the collateral of every OPEN loan (active, extended,
 * partial_paid). Nothing else: a redeemed pledge went home, a forfeited one
 * is inventory (counted by the inventory count, not here), a voided ticket
 * never held anything.
 *
 * One row per PIECE, so each piece gets its own check box; the ticket's own
 * columns (number, customer, dates, loan amount) print on its first row. A
 * ticket with no pieces recorded still gets a row — it is exactly the kind of
 * thing an audit has to surface.
 *
 * It is a picture of NOW, not of a date range: there is no "from / to".
 * Ordered by ticket number the way a person reads them (9 before 10).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { LoanStatus } from '@/types/database-aliases'
import { allRows, chunks } from './all-rows'
import type { ReportResult } from './types'

const OPEN: ReadonlyArray<LoanStatus> = ['active', 'extended', 'partial_paid']

export type PawnAuditLoanInput = {
  id: string
  tenant_id: string
  ticket_number: string | null
  principal: number | string
  issue_date: string
  due_date: string
  status: string
  customer: { first_name: string; last_name: string } | null
}

export type PawnAuditItemInput = {
  loan_id: string
  position: number
  description: string
  karat: number | string | null
  weight_grams: number | string | null
  jewelry_size: string | null
  firearm_serial_number: string | null
  electronic_serial: string | null
  jewelry_serial: string | null
}

export type PawnAuditRow = {
  loan_id: string
  tenant_id: string
  ticket_number: string
  customer_name: string
  issue_date: string
  due_date: string
  status: LoanStatus
  /** The ticket's loan amount. */
  principal: number
  /** First row of its ticket: the ticket's columns print here only. */
  first: boolean
  /** Piece n of `item_count`. 0 when the ticket has no pieces recorded. */
  item_no: number
  item_count: number
  description: string
  karat: number | null
  weight_grams: number | null
  size: string | null
  serial: string | null
}

const numOrNull = (v: number | string | null): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Ticket numbers the way a person sorts them: 9 before 10, PT-000004 after 15664. */
export function compareTickets(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

/** "14k · 4.6 g · Size 9 · S/N BPNL281" — the facts that identify a piece in the safe. */
export function auditItemDetail(
  row: Pick<PawnAuditRow, 'karat' | 'weight_grams' | 'size' | 'serial'>,
  labels: { size: string; serial: string },
): string {
  const parts: string[] = []
  if (row.karat != null) parts.push(`${Number(row.karat.toFixed(1))}k`)
  if (row.weight_grams != null) parts.push(`${Number(row.weight_grams.toFixed(2))} g`)
  if (row.size) parts.push(`${labels.size} ${row.size}`)
  if (row.serial) parts.push(`${labels.serial} ${row.serial}`)
  return parts.join(' · ')
}

export function buildPawnAudit(args: {
  loans: ReadonlyArray<PawnAuditLoanInput>
  items: ReadonlyArray<PawnAuditItemInput>
  tenantIds: ReadonlyArray<string>
}): ReportResult<PawnAuditRow> {
  const byLoan = new Map<string, PawnAuditItemInput[]>()
  for (const it of args.items) {
    const list = byLoan.get(it.loan_id)
    if (list) list.push(it)
    else byLoan.set(it.loan_id, [it])
  }

  const loans = args.loans
    .filter((l) => (OPEN as ReadonlyArray<string>).includes(l.status))
    .slice()
    .sort((a, b) => compareTickets(a.ticket_number ?? '', b.ticket_number ?? ''))

  const rows: PawnAuditRow[] = []
  let pieces = 0
  let principal = 0
  let withoutItems = 0
  for (const l of loans) {
    const items = (byLoan.get(l.id) ?? []).slice().sort((a, b) => a.position - b.position)
    const ticket = {
      loan_id: l.id,
      tenant_id: l.tenant_id,
      ticket_number: l.ticket_number ?? '',
      customer_name: l.customer ? `${l.customer.last_name}, ${l.customer.first_name}` : '—',
      issue_date: l.issue_date,
      due_date: l.due_date,
      status: l.status as LoanStatus,
      principal: Number(l.principal),
    }
    principal += ticket.principal
    if (items.length === 0) {
      withoutItems++
      rows.push({
        ...ticket,
        first: true,
        item_no: 0,
        item_count: 0,
        description: '',
        karat: null,
        weight_grams: null,
        size: null,
        serial: null,
      })
      continue
    }
    pieces += items.length
    items.forEach((it, i) => {
      rows.push({
        ...ticket,
        first: i === 0,
        item_no: i + 1,
        item_count: items.length,
        description: it.description,
        karat: numOrNull(it.karat),
        weight_grams: numOrNull(it.weight_grams),
        size: it.jewelry_size?.trim() || null,
        serial:
          it.firearm_serial_number?.trim() ||
          it.electronic_serial?.trim() ||
          it.jewelry_serial?.trim() ||
          null,
      })
    })
  }

  return {
    rows,
    totals: {
      tickets: loans.length,
      pieces,
      principal: Math.round(principal * 100) / 100,
      tickets_without_items: withoutItems,
    },
    tenantIds: [...args.tenantIds],
  }
}

export async function getPawnAudit(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
}): Promise<ReportResult<PawnAuditRow>> {
  const { supabase, tenantIds } = args
  const tenants = tenantIds as string[]

  // Paged: an audit that stopped at the API's 1,000 rows would call a
  // pledge "not on the list" when it is simply past the cut.
  const loans = await allRows<PawnAuditLoanInput>('pawn_audit_loans', (from, to) =>
    supabase
      .from('loans')
      .select(
        `id, tenant_id, ticket_number, principal, issue_date, due_date, status,
         customer:customers(first_name, last_name)`,
      )
      .in('tenant_id', tenants)
      .is('deleted_at', null)
      .in('status', [...OPEN])
      .order('id', { ascending: true })
      .range(from, to),
  )

  const items: PawnAuditItemInput[] = []
  for (const ids of chunks(loans.map((l) => l.id))) {
    const part = await allRows<PawnAuditItemInput>('pawn_audit_items', (from, to) =>
      supabase
        .from('loan_collateral_items')
        .select(
          'loan_id, position, description, karat, weight_grams, jewelry_size, firearm_serial_number, electronic_serial, jewelry_serial',
        )
        .in('tenant_id', tenants)
        .in('loan_id', ids)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to),
    )
    items.push(...part)
  }

  return buildPawnAudit({ loans, items, tenantIds })
}
