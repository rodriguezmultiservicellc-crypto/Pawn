import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { REPAIR_PHOTOS_BUCKET, getSignedUrl } from '@/lib/supabase/storage'
import { isValidPublicToken } from '@/lib/repair/stages'
import { shapePublicTicket, type PublicTicket } from '@/lib/repair/public-ticket'
import TrackingContent from './content'

/**
 * Public repair tracking page — /t/<token> (brief Phase 1, patches/0061).
 *
 * No login. The token is the ONLY input: the SECURITY DEFINER RPC
 * `repair_public_ticket(token)` resolves tenant + ticket from it and
 * returns a document that already excludes the customer's identity; the
 * shaper re-applies the allowlist on this side. Unknown, revoked, voided,
 * deleted or suspended → the same generic not-found, so the page cannot
 * be used to probe token existence.
 *
 * The reference photo lives in a private bucket; it is signed here for
 * one hour with the service role (rule 12) — the browser never sees a
 * storage path.
 */

export const dynamic = 'force-dynamic'

type Params = Promise<{ token: string }>

async function loadTicket(token: string): Promise<PublicTicket | null> {
  if (!isValidPublicToken(token)) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('repair_public_ticket', { p_token: token })
  if (error) {
    console.error('[tracking] rpc failed', error.message)
    return null
  }
  return shapePublicTicket(data)
}

export default async function TrackingPage({ params }: { params: Params }) {
  const { token } = await params
  const doc = await loadTicket(token)
  if (!doc) notFound()

  const photoUrl = doc.photo_path
    ? await getSignedUrl({
        bucket: REPAIR_PHOTOS_BUCKET,
        path: doc.photo_path,
        ttlSeconds: 3600,
      })
    : null

  return <TrackingContent doc={doc} photoUrl={photoUrl} />
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token } = await params
  const doc = await loadTicket(token)
  return {
    title: doc ? `${doc.shop.name} · ${doc.ticket_number}` : 'Not found',
    // A private link — never indexed, never previewed with the ticket number.
    robots: { index: false, follow: false, nocache: true },
  }
}
