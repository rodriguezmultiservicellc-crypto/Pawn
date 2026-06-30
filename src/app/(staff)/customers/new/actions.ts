'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { createCustomerFromForm } from '@/lib/customers/create'

export type CreateCustomerState = {
  error?: string
  fieldErrors?: Record<string, string>
  /**
   * Echo of the most recent submission. Repopulates the form on
   * validation/insert error so React 19's auto-form-reset doesn't wipe
   * the operator's typed values. Only set when an error is returned.
   */
  values?: Record<string, string>
}

export async function createCustomerAction(
  _prev: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Defense in depth: re-verify staff role at the active tenant. requireStaff
  // also handles chain-admin parent-tenant access.
  const { supabase, userId } = await requireStaff(ctx.tenantId)

  const result = await createCustomerFromForm({
    supabase,
    tenantId: ctx.tenantId,
    userId,
    formData,
  })

  if (!result.ok) {
    if (result.fieldErrors)
      return { fieldErrors: result.fieldErrors, values: result.echo }
    return { error: result.error, values: result.echo }
  }

  revalidatePath('/customers')
  redirect(`/customers/${result.id}`)
}
