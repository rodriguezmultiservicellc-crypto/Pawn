/**
 * Money primitives. Pure, no I/O — safe in client and server components.
 *
 * Money is `numeric(18,4)` everywhere in this schema (CLAUDE.md Rule 11),
 * so anything crossing the DB boundary is rounded to 4 decimals with the
 * same function, and anything a human reads or types is rounded to 2.
 *
 * NOTE: `r4` / `toMoney` also exist, copy-pasted, in `lib/pawn/math.ts`,
 * `lib/pos/cart.ts` and `lib/repair/billing.ts`. Those predate this module
 * and are load-bearing on three shipped surfaces, so they were left alone
 * rather than refactored blind — see Progress.txt. New code imports from
 * here.
 */

/** Round to 4 decimal places — the numeric(18,4) grid money lives on. */
export function r4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000
}

/** Round to cents. Use for anything a human reads or types. */
export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Coerce a Supabase numeric to a JS number.
 *
 * Takes `unknown` on purpose: PostgREST hands NUMERIC columns back as
 * strings, the generated types disagree with each other about which, and a
 * NaN reaching a balance is worse than a 0.
 */
export function toMoney(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
