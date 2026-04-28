import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import VersionFooter from '@/components/version-footer'
import './globals.css'

/**
 * Inter substitutes the proprietary Airbnb Cereal VF (DESIGN-airbnb.md §3).
 * Body weight is 500, with 600/700 reserved for emphasis. We declare only
 * the weights we actually use to keep the font payload trim.
 */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
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
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
        <VersionFooter />
      </body>
    </html>
  )
}
