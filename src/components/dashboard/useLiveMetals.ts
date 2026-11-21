'use client'

import { useEffect, useState } from 'react'
import type { MetalsStripData } from '@/lib/spot-prices/strip'

/** How often an open dashboard re-reads the saved prices. */
export const LIVE_METALS_POLL_MS = 2 * 60 * 1000

/**
 * Keeps the Live metals widget current while the dashboard stays open:
 * re-reads GET /api/spot/strip every LIVE_METALS_POLL_MS while the tab is
 * visible, and at once when the tab comes back into view. Only reads what
 * the cron already saved — never calls the price provider. A failed read
 * keeps the last good numbers (the "Updated …" stamp shows their age).
 */
export function useLiveMetals(initial: MetalsStripData): MetalsStripData {
  const [data, setData] = useState(initial)

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    let inFlight = false

    const load = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const res = await fetch('/api/spot/strip', { cache: 'no-store' })
        if (res.ok) setData((await res.json()) as MetalsStripData)
      } catch {
        // offline / server restarting — keep what we have
      } finally {
        inFlight = false
      }
    }

    const start = () => {
      if (timer == null) timer = setInterval(load, LIVE_METALS_POLL_MS)
    }
    const stop = () => {
      if (timer != null) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return data
}
