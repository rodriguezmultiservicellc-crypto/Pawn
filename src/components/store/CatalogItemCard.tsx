'use client'

import Link from 'next/link'
import { Storefront } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { PublicCatalogListItem } from '@/lib/tenant-resolver'

export function formatCatalogPrice(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

/** One piece in a catalog grid: photo, description, price, category. */
export function CatalogItemCard({ slug, item }: { slug: string | null; item: PublicCatalogListItem }) {
  const { t } = useI18n()
  return (
    <Link
      href={`/s/${slug}/catalog/${item.sku}`}
      className="block overflow-hidden rounded-xl border border-border bg-card transition hover:bg-background hover:text-foreground/40"
    >
      <div className="aspect-square w-full overflow-hidden bg-background">
        {item.primary_photo?.signed_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.primary_photo.signed_url} alt={item.description} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <Storefront size={28} weight="bold" />
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{item.description}</p>
        <p className="font-mono text-base font-semibold text-foreground">{formatCatalogPrice(item.list_price)}</p>
        <p className="text-xs text-muted">{t.catalog.categories[item.category] ?? item.category}</p>
      </div>
    </Link>
  )
}
