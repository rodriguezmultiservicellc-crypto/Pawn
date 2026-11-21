import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveImportRole } from '@/lib/imports/access'
import ImportContent from './content'

export default async function ImportPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!(await resolveImportRole(ctx))) redirect('/settings')

  return <ImportContent />
}
