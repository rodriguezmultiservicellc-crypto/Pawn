'use client'

import { useI18n } from '@/lib/i18n/context'
import type { PublicStore, PublicTenant } from '@/lib/tenant-resolver'
import { StoreFooter, StoreHeader } from '@/components/store/StoreChrome'

export default function PoliciesContent({ tenant, store }: { tenant: PublicTenant; store: PublicStore | null }) {
  const { t, lang } = useI18n()
  const s = t.store
  // The shopper's language first, the other one if the shop wrote only that.
  const pick = (p: { en: string | null; es: string | null } | undefined) =>
    (lang === 'es' ? p?.es || p?.en : p?.en || p?.es) || s.noPolicy

  return (
    <>
      <StoreHeader tenant={tenant} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8">
        <h1 className="font-display text-2xl font-bold text-foreground">{s.policies}</h1>
        <section className="space-y-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">{s.returnPolicy}</h2>
          <p className="whitespace-pre-line text-sm text-foreground">{pick(store?.returnPolicy)}</p>
        </section>
        <section className="space-y-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">{s.shippingPolicy}</h2>
          <p className="whitespace-pre-line text-sm text-foreground">{pick(store?.shippingPolicy)}</p>
        </section>
      </main>
      <StoreFooter tenant={tenant} />
    </>
  )
}
