'use client'

import { useSyncExternalStore } from 'react'
import { shortDateTime } from '@/lib/format/money'

const noopSubscribe = () => () => {}

/**
 * Local-time stamp rendered only after mount. The server renders in UTC and
 * the browser in the shop's zone, so formatting during SSR produces a text
 * mismatch (React #418) on every load; an empty server placeholder does not.
 */
export function ClientTime({ iso }: { iso: string }) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
  return <>{mounted ? shortDateTime(iso) : '…'}</>
}
