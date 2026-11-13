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

export function layoutTag(template: TagTemplate, content: TagContent): TagLayout {
  const warnings: TagWarning[] = []
  const panels = tagPanels(template)
  const H = template.height_in
  const codePanel = panels[0]
  const textPanel = panels[panels.length - 1]
  const split = panels.length > 1

  // ── Barcode: snap the module to whole dots that fit the panel width.
  const symbol = encodeCode128(content.barcode)
  const totalModules = symbol.modules + 2 * CODE128_QUIET_MODULES
  const availW = codePanel.w - 2 * MARGIN
  const moduleDots = Math.floor((availW * template.dpi) / totalModules)
  const texts: TextBox[] = []

  const barTop = MARGIN
  const barHeight = split
    ? H - 2 * MARGIN - CODE_SIZE * LEADING
    : Math.min(0.4, H * 0.38)

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
    x: codePanel.x + MARGIN,
    y: codeY,
    w: codePanel.w - 2 * MARGIN,
    size: CODE_SIZE,
    text: fitText(content.code, codePanel.w - 2 * MARGIN, CODE_SIZE),
    bold: true,
    align: 'center',
  })

  // ── Text block: right wing on a split tag, under the code on a single.
  const tx = textPanel.x + MARGIN
  const tw = textPanel.w - 2 * MARGIN
  let y = split ? MARGIN : codeY + CODE_SIZE * LEADING + 0.01
  const bottom = H - MARGIN

  if (content.headline && y + HEADLINE_SIZE <= bottom + 1e-9) {
    texts.push({ x: tx, y, w: tw, size: HEADLINE_SIZE, text: fitText(content.headline, tw, HEADLINE_SIZE), bold: true, align: 'left' })
    y += HEADLINE_SIZE * LEADING
  }
  let placed = 0
  for (const line of content.lines) {
    if (y + LINE_SIZE > bottom + 1e-9) break
    texts.push({ x: tx, y, w: tw, size: LINE_SIZE, text: fitText(line, tw, LINE_SIZE), bold: false, align: 'left' })
    y += LINE_SIZE * LEADING
    placed++
  }
  if (placed < content.lines.length) warnings.push('lines_dropped')

  return { width: template.width_in, height: H, barcode, texts, warnings }
}
