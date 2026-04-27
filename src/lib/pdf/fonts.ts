/**
 * Font registration for @react-pdf/renderer.
 *
 * Inter (sans-serif body) + JetBrains Mono (tabular numerals). We ship the
 * `@fontsource/*` npm packages so the woff files travel with the build —
 * no remote font-server dependency at render time. React-PDF's fontkit
 * accepts WOFF/WOFF2 directly.
 *
 * Idempotent: registerPdfFonts() guards on a module-level flag so calling
 * it from every render-loan-ticket invocation is safe.
 *
 * Body weight is 500 (medium) per DESIGN-airbnb.md §3 — Cereal/Inter body
 * weight role. We also register 700 for bold accents (ticket number, totals).
 *
 * IMPORTANT: this file is server-only — it imports `path` and resolves files
 * via require.resolve(). Never import from a client component.
 */

import { Font } from '@react-pdf/renderer'
import fs from 'node:fs'
import path from 'node:path'

let registered = false

/**
 * Read a woff file from node_modules and return it as a base64 data URL so
 * react-pdf's fontkit loader can decode it directly. Bundler-friendly:
 * Turbopack does not statically analyze fs.readFileSync as a module
 * import — the path is resolved at runtime.
 *
 * The fontsource packages publish files under
 * `node_modules/<pkg>/files/<font>-<subset>-<weight>-<style>.woff`.
 *
 * We resolve from process.cwd() so the path stays correct in both `next
 * dev` (cwd = project root) and `next start` (same). Vercel builds run
 * from the project root too.
 */
function fontDataUrl(pkg: string, file: string): string {
  const filePath = path.join(process.cwd(), 'node_modules', pkg, 'files', file)
  const bytes = fs.readFileSync(filePath)
  // The data URL header must include `;base64` for fontkit's data-URL
  // detector (see @react-pdf/font's isDataUrl).
  return `data:font/woff;base64,${bytes.toString('base64')}`
}

export function registerPdfFonts(): void {
  if (registered) return
  registered = true

  // Inter — sans-serif body.
  Font.register({
    family: 'Inter',
    fonts: [
      {
        src: fontDataUrl('@fontsource/inter', 'inter-latin-500-normal.woff'),
        fontWeight: 500,
      },
      {
        src: fontDataUrl('@fontsource/inter', 'inter-latin-700-normal.woff'),
        fontWeight: 700,
      },
    ],
  })

  // JetBrains Mono — tabular numerals (ticket numbers, amounts, weights).
  Font.register({
    family: 'JetBrains Mono',
    fonts: [
      {
        src: fontDataUrl(
          '@fontsource/jetbrains-mono',
          'jetbrains-mono-latin-500-normal.woff',
        ),
        fontWeight: 500,
      },
      {
        src: fontDataUrl(
          '@fontsource/jetbrains-mono',
          'jetbrains-mono-latin-700-normal.woff',
        ),
        fontWeight: 700,
      },
    ],
  })

  // Disable hyphenation across the board — tickets break weirdly otherwise.
  Font.registerHyphenationCallback((word) => [word])
}
