'use server'

import { getCtx } from '@/lib/supabase/ctx'

export type PickerCustomerResult = {
  id: string
  /** Display label: "Lastname, Firstname · phone". */
  label: string
}

/**
 * Server-side typeahead for the customer picker. Returns up to 20 matches
 * for the given query. Searches across last_name, first_name, phone, and
 * id_number (driver's license / state ID) via ilike. Banned customers
 * are excluded — staff intent on banned-list lookup uses
 * /customers?banned=1.
 *
 * Returns empty array if not signed in, no tenant context, or query too
 * short. RLS scopes results to the caller's tenant — no explicit tenant_id
 * filter needed here, but we still pass it for the indexed predicate.
 */
export async function searchCustomersForPicker(
  query: string,
): Promise<PickerCustomerResult[]> {
  const ctx = await getCtx()
  if (!ctx || !ctx.tenantId) return []

  const q = query.trim()
  if (q.length < 2) return []

  // Use ilike with leading + trailing wildcards so the operator can type
  // any substring. PostgreSQL's GIN trigram indexes would be nice for
  // 10k+ row tenants, but for the typical pawn shop (<3k customers)
  // a plain index scan + ilike is fine.
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`)
  const wildcard = `%${escaped}%`

  const { data } = await ctx.supabase
    .from('customers')
    .select('id, first_name, last_name, phone')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .eq('is_banned', false)
    .or(
      `last_name.ilike.${wildcard},first_name.ilike.${wildcard},phone.ilike.${wildcard},id_number.ilike.${wildcard}`,
    )
    .order('last_name', { ascending: true })
    .limit(20)

  return (data ?? []).map((c) => ({
    id: c.id,
    label: `${c.last_name}, ${c.first_name}${c.phone ? ` · ${c.phone}` : ''}`,
  }))
}

/**
 * Exact-match lookup by id_number (driver's license / state ID number).
 * Used after a DL barcode scan to find an existing customer by the
 * licenseNumber from the AAMVA payload. Returns null if no match — the
 * caller surfaces a "create new" prompt.
 */
export async function findCustomerByIdNumber(
  idNumber: string,
): Promise<PickerCustomerResult | null> {
  const ctx = await getCtx()
  if (!ctx || !ctx.tenantId) return null

  const trimmed = idNumber.trim()
  if (trimmed.length === 0) return null

  const { data } = await ctx.supabase
    .from('customers')
    .select('id, first_name, last_name, phone')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .eq('id_number', trimmed)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string
      first_name: string
      last_name: string
      phone: string | null
    }>()

  if (!data) return null
  return {
    id: data.id,
    label: `${data.last_name}, ${data.first_name}${data.phone ? ` · ${data.phone}` : ''}`,
  }
}

/**
 * Lookup a single customer by id, used when a form has a prefilled
 * customer (e.g., redirected from /customers/[id] with ?customer=). Returns
 * null if not found / not in tenant. RLS handles tenant scoping.
 */
export async function getCustomerForPicker(
  id: string,
): Promise<PickerCustomerResult | null> {
  const ctx = await getCtx()
  if (!ctx || !ctx.tenantId) return null

  const { data } = await ctx.supabase
    .from('customers')
    .select('id, first_name, last_name, phone')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id,
    label: `${data.last_name}, ${data.first_name}${data.phone ? ` · ${data.phone}` : ''}`,
  }
}
