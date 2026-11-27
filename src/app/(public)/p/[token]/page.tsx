import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadPublicPawn } from '@/lib/pawn/public-ticket'
import PawnTicketContent from './content'

/**
 * Public pawn ticket page — /p/<token> (patches/0127), the pawn twin of the
 * repair tracking page (/t/<token>).
 *
 * No login. The token is the ONLY input (lib/pawn/public-ticket.ts): unknown,
 * revoked, voided or deleted → the same generic not-found. Shows the ticket,
 * never the customer's identity.
 */

export const dynamic = 'force-dynamic'

type Params = Promise<{ token: string }>

export default async function PawnTicketPage({ params }: { params: Params }) {
  const { token } = await params
  const doc = await loadPublicPawn(token)
  if (!doc) notFound()
  return <PawnTicketContent doc={doc} />
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token } = await params
  const doc = await loadPublicPawn(token)
  return {
    title: doc ? `${doc.shop.name} · ${doc.ticketNumber}` : 'Not found',
    // A private link — never indexed.
    robots: { index: false, follow: false, nocache: true },
  }
}
