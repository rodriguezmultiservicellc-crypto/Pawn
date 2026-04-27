'use client'

import { useState } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

/**
 * Inline collapsible JSONB viewer for audit_log.changes.
 *
 * Collapsed: comma-separated list of top-level keys.
 * Expanded: pretty-printed JSON in a monospaced <pre>.
 *
 * `changes` arrives as the raw Supabase Json union; we cast safely and only
 * render top-level keys in the collapsed view to avoid surprise output.
 */
export function ChangesViewer({ changes }: { changes: unknown }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  // Empty / null payload — nothing to show.
  if (changes == null) {
    return <span className="text-ash">—</span>
  }

  // Plain primitive — render directly without a toggle.
  if (typeof changes !== 'object') {
    return (
      <span className="font-mono text-xs text-ink">{String(changes)}</span>
    )
  }

  const obj = changes as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length === 0) {
    return <span className="text-ash">—</span>
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-left text-xs text-ink hover:text-rausch"
      >
        {open ? (
          <CaretDown size={12} weight="bold" />
        ) : (
          <CaretRight size={12} weight="bold" />
        )}
        <span className="truncate">
          {open ? t.audit.columns.hideChanges : keys.slice(0, 4).join(', ')}
          {!open && keys.length > 4 ? ` +${keys.length - 4}` : ''}
        </span>
      </button>
      {open ? (
        <pre
          className="overflow-x-auto rounded-md border border-hairline bg-cloud p-3 font-mono text-[11px] leading-snug text-ink"
          style={{ fontFamily: 'var(--font-jetbrains-mono, ui-monospace, monospace)' }}
        >
          {JSON.stringify(obj, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

export default ChangesViewer
