'use client'

import Link from 'next/link'
import { Storefront } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { PublicTenant } from '@/lib/tenant-resolver'
import LanguageToggle from '@/app/(public)/s/[slug]/LanguageToggle'
import { CartLink } from './CartButtons'

/** Header + footer for the store pages that have no catalog chrome of their own. */
export function StoreHeader({ tenant }: { tenant: PublicTenant }) {
  const display = tenant.dba ?? tenant.name
  const slug = tenant.public_slug ?? ''
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href={`/s/${slug}`} className="flex items-center gap-3">
          {tenant.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.logo_url} alt="" className="h-9 w-9 rounded-md object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold text-navy">
              <Storefront size={18} weight="bold" />
            </div>
          )}
          <span className="text-base font-semibold tracking-[-0.01em] text-foreground">{display}</span>
        </Link>
        <div className="flex items-center gap-3">
          {slug ? <CartLink slug={slug} /> : null}
          <LanguageToggle />
        </div>
      </div>
    </header>
  )
}

export function StoreFooter({ tenant }: { tenant: PublicTenant }) {
  const { t } = useI18n()
  return (
    <footer className="border-t border-border py-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-muted">
        <span>
          © {new Date().getFullYear()} {tenant.name}
        </span>
        <Link href={`/s/${tenant.public_slug}/policies`} className="hover:text-foreground">
          {t.store.policies}
        </Link>
        <span>{t.landing.poweredBy}</span>
      </div>
    </footer>
  )
}
