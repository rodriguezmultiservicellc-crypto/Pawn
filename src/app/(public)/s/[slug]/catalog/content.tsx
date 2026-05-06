'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  Storefront,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type {
  CatalogPagination,
  PublicCatalogListItem,
  PublicTenant,
} from '@/lib/tenant-resolver'
import type { InventoryCategory } from '@/types/database-aliases'
import LanguageToggle from '../LanguageToggle'

export default function CatalogListContent({
  tenant,
  items,
  pagination,
  category,
  query,
}: {
  tenant: PublicTenant
  items: PublicCatalogListItem[]
  pagination: CatalogPagination
  category: InventoryCategory | null
  query: string
}) {
  const { t } = useI18n()
  const dict = t.catalog
  const display = tenant.dba ?? tenant.name
  const router = useRouter()

  const [searchInput, setSearchInput] = useState(query)
  // Debounced URL update on search input.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput === query) return
      const params = new URLSearchParams()
      if (searchInput.trim().length >= 2) params.set('q', searchInput.trim())
      if (category) params.set('category', category)
      // page resets to 1 on filter change.
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : '?')
    }, 300)
    return () => clearTimeout(handle)
  }, [searchInput, query, category, router])

  const categoriesPresent = useMemo(() => {
    const set = new Set<InventoryCategory>()
    for (const it of items) set.add(it.category)
    return Array.from(set).sort()
  }, [items])

  const showEmpty = items.length === 0
  const showEmptyAll = showEmpty && !category && !query

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href={`/s/${tenant.public_slug}`}
            className="flex items-center gap-3"
          >
            {tenant.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logo_url}
                alt=""
                className="h-9 w-9 rounded-md object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold text-navy">
                <Storefront size={18} weight="bold" />
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-base font-semibold tracking-[-0.01em] text-foreground">
                {display}
              </span>
              <span className="text-xs text-muted">{dict.shop}</span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href={`/s/${tenant.public_slug}`}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <ArrowLeft size={12} weight="bold" />
              {dict.backToHome}
            </Link>
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {/* Filter row */}
        <div className="mb-6 space-y-4">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              weight="bold"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={dict.searchPlaceholder}
              className="block w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </div>
          {categoriesPresent.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              <CategoryPill
                slug={tenant.public_slug}
                value={null}
                active={category === null}
                label={dict.filterAll}
                preserveQuery={query}
              />
              {categoriesPresent.map((c) => (
                <CategoryPill
                  key={c}
                  slug={tenant.public_slug}
                  value={c}
                  active={category === c}
                  label={dict.categories[c] ?? c}
                  preserveQuery={query}
                />
              ))}
            </div>
          ) : null}
          {(category || query) && !showEmpty ? (
            <Link
              href={`/s/${tenant.public_slug}/catalog`}
              className="text-xs text-gold hover:underline"
            >
              {dict.clearFilters}
            </Link>
          ) : null}
        </div>

        {/* Grid or empty */}
        {showEmpty ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-sm text-muted">
            {showEmptyAll ? dict.emptyAll : dict.empty}
            {!showEmptyAll ? (
              <div className="mt-3">
                <Link
                  href={`/s/${tenant.public_slug}/catalog`}
                  className="text-xs font-medium text-gold hover:underline"
                >
                  {dict.clearFilters}
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/s/${tenant.public_slug}/catalog/${item.sku}`}
                  className="block overflow-hidden rounded-lg border border-border bg-card transition hover:border-foreground/40"
                >
                  <div className="aspect-square w-full overflow-hidden bg-background">
                    {item.primary_photo?.signed_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.primary_photo.signed_url}
                        alt={item.description}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted">
                        <Storefront size={28} weight="bold" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 p-3">
                    <p className="line-clamp-2 text-sm font-medium text-foreground">
                      {item.description}
                    </p>
                    <p className="font-mono text-base font-semibold text-foreground">
                      {formatPrice(item.list_price)}
                    </p>
                    <p className="text-xs text-muted">
                      {dict.categories[item.category] ?? item.category}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 ? (
          <nav className="mt-8 flex items-center justify-center gap-3 text-sm">
            <PageLink
              slug={tenant.public_slug}
              page={pagination.page - 1}
              category={category}
              query={query}
              disabled={pagination.page <= 1}
              icon={<CaretLeft size={14} weight="bold" />}
              label={dict.prevPage}
            />
            <span className="text-xs text-muted">
              {dict.pageOf
                .replace('{page}', String(pagination.page))
                .replace('{total}', String(pagination.totalPages))}
            </span>
            <PageLink
              slug={tenant.public_slug}
              page={pagination.page + 1}
              category={category}
              query={query}
              disabled={!pagination.hasMore}
              icon={<CaretRight size={14} weight="bold" />}
              label={dict.nextPage}
              right
            />
          </nav>
        ) : null}
      </main>

      <footer className="border-t border-border py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 text-xs text-muted">
          <span>
            © {new Date().getFullYear()} {tenant.name}
          </span>
          <span>{t.landing.poweredBy}</span>
        </div>
      </footer>
    </>
  )
}

function CategoryPill({
  slug,
  value,
  active,
  label,
  preserveQuery,
}: {
  slug: string
  value: InventoryCategory | null
  active: boolean
  label: string
  preserveQuery: string
}) {
  const params = new URLSearchParams()
  if (value) params.set('category', value)
  if (preserveQuery) params.set('q', preserveQuery)
  const qs = params.toString()
  return (
    <Link
      href={`/s/${slug}/catalog${qs ? `?${qs}` : ''}`}
      className={`rounded-xl border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-gold bg-gold text-navy'
          : 'border-border bg-card text-foreground hover:border-foreground/40'
      }`}
    >
      {label}
    </Link>
  )
}

function PageLink({
  slug,
  page,
  category,
  query,
  disabled,
  icon,
  label,
  right,
}: {
  slug: string
  page: number
  category: InventoryCategory | null
  query: string
  disabled: boolean
  icon: React.ReactNode
  label: string
  right?: boolean
}) {
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/50 px-3 py-1.5 text-xs text-muted">
        {right ? null : icon}
        {label}
        {right ? icon : null}
      </span>
    )
  }
  const params = new URLSearchParams()
  params.set('page', String(page))
  if (category) params.set('category', category)
  if (query) params.set('q', query)
  return (
    <Link
      href={`/s/${slug}/catalog?${params.toString()}`}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-foreground/40"
    >
      {right ? null : icon}
      {label}
      {right ? icon : null}
    </Link>
  )
}

function formatPrice(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
