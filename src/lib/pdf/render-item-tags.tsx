/**
 * Render item tags to a PDF buffer. Pure apart from font registration —
 * the caller loads and gates; this only draws.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import { layoutTag, type TagWarning } from '@/lib/labels/layout'
import type { TagContent } from '@/lib/labels/tag-content'
import type { TagTemplate } from '@/lib/labels/templates'
import { registerPdfFonts } from './fonts'
import ItemTagsPDF from './ItemTagsPDF'

export async function renderItemTagsPdf(args: {
  template: TagTemplate
  contents: TagContent[]
  title: string
}): Promise<{ buffer: Buffer; warnings: TagWarning[] }> {
  registerPdfFonts()
  const warnings = new Set<TagWarning>()
  const layouts = args.contents.map((c) => {
    const l = layoutTag(args.template, c)
    l.warnings.forEach((w) => warnings.add(w))
    return l
  })
  const buffer = await renderToBuffer(<ItemTagsPDF layouts={layouts} title={args.title} />)
  return { buffer, warnings: [...warnings] }
}
