import 'server-only'

import { getSpotFreshness } from './lookup'
import type { SpotFreshness } from './staleness'
import type { TenantRole } from '@/types/database-aliases'

/**
 * Server-side half of the stale-price guard shared by Buy Outright and
 * New Pawn Ticket.
 *
 * When the newest spot price is older than the threshold AND the
 * submission prices precious metal, the request must carry the manager's
 * acknowledgement checkbox AND come from a role allowed to give it. The
 * client renders the same rule (banner + checkbox) — this is the check
 * that actually holds, since a form field is trivial to forge.
 *
 * Returns the freshness so the caller can record the acknowledgement in
 * the audit row (who confirmed, how old the price was).
 */

export const STALE_SPOT_ACK_FIELD = 'stale_spot_ack'

/** Roles that may issue against a stale price. Mirrors who can press "Refresh now". */
export const STALE_SPOT_CONFIRM_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'chain_admin',
]

export type StaleGateResult =
  | { ok: true; freshness: SpotFreshness; acknowledged: boolean }
  | {
      ok: false
      freshness: SpotFreshness
      error: 'stale_spot_price_confirm_required' | 'stale_spot_price_manager_required'
    }

export async function checkStaleSpotGate(args: {
  formData: FormData
  tenantRole: TenantRole | null
  /** Does this submission actually price metal? A loan on a laptop doesn't. */
  involvesMetal: boolean
}): Promise<StaleGateResult> {
  const freshness = await getSpotFreshness()
  if (!freshness.stale || !args.involvesMetal) {
    return { ok: true, freshness, acknowledged: false }
  }
  const canConfirm =
    args.tenantRole != null && STALE_SPOT_CONFIRM_ROLES.includes(args.tenantRole)
  if (!canConfirm) {
    return { ok: false, freshness, error: 'stale_spot_price_manager_required' }
  }
  const ack = String(args.formData.get(STALE_SPOT_ACK_FIELD) ?? '')
  if (ack !== 'on' && ack !== 'true' && ack !== '1') {
    return { ok: false, freshness, error: 'stale_spot_price_confirm_required' }
  }
  return { ok: true, freshness, acknowledged: true }
}

export function canConfirmStaleSpot(role: TenantRole | null | undefined): boolean {
  return role != null && STALE_SPOT_CONFIRM_ROLES.includes(role)
}
