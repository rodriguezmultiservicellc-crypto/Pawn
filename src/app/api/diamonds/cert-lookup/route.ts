import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/supabase/ctx'
import { lookupDiamondCert, type CertLab } from '@/lib/diamonds/cert'
import { logAudit } from '@/lib/audit'

const VALID_LABS: CertLab[] = ['gia', 'igi', 'ags', 'gcal', 'hrd', 'other']

/**
 * POST /api/diamonds/cert-lookup
 *
 * Body: { lab: CertLab, cert_number: string }
 *
 * Auth: any staff role. Audit-logged so we can measure operator
 * usage and prioritize the paid integration when usage warrants it.
 *
 * v1 always returns ok:false reason:'not_configured' — see
 * lib/diamonds/cert.ts. The wrapper exists so the UI can ship
 * the verify button today.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!ctx.tenantId || !ctx.tenantRole) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { lab?: string; cert_number?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const labRaw = (body.lab ?? '').toLowerCase() as CertLab
  const lab = VALID_LABS.includes(labRaw) ? labRaw : 'other'
  const certNumber = (body.cert_number ?? '').trim()
  if (!certNumber) {
    return NextResponse.json(
      { error: 'cert_number_required' },
      { status: 400 },
    )
  }

  const result = await lookupDiamondCert({ lab, certNumber })

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update', // generic — no dedicated cert-lookup AuditAction yet
    tableName: 'appraisal_stones',
    recordId: certNumber, // not a UUID, but the audit row tolerates string
    changes: {
      flow: 'diamond_cert_lookup',
      lab,
      cert_number: certNumber,
      provider: result.ok ? result.provider : null,
      reason: result.ok ? null : result.reason,
    },
  })

  return NextResponse.json(result)
}
