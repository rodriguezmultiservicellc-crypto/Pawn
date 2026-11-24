import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { loadBusinessProfile } from '@/lib/agency-forms/load'
import ProfileForm from './form'

export const dynamic = 'force-dynamic'

/** The business profile government forms are filled from. Owner only. */
export default async function BusinessProfilePage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase } = await requireOwner(ctx.tenantId)

  const { profile } = await loadBusinessProfile(supabase, ctx.tenantId)
  return <ProfileForm initial={profile} />
}
