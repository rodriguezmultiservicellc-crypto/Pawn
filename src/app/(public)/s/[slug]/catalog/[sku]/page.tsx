import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import {
  fetchPublicCatalogItem,
  fetchPublicTenant,
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

  return <CatalogItemContent tenant={tenant} item={item} />
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
  const primary = item.photos?.find((p) => p.is_primary) ?? item.photos?.[0]

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: primary?.signed_url ? [{ url: primary.signed_url }] : undefined,
    },
    twitter: {
      card: primary?.signed_url ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  }
}
