'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { createCustomerFromForm } from '@/lib/customers/create'

export type InlineCustomerState = {
  error?: string
  fieldErrors?: Record<string, string>
  /** Set on success — the new customer, shaped for CustomerPicker.set(). */
  customer?: { id: string; label: string }
}

const INLINE_REQUIRED_ADDRESS = ['address1', 'city', 'state', 'zip'] as const

/**
 * Create a customer WITHOUT navigating away. Returns the new customer's
 * id + picker label so an intake flow (e.g. /pawn/new) can drop it straight
 * into its CustomerPicker via the imperative handle. Mirrors
 * createCustomerAction's gate + insert, but returns instead of redirecting.
 */
export async function createCustomerInlineAction(
  _prev: InlineCustomerState,
  formData: FormData,
): Promise<InlineCustomerState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { supabase, userId } = await requireStaff(ctx.tenantId)

  // The quick popup always asks for the address (Eddy, 2026-11-26): a pawn
  // or buy needs it (missingPledgorFields). Checked here, not only on screen.
  const fieldErrors: Record<string, string> = {}
  for (const key of INLINE_REQUIRED_ADDRESS) {
    if ((formData.get(key) ?? '').toString().trim() === '') fieldErrors[key] = 'required'
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const result = await createCustomerFromForm({
    supabase,
    tenantId: ctx.tenantId,
    userId,
    formData,
  })

  if (!result.ok) {
    if (result.fieldErrors) return { fieldErrors: result.fieldErrors }
    return { error: result.error }
  }

  const phone = (formData.get('phone') ?? '').toString().trim()
  const label = `${result.lastName}, ${result.firstName}${phone ? ` · ${phone}` : ''}`

  revalidatePath('/customers')
  return { customer: { id: result.id, label } }
}
