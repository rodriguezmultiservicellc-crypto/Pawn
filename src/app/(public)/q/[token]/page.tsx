import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { REPAIR_PHOTOS_BUCKET, getSignedUrl } from '@/lib/supabase/storage'
import { isValidPublicToken } from '@/lib/repair/stages'
import { shapePublicQuote, type PublicQuote } from '@/lib/custom-quotes/public-quote'
import QuotePublicContent from './content'

/**
 * Public custom-quote page — /q/<token> (brief Phase 2, patches/0063).
 * Same shape as /t/<token>: token is the only input, SECURITY DEFINER RPC,
 * allowlist shaper, generic 404, 1h-signed photo, noindex. Never a cost.
 */

export const dynamic = 'force-dynamic'

type Params = Promise<{ token: string }>

async function loadQuote(token: string): Promise<PublicQuote | null> {
  if (!isValidPublicToken(token)) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('custom_quote_public', { p_token: token })
  if (error) {
    console.error('[quote.public] rpc failed', error.message)
    return null
  }
  return shapePublicQuote(data)
}

export default async function QuotePublicPage({ params }: { params: Params }) {
  const { token } = await params
  const doc = await loadQuote(token)
  if (!doc) notFound()
  const photoUrl = doc.photo_path
    ? await getSignedUrl({ bucket: REPAIR_PHOTOS_BUCKET, path: doc.photo_path, ttlSeconds: 3600 })
    : null
  return <QuotePublicContent doc={doc} photoUrl={photoUrl} />
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token } = await params
  const doc = await loadQuote(token)
  return {
    title: doc ? `${doc.shop.name} · ${doc.quote_number}` : 'Not found',
    robots: { index: false, follow: false, nocache: true },
  }
}
