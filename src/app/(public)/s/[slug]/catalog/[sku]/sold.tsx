'use client'

import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import type { PublicCatalogListItem, PublicSoldItem, PublicTenant } from '@/lib/tenant-resolver'
import { StoreFooter, StoreHeader } from '@/components/store/StoreChrome'
import { CatalogItemCard } from '@/components/store/CatalogItemCard'

/**
 * An old link to a piece that sold (or is in someone's checkout). Feeds and
 * search results lag behind the shop floor; this page keeps the link alive
 * and points at similar pieces instead of a dead 404.
 */
export default function SoldItemContent({
  tenant,
  item,
  similar,
}: {
  tenant: PublicTenant
  item: PublicSoldItem
  similar: PublicCatalogListItem[]
}) {
  const { t } = useI18n()
  const d = t.catalog
  return (
    <>
      <StoreHeader tenant={tenant} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 text-center">
          <span
            className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
              item.sold ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'
            }`}
          >
            {item.sold ? d.soldBadge : d.onHoldBadge}
          </span>
          <h1 className="mt-3 font-display text-2xl font-bold text-foreground">{item.description}</h1>
          <p className="mt-2 text-sm text-muted">{item.sold ? d.soldBody : d.onHoldBody}</p>
          <Link
            href={`/s/${tenant.public_slug}/catalog`}
            className="mt-5 inline-block rounded-xl bg-gold px-5 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg"
          >
            {d.seeEverything}
          </Link>
        </div>

        {similar.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-4 text-base font-semibold text-foreground">{d.similarPieces}</h2>
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {similar.map((s) => (
                <li key={s.id}>
                  <CatalogItemCard slug={tenant.public_slug} item={s} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <StoreFooter tenant={tenant} />
    </>
  )
}
