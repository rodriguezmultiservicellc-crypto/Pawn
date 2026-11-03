/**
 * One-off / operator CLI: run the spot-price refresh from a terminal,
 * exactly as the cron and the "Refresh now" button do, and print the
 * summary. Useful when the feed has gone stale and nobody is at the UI.
 *
 *   npx tsx --env-file=.env.local scripts/refresh-spot-prices.ts
 *
 * Writes real rows to spot_prices + spot_price_fetches (trigger='manual',
 * no user attribution). Requires SUPABASE_SERVICE_ROLE_KEY in the env.
 */

import { refreshSpotPrices } from '../src/lib/spot-prices/refresh'

async function main() {
  const summary = await refreshSpotPrices({ trigger: 'manual' })
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.ok ? 0 : 1)
}

void main()
