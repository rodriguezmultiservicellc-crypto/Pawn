'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ShoppingBag } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { addToCart, CART_MAX, useCart, type CartLine } from './cart'

/** Header link to the cart with a count. Renders nothing when the cart is empty. */
export function CartLink({ slug }: { slug: string }) {
  const { t } = useI18n()
  const lines = useCart(slug)
  if (lines.length === 0) return null
  return (
    <Link
      href={`/s/${slug}/cart`}
      className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background"
    >
      <ShoppingBag size={14} weight="bold" />
      {t.store.cart} <span className="font-mono">({lines.length})</span>
    </Link>
  )
}

/**
 * Buy button on an item page. Over the shop's online limit it explains
 * that the piece is sold by contacting the store instead (fraud decision 2).
 */
export function AddToCartButton({
  slug,
  line,
  overLimit,
}: {
  slug: string
  line: CartLine
  overLimit: boolean
}) {
  const { t } = useI18n()
  const lines = useCart(slug)
  const [full, setFull] = useState(false)
  const inCart = lines.some((l) => l.id === line.id)

  if (overLimit) {
    return <p className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted">{t.store.overLimit}</p>
  }

  if (inCart) {
    return (
      <Link
        href={`/s/${slug}/cart`}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-bold text-success"
      >
        <Check size={14} weight="bold" /> {t.store.inCart} · {t.store.viewCart}
      </Link>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setFull(!addToCart(slug, line))}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg"
      >
        <ShoppingBag size={14} weight="bold" /> {t.store.addToCart}
      </button>
      {full ? <p className="text-xs text-danger">{t.store.cartFull.replace('{n}', String(CART_MAX))}</p> : null}
    </>
  )
}
