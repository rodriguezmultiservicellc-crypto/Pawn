'use client'

import { useEffect, useRef, useState } from 'react'
import type { TenantType } from '@/types/database-aliases'

export type SwitcherTenant = {
  id: string
  name: string
  dba: string | null
  tenant_type: TenantType
}

const TYPE_LABEL: Record<TenantType, string> = {
  chain_hq: 'Chain HQ',
  shop: 'Shop',
  standalone: 'Standalone',
}

/**
 * Tenant switcher dropdown. Single-tenant users see a non-interactive chip;
 * multi-tenant users (and chain admins with multiple shops in scope) see a
 * full dropdown.
 *
 * Switching POSTs to /api/tenant/switch which verifies membership before
 * setting the `pawn-active-tenant` cookie. We then `location.reload()` so
 * the server layout re-runs getCtx() with the new cookie.
 *
 * Closes on outside click, Escape key, or successful switch.
 */
export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: SwitcherTenant[]
  activeTenantId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onClick)
      document.addEventListener('keydown', onKey)
    }
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (tenants.length === 0) return null

  const active =
    tenants.find((t) => t.id === activeTenantId) ?? tenants[0]
  const activeLabel = active.dba || active.name
  const single = tenants.length === 1

  // Single-tenant: render as a static chip.
  if (single) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm">
        <span className="text-foreground font-medium">{activeLabel}</span>
      </span>
    )
  }

  async function onSwitch(tenantId: string) {
    if (tenantId === active.id) {
      setOpen(false)
      return
    }
    setPendingId(tenantId)
    setError(null)
    try {
      const res = await fetch('/api/tenant/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        setError(body?.error ?? 'switch_failed')
        setPendingId(null)
        return
      }
      // Re-run server layout (and getCtx) with the new cookie.
      window.location.reload()
    } catch {
      setError('network_error')
      setPendingId(null)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:border-foreground"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-foreground font-medium">{activeLabel}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`h-4 w-4 text-muted transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-card"
          style={{
            boxShadow:
              'rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0',
          }}
        >
          <ul className="max-h-80 overflow-y-auto py-1">
            {tenants.map((t) => {
              const isActive = t.id === active.id
              const isPending = pendingId === t.id
              const label = t.dba || t.name
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    disabled={isPending}
                    onClick={() => onSwitch(t.id)}
                    className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-background disabled:opacity-50 ${
                      isActive ? 'bg-background' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {label}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {TYPE_LABEL[t.tenant_type]}
                      </span>
                    </span>
                    {isActive ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="mt-0.5 h-4 w-4 text-gold"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
          {error ? (
            <div className="border-t border-border bg-danger/5 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
