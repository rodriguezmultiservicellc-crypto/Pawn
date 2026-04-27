import { redirect } from 'next/navigation'

/**
 * /portal — redirect to the loans tab. The portal does not currently have
 * a separate dashboard; loans is the canonical landing surface.
 */
export default function PortalIndexPage() {
  redirect('/portal/loans')
}
