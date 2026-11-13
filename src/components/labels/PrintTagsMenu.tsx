'use client'

/**
 * Print button for tags and labels. The main button prints the default
 * template as a PDF; the caret lists every template with PDF and ZPL.
 * Opens /api/print/tags in a new tab (PDF) or downloads the .zpl file.
 */

import { useEffect, useRef, useState } from 'react'
import { CaretDown, Printer } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { TagKind, TemplateChoice } from '@/lib/labels/templates'

export function tagPrintUrl(kind: TagKind, target: Record<string, string>, template: string | null, format: 'pdf' | 'zpl'): string {
  const sp = new URLSearchParams({ kind, ...target, format })
  if (template) sp.set('template', template)
  return `/api/print/tags?${sp.toString()}`
}

export default function PrintTagsMenu({
  kind,
  target,
  choices,
  label,
  disabled = false,
  onPrinted,
  compact = false,
}: {
  kind: TagKind
  /** {ids: 'a,b'} | {loan: id} | {ticket: id} */
  target: Record<string, string>
  choices: TemplateChoice[]
  label: string
  disabled?: boolean
  /** Called after a print was opened (e.g. to clear a selection or refresh). */
  onPrinted?: () => void
  compact?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const def = choices.find((c) => c.isDefault) ?? choices[0]

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function go(template: string | null, format: 'pdf' | 'zpl') {
    setOpen(false)
    const url = tagPrintUrl(kind, target, template, format)
    if (format === 'pdf') window.open(url, '_blank', 'noopener,noreferrer')
    else window.location.href = url
    onPrinted?.()
  }

  const pad = compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'
  const base = `inline-flex items-center gap-1 border border-border bg-card text-foreground hover:bg-background disabled:opacity-50`

  return (
    <div ref={ref} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => go(def?.key ?? null, 'pdf')}
        className={`${base} ${pad} rounded-l-md`}
      >
        <Printer size={compact ? 12 : 14} weight="bold" />
        {label}
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-label={t.tags.formatZpl}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${base} ${compact ? 'px-1.5 py-1' : 'px-2 py-2'} -ml-px rounded-r-md`}
      >
        <CaretDown size={compact ? 10 : 12} weight="bold" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-border bg-card p-1 shadow-lg">
          {choices.map((c) => (
            <div key={c.key} className="rounded-lg px-2 py-1.5">
              <div className="text-sm font-semibold text-foreground">
                {c.name}
                {c.isDefault ? <span className="ml-1 text-xs font-normal text-muted">· {t.tags.templateDefault}</span> : null}
                {c.builtin ? <span className="ml-1 text-xs font-normal text-muted">· {t.tags.templateBuiltin}</span> : null}
              </div>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => go(c.key, 'pdf')} className="text-xs text-blue hover:underline">
                  {t.tags.formatPdf}
                </button>
                <button type="button" onClick={() => go(c.key, 'zpl')} className="text-xs text-blue hover:underline">
                  {t.tags.formatZpl}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
