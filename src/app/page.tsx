import type { Metadata } from 'next'
import { headers } from 'next/headers'
import LandingPage from '@/components/marketing/LandingPage'

/**
 * Apex "/" is the public marketing landing. The proxy passes unauthenticated
 * visitors through to this page (logged-in users are role-routed to
 * /admin, /dashboard, or /portal before it renders). Tenant subdomains are
 * rewritten to /s/<slug> upstream, so this only serves the platform apex.
 */
export const metadata: Metadata = {
  title: 'Sol Pawn — Pawn, jewelry & repair shop software',
  description:
    'One system for pawn loans, repair tickets, retail POS, inventory, and compliance. Built for pawn and jewelry shops. Bilingual (EN/ES).',
  openGraph: {
    title: 'Sol Pawn — Pawn, jewelry & repair shop software',
    description:
      'One system for pawn loans, repair tickets, retail POS, inventory, and compliance. Bilingual (EN/ES).',
    siteName: 'Sol Pawn',
    type: 'website',
  },
}

/**
 * Sniff Accept-Language server-side (es-* → Spanish, else English) so the
 * page renders in the visitor's language with no client flicker. The nav
 * EN|ES toggle takes over from there. Mirrors the tenant-storefront layout.
 */
async function detectInitialLang(): Promise<'en' | 'es'> {
  const accept = (await headers()).get('accept-language')?.toLowerCase() ?? ''
  for (const part of accept.split(',')) {
    const code = part.trim().split(';')[0]
    if (code?.startsWith('es')) return 'es'
    if (code?.startsWith('en')) return 'en'
  }
  return 'en'
}

export default async function Home() {
  const initialLang = await detectInitialLang()
  return <LandingPage initialLang={initialLang} />
}
