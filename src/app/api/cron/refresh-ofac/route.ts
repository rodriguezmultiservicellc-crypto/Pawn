/**
 * Cron — refresh the OFAC SDN list (patches/0051). Daily; a no-op when
 * Treasury hasn't published a change (content hash).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCron } from '@/lib/cron/auth'
import { refreshOfacList } from '@/lib/compliance/ofac/refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return new NextResponse('unauthorized', { status: 401 })
  try {
    const result = await refreshOfacList(createAdminClient())
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron:refresh-ofac]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
