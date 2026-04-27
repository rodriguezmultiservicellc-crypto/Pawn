/**
 * Florida LeadsOnline police-report exporter.
 *
 * ===========================================================================
 * FORMAT DRAFT — confirm with FL LeadsOnline before go-live.
 * ===========================================================================
 *
 * The CSV column set below is best-effort. LeadsOnline publishes a tenant-
 * specific upload spec (their docs say each agency may set their own
 * required columns), and the exact field names vary by jurisdiction.
 * Eddy: before submitting a real file in production, request the agency's
 * "LeadsOnline Required Field List" PDF from the responsible police
 * department, then reconcile the columns here against it.
 *
 * One row per ITEM. Multi-item transactions emit one row per item with
 * customer + transaction columns repeated. Transactions are read from the
 * compliance_log table only — never derived from loans/sales (Rule 15).
 *
 * Column reference (v0 draft):
 *   store_id, transaction_date, transaction_type (PAWN|BUY|SALE_RECEIVED),
 *   customer_first_name, customer_middle_name, customer_last_name,
 *   customer_dob (YYYY-MM-DD), customer_address, customer_city,
 *   customer_state, customer_zip, customer_phone,
 *   customer_id_type (DL|PASSPORT|STATE_ID|MILITARY),
 *   customer_id_number, customer_id_state,
 *   item_description, item_serial, item_brand, item_model, item_make,
 *   item_quantity, item_unit_amount, item_total_amount.
 */

import type { ComplianceLogRow } from '@/types/database-aliases'
import { rowsToCsv, type CsvColumn } from '@/lib/reports/http'

export type LeadsOnlineRow = {
  store_id: string
  transaction_date: string
  transaction_type: 'PAWN' | 'BUY' | 'SALE_RECEIVED'
  customer_first_name: string
  customer_middle_name: string
  customer_last_name: string
  customer_dob: string
  customer_address: string
  customer_city: string
  customer_state: string
  customer_zip: string
  customer_phone: string
  customer_id_type: 'DL' | 'PASSPORT' | 'STATE_ID' | 'MILITARY' | ''
  customer_id_number: string
  customer_id_state: string
  item_description: string
  item_serial: string
  item_brand: string
  item_model: string
  item_make: string
  item_quantity: string
  item_unit_amount: string
  item_total_amount: string
}

const COLUMNS: ReadonlyArray<CsvColumn<LeadsOnlineRow>> = [
  { header: 'store_id', value: 'store_id' },
  { header: 'transaction_date', value: 'transaction_date' },
  { header: 'transaction_type', value: 'transaction_type' },
  { header: 'customer_first_name', value: 'customer_first_name' },
  { header: 'customer_middle_name', value: 'customer_middle_name' },
  { header: 'customer_last_name', value: 'customer_last_name' },
  { header: 'customer_dob', value: 'customer_dob' },
  { header: 'customer_address', value: 'customer_address' },
  { header: 'customer_city', value: 'customer_city' },
  { header: 'customer_state', value: 'customer_state' },
  { header: 'customer_zip', value: 'customer_zip' },
  { header: 'customer_phone', value: 'customer_phone' },
  { header: 'customer_id_type', value: 'customer_id_type' },
  { header: 'customer_id_number', value: 'customer_id_number' },
  { header: 'customer_id_state', value: 'customer_id_state' },
  { header: 'item_description', value: 'item_description' },
  { header: 'item_serial', value: 'item_serial' },
  { header: 'item_brand', value: 'item_brand' },
  { header: 'item_model', value: 'item_model' },
  { header: 'item_make', value: 'item_make' },
  { header: 'item_quantity', value: 'item_quantity' },
  { header: 'item_unit_amount', value: 'item_unit_amount' },
  { header: 'item_total_amount', value: 'item_total_amount' },
]

/** Map our internal id_type to the upload spec's set. */
function mapIdType(s: unknown): LeadsOnlineRow['customer_id_type'] {
  if (typeof s !== 'string') return ''
  switch (s) {
    case 'drivers_license':
      return 'DL'
    case 'passport':
      return 'PASSPORT'
    case 'state_id':
    case 'permanent_resident_card':
      return 'STATE_ID'
    case 'military_id':
      return 'MILITARY'
    default:
      return ''
  }
}

