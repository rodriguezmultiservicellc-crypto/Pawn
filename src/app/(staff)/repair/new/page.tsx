import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { claimHandoff, type ClaimResult } from '@/lib/pawn/draft-handoff'
import { parseRepairDraftPayload } from '@/lib/repair/draft-payload'
import { signIntakePhotos } from '@/lib/uploads/intake-photos-server'
import NewRepairTicketForm, { type RepairDraftInitial, type TechnicianOption } from './form'

type SearchParams = Promise<{ draft?: string; handoff?: string }>

export default async function NewRepairTicketPage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  // Staff users at this tenant for the technician picker. Two-step:
  // user_tenants → join to profiles by user_id (no FK across schemas).
  const { data: utRows } = await ctx.supabase
    .from('user_tenants')
    .select('user_id, role')
    .eq('tenant_id', ctx.tenantId)
    .eq('is_active', true)

  const userIds = (utRows ?? [])
    .filter((u) =>
      ['owner', 'manager', 'pawn_clerk', 'repair_tech', 'chain_admin'].includes(
        u.role,
      ),
    )
    .map((u) => u.user_id)

  let technicianOptions: TechnicianOption[] = []
  if (userIds.length > 0) {
    const { data: profiles } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    technicianOptions = (profiles ?? []).map((p) => ({
      id: p.id,
      label: p.full_name?.trim() || p.email || p.id.slice(0, 8),
    }))
  }

  // Opened from another device's QR code (patches/0118): take the draft
  // (once; the device that showed the code closes its copy), then load it.
  const { draft: draftId, handoff: handoffCode } = await props.searchParams
  const validDraftId = draftId && /^[0-9a-f-]{36}$/i.test(draftId) ? draftId : null
  let handoff: ClaimResult | null = null
  if (validDraftId && handoffCode) {
    handoff = await claimHandoff({
      supabase: ctx.supabase,
      table: 'repair_drafts',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      draftId: validDraftId,
      code: handoffCode,
    })
  }
  let initialDraft: RepairDraftInitial | null = null
  if (validDraftId) {
    const { data: d } = await ctx.supabase
      .from('repair_drafts')
      .select('id, payload, customers(id, first_name, last_name, phone)')
      .eq('id', validDraftId)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    const c = d?.customers
    if (d && c) {
      const payload = parseRepairDraftPayload(d.payload)
      const tenantId = ctx.tenantId
      initialDraft = {
        id: d.id,
        // The same label the customer picker shows.
        customer: {
          id: c.id,
          label: `${c.last_name}, ${c.first_name}${c.phone ? ` · ${c.phone}` : ''}`,
        },
        payload,
        // Each item's photos, shown again. Only this shop's photos that are
        // still in storage come back.
        photos: await Promise.all(
          payload.line_items.map(async (li) =>
            (await signIntakePhotos(li.photos, tenantId, 'repair-photos')).map((p) => ({
              ...p,
              name: '',
            })),
          ),
        ),
      }
    }
  }

  return (
    <NewRepairTicketForm
      tenantId={ctx.tenantId}
      technicians={technicianOptions}
      initialDraft={initialDraft}
      handoff={handoff}
    />
  )
}
