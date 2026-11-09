import 'server-only'

import { isLaserOrderStatus, type LaserOrderStatus } from './status'
import { parseCutDetails, type CutDetails, type RemoteObservation } from './merge'

/**
 * orocut.com order API client (spec "Server", 2026-11-09). Server-only: the
 * order token is a tenant secret and never reaches the browser.
 *
 * Base URL: `OROCUT_API_BASE` (platform env, for the local mock and for a
 * staging host) or https://orocut.com. 15 s timeout, no retries here — the
 * callers decide (the poller just tries again next tick; Send tells the
 * clerk).
 */

const DEFAULT_BASE = 'https://orocut.com'
const TIMEOUT_MS = 15_000

export function orocutBaseUrl(): string {
  return (process.env.OROCUT_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, '')
}

/**
 * Where orocut.com posts status changes. Only an https URL is sent — the
 * spec requires https and localhost would never be reachable anyway; the
 * poller covers development.
 */
export function orocutCallbackUrl(appUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string | null {
  const base = (appUrl ?? '').replace(/\/+$/, '')
  if (!/^https:\/\//i.test(base)) return null
  return `${base}/api/webhooks/orocut`
}

export type OrocutFailure = {
  ok: false
  kind: 'unauthorized' | 'network' | 'remote' | 'invalid'
  httpStatus: number | null
  detail: string
}

export type CreateOrderPayload = {
  external_id: string
  text: string
  text2?: string
  style?: string
  quantity?: number
  metal?: string
  thickness_mm?: number
  chain_length_in?: number
  height_mm?: number
  customer_name?: string
  due_at?: string
  notes?: string
  picture_url?: string
  callback_url?: string
}

export type RemoteOrderDoc = {
  order_id: string
  external_id: string | null
  status: LaserOrderStatus
  reason: string | null
  details: CutDetails | null
  updated_at: string | null
  history: RemoteObservation[]
}

type RawResponse = { ok: true; status: number; json: unknown } | OrocutFailure

async function call(args: {
  token: string
  method: 'GET' | 'POST'
  path: string
  body?: unknown
}): Promise<RawResponse> {
  const url = `${orocutBaseUrl()}${args.path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: 'application/json',
        ...(args.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    return {
      ok: false,
      kind: 'network',
      httpStatus: null,
      detail: err instanceof Error ? err.message : 'fetch failed',
    }
  }

  let json: unknown = null
  const text = await res.text()
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: 'unauthorized', httpStatus: res.status, detail: messageOf(json) ?? res.statusText }
  }
  // 409 is a meaningful answer for POSTs — the callers read it.
  if (!res.ok && res.status !== 409 && res.status !== 404) {
    return { ok: false, kind: 'remote', httpStatus: res.status, detail: messageOf(json) ?? `HTTP ${res.status}` }
  }
  return { ok: true, status: res.status, json }
}

function messageOf(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  for (const k of ['error', 'message', 'detail']) {
    if (typeof o[k] === 'string' && o[k]) return o[k] as string
  }
  return null
}

function str(o: Record<string, unknown>, k: string): string | null {
  return typeof o[k] === 'string' && o[k] ? (o[k] as string) : null
}

/** Tolerant reader for an order document as orocut.com returns it. */
export function parseRemoteOrder(json: unknown): RemoteOrderDoc | null {
  if (!json || typeof json !== 'object') return null
  // Some servers wrap: { order: {...} }
  const root = json as Record<string, unknown>
  const o = (root.order && typeof root.order === 'object' ? root.order : root) as Record<string, unknown>
  const orderId = str(o, 'order_id') ?? str(o, 'id')
  if (!orderId || !isLaserOrderStatus(o.status)) return null

  const rawHistory = Array.isArray(o.history)
    ? o.history
    : Array.isArray(o.status_history)
      ? o.status_history
      : []
  const history: RemoteObservation[] = []
  for (const h of rawHistory) {
    if (!h || typeof h !== 'object') continue
    const e = h as Record<string, unknown>
    if (!isLaserOrderStatus(e.status)) continue
    const at = str(e, 'at') ?? str(e, 'created_at') ?? str(e, 'changed_at')
    if (!at) continue
    history.push({
      status: e.status,
      at,
      by: str(e, 'by') ?? str(e, 'machine') ?? null,
      reason: str(e, 'reason'),
      details: parseCutDetails(e.details),
    })
  }

  return {
    order_id: orderId,
    external_id: str(o, 'external_id'),
    status: o.status,
    reason: str(o, 'reason') ?? str(o, 'reject_reason'),
    details: parseCutDetails(o.details ?? o.cut_details),
    updated_at: str(o, 'updated_at'),
    history,
  }
}

export type CreateOrderResult =
  | { ok: true; orderId: string; status: LaserOrderStatus | null; conflict: boolean }
  | OrocutFailure

/** POST /api/v1/orders. A 409 means the external_id is already open there. */
export async function createOrder(token: string, payload: CreateOrderPayload): Promise<CreateOrderResult> {
  const r = await call({ token, method: 'POST', path: '/api/v1/orders', body: payload })
  if (!r.ok) return r
  const o = (r.json && typeof r.json === 'object' ? r.json : {}) as Record<string, unknown>
  const orderId = str(o, 'order_id') ?? str(o, 'id')
  if (r.status === 404) {
    return { ok: false, kind: 'remote', httpStatus: 404, detail: messageOf(r.json) ?? 'not found' }
  }
  if (!orderId) {
    return { ok: false, kind: 'invalid', httpStatus: r.status, detail: 'response has no order_id' }
  }
  return {
    ok: true,
    orderId,
    status: isLaserOrderStatus(o.status) ? o.status : null,
    conflict: r.status === 409,
  }
}

export type GetOrderResult = { ok: true; order: RemoteOrderDoc } | OrocutFailure

/** GET /api/v1/orders/{order_id}. */
export async function getOrder(token: string, orderId: string): Promise<GetOrderResult> {
  const r = await call({ token, method: 'GET', path: `/api/v1/orders/${encodeURIComponent(orderId)}` })
  if (!r.ok) return r
  if (r.status === 404) {
    return { ok: false, kind: 'remote', httpStatus: 404, detail: 'order not found on orocut.com' }
  }
  const order = parseRemoteOrder(r.json)
  if (!order) return { ok: false, kind: 'invalid', httpStatus: r.status, detail: 'unreadable order document' }
  return { ok: true, order }
}

export type CancelOrderResult =
  | { ok: true; status: LaserOrderStatus | null; refused: boolean }
  | OrocutFailure

/**
 * POST /api/v1/orders/{order_id}/cancel. A 409 means the order is already
 * final over there (done / rejected) — `refused` with the current status.
 */
export async function cancelOrder(token: string, orderId: string): Promise<CancelOrderResult> {
  const r = await call({
    token,
    method: 'POST',
    path: `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`,
    body: {},
  })
  if (!r.ok) return r
  if (r.status === 404) {
    return { ok: false, kind: 'remote', httpStatus: 404, detail: 'order not found on orocut.com' }
  }
  const o = (r.json && typeof r.json === 'object' ? r.json : {}) as Record<string, unknown>
  return {
    ok: true,
    status: isLaserOrderStatus(o.status) ? o.status : r.status === 409 ? null : 'cancelled',
    refused: r.status === 409,
  }
}

/**
 * Does orocut.com accept this token? There is no dedicated check endpoint;
 * a lookup by an external_id that cannot exist answers 401/403 for a bad
 * token and 200/404 for a good one.
 */
export async function probeToken(token: string): Promise<{ ok: true } | OrocutFailure> {
  const r = await call({
    token,
    method: 'GET',
    path: `/api/v1/orders?external_id=${encodeURIComponent('sol-pawn-token-check')}`,
  })
  if (!r.ok) return r
  return { ok: true }
}
