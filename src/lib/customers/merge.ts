import type { TenantRole } from '@/types/database-aliases'

/** Who may merge duplicate customers (patches/0091). A merge rewrites who
 *  a printed pawn ticket belongs to — not a clerk-level action. */
export const CUSTOMER_MERGE_ROLES = ['owner', 'manager', 'chain_admin'] as const satisfies readonly TenantRole[]

export function canMergeCustomers(role: string | null | undefined): boolean {
  return !!role && (CUSTOMER_MERGE_ROLES as readonly string[]).includes(role)
}
