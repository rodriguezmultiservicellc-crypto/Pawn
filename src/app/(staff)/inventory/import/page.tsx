import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveImportRole } from '@/lib/imports/access'
import InventoryImportContent from './content'

export default async function InventoryImportPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!(await resolveImportRole(ctx))) redirect('/inventory')

  return <InventoryImportContent />
}
