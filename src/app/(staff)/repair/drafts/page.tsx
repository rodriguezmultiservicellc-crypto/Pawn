import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { parseRepairDraftPayload } from '@/lib/repair/draft-payload'
import RepairDraftsContent, { type RepairDraftRow } from './content'

/**
 * Repair tickets not opened yet (patches/0118): saved with "Save as draft",
 * or moved to another device by QR code. Continue opens New repair ticket
 * with every field back; opening the ticket closes the draft.
 */
export default async function RepairDraftsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  const { data } = await ctx.supabase
    .from('repair_drafts')
    .select(
      'id, payload, updated_at, handoff_claimed_at, customers(first_name, last_name, phone)',
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200)

  const rows: RepairDraftRow[] = (data ?? []).map((d) => {
    const p = parseRepairDraftPayload(d.payload)
    const c = d.customers
    const priced = p.line_items.filter((li) => li.price.trim() !== '')
    return {
      id: d.id,
      customerName: c ? `${c.last_name}, ${c.first_name}` : '—',
      customerPhone: c?.phone ?? null,
      itemCount: p.line_items.length,
      total: priced.length === 0 ? null : priced.reduce((s, li) => s + (parseFloat(li.price) || 0), 0),
      updatedAt: d.updated_at,
      onOtherDevice: d.handoff_claimed_at != null,
    }
  })

  return <RepairDraftsContent rows={rows} />
}
