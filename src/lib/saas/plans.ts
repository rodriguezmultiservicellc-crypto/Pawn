import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { SubscriptionPlan } from './types'

export type { SubscriptionPlan } from './types'
export {
  formatCents,
  planFeatures,
  planHasFeature,
  planLimit,
} from './types'

/** Active plans in display order. Operator-side admin uses this; tenant-side
 *  pricing pages will use the same query later. */
export async function getActivePlans(): Promise<SubscriptionPlan[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`failed to load plans: ${error.message}`)
  return data ?? []
}

export async function getAllPlans(): Promise<SubscriptionPlan[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('subscription_plans')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`failed to load plans: ${error.message}`)
  return data ?? []
}

export async function getPlanByCode(
  code: string,
): Promise<SubscriptionPlan | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscription_plans')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  return data
}

export async function getPlanById(
  id: string,
): Promise<SubscriptionPlan | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscription_plans')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return data
}
