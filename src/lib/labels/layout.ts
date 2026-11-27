/**
 * Tag layout — one geometry for both renderers. Pure.
 *
 * Everything is computed in inches here; the PDF renderer multiplies by 72
 * (points) and the ZPL renderer by the template's dpi (dots). Because the
 * barcode module width is snapped to whole printer dots, the PDF and the
 * thermal print have the same bar geometry, which is what makes a PDF
 * test print a fair predictor of whether the real tag will scan.
 */

import { CODE128_QUIET_MODULES, code128Bars, encodeCode128 } from './code128'
import type { TagContent } from './tag-content'
import { tagPanels, type TagTemplate } from './templates'

export type TagWarning =
  /** Bars are 1 printer dot wide: likely unreadable at 203 dpi. */
  | 'barcode_narrow'
  /** Even 1-dot bars do not fit the panel: the tag cannot be scanned. */
  | 'barcode_too_wide'
  /** Some text lines did not fit and were left off. */
  | 'lines_dropped'

export type TextBox = { x: number; y: number; w: number; size: number; text: string; bold: boolean; align: 'left' | 'center' }

export type TagLayout = {
  width: number
  height: number
  barcode: null | {
    x: number
    y: number
    height: number
    /** One module, in inches (a whole number of dots). */
    module: number
    /** One module, in printer dots. */
    moduleDots: number
    bars: Array<{ x: number; w: number }>
    data: string
  }
  texts: TextBox[]
  warnings: TagWarning[]
}

const MARGIN = 0.04
const CODE_SIZE = 0.075
const HEADLINE_SIZE = 0.13
const LINE_SIZE = 0.07
const LEADING = 1.2
/** Average glyph advance as a share of font size, for clipping. */
const CHAR_ADVANCE = 0.56

/** Clip text to what fits in `w` inches at `size`. */
export function fitText(text: string, w: number, size: number): string {
  const max = Math.max(1, Math.floor(w / (size * CHAR_ADVANCE)))
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/**
 * Text scale for a label: 1 up to 2 sq in (every jewelry tag and the 2×1
 * labels print exactly as before), then growing with the label's area so a
 * 3×5 envelope label reads across a bench (≈ 2.7×).
 */
export function tagScale(t: Pick<TagTemplate, 'width_in' | 'height_in'>): number {
  return Math.min(3, Math.max(1, Math.sqrt((t.width_in * t.height_in) / 2)))
}

/**
 * Word-wrap `text` into at most `maxRows` rows that fit `w` inches at
 * `size`; the last row is clipped with "…" when the text is longer.
 */
export function wrapText(text: string, w: number, size: number, maxRows: number): string[] {
  const max = Math.max(1, Math.floor(w / (size * CHAR_ADVANCE)))
  const rows: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= max) {
      cur = next
      continue
    }
    if (cur) rows.push(cur)
    cur = word
  }
  if (cur) rows.push(cur)
  // A single word longer than a row is clipped.
  const fitted = rows.map((r) => fitText(r, w, size))
  if (fitted.length <= maxRows) return fitted
  const rest = rows.slice(maxRows - 1).join(' ')
  return [...fitted.slice(0, maxRows - 1), fitText(rest, w, size)]
}

/** Rows a wrapped line may take. */
const WRAP_ROWS = 3

export function layoutTag(template: TagTemplate, content: TagContent): TagLayout {
  const warnings: TagWarning[] = []
  const panels = tagPanels(template)
  const H = template.height_in
  const codePanel = panels[0]
  const textPanel = panels[panels.length - 1]
  const split = panels.length > 1
  const k = tagScale(template)
  // Margins grow with the label (a 3×5 thermal label needs ~0.1in); every
  // jewelry tag keeps k = 1, so its geometry is unchanged.
  const M = MARGIN * k
  // An envelope (wrapping) label prints the ticket number larger: it is how
  // the envelope is found in a drawer.
  const CODE = CODE_SIZE * k * (content.wrap ? 1.5 : 1)
  // The customer name on an envelope: ~20pt, so a full name fits one row.
  const HEAD = HEADLINE_SIZE * k * (content.wrap ? 0.8 : 1)
  const LINE = LINE_SIZE * k
  /** Extra space between two wrapped lines, so items read apart. */
  const GAP = content.wrap ? LINE * 0.35 : 0

  // ── Barcode: snap the module to whole dots that fit the panel width.
  const symbol = encodeCode128(content.barcode)
  const totalModules = symbol.modules + 2 * CODE128_QUIET_MODULES
  const availW = codePanel.w - 2 * M
  const moduleDots = Math.floor((availW * template.dpi) / totalModules)
  const texts: TextBox[] = []

  const barTop = M
  const barHeight = split
    ? H - 2 * M - CODE * LEADING
    : Math.min(0.4 * Math.min(k, 1.9), H * 0.38)

  let barcode: TagLayout['barcode'] = null
  if (moduleDots < 1) {
    warnings.push('barcode_too_wide')
  } else {
    if (moduleDots < 2 && template.dpi <= 203) warnings.push('barcode_narrow')
    const moduleIn = moduleDots / template.dpi
    const symbolW = symbol.modules * moduleIn
    const x0 = codePanel.x + (codePanel.w - symbolW) / 2
    barcode = {
      x: x0,
      y: barTop,
      height: Math.max(0.1, barHeight),
      module: moduleIn,
      moduleDots,
      bars: code128Bars(symbol).map((b) => ({ x: x0 + b.x * moduleIn, w: b.w * moduleIn })),
      data: content.barcode,
    }
  }

  const codeY = barTop + Math.max(0.1, barHeight) + 0.01
  texts.push({
    x: codePanel.x + M,
    y: codeY,
    w: codePanel.w - 2 * M,
    size: CODE,
    text: fitText(content.code, codePanel.w - 2 * M, CODE),
    bold: true,
    align: 'center',
  })

  // ── Text block: right wing on a split tag, under the code on a single.
  const tx = textPanel.x + M
  const tw = textPanel.w - 2 * M
  let y = split ? M : codeY + CODE * LEADING + 0.01 * k
  const bottom = H - M

  if (content.headline && y + HEAD <= bottom + 1e-9) {
    const rows = content.wrap ? wrapText(content.headline, tw, HEAD, 2) : [fitText(content.headline, tw, HEAD)]
    for (const row of rows) {
      if (y + HEAD > bottom + 1e-9) break
      texts.push({ x: tx, y, w: tw, size: HEAD, text: row, bold: true, align: 'left' })
      y += HEAD * LEADING
    }
    y += GAP
  }
  let placed = 0
  for (const line of content.lines) {
    const rows = content.wrap ? wrapText(line, tw, LINE, WRAP_ROWS) : [fitText(line, tw, LINE)]
    // A line goes on whole or not at all.
    if (y + LINE * LEADING * (rows.length - 1) + LINE > bottom + 1e-9) break
    for (const row of rows) {
      texts.push({ x: tx, y, w: tw, size: LINE, text: row, bold: false, align: 'left' })
      y += LINE * LEADING
    }
    y += GAP
    placed++
  }
  if (placed < content.lines.length) warnings.push('lines_dropped')

  return { width: template.width_in, height: H, barcode, texts, warnings }
}
