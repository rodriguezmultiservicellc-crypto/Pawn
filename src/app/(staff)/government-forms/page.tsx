import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { AGENCY_FORMS } from '@/lib/agency-forms'
import { hasFact } from '@/lib/agency-forms/profile'
import { answersFor } from '@/lib/agency-forms/types'
import { loadBusinessProfile } from '@/lib/agency-forms/load'
import GovernmentFormsContent, { type FormCard } from './content'

export const dynamic = 'force-dynamic'

/** Government forms filled from the business profile. Owner only. */
export default async function GovernmentFormsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase } = await requireOwner(ctx.tenantId)

  const { profile, saved } = await loadBusinessProfile(supabase, ctx.tenantId)
  const forms: FormCard[] = AGENCY_FORMS.map((f) => ({
    id: f.id,
    agency: f.agency,
    code: f.code,
    questions: f.questions.map((q) => ({ key: q.key, options: [...q.options] })),
    answers: answersFor(f, profile.form_answers[f.id]),
    missing: f.required.filter((fact) => !hasFact(profile, fact)),
  }))

  return <GovernmentFormsContent forms={forms} profileSaved={saved} legalName={profile.legal_name} />
}
