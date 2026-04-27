/**
 * Pure formatters for audit_log rows. Lives in its own module so client
 * components can import it without dragging the service-role admin client
 * (which `lib/audit.ts` pulls in for the writer) into the client bundle.
 */

import type { Dictionary } from './i18n/config'

/**
 * Translate an audit action to a human label. Looks up
 *   1. audit.actions.perTable[tableName][action]    (richest phrasing)
 *   2. audit.actions[action]                        (generic verb)
 *   3. raw action string                            (fallback)
 */
export function formatAuditAction(
  action: string,
  tableName: string,
  t: Dictionary,
): string {
  const perTable = (
    t.audit.actions.perTable as Record<string, Record<string, string> | undefined>
  )[tableName]
  if (perTable && perTable[action]) return perTable[action]
  const generic = (t.audit.actions as Record<string, unknown>)[action]
  if (typeof generic === 'string') return generic
  return action
}

/**
 * Translate a table_name to a localized display name. Falls back to the raw
 * snake_case identifier when the table is not in the dictionary.
 */
export function formatAuditTable(tableName: string, t: Dictionary): string {
  const tables = t.audit.tables as Record<string, string | undefined>
  return tables[tableName] ?? tableName
}
