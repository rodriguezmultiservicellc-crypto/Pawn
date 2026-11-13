'use client'

/**
 * Shopper's cart, kept in the browser per shop. Every piece is one of a
 * kind, so a line is a piece and quantity is always one. Nothing here is
 * trusted: the server re-checks each piece against the public catalog and
 * reprices it when the shopper presses Pay (online_order_reserve).
 */

import { useSyncExternalStore } from 'react'

export type CartLine = {
  id: string
  sku: string
  description: string
  price: number
  photoUrl: string | null
}

export const CART_MAX = 10
const EVENT = 'pawn-cart-change'
const EMPTY: CartLine[] = []
const key = (slug: string) => `pawn-cart:${slug}`

// Cache the parsed value per raw string so useSyncExternalStore sees a
// stable snapshot between renders.
let lastRaw: string | null = null
let lastLines: CartLine[] = EMPTY

function read(slug: string): CartLine[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key(slug))
  } catch {
    return EMPTY
  }
  if (raw === lastRaw) return lastLines
  lastRaw = raw
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    lastLines = Array.isArray(parsed)
      ? (parsed as CartLine[]).filter((l) => l && typeof l.id === 'string').slice(0, CART_MAX)
      : EMPTY
  } catch {
    lastLines = EMPTY
  }
  return lastLines
}

function write(slug: string, lines: CartLine[]): void {
  try {
    localStorage.setItem(key(slug), JSON.stringify(lines.slice(0, CART_MAX)))
  } catch {}
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('storage', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(EVENT, cb)
  }
}

export function useCart(slug: string): CartLine[] {
  return useSyncExternalStore(subscribe, () => read(slug), () => EMPTY)
}

/** Returns false when the cart is full. Adding a piece twice is a no-op. */
export function addToCart(slug: string, line: CartLine): boolean {
  const lines = read(slug)
  if (lines.some((l) => l.id === line.id)) return true
  if (lines.length >= CART_MAX) return false
  write(slug, [...lines, line])
  return true
}

export function removeFromCart(slug: string, id: string): void {
  write(slug, read(slug).filter((l) => l.id !== id))
}

export function keepOnly(slug: string, ids: Set<string>): void {
  write(slug, read(slug).filter((l) => ids.has(l.id)))
}

export function clearCart(slug: string): void {
  write(slug, [])
}
