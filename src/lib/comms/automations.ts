/**
 * Automated-message definitions (patches/0050). Pure — shared by the
 * settings UI and the cron runner. comm_automations rows override the
 * defaults below per tenant; an absent row means "use the default".
 *
 * Anchors:
 *   due          target = due_date + offset        (negative = before due)
 *   forfeit      target = forfeiture date − offset (days before forfeiture)
 *   birthday     target = birthday − offset        (days before birthday)
 *   last_activity target = last activity + offset  (days of inactivity)
 *   forfeited    target = forfeiture event + offset
 *   redeemed     target = redemption event + offset
 */

import type { MessageKind } from '@/types/database-aliases'

export type AutomationAnchor =
  | 'due'
  | 'forfeit'
  | 'birthday'
  | 'last_activity'
  | 'forfeited'
  | 'redeemed'

export type AutomationDef = {
  kind: MessageKind
  group: 'loan' | 'lifecycle'
  anchor: AutomationAnchor
  /** Marketing messages only reach marketing_opt_in customers. */
  marketing: boolean
  defaultEnabled: boolean
  defaultOffset: number
  minOffset: number
  maxOffset: number
}

export const AUTOMATION_DEFS: ReadonlyArray<AutomationDef> = [
  { kind: 'loan_maturity_t7', group: 'loan', anchor: 'due', marketing: false, defaultEnabled: true, defaultOffset: -7, minOffset: -60, maxOffset: 60 },
  { kind: 'loan_maturity_t1', group: 'loan', anchor: 'due', marketing: false, defaultEnabled: true, defaultOffset: -1, minOffset: -60, maxOffset: 60 },
  { kind: 'loan_due_today', group: 'loan', anchor: 'due', marketing: false, defaultEnabled: true, defaultOffset: 0, minOffset: -60, maxOffset: 60 },
  { kind: 'loan_overdue_t1', group: 'loan', anchor: 'due', marketing: false, defaultEnabled: true, defaultOffset: 1, minOffset: -60, maxOffset: 60 },
  { kind: 'loan_overdue_t7', group: 'loan', anchor: 'due', marketing: false, defaultEnabled: true, defaultOffset: 7, minOffset: -60, maxOffset: 60 },
  { kind: 'loan_final_notice', group: 'loan', anchor: 'forfeit', marketing: false, defaultEnabled: true, defaultOffset: 5, minOffset: 1, maxOffset: 60 },
  { kind: 'birthday_greeting', group: 'lifecycle', anchor: 'birthday', marketing: true, defaultEnabled: false, defaultOffset: 0, minOffset: 0, maxOffset: 30 },
  { kind: 'dormant_winback', group: 'lifecycle', anchor: 'last_activity', marketing: true, defaultEnabled: false, defaultOffset: 90, minOffset: 30, maxOffset: 365 },
  { kind: 'forfeiture_winback', group: 'lifecycle', anchor: 'forfeited', marketing: true, defaultEnabled: false, defaultOffset: 14, minOffset: 1, maxOffset: 180 },
  { kind: 'redemption_thankyou', group: 'lifecycle', anchor: 'redeemed', marketing: true, defaultEnabled: false, defaultOffset: 1, minOffset: 0, maxOffset: 30 },
]

/** Days a missed send stays eligible (cron outage tolerance). */
export const CATCHUP_DAYS = 2

export type AutomationConfig = AutomationDef & {
  isEnabled: boolean
  offsetDays: number
  /** True when a comm_automations row overrides the default. */
  customized: boolean
}

export function getAutomationDef(kind: string): AutomationDef | null {
  return AUTOMATION_DEFS.find((d) => d.kind === kind) ?? null
}

export function mergeAutomations(
  rows: ReadonlyArray<{ kind: string; is_enabled: boolean; offset_days: number }>,
): AutomationConfig[] {
  return AUTOMATION_DEFS.map((d) => {
    const row = rows.find((r) => r.kind === d.kind)
    return {
      ...d,
      isEnabled: row ? row.is_enabled : d.defaultEnabled,
      offsetDays: row ? clampOffset(d, row.offset_days) : d.defaultOffset,
      customized: !!row,
    }
  })
}

export function clampOffset(d: AutomationDef, n: number): number {
  return Math.min(d.maxOffset, Math.max(d.minOffset, Math.trunc(n)))
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

/** True when `today` is within [target, target + CATCHUP_DAYS]. */
export function isDue(target: string, today: string): boolean {
  const lag = daysBetweenIso(target, today)
  return lag >= 0 && lag <= CATCHUP_DAYS
}

/**
 * Which loan reminder (if any) should go out today for a loan. Among the
 * due-anchored steps that are currently due, only the LATEST target wins —
 * after a cron outage we send the most relevant reminder, not a burst of
 * stale ones. The final notice is evaluated independently.
 */
export function loanStepsDueToday(args: {
  configs: ReadonlyArray<AutomationConfig>
  dueDate: string
  forfeitEligibleOn: string
  today: string
}): AutomationConfig[] {
  const { configs, dueDate, forfeitEligibleOn, today } = args
  const out: AutomationConfig[] = []

  let best: { cfg: AutomationConfig; target: string } | null = null
  for (const c of configs) {
    if (!c.isEnabled || c.anchor !== 'due') continue
    const target = addDays(dueDate, c.offsetDays)
    // A due-anchored reminder never goes out once forfeiture is possible.
    if (target >= forfeitEligibleOn) continue
    if (isDue(target, today) && (!best || target > best.target)) best = { cfg: c, target }
  }
  if (best) out.push(best.cfg)

  const final = configs.find((c) => c.anchor === 'forfeit')
  if (final?.isEnabled) {
    const target = addDays(forfeitEligibleOn, -final.offsetDays)
    if (target < forfeitEligibleOn && isDue(target, today)) out.push(final)
  }
  return out
}
