'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { sendTicketsToLeadsOnline, type SendResult } from '@/lib/leadsonline/submit'

export type SendToLeadsOnlineResult =
  | { ok: true; env: 'sandbox' | 'production'; results: SendResult[] }
  | { ok: false; error: string }

/** Send these police-report tickets (compliance_log ids) to the LeadsOnline
 *  web service the shop is set up for (patches/0123). Owner / manager. */
export async function sendToLeadsOnlineAction(complianceLogIds: string[]): Promise<SendToLeadsOnlineResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { userId } = await requireRoleInTenant(ctx.tenantId, ['owner', 'chain_admin', 'manager'])

  const ids = Array.isArray(complianceLogIds) ? complianceLogIds.filter((v) => typeof v === 'string') : []
  const r = await sendTicketsToLeadsOnline({ tenantId: ctx.tenantId, userId, complianceLogIds: ids })
  revalidatePath('/reports/police-report')
  revalidatePath('/settings/integrations/leadsonline')
  return r
}
