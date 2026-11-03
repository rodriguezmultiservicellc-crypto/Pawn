import { describe, expect, it } from 'vitest'
import { fetchSpotQuotesWithFallback } from './index'
import { parseGoldApiPrice } from './gold-api'
import { parseYahooChartPrice } from './yahoo-futures'
import { parseStooqCsv } from './stooq'
import type { SpotMetal, SpotSource, SpotSourceId } from './types'

const AT = '2026-11-03T20:00:00.000Z'

function fake(
  id: SpotSourceId,
  prices: Partial<Record<SpotMetal, number>>,
  errors: string[] = [],
): SpotSource {
  return {
    id,
    label: id,
    async fetch({ fetchedAt }) {
      return {
        quotes: (Object.entries(prices) as Array<[SpotMetal, number]>).map(
          ([metal, price_per_oz]) => ({ metal, price_per_oz, fetched_at: fetchedAt, source: id }),
        ),
        errors,
      }
    },
  }
}

function throwing(id: SpotSourceId): SpotSource {
  return {
    id,
    label: id,
    async fetch() {
      throw new Error('boom')
    },
  }
}

const ALL = { gold: 3900, silver: 49, platinum: 1420, palladium: 950 }

describe('fetchSpotQuotesWithFallback', () => {
  it('stops at the first provider that returns every metal', async () => {
    const r = await fetchSpotQuotesWithFallback(
      [fake('gold-api', ALL), fake('yahoo-futures', ALL)],
      { fetchedAt: AT },
    )
    expect(r.quotes).toHaveLength(4)
    expect(r.source).toBe('gold-api')
    expect(r.attempts.map((a) => a.source)).toEqual(['gold-api'])
    expect(r.attempts[0].ok).toBe(true)
    expect(r.quotes.every((q) => q.fetched_at === AT)).toBe(true)
  })

  it('falls through when the primary returns nothing (the Stooq 404 case)', async () => {
    const r = await fetchSpotQuotesWithFallback(
      [
        fake('stooq', {}, ['gold: HTTP 404', 'silver: HTTP 404']),
        fake('yahoo-futures', ALL),
      ],
      { fetchedAt: AT },
    )
    expect(r.source).toBe('yahoo-futures')
    expect(r.quotes.every((q) => q.source === 'yahoo-futures')).toBe(true)
    expect(r.attempts).toHaveLength(2)
    expect(r.attempts[0]).toMatchObject({ source: 'stooq', ok: false, quotes: 0 })
    expect(r.attempts[0].error).toContain('HTTP 404')
    expect(r.attempts[1]).toMatchObject({ source: 'yahoo-futures', ok: true, quotes: 4 })
  })

  it('fills a single missing metal from the next provider and keeps the rest', async () => {
    const r = await fetchSpotQuotesWithFallback(
      [
        fake('gold-api', { gold: 3900, silver: 49, platinum: 1420 }, ['palladium: timeout']),
        fake('yahoo-futures', { ...ALL, gold: 3999 }),
      ],
      { fetchedAt: AT },
    )
    expect(r.quotes).toHaveLength(4)
    const gold = r.quotes.find((q) => q.metal === 'gold')!
    const pd = r.quotes.find((q) => q.metal === 'palladium')!
    // First provider to supply a metal wins — gold stays from gold-api.
    expect(gold).toMatchObject({ price_per_oz: 3900, source: 'gold-api' })
    expect(pd).toMatchObject({ price_per_oz: 950, source: 'yahoo-futures' })
    expect(r.source).toBe('gold-api')
    expect(r.attempts[0].ok).toBe(false)
    expect(r.attempts[0].quotes).toBe(3)
  })

  it('reports every attempt and a null winner when all providers fail', async () => {
    const r = await fetchSpotQuotesWithFallback(
      [fake('gold-api', {}, ['gold: HTTP 503']), throwing('yahoo-futures'), fake('stooq', {})],
      { fetchedAt: AT },
    )
    expect(r.quotes).toEqual([])
    expect(r.source).toBeNull()
    expect(r.attempts).toHaveLength(3)
    expect(r.attempts[1].error).toContain('boom')
  })

  it('survives a provider that throws instead of reporting', async () => {
    const r = await fetchSpotQuotesWithFallback(
      [throwing('gold-api'), fake('yahoo-futures', ALL)],
      { fetchedAt: AT },
    )
    expect(r.source).toBe('yahoo-futures')
    expect(r.attempts[0]).toMatchObject({ source: 'gold-api', ok: false, quotes: 0 })
  })
})

describe('provider parsers', () => {
  it('gold-api: reads price, rejects garbage', () => {
    expect(parseGoldApiPrice({ price: 3921.199951, symbol: 'XAU' })).toBe(3921.199951)
    expect(parseGoldApiPrice({ price: 0 })).toBeNull()
    expect(parseGoldApiPrice({ price: 'abc' })).toBeNull()
    expect(parseGoldApiPrice(null)).toBeNull()
    expect(parseGoldApiPrice('{"price":1}')).toBeNull()
  })

  it('yahoo: reads regularMarketPrice, rejects the delisted-symbol shape', () => {
    expect(
      parseYahooChartPrice({
        chart: { result: [{ meta: { regularMarketPrice: 3931.6 } }], error: null },
      }),
    ).toBe(3931.6)
    expect(
      parseYahooChartPrice({
        chart: { result: null, error: { code: 'Not Found' } },
      }),
    ).toBeNull()
    expect(parseYahooChartPrice({})).toBeNull()
  })

  it('stooq: reads the Close column, rejects N/D', () => {
    expect(parseStooqCsv('Symbol,Date,Time,Close\nXAUUSD,2026-04-30,05:42:08,4560.945\n')).toBe(
      4560.945,
    )
    expect(parseStooqCsv('Symbol,Date,Time,Close\nXAUUSD,N/D,N/D,N/D')).toBeNull()
    expect(parseStooqCsv('<html>404</html>')).toBeNull()
  })
})