function mapEventType(t: string): LeadsOnlineRow['transaction_type'] {
  switch (t) {
    case 'pawn_intake':
      return 'PAWN'
    case 'buy_outright':
      return 'BUY'
    default:
      // pawn_redemption / pawn_forfeiture / buy_release — these are not
      // separately reported under LeadsOnline. Caller filters them out
      // before flattening, but keep a safe default here.
      return 'SALE_RECEIVED'
  }
}

function s(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function n(v: unknown): string {
  if (v == null) return ''
  const num = typeof v === 'number' ? v : parseFloat(String(v))
  if (!isFinite(num)) return ''
  return num.toFixed(2)
}

/**
 * Flatten a compliance_log row into one or more LeadsOnline rows (one per
 * item).
 *
 * `tenantStoreId` is the agency-assigned store identifier; we accept it as
 * an explicit param because it lives on `tenants` (operator sets it during
 * onboarding) and may differ from the `tenant.id` UUID we use internally.
 */
export function flattenComplianceRow(
  row: ComplianceLogRow,
  opts: { tenantStoreId: string },
): LeadsOnlineRow[] {
  const customer = (row.customer_snapshot ?? {}) as Record<string, unknown>
  const itemsRaw = row.items_snapshot
  const items: ReadonlyArray<Record<string, unknown>> = Array.isArray(itemsRaw)
    ? (itemsRaw as Array<Record<string, unknown>>)
    : []

  const txDate = (row.occurred_at ?? '').slice(0, 10)
  const txType = mapEventType(row.event_type)

  const customerCommon = {
    customer_first_name: s(customer.first_name),
    customer_middle_name: s(customer.middle_name),
    customer_last_name: s(customer.last_name),
    customer_dob: s(customer.date_of_birth).slice(0, 10),
    customer_address: [s(customer.address1), s(customer.address2)]
      .filter(Boolean)
      .join(', '),
    customer_city: s(customer.city),
    customer_state: s(customer.state),
    customer_zip: s(customer.zip),
    customer_phone: s(customer.phone),
    customer_id_type: mapIdType(customer.id_type),
    customer_id_number: s(customer.id_number),
    customer_id_state: s(customer.id_state),
  }

  if (items.length === 0) {
    // Some events (e.g. pawn_redemption) have no items array; emit one
    // header-only row so the transaction is at least visible.
    return [
      {
        store_id: opts.tenantStoreId,
        transaction_date: txDate,
        transaction_type: txType,
        ...customerCommon,
        item_description: '',
        item_serial: '',
        item_brand: '',
        item_model: '',
        item_make: '',
        item_quantity: '1',
        item_unit_amount: n(row.amount),
        item_total_amount: n(row.amount),
      },
    ]
  }

  return items.map((it) => {
    const qty = (it.quantity ?? 1) as number
    const unit = (it.unit_amount ?? it.est_value ?? 0) as number
    const total =
      (it.total_amount ?? null) != null
        ? (it.total_amount as number)
        : Number(unit) * Number(qty)
    return {
      store_id: opts.tenantStoreId,
      transaction_date: txDate,
      transaction_type: txType,
      ...customerCommon,
      item_description: s(it.description),
      item_serial: s(it.serial_number ?? it.serial),
      item_brand: s(it.brand),
      item_model: s(it.model),
      item_make: s(it.make ?? it.metal_type),
      item_quantity: String(qty),
      item_unit_amount: n(unit),
      item_total_amount: n(total),
    }
  })
}

/** Build the full CSV payload for a batch of compliance_log rows. */
export function buildLeadsOnlineCsv(
  rows: ReadonlyArray<ComplianceLogRow>,
  opts: { tenantStoreId: string },
): string {
  const flattened = rows.flatMap((r) => flattenComplianceRow(r, opts))
  return rowsToCsv(flattened, COLUMNS)
}

export const LEADS_ONLINE_COLUMNS = COLUMNS
