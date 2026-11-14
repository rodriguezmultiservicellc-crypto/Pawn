import { describe, expect, it } from 'vitest'
import {
  buildFeedXml,
  feedDescription,
  feedTitle,
  googleCategory,
  googleCondition,
  shippingPrice,
  xmlEscape,
  type FeedItem,
  type FeedShop,
} from './feed'

const shop: FeedShop = {
  name: 'Sol Pawn & Gold',
  baseUrl: 'https://shop.example.com',
  ship: { enabled: true, flatRate: 15, freeOver: 500 },
}

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  sku: 'RNG-14K-0042',
  description: '14K yellow gold band',
  category: 'ring',
  brand: null,
  model: null,
  metal: 'yellow_gold',
  karat: '14K',
  weight_grams: 4.2,
  condition: 'used',
  list_price: 389.5,
  photoIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
  ...over,
})

describe('feed field mapping', () => {
  it('maps condition to Google vocabulary', () => {
    expect(googleCondition('new')).toBe('new')
    expect(googleCondition('restored')).toBe('refurbished')
    expect(googleCondition('vintage')).toBe('used')
    expect(googleCondition(null)).toBe('used')
  })
  it('maps jewelry categories and leaves the rest to Google', () => {
    expect(googleCategory('ring')).toBe(200)
    expect(googleCategory('chain')).toBe(196)
    expect(googleCategory('electronics')).toBeNull()
  })
  it('puts brand + model first unless the description already says them', () => {
    expect(feedTitle(item({ brand: 'Rolex', model: 'Datejust', description: 'Steel watch' }))).toBe('Rolex Datejust Steel watch')
    expect(feedTitle(item({ brand: 'Rolex', model: 'Datejust', description: 'Rolex Datejust 36mm' }))).toBe('Rolex Datejust 36mm')
    expect(feedTitle(item({ description: 'x'.repeat(200) })).length).toBe(150)
  })
  it('adds metal and weight to the description', () => {
    expect(feedDescription(item())).toBe('14K yellow gold band. 14K yellow gold, 4.2 g.')
  })
  it('charges flat shipping, free over the threshold, none when not shipping', () => {
    expect(shippingPrice(100, shop.ship)).toBe(15)
    expect(shippingPrice(500, shop.ship)).toBe(0)
    expect(shippingPrice(100, { ...shop.ship, enabled: false })).toBeNull()
  })
  it('escapes XML and strips control characters', () => {
    expect(xmlEscape(`<a href="x">Tom's & co\u0007</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom&apos;s &amp; co&lt;/a&gt;')
  })
})

describe('buildFeedXml', () => {
  const xml = buildFeedXml(shop, [
    item(),
    item({ sku: 'NO-PHOTO', photoIds: [] }),
    item({ sku: 'COIN-1', category: 'coin', list_price: 1200 }),
  ])

  it('is an RSS 2.0 feed in the Google namespace', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">')
    expect(xml).toContain('<title>Sol Pawn &amp; Gold</title>')
  })
  it('leaves out pieces without a photo', () => {
    expect(xml).not.toContain('NO-PHOTO')
    expect(xml.match(/<item>/g)?.length).toBe(2)
  })
  it('writes the required fields with stable image addresses', () => {
    expect(xml).toContain('<g:id>RNG-14K-0042</g:id>')
    expect(xml).toContain('<g:link>https://shop.example.com/catalog/RNG-14K-0042</g:link>')
    expect(xml).toContain('<g:image_link>https://shop.example.com/img/11111111-1111-1111-1111-111111111111</g:image_link>')
    expect(xml).toContain('<g:additional_image_link>https://shop.example.com/img/22222222-2222-2222-2222-222222222222</g:additional_image_link>')
    expect(xml).toContain('<g:price>389.50 USD</g:price>')
    expect(xml).toContain('<g:availability>in_stock</g:availability>')
    expect(xml).toContain('<g:condition>used</g:condition>')
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>')
    expect(xml).toContain('<g:brand>Sol Pawn &amp; Gold</g:brand>')
    expect(xml).toContain('<g:google_product_category>200</g:google_product_category>')
  })
  it('prices shipping per piece', () => {
    const coin = xml.slice(xml.indexOf('<g:id>COIN-1</g:id>'))
    expect(coin).toContain('<g:price>0.00 USD</g:price></g:shipping>')
    expect(coin).not.toContain('google_product_category')
  })
})
