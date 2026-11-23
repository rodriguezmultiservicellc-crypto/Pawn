/**
 * Every row of a report query, 1,000 at a time.
 *
 * The API answers at most 1,000 rows per request and says nothing when it
 * stops there. A report that adds up money must read them all, or it
 * under-reports without anyone noticing.
 *
 * `page(from, to)` must be the query with `.range(from, to)` and a STABLE
 * order (end the order with a unique column such as `id`), so no row is
 * read twice or skipped between pages.
 */
export const REPORT_PAGE = 1000

/** `ids` in groups small enough for one `.in()` request each. */
export function chunks<T>(ids: ReadonlyArray<T>, size = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

export async function allRows<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += REPORT_PAGE) {
    const { data, error } = await page(from, from + REPORT_PAGE - 1)
    if (error) throw new Error(`${what}_failed: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < REPORT_PAGE) return out
  }
}
