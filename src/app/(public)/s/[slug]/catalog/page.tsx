import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import {
  fetchPublicCatalog,
  fetchPublicTenant,
} from '@/lib/tenant-resolver'
import type { InventoryCategory } from '@/types/database-aliases'
import CatalogListContent from './content'

type Params = Promise<{ slug: string }>
type Search = Promise<{
  page?: string
  category?: string
  q?: string
}>

const PAGE_SIZE = 24

const ALLOWED_CATEGORIES: ReadonlyArray<InventoryCategory> = [
  'ring',
  'necklace',
  'bracelet',
  'earrings',
  'pendant',
  'chain',
  'watch',
  'coin',
  'bullion',
  'loose_stone',
  'electronics',
  'tool',
  'instrument',
  'other',
]

export default async function PublicCatalogListPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Search
}) {
  const { slug } = await params
  const sp = await searchParams

  const tenant = await fetchPublicTenant(slug)
  if (!tenant) notFound()
  if (!tenant.has_retail) notFound()
  if (!tenant.public_catalog_enabled) notFound()

  const page = parsePage(sp.page)
  const category = parseCategory(sp.category)
  const q = (sp.q ?? '').trim() || undefined

  const { items, pagination } = await fetchPublicCatalog({
    tenantId: tenant.id,
    page,
    pageSize: PAGE_SIZE,
    category,
    q,
  })

  return (
    <CatalogListContent
      tenant={tenant}
      items={items}
      pagination={pagination}
      category={category ?? null}
      query={q ?? ''}
    />
  )
}

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { slug } = await params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant || !tenant.has_retail || !tenant.public_catalog_enabled) {
    return { title: 'Not found' }
  }
  const display = tenant.dba ?? tenant.name
  const cityState = [tenant.city, tenant.state].filter(Boolean).join(', ')
  const title = `${display} — Shop`
  const description = cityState
    ? `Browse jewelry, watches, and more from ${display} in ${cityState}.`
    : `Browse jewelry, watches, and more from ${display}.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: tenant.logo_url ? [{ url: tenant.logo_url }] : undefined,
    },
  }
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

function parseCategory(raw: string | undefined): InventoryCategory | undefined {
  return ALLOWED_CATEGORIES.find((c) => c === raw)
}
