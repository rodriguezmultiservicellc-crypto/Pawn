/**
 * eBay API client — low-level fetch wrapper.
 *
 * STUB STAGE — `ebayFetch()` synthesises a plausible JSON response and
 * writes the would-be request payload to ebay_listing_events so the UI
 * can show "we attempted X" even when the network round-trip never
 * happens. Each call site in lib/ebay/listings.ts is also marked STUB.
 *
 * REAL WIRE-UP (follow-up after credentials):
 *   - Resolve credentials via resolveCredentials() to refresh access
 *     tokens automatically.
 *   - POST/GET to api.ebay.com (or api.sandbox.ebay.com) with:
 *       Authorization: Bearer <access_token>
 *       Content-Type: application/json
 *       X-EBAY-C-MARKETPLACE-ID: <site_id>      (e.g. EBAY_US)
 *       Accept-Language: en-US                   (matches marketplace)
 *   - 401 / token-expired → call refreshAccessToken() once, retry.
 *   - Surface errors as Error('ebay_<status>_<errorCode>') so callers can
 *     map to translated UI messages.
 *
 * Server-only — never import from a client component.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredentials } from './auth'
import type {
  EbayListingEventInsert,
  EbayListingEventKind,
} from '@/types/database-aliases'

export type EbayFetchResult<T> = {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: fetch(`${creds.apiBase}${path}`, {
 *   method, headers: {
 *     Authorization: `Bearer ${creds.accessToken}`,
 *     'Content-Type': 'application/json',
 *     'X-EBAY-C-MARKETPLACE-ID': creds.siteId,
 *     'Accept-Language': 'en-US',
 *   }, body: init.body ? JSON.stringify(init.body) : undefined
 * }) — and parse JSON.
 *
 * The stub:
 *   - Validates tenant has credentials (throws 'tenant_ebay_not_connected'
 *     otherwise via resolveCredentials).
 *   - Inserts an ebay_listing_events row with the would-be request payload
 *     so the UI / events viewer reflects every attempted call.
 *   - Returns synthetic success when args.mockResponse is provided, or a
 *     deterministic-shape mock built from the path otherwise.
 */
export async function ebayFetch<T>(args: {
  tenantId: string
  path: string
  init?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
    queryParams?: Record<string, string>
  }
  /** Used only by the stub — what to return as response body. */
  mockResponse?: T
  /** What ebay_listing_events.kind should this write. */
  eventKind: EbayListingEventKind
  /** Optional listing FK so the events viewer can filter by listing. */
  listingId?: string | null
}): Promise<EbayFetchResult<T>> {
  // Resolve creds first so we throw `tenant_ebay_not_connected` cleanly
  // when the tenant hasn't onboarded yet — even in stub mode this is a
  // real preflight.
  const creds = await resolveCredentials(args.tenantId)

  const method = args.init?.method ?? 'GET'
  const wouldBeUrl = `${creds.apiBase}${args.path}${
    args.init?.queryParams
      ? `?${new URLSearchParams(args.init.queryParams).toString()}`
      : ''
  }`

  const requestPayload = {
    method,
    url: wouldBeUrl,
    site_id: creds.siteId,
    body: args.init?.body ?? null,
    note: 'STUB — request was not actually sent to eBay.',
  }

  const responsePayload =
    args.mockResponse ?? ({ ok: true, stub: true, path: args.path } as unknown as T)

  await writeEvent({
    tenantId: args.tenantId,
    listingId: args.listingId ?? null,
    kind: args.eventKind,
    requestPayload,
    responsePayload,
    httpStatus: 200,
    errorText: null,
  })

  return {
    ok: true,
    status: 200,
    data: responsePayload as T,
    error: null,
  }
}

/**
 * Write a row to ebay_listing_events. Service-role insert so it doesn't
 * require an RLS write policy on a write-once audit table. Errors are
 * swallowed (same shape as logAudit) — a failed event-log insert must not
 * break the user-facing action.
 */
export async function writeEvent(args: {
  tenantId: string
  listingId: string | null
  kind: EbayListingEventKind
  requestPayload: unknown
  responsePayload: unknown
  httpStatus: number | null
  errorText: string | null
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const insert: EbayListingEventInsert = {
      tenant_id: args.tenantId,
      listing_id: args.listingId,
      kind: args.kind,
      request_payload: args.requestPayload as never,
      response_payload: args.responsePayload as never,
      http_status: args.httpStatus,
      error_text: args.errorText,
    }
    const { error } = await admin
      .from('ebay_listing_events')
      .insert(insert as never)
    if (error) {
      console.error('[ebay] event insert failed', error.message, {
        kind: args.kind,
        listingId: args.listingId,
      })
    }
  } catch (err) {
    console.error('[ebay] writeEvent unexpected error', err)
  }
}
