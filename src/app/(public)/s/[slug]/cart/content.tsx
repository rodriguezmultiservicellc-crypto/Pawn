'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LockSimple, Storefront, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import type { PublicStore, PublicTenant } from '@/lib/tenant-resolver'
import { keepOnly, removeFromCart, useCart, type CartLine } from '@/components/store/cart'
import { StoreFooter, StoreHeader } from '@/components/store/StoreChrome'

type Fresh = Pick<CartLine, 'id' | 'sku' | 'description' | 'price' | 'photoUrl'>

export default function CartContent({ tenant, store }: { tenant: PublicTenant; store: PublicStore }) {
  const { t, lang } = useI18n()
  const s = t.store
  const slug = tenant.public_slug ?? ''
  const lines = useCart(slug)

  // Re-check the cart against the live catalog once per visit: sold or
  // reserved pieces drop out, and prices / photos come from the server.
  const [fresh, setFresh] = useState<Map<string, Fresh> | null>(null)
  const [removedSome, setRemovedSome] = useState(false)
  const ids = lines.map((l) => l.id).join(',')
  useEffect(() => {
    if (!ids) return
    let live = true
    fetch(`/api/store/${slug}/cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: ids.split(',') }),
    })
      .then((r) => r.json() as Promise<{ items: Fresh[] }>)
      .then(({ items }) => {
        if (!live) return
        const m = new Map(items.map((i) => [i.id, i]))
        setFresh(m)
        if (m.size < ids.split(',').length) {
          setRemovedSome(true)
          keepOnly(slug, new Set(m.keys()))
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [ids, slug])

  const shown = lines.map((l) => fresh?.get(l.id) ?? l)
  const subtotal = shown.reduce((acc, l) => acc + l.price, 0)

  const [fulfillment, setFulfillment] = useState<'pickup' | 'ship'>(store.pickupEnabled ? 'pickup' : 'ship')
  const shipping =
    fulfillment === 'ship' && !(store.shipFreeOver != null && subtotal >= store.shipFreeOver) ? store.shipFlatRate : 0

  const [form, setForm] = useState({ name: '', email: '', phone: '', line1: '', line2: '', city: '', state: '', postal: '' })
  const [error, setError] = useState<string | null>(null)
  const [badFields, setBadFields] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function pay(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBadFields(new Set())
    setPaying(true)
    try {
      const res = await fetch(`/api/store/${slug}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: lines.map((l) => l.id),
          name: form.name,
          email: form.email,
          phone: form.phone,
          language: lang,
          fulfillment,
          address:
            fulfillment === 'ship'
              ? { line1: form.line1, line2: form.line2, city: form.city, state: form.state, postal: form.postal }
              : null,
        }),
      })
      const json = (await res.json()) as { url?: string; error?: string; fields?: string[] }
      if (json.url) {
        window.location.assign(json.url)
        return
      }
      setBadFields(new Set(json.fields ?? []))
      const errs = s.errors as Record<string, string>
      setError(errs[json.error ?? 'generic'] ?? errs.generic)
    } catch {
      setError(s.errors.generic)
    }
    setPaying(false)
  }

  const input = (k: keyof typeof form, label: string, opts: { type?: string; field?: string; required?: boolean; auto?: string } = {}) => (
    <label className="block space-y-1 text-sm">
      <span className="font-semibold text-foreground">{label}</span>
      <input
        type={opts.type ?? 'text'}
        value={form[k]}
        onChange={set(k)}
        required={opts.required ?? true}
        autoComplete={opts.auto}
        className={`w-full rounded-xl border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none ${
          badFields.has(opts.field ?? k) ? 'border-danger' : 'border-border'
        }`}
      />
    </label>
  )

  return (
    <>
      <StoreHeader tenant={tenant} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="font-display text-2xl font-bold text-foreground">{s.cartTitle}</h1>
        {removedSome ? <p className="mt-3 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">{s.removedGone}</p> : null}

        {lines.length === 0 ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted">{s.cartEmpty}</p>
            <Link href={`/s/${slug}/catalog`} className="text-sm font-semibold text-blue hover:text-blue-2">
              {s.keepShopping} →
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-5">
            <section className="space-y-3 lg:col-span-2">
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {shown.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 p-3">
                    <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-background">
                      {l.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.photoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted">
                          <Storefront size={20} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{l.description}</p>
                      <p className="font-mono text-xs text-muted">{l.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-foreground">{formatMoney(l.price)}</p>
                      <button
                        type="button"
                        onClick={() => removeFromCart(slug, l.id)}
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-danger"
                      >
                        <Trash size={12} /> {s.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 rounded-xl border border-border bg-card p-4 text-sm">
                <Row label={s.subtotal} value={formatMoney(subtotal)} />
                {fulfillment === 'ship' ? (
                  <Row label={s.shipping} value={shipping > 0 ? formatMoney(shipping) : s.shippingFree} />
                ) : null}
                <Row label={s.tax} value={s.taxAtPayment} muted />
                <Row label={s.total} value={formatMoney(subtotal + shipping)} strong />
              </dl>
              <p className="text-xs text-muted">{s.oneOfAKind}</p>
            </section>

            <form onSubmit={pay} className="space-y-5 rounded-xl border border-border bg-card p-5 lg:col-span-3">
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-foreground">{s.contact}</legend>
                {input('name', s.name, { auto: 'name' })}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {input('email', s.email, { type: 'email', auto: 'email' })}
                  {input('phone', s.phone, { type: 'tel', required: false, auto: 'tel' })}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-foreground">{s.fulfillment}</legend>
                {store.pickupEnabled ? (
                  <Choice checked={fulfillment === 'pickup'} onChange={() => setFulfillment('pickup')} title={s.pickup} help={s.pickupHelp} />
                ) : null}
                {store.shipEnabled ? (
                  <Choice
                    checked={fulfillment === 'ship'}
                    onChange={() => setFulfillment('ship')}
                    title={s.ship}
                    help={store.shipFreeOver != null ? s.shipHelp.replace('{amount}', formatMoney(store.shipFreeOver)) : ''}
                  />
                ) : null}
              </fieldset>

              {fulfillment === 'ship' ? (
                <fieldset className="space-y-3">
                  {input('line1', s.address1, { field: 'address.line1', auto: 'address-line1' })}
                  {input('line2', s.address2, { field: 'address.line2', required: false, auto: 'address-line2' })}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {input('city', s.city, { field: 'address.city', auto: 'address-level2' })}
                    {input('state', s.state, { field: 'address.state', auto: 'address-level1' })}
                    {input('postal', s.postal, { field: 'address.postal', auto: 'postal-code' })}
                  </div>
                </fieldset>
              ) : null}

              {error ? <p className="text-sm text-danger">{error}</p> : null}

              <button
                type="submit"
                disabled={paying}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
              >
                <LockSimple size={16} weight="bold" />
                {paying ? s.paying : s.pay}
              </button>
              <p className="text-xs text-muted">{s.payNote}</p>
            </form>
          </div>
        )}
      </main>
      <StoreFooter tenant={tenant} />
    </>
  )
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold text-foreground' : 'text-muted'}>{label}</dt>
      <dd className={`${strong ? 'font-mono text-base font-bold text-foreground' : muted ? 'text-xs text-muted' : 'font-mono text-foreground'}`}>
        {value}
      </dd>
    </div>
  )
}

function Choice({ checked, onChange, title, help }: { checked: boolean; onChange: () => void; title: string; help: string }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? 'border-blue bg-blue/5' : 'border-border'}`}
    >
      <input type="radio" checked={checked} onChange={onChange} className="mt-1" />
      <span>
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {help ? <span className="block text-xs text-muted">{help}</span> : null}
      </span>
    </label>
  )
}
