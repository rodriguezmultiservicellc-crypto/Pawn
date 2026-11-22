import type { Metadata } from 'next'
import localFont from 'next/font/local'
import VersionFooter from '@/components/version-footer'
import './globals.css'

/**
 * Font stack — DESIGN-lunaazul.md §3.
 *   - DM Sans: body / UI default. Weights 400 (default), 500, 600, 700.
 *   - Playfair Display: page titles + display headings only. 700, 900.
 *   - JetBrains Mono: tabular numerals (loan principal, ticket numbers,
 *     register totals, item SKUs). Retained from previous system.
 *
 * Self-hosted from ./fonts (latin subset, one variable-weight woff2 per
 * family, OFL licenses alongside). next/font/google downloaded them from
 * Google at build time, and that download failed two Vercel builds — the
 * build now needs no network for fonts. The files are the same Google
 * Fonts releases, taken from the @fontsource-variable packages.
 */
const dmSans = localFont({
  src: './fonts/dm-sans-latin-wght-normal.woff2',
  variable: '--font-dm-sans',
  weight: '100 1000',
  style: 'normal',
  display: 'swap',
})

const playfair = localFont({
  src: './fonts/playfair-display-latin-wght-normal.woff2',
  variable: '--font-playfair',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
})

const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin-wght-normal.woff2',
  variable: '--font-jetbrains-mono',
  weight: '100 800',
  style: 'normal',
  display: 'swap',
  // Arial metrics would be wrong for a monospace face.
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
})

export const metadata: Metadata = {
  title: 'Sol Pawn',
  description:
    'Multi-tenant pawn / jewelry / repair / retail SaaS. Rodriguez Multi Service LLC.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${playfair.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <VersionFooter />
      </body>
    </html>
  )
}
