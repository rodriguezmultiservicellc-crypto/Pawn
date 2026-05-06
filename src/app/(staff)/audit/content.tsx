'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MagnifyingGlass, ClockCounterClockwise } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatAuditAction, formatAuditTable } from '@/lib/audit-format'
import { relativeTime, absoluteTimestamp } from '@/lib/format/datetime'
import { ChangesViewer } from '@/components/audit/ChangesViewer'

export type FacetUser = {
  id: string
  full_name: string | null
  email: string | null
}

export type AuditEvent = {
  id: string
  created_at: string
  user_id: string | null
  user: FacetUser | null
  action: string
  table_name: string
  record_id: string | null
  changes: unknown
}

const TABLES_WITH_DETAIL: ReadonlySet<string> = new Set([
  'customers',
  'inventory_items',
])

export default function AuditContent({
  events,
  total,
  page,
  totalPages,
  pageSize,
  facetUsers,
  facetTables,
  facetActionPrefixes,
  query,
  userFilter,
  tableFilter,
  actionPrefixFilter,
  fromFilter,
  toFilter,
}: {
  events: AuditEvent[]
  total: number
  page: number
  totalPages: number
  pageSize: number
  facetUsers: FacetUser[]
  facetTables: string[]
  facetActionPrefixes: string[]
  query: string
  userFilter: string
  tableFilter: string
  actionPrefixFilter: string
  fromFilter: string
  toFilter: string
}) {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState(query)
  const [pending, startTransition] = useTransition()

  function pushParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') sp.delete(k)
      else sp.set(k, v)
    }
    // Any filter change resets pagination unless the change IS the page.
    if (!('page' in next)) sp.delete('page')
    startTransition(() => {
      router.push(`/audit${sp.toString() ? `?${sp.toString()}` : ''}`)
    })
  }

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    pushParams({ q: searchInput.trim() })
  }

  function clearAll() {
    setSearchInput('')
    pushParams({
      q: null,
      user: null,
      table: null,
      actionPrefix: null,
      from: null,
      to: null,
    })
  }

  const hasFilter =
    !!query ||
    !!userFilter ||
    !!tableFilter ||
    !!actionPrefixFilter ||
    !!fromFilter ||
    !!toFilter

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const pageOfLabel = t.audit.pagination.pageOf
    .replace('{n}', String(page))
    .replace('{total}', String(totalPages))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClockCounterClockwise size={28} weight="regular" className="text-gold" />
          <div>
            <h1 className="font-display text-2xl font-bold">{t.audit.title}</h1>
            <p className="text-sm text-muted">{t.audit.subtitle}</p>
          </div>
        </div>
        <div className="text-sm text-muted">
          {total === 0
            ? '0'
            : `${start.toLocaleString()}–${end.toLocaleString()} / ${total.toLocaleString()}`}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <form
          onSubmit={onSearchSubmit}
          className="sm:col-span-4 flex items-center gap-2"
        >
          <div className="relative flex-1">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t.audit.filters.search}
              className="block w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            {t.common.search}
          </button>
        </form>

        <select
          value={userFilter}
          onChange={(e) => pushParams({ user: e.target.value })}
          className="sm:col-span-3 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">{t.audit.filters.allUsers}</option>
          {facetUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {userLabel(u)}
            </option>
          ))}
        </select>

        <select
          value={tableFilter}
          onChange={(e) => pushParams({ table: e.target.value })}
          className="sm:col-span-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">{t.audit.filters.allTables}</option>
          {facetTables.map((tbl) => (
            <option key={tbl} value={tbl}>
              {formatAuditTable(tbl, t)}
            </option>
          ))}
        </select>

        <select
          value={actionPrefixFilter}
          onChange={(e) => pushParams({ actionPrefix: e.target.value })}
          className="sm:col-span-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">{t.audit.filters.allActions}</option>
          {facetActionPrefixes.map((a) => (
            <option key={a} value={a}>
              {formatAuditAction(a, '', t)}
            </option>
          ))}
        </select>

        {hasFilter ? (
          <button
            type="button"
            onClick={clearAll}
            className="sm:col-span-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
          >
            {t.common.clear}
          </button>
        ) : (
          <span className="sm:col-span-1" />
        )}

        <label className="sm:col-span-2 flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{t.audit.filters.from}</span>
          <input
            type="date"
            value={fromFilter}
            onChange={(e) => pushParams({ from: e.target.value })}
            className="block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        </label>
        <label className="sm:col-span-2 flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{t.audit.filters.to}</span>
          <input
            type="date"
            value={toFilter}
            onChange={(e) => pushParams({ to: e.target.value })}
            className="block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        </label>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted">{t.audit.empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t.audit.columns.time}</th>
                <th className="px-4 py-3 font-medium">{t.audit.columns.user}</th>
                <th className="px-4 py-3 font-medium">{t.audit.columns.action}</th>
                <th className="px-4 py-3 font-medium">{t.audit.columns.table}</th>
                <th className="px-4 py-3 font-medium">
                  {t.audit.columns.recordId}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.audit.columns.changes}
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const link = recordLink(ev.table_name, ev.record_id, ev.changes)
                return (
                  <tr
                    key={ev.id}
                    className="border-b border-border align-top last:border-0 hover:bg-background"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      <span title={absoluteTimestamp(ev.created_at)}>
                        {relativeTime(ev.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ev.user ? (
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {ev.user.full_name ?? ev.user.email ?? ev.user.id}
                          </div>
                          {ev.user.email && ev.user.full_name ? (
                            <div className="truncate text-xs text-muted">
                              {ev.user.email}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatAuditAction(ev.action, ev.table_name, t)}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatAuditTable(ev.table_name, t)}
                    </td>
                    <td className="px-4 py-3">
                      {ev.record_id ? (
                        link ? (
                          <Link
                            href={link}
                            className="font-mono text-xs text-gold hover:underline"
                          >
                            {shortId(ev.record_id)}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-muted">
                            {shortId(ev.record_id)}
                          </span>
                        )
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ChangesViewer changes={ev.changes} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() =>
            pushParams({ page: page > 2 ? String(page - 1) : null })
          }
          disabled={page <= 1 || pending}
          className="rounded-md border border-border bg-card px-3 py-2 text-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
        >
          {t.audit.pagination.previous}
        </button>
        <span className="text-muted">{pageOfLabel}</span>
        <button
          type="button"
          onClick={() => pushParams({ page: String(page + 1) })}
          disabled={page >= totalPages || pending}
          className="rounded-md border border-border bg-card px-3 py-2 text-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
        >
          {t.audit.pagination.next}
        </button>
      </div>
    </div>
  )
}

function userLabel(u: FacetUser): string {
  if (u.full_name && u.email) return `${u.full_name} — ${u.email}`
  return u.full_name ?? u.email ?? u.id
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/**
 * Build a deep-link URL for the affected record when the table has a
 * detail page in the staff app. Returns null when no useful link exists
 * (e.g. customer_documents — those don't have their own detail route, so
 * we'd need to know the parent customer_id). For inventory_item_photos /
 * stones we link to the parent item via the `item_id` in the `changes`
 * blob when present.
 */
function recordLink(
  tableName: string,
  recordId: string | null,
  changes: unknown,
): string | null {
  if (!recordId) return null

  if (TABLES_WITH_DETAIL.has(tableName)) {
    if (tableName === 'customers') return `/customers/${recordId}`
    if (tableName === 'inventory_items') return `/inventory/${recordId}`
  }

  // Item-scoped sub-records: surface the parent inventory item.
  if (
    tableName === 'inventory_item_photos' ||
    tableName === 'inventory_item_stones'
  ) {
    const itemId = pickStringFromChanges(changes, 'item_id')
    if (itemId) return `/inventory/${itemId}`
  }

  // Customer-scoped sub-records.
  if (tableName === 'customer_documents') {
    const customerId = pickStringFromChanges(changes, 'customer_id')
    if (customerId) return `/customers/${customerId}`
  }

  return null
}

function pickStringFromChanges(changes: unknown, key: string): string | null {
  if (!changes || typeof changes !== 'object') return null
  const v = (changes as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}
