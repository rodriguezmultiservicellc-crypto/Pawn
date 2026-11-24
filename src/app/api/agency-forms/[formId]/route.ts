/**
 * GET /api/agency-forms/[formId]
 *
 * The government form, filled from the shop's business profile
 * (src/lib/agency-forms/). Owner only (requireOwner, then RLS on
 * tenant_business_profile). Refuses while the profile lacks what the form
 * requires. Never signs or dates. Every download is audit-logged (which
 * form, not its contents).
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { agencyForm } from '@/lib/agency-forms'
import { answersFor } from '@/lib/agency-forms/types'
import { hasFact } from '@/lib/agency-forms/profile'
import { loadBusinessProfile } from '@/lib/agency-forms/load'
import { fillAgencyPdf, ValueTooLongError } from '@/lib/agency-forms/fill-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ formId: string }> },
): Promise<Response> {
  const { formId } = await ctx.params
  const form = agencyForm(formId)
  if (!form) return new Response('unknown_form', { status: 404 })

  const session = await getCtx()
  if (!session) return new Response('unauthorized', { status: 401 })
  if (!session.tenantId) return new Response('no_tenant', { status: 400 })
  const { supabase, userId } = await requireOwner(session.tenantId)

  const { profile } = await loadBusinessProfile(supabase, session.tenantId)
  const missing = form.required.filter((f) => !hasFact(profile, f))
  if (missing.length > 0) {
    return new Response(`profile_incomplete:${missing.join(',')}`, { status: 422 })
  }

  let bytes: Uint8Array
  try {
    bytes = await fillAgencyPdf(form.template, form.fill(profile, answersFor(form, profile.form_answers[form.id])))
  } catch (err) {
    // A profile value longer than the form's box (a 30-letter last name in
    // a 25-letter box): said plainly, never cut.
    if (err instanceof ValueTooLongError) {
      return new Response(
        `A value in the business profile is longer than the form allows: ${err.fields.join(', ')}. Shorten it in the business profile and download again.`,
        { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      )
    }
    console.error('[api.agency-forms] fill failed', form.id, err)
    return new Response('fill_failed', { status: 500 })
  }

  await logAudit({
    tenantId: session.tenantId,
    userId,
    action: 'update',
    tableName: 'tenant_business_profile',
    recordId: session.tenantId,
    changes: { kind: 'agency_form_downloaded', form: form.id },
  })

  const name = (profile.legal_name ?? 'business').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-')
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return new Response(new Blob([ab], { type: 'application/pdf' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${form.id}-${name}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
