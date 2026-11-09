/**
 * Laser nameplate order statuses (patches/0070, enum laser_order_status).
 *
 *   new → received → cut → done          (cut may repeat: quantity, recuts)
 *   rejected  from new / received / cut  (operator, with a reason)
 *   cancelled from new / received / cut  (Sol Pawn, while not done)
 *
 * orocut.com is the authority on transitions; this module only knows which
 * states are still "open" (the order can still change) and which are final.
 */

export const LASER_ORDER_STATUSES = [
  'new',
  'received',
  'cut',
  'done',
  'rejected',
  'cancelled',
] as const

export type LaserOrderStatus = (typeof LASER_ORDER_STATUSES)[number]

const OPEN: ReadonlySet<LaserOrderStatus> = new Set(['new', 'received', 'cut'])

export function isLaserOrderStatus(v: unknown): v is LaserOrderStatus {
  return typeof v === 'string' && (LASER_ORDER_STATUSES as readonly string[]).includes(v)
}

/** Still in flight — the laser PC may change it and the shop may cancel it. */
export function isOpenLaserStatus(s: LaserOrderStatus): boolean {
  return OPEN.has(s)
}

/** The statuses the poller and the ticket panel treat as "current order". */
export const OPEN_LASER_STATUSES: readonly LaserOrderStatus[] = ['new', 'received', 'cut']
