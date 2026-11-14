/**
 * Product feed (PLAN-2026-11-13 Phase 4). Pure: turns public catalog rows
 * into the RSS 2.0 + g: namespace file Google Merchant Center fetches on a
 * schedule. Meta's catalog accepts the same file.
 *
 * Spec: https://support.google.com/merchants/answer/7052112
 * Every piece is one of a kind with no manufacturer barcode, so each item
 * says identifier_exists = no.
 */

import { en } from '@/lib/i18n/en'
import { categoryLabel } from '@/lib/inventory/labels'
import type { Database } from '@/types/database'

type Category = Database['public']['Enums']['inventory_category']
type Condition = Database['public']['Enums']['inventory_condition']

export const FEED_MAX_ITEMS = 5000
const TITLE_MAX = 150
const DESCRIPTION_MAX = 5000
const EXTRA_IMAGES_MAX = 10

export type FeedItem = {
  sku: string
  description: string
  category: Category
  brand: string | null
  model: string | null
  metal: string | null
  karat: string | null
  weight_grams: number | null
  condition: Condition | null
  list_price: number
  /** Photo ids, primary first. Items without one are left out of the feed. */
  photoIds: string[]
}

export type FeedShop = {
  name: string
  /** storeBaseUrl(): custom domain or app URL + /s/<slug>. No trailing slash. */
  baseUrl: string
  ship: { enabled: boolean; flatRate: number; freeOver: number | null }
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not allowed in XML 1.0 at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** Google's condition vocabulary is new / refurbished / used. A pawn shop's default is used. */
export function googleCondition(c: Condition | null): 'new' | 'refurbished' | 'used' {
  if (c === 'new') return 'new'
  if (c === 'restored') return 'refurbished'
  return 'used'
}

/**
 * Google product taxonomy ids for the jewelry categories. Anything else is
 * left out — Google assigns a category itself when the field is missing.
 */
const GOOGLE_CATEGORY: Partial<Record<Category, number>> = {
  ring: 200, // Apparel & Accessories > Jewelry > Rings
  necklace: 196, // … > Necklaces
  chain: 196,
  bracelet: 191, // … > Bracelets
  earrings: 194, // … > Earrings
  pendant: 192, // … > Charms & Pendants
  watch: 201, // … > Watches
}

export function googleCategory(c: Category): number | null {
  return GOOGLE_CATEGORY[c] ?? null
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…'
}

function details(i: FeedItem): string {
  const parts: string[] = []
  if (i.karat || i.metal) parts.push([i.karat, i.metal?.replace(/_/g, ' ')].filter(Boolean).join(' '))
  if (i.weight_grams != null) parts.push(`${i.weight_grams} g`)
  return parts.join(', ')
}

/** Title: the item's own description; brand + model lead when the description does not already say them. */
export function feedTitle(i: FeedItem): string {
  const lead = [i.brand, i.model].filter(Boolean).join(' ')
  const desc = i.description.trim()
  const title = lead && !desc.toLowerCase().includes(lead.toLowerCase()) ? `${lead} ${desc}` : desc
  return clip(title || i.sku, TITLE_MAX)
}

export function feedDescription(i: FeedItem): string {
  const d = details(i)
  return clip(d ? `${i.description.trim()}. ${d}.` : i.description.trim() || i.sku, DESCRIPTION_MAX)
}

/** Shipping for this piece, or null when the shop does not ship (Merchant Center account settings apply). */
export function shippingPrice(price: number, ship: FeedShop['ship']): number | null {
  if (!ship.enabled) return null
  if (ship.freeOver != null && price >= ship.freeOver) return 0
  return ship.flatRate
}

const money = (n: number) => `${n.toFixed(2)} USD`

export function itemUrl(baseUrl: string, sku: string): string {
  return `${baseUrl}/catalog/${encodeURIComponent(sku)}`
}

export function imageUrl(baseUrl: string, photoId: string): string {
  return `${baseUrl}/img/${encodeURIComponent(photoId)}`
}

/** True when a piece can go in the feed (Google refuses an item without an image). */
export function feedEligible(i: Pick<FeedItem, 'photoIds' | 'list_price'>): boolean {
  return i.photoIds.length > 0 && i.list_price > 0
}

export function buildFeedXml(shop: FeedShop, items: FeedItem[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    `<title>${xmlEscape(shop.name)}</title>`,
    `<link>${xmlEscape(shop.baseUrl)}</link>`,
    `<description>${xmlEscape(shop.name)}</description>`,
  ]
  for (const i of items) {
    if (!feedEligible(i)) continue
    const [primary, ...extra] = i.photoIds
    const cat = googleCategory(i.category)
    const ship = shippingPrice(i.list_price, shop.ship)
    const tag = (name: string, value: string) => `<${name}>${xmlEscape(value)}</${name}>`
    out.push(
      '<item>',
      tag('g:id', i.sku),
      tag('g:title', feedTitle(i)),
      tag('g:description', feedDescription(i)),
      tag('g:link', itemUrl(shop.baseUrl, i.sku)),
      tag('g:image_link', imageUrl(shop.baseUrl, primary)),
      ...extra.slice(0, EXTRA_IMAGES_MAX).map((p) => tag('g:additional_image_link', imageUrl(shop.baseUrl, p))),
      tag('g:availability', 'in_stock'),
      tag('g:price', money(i.list_price)),
      tag('g:condition', googleCondition(i.condition)),
      // A custom or pre-owned piece may name the shop as its brand.
      tag('g:brand', i.brand?.trim() || shop.name),
      tag('g:identifier_exists', 'no'),
      ...(cat ? [tag('g:google_product_category', String(cat))] : []),
      tag('g:product_type', categoryLabel(i.category, en)),
      ...(ship != null
        ? [`<g:shipping><g:country>US</g:country><g:price>${money(ship)}</g:price></g:shipping>`]
        : []),
      '</item>',
    )
  }
  out.push('</channel>', '</rss>', '')
  return out.join('\n')
}
