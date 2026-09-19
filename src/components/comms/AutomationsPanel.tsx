'use client'

import { useActionState, useState } from 'react'
import { CheckCircle, Megaphone, Timer } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { AutomationConfig } from '@/lib/comms/automations'
import type { ActionResult } from '@/app/(staff)/settings/communications/actions'

/**
 * Settings → Communications → Automations. One row per automated message:
 * on/off + when (days relative to the kind's anchor). Loan reminders are
 * transactional; lifecycle messages are marketing (opted-in customers only).
 */
export function AutomationsPanel({
  configs,
  marketingOptInCount,
  action,
}: {
  configs: AutomationConfig[]
  marketingOptInCount: number
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>
}) {
  const { t } = useI18n()
  const ta = t.comms.automations
  const loan = configs.filter((c) => c.group === 'loan')
  const lifecycle = configs.filter((c) => c.group === 'lifecycle')

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{ta.subtitle}</p>

      <Group
        icon={<Timer size={16} weight="bold" />}
        title={ta.loanGroup}
        note={ta.loanNote}
        rows={loan}
        action={action}
      />
      <Group
        icon={<Megaphone size={16} weight="bold" />}
        title={ta.lifecycleGroup}
        note={ta.marketingNote.replace('{n}', String(marketingOptInCount))}
        rows={lifecycle}
        action={action}
      />
    </div>
  )
}

function Group({
  icon,
  title,
  note,
  rows,
  action,
}: {
  icon: React.ReactNode
  title: string
  note: string
  rows: AutomationConfig[]
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="text-muted">{icon}</span>
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted">{note}</p>
      </header>
      <ul className="divide-y divide-border">
        {rows.map((c) => (
          <AutomationRow key={c.kind} config={c} action={action} />
        ))}
      </ul>
    </section>
  )
}

function AutomationRow({
  config,
  action,
}: {
  config: AutomationConfig
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>
}) {
  const { t } = useI18n()
  const ta = t.comms.automations
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action,
    null,
  )
  const [dirty, setDirty] = useState(false)
  const isDue = config.anchor === 'due'
  const magnitude = isDue ? Math.abs(config.offsetDays) : config.offsetDays
  const min = isDue ? 0 : config.minOffset
  const max = isDue ? Math.max(Math.abs(config.minOffset), config.maxOffset) : config.maxOffset

  return (
    <li className="px-4 py-3">
      <form
        action={(fd) => {
          setDirty(false)
          formAction(fd)
        }}
        onChange={() => setDirty(true)}
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="kind" value={config.kind} />
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <input
            type="checkbox"
            name="is_enabled"
            defaultChecked={config.isEnabled}
            className="h-4 w-4 accent-[var(--color-blue)]"
          />
          <span className="text-sm font-medium text-foreground">
            {t.comms.kindLabels[config.kind]}
          </span>
          {!config.customized ? (
            <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {ta.defaultBadge}
            </span>
          ) : null}
        </label>

        <div className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="number"
            name="offset_days"
            min={min}
            max={max}
            step={1}
            required
            defaultValue={magnitude}
            className="w-20 rounded-xl border-2 border-border bg-background px-3 py-1.5 text-sm tabular-nums outline-none focus:border-blue"
          />
          {isDue ? (
            <>
              <span>{ta.days}</span>
              <select
                name="direction"
                defaultValue={config.offsetDays < 0 ? 'before' : 'after'}
                className="rounded-xl border-2 border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-blue"
              >
                <option value="before">{ta.beforeDue}</option>
                <option value="after">{ta.afterDue}</option>
              </select>
            </>
          ) : (
            <span className="text-muted">{ta.anchors[config.anchor]}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending || !dirty}
            className="rounded-xl bg-gold px-3 py-1.5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none"
          >
            {pending ? t.common.saving : t.common.save}
          </button>
          {state && 'ok' in state && !dirty ? (
            <CheckCircle size={16} weight="bold" className="text-success" />
          ) : null}
          {state && 'error' in state ? (
            <span className="text-xs text-danger">
              {state.error === 'invalid_offset'
                ? ta.invalidOffset.replace('{min}', String(min)).replace('{max}', String(max))
                : state.error}
            </span>
          ) : null}
        </div>
        <p className="w-full text-xs text-muted">{t.comms.kindDescriptions[config.kind]}</p>
      </form>
    </li>
  )
}
