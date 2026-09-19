import 'server-only'
import type { NextRequest } from 'next/server'

/**
 * Cron auth: `Authorization: Bearer ${CRON_SECRET}` only. Vercel Cron sets
 * the header when CRON_SECRET is configured at the project level. The
 * `x-vercel-cron` header is NOT a security check — any external caller can
 * set it — so it is never trusted.
 */
export function authorizeCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return req.headers.get('authorization') === `Bearer ${expected}`
}
