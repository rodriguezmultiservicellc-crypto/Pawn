/**
 * Customer search → PostgREST `.or()` filter strings, ONE PER WORD.
 * Pure, no I/O.
 *
 * Each word must match at least one column; the caller chains one
 * `.or(filter)` per returned string, and PostgREST ANDs chained filters.
 * So "freddy rodriguez" finds first_name ~ freddy AND last_name ~
 * rodriguez. Matching the whole phrase against each column — the earlier
 * behaviour — found nobody for a full name.
 *
 * Commas and parentheses are PostgREST filter syntax and are dropped from
 * words ("Rodriguez, Freddy" still works); % and _ are escaped so they
 * match literally. At most 6 words.
 */
export function customerSearchFilters(q: string, columns: readonly string[]): string[] {
  return q
    .split(/\s+/)
    .map((w) => w.replace(/[,()]/g, '').replace(/[%_\\]/g, (m) => '\\' + m))
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => columns.map((c) => `${c}.ilike.%${w}%`).join(','))
}
