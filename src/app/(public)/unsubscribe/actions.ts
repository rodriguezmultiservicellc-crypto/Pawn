// src/app/(public)/unsubscribe/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Confirm action — flips marketing_opt_in on the customer matching the
 * token. No-op if the token doesn't resolve, or the customer is already
 * unsubscribed.
 *
 * Returns via redirect to the same page with `?ok=1` so the success
 * state survives a refresh and we don't leak the token in browser
 * history.
 */
export async function unsubscribeAction(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim()
  if (!UUID_RE.test(token)) redirect('/unsubscribe')

  const admin = createAdminClient()
  const { data: customer } = await admin
    .from('customers')
    .select('id, tenant_id, marketing_opt_in')
    .eq('email_unsubscribe_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) {
    // Same redirect either way — no info disclosure on bad/expired token.
    redirect('/unsubscribe')
  }

  if (customer.marketing_opt_in) {
    const { error } = await admin
      .from('customers')
      .update({ marketing_opt_in: false })
      .eq('id', customer.id)

    if (!error) {
      await logAudit({
        tenantId: customer.tenant_id,
        userId: null,
        action: 'email_campaign_unsubscribe',
        tableName: 'customers',
        recordId: customer.id,
        changes: {
          via: 'public_unsubscribe_link',
          before: { marketing_opt_in: true },
          after: { marketing_opt_in: false },
        },
      })
    }
  }

  redirect('/unsubscribe?ok=1')
}
