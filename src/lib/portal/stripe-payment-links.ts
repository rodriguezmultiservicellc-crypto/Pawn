import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  StripePaymentLinkInsert,
  StripePaymentLinkRow,
  StripePaymentLinkUpdate,
} from '@/types/database-aliases'

/**
 * Loosely-typed admin handle for stripe_payment_links — the table ships in
 * patches/0009 but src/types/database.ts doesn't see it until the operator
 * regenerates types post-merge. These helpers paper over the gap.
 *
 * Once db:types regenerates and Database['public']['Tables']
 * ['stripe_payment_links'] exists, callers can switch to the standard
 * Supabase client surface and we can delete this file.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(): any {
  // Cast the admin client to `any` so we can use the new table by name
  // without TS picking up the generated Database union (which doesn't
  // know about it yet).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (createAdminClient() as any).from('stripe_payment_links')
}

export async function findStripeLinkBySessionId(
  sessionId: string,
): Promise<StripePaymentLinkRow | null> {
  const { data } = await table()
    .select('*')
    .eq('stripe_session_id', sessionId)
    .maybeSingle()
  return (data as StripePaymentLinkRow | null) ?? null
}

export async function findStripeLinkByPaymentIntentId(
  paymentIntentId: string,
): Promise<StripePaymentLinkRow | null> {
  const { data } = await table()
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()
  return (data as StripePaymentLinkRow | null) ?? null
}

export async function insertStripeLink(
  insert: StripePaymentLinkInsert,
): Promise<{ id: string } | null> {
  const { data, error } = await table()
    .insert(insert)
    .select('id')
    .single()
  if (error || !data) return null
  return data as { id: string }
}

export async function updateStripeLinkBySessionId(
  sessionId: string,
  update: StripePaymentLinkUpdate,
): Promise<void> {
  await table().update(update).eq('stripe_session_id', sessionId)
}

export async function getStripeLinkStatusBySessionId(
  sessionId: string,
): Promise<string | null> {
  const { data } = await table()
    .select('status')
    .eq('stripe_session_id', sessionId)
    .maybeSingle()
  return (data as { status?: string } | null)?.status ?? null
}
