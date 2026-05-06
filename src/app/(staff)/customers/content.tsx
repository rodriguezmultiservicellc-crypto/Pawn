'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MagnifyingGlass, Plus, Prohibit } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { IdDocumentType } from '@/types/database-aliases'

export type CustomerListRow = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
  id_type: IdDocumentType | null
  id_number: string | null
  tags: string[] | null
  is_banned: boolean
  created_at: string
}

export default function CustomersContent({
  customers,
  query,
  onlyBanned,
}: {
  customers: CustomerListRow[]
  query: string
  onlyBanned: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState(query)
  const [pending, startTransition] = useTransition()

  function pushParams(next: { q?: string; banned?: boolean }) {
    const sp = new URLSearchParams(searchParams.toString())
    if (next.q !== undefined) {
      if (next.q) sp.set('q', next.q)
      else sp.delete('q')
    }
    if (next.banned !== undefined) {
      if (next.banned) sp.set('banned', '1')
      else sp.delete('banned')
    }
    startTransition(() => {
      router.push(`/customers${sp.toString() ? `?${sp.toString()}` : ''}`)
    })
  }

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    pushParams({ q: searchInput.trim() })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.customers.title}</h1>
        <Link
          href="/customers/new"
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2"
        >
          <Plus size={16} weight="bold" />
          <span>{t.customers.new}</span>
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={onSearchSubmit} className="flex flex-1 items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t.customers.searchPlaceholder}
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
        <label className="inline-flex shrink-0 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={onlyBanned}
            onChange={(e) => pushParams({ banned: e.target.checked })}
            className="h-4 w-4 rounded border-border text-gold focus:ring-blue/10"
          />
          <span>{t.customers.bannedBadge}</span>
        </label>
      </div>

      {customers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted">
            {query || onlyBanned
              ? t.customers.emptyForFilter
              : t.customers.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">
                  {t.customers.nameColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.customers.contactColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.customers.idColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.customers.tagsColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.customers.addedColumn}
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-background"
                  onClick={() => router.push(`/customers/${c.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {c.last_name}, {c.first_name}
                      </span>
                      {c.is_banned ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/5 px-2 py-0.5 text-xs text-danger">
                          <Prohibit size={12} weight="bold" />
                          {t.customers.bannedBadge}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <div>{c.phone ?? <span className="text-muted">—</span>}</div>
                    {c.email ? (
                      <div className="text-xs text-muted">{c.email}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {c.id_number ? (
                      <div>
                        <span className="font-mono text-xs">
                          {maskIdNumber(c.id_number)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.tags && c.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        {c.tags.length > 3 ? (
                          <span className="text-xs text-muted">
                            +{c.tags.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Show only the last 4 characters of an ID number in the list view to avoid
 * casual shoulder-surfing. Full number is on the detail page.
 */
function maskIdNumber(num: string): string {
  if (num.length <= 4) return num
  return `••• ${num.slice(-4)}`
}
