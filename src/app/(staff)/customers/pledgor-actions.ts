'use server'

/**
 * Read-only: what the picked customer's record still lacks before a pawn or
 * a buy (FL 539.001(8)(b)). The intake actions refuse on the same check;
 * this only lets the screen say so before the clerk fills in the items.
 */

import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { customerCreateSchema } from '@/lib/validations/customer'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import {
  PLEDGOR_COLUMNS,
  pledgorColumnsFor,
  missingPledgorFields,
  type PledgorColumn,
  type PledgorField,
  type PledgorRecord,
} from '@/lib/customers/pledgor-record'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadPledgorGapsAction(
  customerId: string,
): Promise<{ ok: true; missing: PledgorField[]; record: PledgorRecord } | { ok: false }> {
  if (!UUID.test(customerId)) return { ok: false }
  const ctx = await getCtx()
  if (!ctx?.tenantId) return { ok: false }
  const { supabase } = await requireStaff(ctx.tenantId)
  const { data } = await supabase
    .from('customers')
    .select(PLEDGOR_COLUMNS)
    .eq('id', customerId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle<PledgorRecord>()
  if (!data) return { ok: false }
  const today = todayInTimezone((await loadTenantRules(supabase, ctx.tenantId)).timezone)
  return { ok: true, missing: missingPledgorFields(data, today), record: data }
}

/**
 * The "Complete customer record" popup on New pawn / New buy (Eddy,
 * 2026-11-25: "do this in a popup so we don't leave the page"). Saves ONLY
 * the columns of the fields still missing — nothing else on the record can
 * change from here — with the same rules as the customer form
 * (customerCreateSchema). A field left blank stays missing. Audited.
 */
export async function completePledgorRecordAction(
  customerId: string,
  values: Partial<Record<PledgorColumn, string>>,
): Promise<
  | { ok: true; missing: PledgorField[] }
  | { ok: false; fieldErrors?: Partial<Record<PledgorColumn, string>> }
> {
  if (!UUID.test(customerId)) return { ok: false }
  const ctx = await getCtx()
  if (!ctx?.tenantId) return { ok: false }
  const { supabase, userId } = await requireStaff(ctx.tenantId)

  const { data: before } = await supabase
    .from('customers')
    .select(PLEDGOR_COLUMNS)
    .eq('id', customerId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle<PledgorRecord>()
  if (!before) return { ok: false }

  const today = todayInTimezone((await loadTenantRules(supabase, ctx.tenantId)).timezone)
  const columns = pledgorColumnsFor(missingPledgorFields(before, today))
  if (columns.length === 0) return { ok: true, missing: [] }

  const mask = Object.fromEntries(columns.map((c) => [c, true as const])) as {
    [K in PledgorColumn]?: true
  }
  const raw = Object.fromEntries(columns.map((c) => [c, values[c] ?? '']))
  const parsed = customerCreateSchema.pick(mask).safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Partial<Record<PledgorColumn, string>> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as PledgorColumn
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { ok: false, fieldErrors }
  }

  // Only what was filled in: a blank never clears a column.
  const patch: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (v != null && v !== '') patch[k] = v as string | number
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from('customers')
      .update({ ...patch, updated_by: userId })
      .eq('id', customerId)
      .eq('tenant_id', ctx.tenantId)
    if (error) return { ok: false }
    await logAudit({
      tenantId: ctx.tenantId,
      userId,
      action: 'update',
      tableName: 'customers',
      recordId: customerId,
      changes: { kind: 'pledgor_complete', ...patch },
    })
    revalidatePath(`/customers/${customerId}`)
  }

  const after = { ...before, ...patch } as PledgorRecord
  return { ok: true, missing: missingPledgorFields(after, today) }
}
