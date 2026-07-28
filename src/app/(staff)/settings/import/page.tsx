import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import ImportContent from './content'

const IMPORT_ROLES = new Set(['owner', 'manager', 'chain_admin'])

export default async function ImportPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !IMPORT_ROLES.has(ctx.tenantRole)) redirect('/settings')

  return <ImportContent />
}
