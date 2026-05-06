// src/app/(public)/unsubscribe/page.tsx
//
// Public landing for one-click marketing-email unsubscribe. The link in
// every campaign email points here with `?t=<token>`. The token is
// `customers.email_unsubscribe_token` (UUID). On confirm, we flip
// marketing_opt_in=false on the customer row.
//
// Surface area is intentionally narrow: no user info displayed beyond
// first name, no internal IDs, no campaign details. A bad token resolves
// to a generic "invalid or expired" message — same response whether
// the token never existed or the customer was deleted, so the page
// can't be used for token-fishing.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import UnsubscribeContent from './content'

type SearchParams = {
  t?: string
  ok?: string
}

export const dynamic = 'force-dynamic'

export default async function UnsubscribePage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const token = typeof params.t === 'string' ? params.t.trim() : ''
  const ok = params.ok === '1'

  if (ok) {
    return <UnsubscribeContent state={{ kind: 'success' }} />
  }

  if (!isValidUuid(token)) {
    return <UnsubscribeContent state={{ kind: 'invalid' }} />
  }

  const admin = createAdminClient()
  const { data: customer } = await admin
    .from('customers')
    .select('id, tenant_id, first_name, marketing_opt_in')
    .eq('email_unsubscribe_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) {
    return <UnsubscribeContent state={{ kind: 'invalid' }} />
  }

  if (!customer.marketing_opt_in) {
    return (
      <UnsubscribeContent
        state={{ kind: 'already', firstName: customer.first_name }}
      />
    )
  }

  return (
    <UnsubscribeContent
      state={{
        kind: 'confirm',
        firstName: customer.first_name,
        token,
      }}
    />
  )
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
