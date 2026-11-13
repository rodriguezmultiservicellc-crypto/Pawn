import { notFound, redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { COUNT_RESOLVE_ROLES, COUNT_ROLES, sortFindings } from '@/lib/counts/types'
import {
  loadCountProgress,
  loadCountSession,
  loadExceptions,
  loadExpected,
  loadRecentReads,
  rpcFindings,
} from '@/lib/counts/server'
import CountDetail from './content'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * /inventory/counts/[id] — scan screen while open, result + exception
 * resolution once closed. The session is loaded through RLS and checked
 * against the active tenant before the findings function (service role)
 * is called for it.
 */
export default async function CountDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !COUNT_ROLES.includes(ctx.tenantRole)) redirect('/dashboard')
  if (!UUID.test(id)) notFound()
  const tenantId = ctx.tenantId

  const session = await loadCountSession(ctx.supabase, tenantId, id)
  if (!session) notFound()

  const isOpen = session.status === 'open'
  const [progress, expected, recent, findings, exceptions] = await Promise.all([
    loadCountProgress(ctx.supabase, tenantId, id),
    isOpen ? loadExpected(ctx.supabase, tenantId, id) : Promise.resolve([]),
    isOpen ? loadRecentReads(ctx.supabase, tenantId, id) : Promise.resolve([]),
    isOpen ? rpcFindings(id) : Promise.resolve([]),
    session.status === 'closed' ? loadExceptions(ctx.supabase, tenantId, id) : Promise.resolve([]),
  ])

  return (
    <CountDetail
      session={session}
      progress={progress}
      notSeen={expected.filter((e) => !e.seen)}
      recent={recent}
      findings={sortFindings(findings)}
      exceptions={sortFindings(exceptions)}
      canResolve={COUNT_RESOLVE_ROLES.includes(ctx.tenantRole)}
    />
  )
}
