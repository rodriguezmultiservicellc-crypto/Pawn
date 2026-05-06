import type { Metadata } from 'next'
import { DM_Sans, Playfair_Display, JetBrains_Mono } from 'next/font/google'
import VersionFooter from '@/components/version-footer'
import './globals.css'

/**
 * Font stack — DESIGN-lunaazul.md §3.
 *   - DM Sans: body / UI default. Weights 400 (default), 500, 600, 700.
 *   - Playfair Display: page titles + display headings only. 700, 900.
 *   - JetBrains Mono: tabular numerals (loan principal, ticket numbers,
 *     register totals, item SKUs). Retained from previous system.
 */
const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  weight: ['700', '900'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Pawn',
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
