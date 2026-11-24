/**
 * Police-report exporter dispatcher.
 *
 * Reads `tenants.police_report_format` and routes to the right format
 * module. v1 ships `fl_leadsonline` only; new states are added by:
 *
 *   1. Adding the format to the `police_report_format` Postgres ENUM
 *      (new migration + enum value).
 *   2. Adding it to the `PoliceReportFormat` TS alias in
 *      `src/types/database-aliases.ts`.
 *   3. Creating a new module under `formats/`.
 *   4. Adding the case in `dispatch()` below.
 *
 * Per CLAUDE.md Rule 15 the data source is ALWAYS `compliance_log` —
 * never derive from loans/sales at report time.
 *
 * fl_leadsonline is the LeadsOnline upload XML, copied from the files xPawn
 * sent (formats/fl-leadsonline-xml.ts). Nothing here sends it anywhere.
 */

import type { PoliceReportFormat } from '@/types/database-aliases'
import { APP_NAME, APP_VERSION } from '@/lib/app-version'
import {
  buildLeadsOnlineXml,
  leadsOnlineFilename,
  type LeadsOnlineStore,
  type LeadsOnlineTicket,
} from './formats/fl-leadsonline-xml'

export type PoliceReportExportInput = {
  format: PoliceReportFormat
  tickets: ReadonlyArray<LeadsOnlineTicket>
  store: LeadsOnlineStore
  /** The shop's timezone (tenants.timezone): ticket times are its wall clock. */
  timeZone: string
  /** When the file is made (names it). */
  at: Date
  /** slug → NCIC TYP code map from the tenant's pawn_intake_categories.
   *  Per-item codes are resolved from this; omit for an unmapped tenant. */
  ncicBySlug?: Record<string, string>
}

export type PoliceReportExportResult = {
  format: PoliceReportFormat
  body: string
  mimeType: 'application/xml'
  filename: string
  /** Tickets in the file. */
  transactionCount: number
  /** Items in the file (a ticket carries one or more). */
  rowCount: number
}

export function dispatch(input: PoliceReportExportInput): PoliceReportExportResult {
  switch (input.format) {
    case 'fl_leadsonline': {
      const body = buildLeadsOnlineXml({
        store: input.store,
        tickets: input.tickets,
        timeZone: input.timeZone,
        software: { name: APP_NAME, version: APP_VERSION },
        ncicBySlug: input.ncicBySlug,
      })
      return {
        format: input.format,
        body,
        mimeType: 'application/xml',
        filename: leadsOnlineFilename(input.store.storeNumber, input.at, input.timeZone),
        transactionCount: input.tickets.length,
        rowCount: input.tickets.reduce(
          (n, t) => n + (Array.isArray(t.row.items_snapshot) ? t.row.items_snapshot.length : 0),
          0,
        ),
      }
    }
    default: {
      // Exhaustiveness check: if a new format lands in the enum but not
      // here, this throws at runtime.
      const exhaustive: never = input.format
      throw new Error(`unsupported_police_report_format: ${exhaustive as string}`)
    }
  }
}

/** The store block of the file, from the tenant row. The store number is
 *  the agency's (tenants.agency_store_id); none set = the tenant id, which
 *  the agency will not recognize — set it before any upload. */
export function storeFromTenant(t: {
  id: string
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  agency_store_id: string | null
}): LeadsOnlineStore {
  return {
    company: t.dba?.trim() || t.name,
    storeNumber: t.agency_store_id?.trim() || t.id,
    address1: t.address ?? '',
    address2: '',
    city: t.city ?? '',
    state: (t.state ?? '').toUpperCase(),
    zip: t.zip ?? '',
    county: '',
    phone: t.phone ?? '',
  }
}
