'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Storefront, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { StoreSettingsInput } from '@/lib/store/settings'
import { saveStoreSettingsAction } from './actions'

const inputCls =
  'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none disabled:opacity-60'

export default function StoreSettingsContent({
  initial,
  canEdit,
  catalogLive,
  stripeConnected,
  storeUrl,
}: {
  initial: StoreSettingsInput
  canEdit: boolean
  catalogLive: boolean
  stripeConnected: boolean
  storeUrl: string | null
}) {
  const { t } = useI18n()
  const s = t.storeSettings
  const [v, setV] = useState(initial)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof StoreSettingsInput>(k: K, val: StoreSettingsInput[K]) => setV((p) => ({ ...p, [k]: val }))

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    start(async () => {
      const r = await saveStoreSettingsAction(v)
      setMsg(r.ok ? { ok: true, text: s.saved } : { ok: false, text: s.errors[r.error] })
    })
  }

  const num = (k: keyof StoreSettingsInput, label: string, help?: string, step = '0.01') => (
    <label className="block space-y-1 text-sm">
      <span className="font-semibold text-foreground">{label}</span>
      <input
        type="number"
        step={step}
        min="0"
        disabled={!canEdit}
        value={String(v[k] ?? '')}
        onChange={(e) => set(k, e.target.value as never)}
        className={`${inputCls} font-mono`}
      />
      {help ? <span className="block text-xs text-muted">{help}</span> : null}
    </label>
  )
  const area = (k: keyof StoreSettingsInput, label: string) => (
    <label className="block space-y-1 text-sm">
      <span className="font-semibold text-foreground">{label}</span>
      <textarea
        rows={4}
        disabled={!canEdit}
        value={String(v[k] ?? '')}
        onChange={(e) => set(k, e.target.value as never)}
        className={inputCls}
      />
    </label>
  )
  const toggle = (k: 'online_checkout_enabled' | 'online_pickup_enabled' | 'online_ship_enabled', label: string, help?: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" disabled={!canEdit} checked={!!v[k]} onChange={(e) => set(k, e.target.checked)} className="mt-1" />
      <span>
        <span className="block font-semibold text-foreground">{label}</span>
        {help ? <span className="block text-xs text-muted">{help}</span> : null}
      </span>
    </label>
  )

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="flex items-center gap-3">
        <Storefront size={28} className="text-gold" />
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{s.title}</h1>
          <p className="text-sm text-muted">{s.subtitle}</p>
        </div>
        {storeUrl ? (
          <Link href={storeUrl} target="_blank" className="ml-auto text-sm text-blue hover:text-blue-2">
            {storeUrl} ↗
          </Link>
        ) : null}
      </div>

      {!catalogLive || !stripeConnected ? (
        <div className="space-y-1 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          {!catalogLive ? <p className="flex items-center gap-2"><Warning size={16} /> {s.needsCatalog}</p> : null}
          {!stripeConnected ? <p className="flex items-center gap-2"><Warning size={16} /> {s.needsStripe}</p> : null}
        </div>
      ) : null}

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        {toggle('online_checkout_enabled', s.checkout, s.checkoutHelp)}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {num('tax_rate_pct', s.taxRate, s.taxHelp, '0.001')}
          {num('online_order_max', s.orderMax, s.orderMaxHelp)}
          {num('online_reservation_minutes', s.reservation, s.reservationHelp, '1')}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        {toggle('online_pickup_enabled', s.pickup)}
        {toggle('online_ship_enabled', s.ship)}
        {v.online_ship_enabled ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {num('ship_flat_rate', s.flatRate)}
            {num('ship_free_over', s.freeOver)}
            {num('ship_signature_over', s.signatureOver)}
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">{s.policies}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {area('store_return_policy_en', s.returnPolicyEn)}
          {area('store_return_policy_es', s.returnPolicyEs)}
          {area('store_shipping_policy_en', s.shippingPolicyEn)}
          {area('store_shipping_policy_es', s.shippingPolicyEs)}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">{s.branding}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block space-y-1 text-sm">
            <span className="font-semibold text-foreground">{s.taglineEn}</span>
            <input maxLength={140} disabled={!canEdit} value={String(v.store_tagline_en ?? '')} onChange={(e) => set('store_tagline_en', e.target.value)} className={inputCls} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-semibold text-foreground">{s.taglineEs}</span>
            <input maxLength={140} disabled={!canEdit} value={String(v.store_tagline_es ?? '')} onChange={(e) => set('store_tagline_es', e.target.value)} className={inputCls} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-semibold text-foreground">{s.accent}</span>
            <span className="flex items-center gap-2">
              <input
                type="color"
                disabled={!canEdit}
                value={String(v.store_accent_color || '#0b1f3a')}
                onChange={(e) => set('store_accent_color', e.target.value)}
                className="h-9 w-12 rounded-md border border-border bg-card"
              />
              <span className="font-mono text-xs text-muted">{String(v.store_accent_color || '—')}</span>
            </span>
          </label>
        </div>
      </section>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-gold px-5 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
          >
            {pending ? s.saving : s.save}
          </button>
          {msg ? <span className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</span> : null}
        </div>
      ) : null}
    </form>
  )
}
