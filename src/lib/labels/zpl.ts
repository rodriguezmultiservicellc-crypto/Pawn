/**
 * ZPL renderer for Zebra-language thermal printers. Pure.
 *
 * Draws the bars itself (^GB boxes) from the shared layout instead of
 * asking the printer to encode (^BC). That keeps the thermal tag
 * bar-for-bar identical to the PDF test print, and Phase 2b adds the RFID
 * write command to this same label without touching the geometry.
 */

import { layoutTag, type TagWarning } from './layout'
import type { TagContent } from './tag-content'
import type { TagTemplate } from './templates'

/** ZPL treats ^ and ~ as command prefixes; the stock font lacks a few glyphs. */
export function zplText(s: string): string {
  return s.replace(/[\^~]/g, ' ').replace(/…/g, '...').replace(/·/g, '-')
}

export function renderZplLabel(template: TagTemplate, content: TagContent, copies = 1): { zpl: string; warnings: TagWarning[] } {
  const layout = layoutTag(template, content)
  const dpi = template.dpi
  const d = (inches: number) => Math.round(inches * dpi)
  const out: string[] = ['^XA', '^CI28', `^PW${d(layout.width)}`, `^LL${d(layout.height)}`, '^LH0,0']

  if (layout.barcode) {
    const bc = layout.barcode
    const h = d(bc.height)
    for (const bar of bc.bars) {
      const w = Math.max(1, Math.round(bar.w * dpi))
      out.push(`^FO${d(bar.x)},${d(bc.y)}^GB${w},${h},${w}^FS`)
    }
  }
  for (const t of layout.texts) {
    const size = Math.max(8, d(t.size))
    out.push(
      `^FO${d(t.x)},${d(t.y)}^A0N,${size},${size}^FB${d(t.w)},1,0,${t.align === 'center' ? 'C' : 'L'}^FD${zplText(t.text)}^FS`,
    )
  }
  out.push(`^PQ${Math.max(1, Math.min(99, Math.floor(copies)))}`, '^XZ')
  return { zpl: out.join('\n'), warnings: layout.warnings }
}

export function renderZplBatch(template: TagTemplate, items: readonly TagContent[]): { zpl: string; warnings: TagWarning[] } {
  const warnings = new Set<TagWarning>()
  const parts = items.map((c) => {
    const r = renderZplLabel(template, c)
    r.warnings.forEach((w) => warnings.add(w))
    return r.zpl
  })
  return { zpl: parts.join('\n'), warnings: [...warnings] }
}
