/**
 * Code 128 encoder (code sets B and C). Pure, no I/O — safe anywhere.
 *
 * Used for item tags (Phase 1 of PLAN-2026-11-13). Both renderers consume
 * it: the PDF tag draws the bars itself, and the tests use it to pin what
 * the ZPL printer is asked to print. Code set A (control characters) is
 * never needed for SKUs or ticket numbers and is not implemented.
 *
 * Set selection keeps the symbol short, which matters on a rat-tail tag:
 *   - start in C when the data opens with 4+ digits (or is exactly 2);
 *   - in B, switch to C for a digit run of 6+, or 4+ that ends the data;
 *     an odd run spends its first digit in B so C gets whole pairs;
 *   - in C, drop back to B as soon as fewer than 2 digits remain.
 */

/** Bar/space widths (in modules) for symbol values 0–106. 106 is STOP. */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const STOP = 106
const SWITCH_TO_C = 99 // from B
const SWITCH_TO_B = 100 // from C

/** Exposed for tests only. */
export const CODE128_PATTERNS = PATTERNS

export type Code128 = {
  /** Symbol values in order: start, data, checksum, stop. */
  values: number[]
  /** Alternating bar/space widths in modules, starting with a bar. */
  widths: number[]
  /** Total width in modules, excluding quiet zones. */
  modules: number
}

export class Code128Error extends Error {}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

function digitRun(data: string, from: number): number {
  let n = 0
  while (from + n < data.length && isDigit(data[from + n])) n++
  return n
}

function valueB(c: string): number {
  const code = c.charCodeAt(0)
  if (code < 32 || code > 126) {
    throw new Code128Error(`code128_unsupported_char: ${JSON.stringify(c)}`)
  }
  return code - 32
}

/** Encode printable ASCII (32–126) as Code 128. Throws Code128Error. */
export function encodeCode128(data: string): Code128 {
  if (data.length === 0) throw new Code128Error('code128_empty')
  if (data.length > 80) throw new Code128Error('code128_too_long')

  const values: number[] = []
  let i = 0
  const leading = digitRun(data, 0)
  let set: 'B' | 'C' =
    leading >= 4 || (leading === 2 && data.length === 2) ? 'C' : 'B'
  values.push(set === 'C' ? START_C : START_B)

  while (i < data.length) {
    if (set === 'C') {
      if (digitRun(data, i) >= 2) {
        values.push(Number(data.slice(i, i + 2)))
        i += 2
        continue
      }
      values.push(SWITCH_TO_B)
      set = 'B'
      continue
    }
    // Set B.
    const run = digitRun(data, i)
    const endsData = i + run === data.length
    if (run >= 6 || (run >= 4 && endsData)) {
      if (run % 2 === 1) {
        values.push(valueB(data[i]))
        i += 1
      }
      values.push(SWITCH_TO_C)
      set = 'C'
      continue
    }
    values.push(valueB(data[i]))
    i += 1
  }

  let sum = values[0]
  for (let k = 1; k < values.length; k++) sum += values[k] * k
  values.push(sum % 103)
  values.push(STOP)

  const widths: number[] = []
  for (const v of values) {
    for (const ch of PATTERNS[v]) widths.push(Number(ch))
  }
  const modules = widths.reduce((a, b) => a + b, 0)
  return { values, widths, modules }
}

/** Bars as {x, w} in modules — what a renderer draws. */
export function code128Bars(code: Code128): Array<{ x: number; w: number }> {
  const bars: Array<{ x: number; w: number }> = []
  let x = 0
  code.widths.forEach((w, idx) => {
    if (idx % 2 === 0) bars.push({ x, w })
    x += w
  })
  return bars
}

/** Quiet zone required on each side, in modules. */
export const CODE128_QUIET_MODULES = 10
