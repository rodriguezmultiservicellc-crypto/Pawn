import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import {
  fetchPublicCatalogItem,
  fetchPublicStore,
  fetchPublicTenant,
  storeBaseUrl,
} from '@/lib/tenant-resolver'
import CatalogItemContent from './content'

export const revalidate = 60

type Params = Promise<{ slug: string; sku: string }>

export default async function PublicCatalogItemPage({
  params,
}: {
  params: Params
}) {
  const { slug, sku } = await params

  const tenant = await fetchPublicTenant(slug)
  if (!tenant) notFound()
  if (!tenant.has_retail) notFound()
  if (!tenant.public_catalog_enabled) notFound()

  const item = await fetchPublicCatalogItem({
    tenantId: tenant.id,
    sku,
  })
  if (!item) notFound()

  const [store, base] = await Promise.all([fetchPublicStore(tenant.id), storeBaseUrl(slug)])
  const url = `${base}/catalog/${encodeURIComponent(item.sku)}`

  // Product structured data for search engines. The image is the stable
  // /image route, not a signed URL that expires before a crawler comes back.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.description,
    sku: item.sku,
    url,
    ...(item.photos?.length ? { image: [`${url}/image`] } : {}),
    ...(item.brand ? { brand: { '@type': 'Brand', name: item.brand } } : {}),
    ...(item.model ? { model: item.model } : {}),
    itemCondition: 'https://schema.org/UsedCondition',
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
  const tenant = await fetchPublicTenant(slug)
  if (!tenant || !tenant.has_retail || !tenant.public_catalog_enabled) {
    return { title: 'Not found' }
  }
  const item = await fetchPublicCatalogItem({
    tenantId: tenant.id,
    sku,
  })
  if (!item) return { title: 'Not found' }

  const display = tenant.dba ?? tenant.name
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
  const url = `${base}/catalog/${encodeURIComponent(item.sku)}`
  const image = item.photos?.length ? `${url}/image` : null

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
