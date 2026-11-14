import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import {
  fetchPublicCatalog,
  fetchPublicCatalogItem,
  fetchPublicSoldItem,
  fetchPublicStore,
  fetchPublicTenant,
  storeBaseUrl,
  type PublicTenant,
} from '@/lib/tenant-resolver'
import { googleCondition, imageUrl, itemUrl } from '@/lib/store/feed'
import CatalogItemContent from './content'
import SoldItemContent from './sold'

export const revalidate = 60

type Params = Promise<{ slug: string; sku: string }>

const SCHEMA_CONDITION = {
  new: 'https://schema.org/NewCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
  used: 'https://schema.org/UsedCondition',
} as const

async function publishedTenant(slug: string): Promise<PublicTenant | null> {
  const tenant = await fetchPublicTenant(slug)
  return tenant?.has_retail && tenant.public_catalog_enabled ? tenant : null
}

export default async function PublicCatalogItemPage({
  params,
}: {
  params: Params
}) {
  const { slug, sku } = await params

  const tenant = await publishedTenant(slug)
  if (!tenant) notFound()

  const item = await fetchPublicCatalogItem({
    tenantId: tenant.id,
    sku,
  })
  if (!item) {
    // Sold or in someone's checkout: keep the link alive (feeds and search
    // results lag behind the shop floor) and show similar pieces.
    const sold = await fetchPublicSoldItem({ tenantId: tenant.id, sku })
    if (!sold) notFound()
    const { items: similar } = await fetchPublicCatalog({
      tenantId: tenant.id,
      page: 1,
      pageSize: 4,
      category: sold.category,
    })
    return <SoldItemContent tenant={tenant} item={sold} similar={similar} />
  }

  const [store, base] = await Promise.all([fetchPublicStore(tenant.id), storeBaseUrl(slug)])
  const url = itemUrl(base, item.sku)
  const photos = item.photos ?? []

  // Product structured data for search engines. Images use the stable
  // /img/<photo> route, not a signed URL that expires before a crawler
  // comes back.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.description,
    sku: item.sku,
    url,
    ...(photos.length ? { image: photos.slice(0, 10).map((p) => imageUrl(base, p.id)) } : {}),
    ...(item.brand ? { brand: { '@type': 'Brand', name: item.brand } } : {}),
    ...(item.model ? { model: item.model } : {}),
    itemCondition: SCHEMA_CONDITION[googleCondition(item.condition)],
    offers: {
      '@type': 'Offer',
      price: item.list_price.toFixed(2),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url,
      seller: { '@type': 'Organization', name: tenant.dba ?? tenant.name },
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify output with '<' escaped cannot close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <CatalogItemContent tenant={tenant} item={item} store={store} />
    </>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { slug, sku } = await params
  const tenant = await publishedTenant(slug)
  if (!tenant) return { title: 'Not found' }
  const display = tenant.dba ?? tenant.name

  const item = await fetchPublicCatalogItem({
    tenantId: tenant.id,
    sku,
  })
  if (!item) {
    const sold = await fetchPublicSoldItem({ tenantId: tenant.id, sku })
    if (!sold) return { title: 'Not found' }
    // Kept for people who follow an old link; not for search results.
    return { title: `${sold.description} — ${display}`, robots: { index: false, follow: true } }
  }

  const title = `${item.description} — ${display}`
  const priceStr = `$${item.list_price.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
  const description =
    item.brand && item.model
      ? `${item.brand} ${item.model} · ${priceStr}`
      : item.metal && item.karat && item.weight_grams != null
      ? `${item.karat} ${item.metal} · ${item.weight_grams}g · ${priceStr}`
      : `${item.description} · ${priceStr}`
  const base = await storeBaseUrl(slug)
  const url = itemUrl(base, item.sku)
  const first = item.photos?.[0]
  const image = first ? imageUrl(base, first.id) : null

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: 'website',
      url,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  }
}
