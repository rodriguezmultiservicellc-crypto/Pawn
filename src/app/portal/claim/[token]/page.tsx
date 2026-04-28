import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ClaimContent from './content'

type Params = Promise<{ token: string }>

/**
 * Portal-claim landing. The customer arrives here after clicking the
 * magic link in their portal-invite email. Supabase has already minted
 * the session by the time this server component runs (the /magic-link
 * page set it client-side and forwarded here).
 *
 * We render a single button that runs the claim action — we deliberately
 * avoid auto-claiming on page load so the customer sees a "you're
 * about to be linked to <Shop Name>" confirmation first. Defends
 * against a leaked link being clicked on a coworker's signed-in
 * browser.
 */
export default async function ClaimPage(props: { params: Params }) {
  const { token } = await props.params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // If they aren't signed in, magic-link redirect must have failed.
  // Bounce back through the magic-link flow with this URL preserved.
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/portal/claim/${token}`)}`)
  }

  // Look up the invite via admin client (RLS hides this row from a
  // non-staff session, and the customer is by definition not staff).
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('customer_portal_invites')
    .select(
      'id, tenant_id, customer_id, email, expires_at, consumed_at, created_at',
    )
    .eq('token', token)
    .maybeSingle()

  if (!invite) {
    return <ClaimContent state={{ kind: 'invalid' }} token={token} />
  }
  if (invite.consumed_at) {
    return <ClaimContent state={{ kind: 'already_used' }} token={token} />
  }
  // Date.now() is "impure" by lint, but this is a server component (single
  // render per request) so the rule misfires. Capture the timestamp once.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  if (new Date(invite.expires_at).getTime() < nowMs) {
    return <ClaimContent state={{ kind: 'expired' }} token={token} />
  }

  // The signed-in user's email must match the invite's email. Defends
  // against a leaked link being claimed by someone other than the
  // intended customer (their coworker, the IT desk, anyone with browser
  // access). Lower-cased compare.
  const userEmail = (user.email ?? '').trim().toLowerCase()
  const inviteEmail = invite.email.trim().toLowerCase()
  if (!userEmail || userEmail !== inviteEmail) {
    return (
      <ClaimContent
        state={{
          kind: 'wrong_user',
          inviteEmail: invite.email,
          userEmail: user.email ?? null,
        }}
        token={token}
      />
    )
  }

  // Pull tenant + customer for the confirmation copy.
  const [{ data: tenant }, { data: customer }] = await Promise.all([
    admin
      .from('tenants')
      .select('name, dba')
      .eq('id', invite.tenant_id)
      .maybeSingle<{ name: string; dba: string | null }>(),
    admin
      .from('customers')
      .select('id, first_name, last_name, auth_user_id')
      .eq('id', invite.customer_id)
      .maybeSingle<{
        id: string
        first_name: string
        last_name: string
        auth_user_id: string | null
      }>(),
  ])

  if (!tenant || !customer) {
    return <ClaimContent state={{ kind: 'invalid' }} token={token} />
  }

  // If the customer record is already linked to a DIFFERENT auth user,
  // we'd be silently rebinding their portal account. Refuse instead
  // and tell the operator to delete-and-reinvite if they really want
  // to switch.
  if (customer.auth_user_id && customer.auth_user_id !== user.id) {
    return <ClaimContent state={{ kind: 'already_linked_other' }} token={token} />
  }

  return (
    <ClaimContent
      state={{
        kind: 'ready',
        shopName: tenant.dba || tenant.name,
        customerName: [customer.first_name, customer.last_name]
          .filter(Boolean)
          .join(' ')
          .trim(),
      }}
      token={token}
    />
  )
}
