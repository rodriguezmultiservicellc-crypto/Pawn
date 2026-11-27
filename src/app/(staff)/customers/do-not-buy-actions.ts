'use server'

import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { checkCustomerDoNotBuy, type DoNotBuyResult } from '@/lib/leadsonline/do-not-buy'

/** The Do Not Buy banner on New pawn / Purchase / Buy outright: is the
 *  picked customer on the LeadsOnline list? Read only. */
export async function checkCustomerDoNotBuyAction(customerId: string): Promise<DoNotBuyResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireRoleInTenant(ctx.tenantId, ['owner', 'chain_admin', 'manager', 'pawn_clerk'])
  if (typeof customerId !== 'string' || customerId === '') return { status: 'off' }
  return checkCustomerDoNotBuy(ctx.tenantId, customerId)
}
