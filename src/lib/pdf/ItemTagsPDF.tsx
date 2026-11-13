/**
 * Item tags as a PDF — one page per tag, page size = tag size.
 *
 * For any printer through its driver (set the driver's paper to the tag
 * stock). Geometry comes from lib/labels/layout.ts, shared with the ZPL
 * renderer; bars are drawn as filled boxes at whole-printer-dot widths.
 *
 * Codes render in Inter, not JetBrains Mono — see lib/pdf/shared.ts on the
 * mono ligature crash; ticket codes contain "-".
 */

import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { TagLayout } from '@/lib/labels/layout'

const PT = 72

export default function ItemTagsPDF({ layouts, title }: { layouts: TagLayout[]; title: string }) {
  return (
    <Document title={title} producer="Sol Pawn">
      {layouts.map((l, i) => (
        <Page key={i} size={[l.width * PT, l.height * PT]} style={{ padding: 0, backgroundColor: '#ffffff' }}>
          {l.barcode
            ? l.barcode.bars.map((b, j) => (
                <View
                  key={j}
                  style={{
                    position: 'absolute',
                    left: b.x * PT,
                    top: l.barcode!.y * PT,
                    width: b.w * PT,
                    height: l.barcode!.height * PT,
                    backgroundColor: '#000000',
                  }}
                />
              ))
            : null}
          {l.texts.map((t, j) => (
            <Text
              key={`t${j}`}
              style={{
                position: 'absolute',
                left: t.x * PT,
                top: t.y * PT,
                width: t.w * PT,
                fontFamily: 'Inter',
                fontWeight: t.bold ? 700 : 500,
                fontSize: t.size * PT,
                lineHeight: 1,
                color: '#000000',
                textAlign: t.align,
              }}
            >
              {t.text}
            </Text>
          ))}
        </Page>
      ))}
    </Document>
  )
}
