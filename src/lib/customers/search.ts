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
 *
 * Phones are stored as typed — "(813) 647-5237" — so a number typed in the
 * search ("8136475237", "813-647-5237", "+1 813…") is matched on its DIGITS
 * against `phone`, any separators allowed between them (Eddy, 2026-11-26:
 * typing the number found nobody). Other columns still match the word as is.
 */
export function customerSearchFilters(q: string, columns: readonly string[]): string[] {
  return q
    .split(/\s+/)
    .map((w) => w.replace(/[,()]/g, ''))
    .filter(Boolean)
    .slice(0, 6)
    .map((raw) => {
      const w = raw.replace(/[%_\\]/g, (m) => '\\' + m)
      const digits = phoneDigits(raw)
      return columns
        .map((c) =>
          c === 'phone' && digits
            ? `phone.match.${digits.split('').join('[^0-9]*')}`
            : `${c}.ilike.%${w}%`,
        )
        .join(',')
    })
}

/** The digits of a word that is a phone number or part of one (3+ digits,
 *  only digits and - . + around them); null otherwise. A leading US
 *  country code 1 on an 11-digit number is dropped. */
export function phoneDigits(word: string): string | null {
  if (!/^\+?[\d.-]+$/.test(word)) return null
  let d = word.replace(/\D/g, '')
  if (d.length < 3) return null
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d
}
