'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  EnvelopeSimple,
  Phone,
  Storefront,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type {
  PublicCatalogItem,
  PublicTenant,
} from '@/lib/tenant-resolver'
import LanguageToggle from '../../LanguageToggle'

export default function CatalogItemContent({
  tenant,
  item,
}: {
  tenant: PublicTenant
  item: PublicCatalogItem
}) {
  const { t } = useI18n()
  const dict = t.catalog
  const display = tenant.dba ?? tenant.name

  const photos = item.photos ?? []
  const stones = item.stones ?? []
  const [activePhoto, setActivePhoto] = useState(0)
  const photo = photos[activePhoto] ?? null

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href={`/s/${tenant.public_slug}`}
            className="flex items-center gap-3"
          >
            {tenant.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logo_url}
                alt=""
                className="h-9 w-9 rounded-md object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold text-navy">
                <Storefront size={18} weight="bold" />
              </div>
            )}
            <span className="text-base font-semibold tracking-[-0.01em] text-foreground">
              {display}
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href={`/s/${tenant.public_slug}/catalog`}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <ArrowLeft size={12} weight="bold" />
              {dict.backToAll}
            </Link>
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Photos */}
          <div className="space-y-3">
            <div className="aspect-square w-full overflow-hidden rounded-lg bg-background">
              {photo?.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.signed_url}
                  alt={item.description}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted">
                  <Storefront size={64} weight="bold" />
                </div>
              )}
            </div>
            {photos.length > 1 ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setActivePhoto((i) =>
                      i <= 0 ? photos.length - 1 : i - 1,
                    )
                  }
                  className="rounded-full border border-border bg-card p-1.5 hover:bg-background hover:text-foreground/40"
                  aria-label={dict.prevPage}
                >
                  <CaretLeft size={14} weight="bold" />
                </button>
                <div className="flex flex-1 items-center gap-2 overflow-x-auto">
                  {photos.map((p, i) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => setActivePhoto(i)}
                      className={`h-14 w-14 flex-shrink-0 overflow-hidden rounded-md border ${
                        i === activePhoto
                          ? 'border-gold'
                          : 'border-border'
                      }`}
                    >
                      {p.signed_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.signed_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setActivePhoto((i) =>
                      i >= photos.length - 1 ? 0 : i + 1,
                    )
                  }
                  className="rounded-full border border-border bg-card p-1.5 hover:bg-background hover:text-foreground/40"
                  aria-label={dict.nextPage}
                >
                  <CaretRight size={14} weight="bold" />
                </button>
              </div>
            ) : null}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div>
              <span className="rounded-xl border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
                {dict.categories[item.category] ?? item.category}
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              {item.description}
            </h1>
            {item.brand || item.model ? (
              <p className="text-sm text-muted">
                {[item.brand, item.model].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            <p className="font-mono text-3xl font-semibold text-foreground">
              {formatPrice(item.list_price)}
            </p>
            <p className="font-mono text-xs text-muted">
              {dict.specs.sku}: {item.sku}
            </p>

            {/* Spec table */}
            <SpecTable item={item} dict={dict} />

            {/* Stones */}
            {stones.length > 0 ? (
              <StonesTable stones={stones} dict={dict} />
            ) : null}

            {/* CTAs */}
            <div className="space-y-2 pt-2">
              {tenant.phone ? (
                <a
                  href={`tel:${tenant.phone.replace(/\s/g, '')}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gold px-4 py-2.5 text-sm font-medium text-navy hover:bg-gold-2"
                >
                  <Phone size={14} weight="bold" />
                  {dict.inquireByPhone}
                </a>
              ) : null}
              {tenant.email ? (
                <a
                  href={`mailto:${tenant.email}?subject=${encodeURIComponent(
                    `Inquiry: ${item.description} (${item.sku})`,
                  )}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-background hover:text-foreground/40"
                >
                  <EnvelopeSimple size={14} weight="bold" />
                  {dict.inquireByEmail}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 text-xs text-muted">
          <span>
            © {new Date().getFullYear()} {tenant.name}
          </span>
          <span>{t.landing.poweredBy}</span>
        </div>
      </footer>
    </>
  )
}

function SpecTable({
  item,
  dict,
}: {
  item: PublicCatalogItem
  dict: ReturnType<typeof useI18n>['t']['catalog']
}) {
  const rows: Array<[string, string]> = []
  if (item.metal) {
    rows.push([dict.specs.metal, dict.metals[item.metal] ?? item.metal])
  }
  if (item.karat) {
    rows.push([dict.specs.karat, item.karat])
  }
  if (item.weight_grams != null) {
    const dwt =
      item.weight_dwt != null ? ` (${item.weight_dwt}dwt)` : ''
    rows.push([dict.specs.weight, `${item.weight_grams}g${dwt}`])
  }
  if (item.serial_number) {
    rows.push([dict.specs.serialNumber, item.serial_number])
  }
  if (rows.length === 0) return null
  return (
    <dl className="space-y-1.5 rounded-xl border border-border bg-card p-4 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function StonesTable({
  stones,
  dict,
}: {
  stones: NonNullable<PublicCatalogItem['stones']>
  dict: ReturnType<typeof useI18n>['t']['catalog']
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-foreground">{dict.specs.stones}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-background text-muted">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">
                {dict.stonesTable.count}
              </th>
              <th className="px-2 py-1.5 text-left font-medium">
                {dict.stonesTable.type}
              </th>
              <th className="px-2 py-1.5 text-left font-medium">
                {dict.stonesTable.cut}
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                {dict.stonesTable.carat}
              </th>
              <th className="px-2 py-1.5 text-left font-medium">
                {dict.stonesTable.color}
              </th>
              <th className="px-2 py-1.5 text-left font-medium">
                {dict.stonesTable.clarity}
              </th>
            </tr>
          </thead>
          <tbody>
            {stones.map((s, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-2 py-1.5">{s.count}</td>
                <td className="px-2 py-1.5">{s.stone_type ?? '—'}</td>
                <td className="px-2 py-1.5">{s.cut ?? '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {s.carat != null ? (
                    <>
                      {s.carat}
                      {s.is_total_carat ? (
                        <span className="ml-1 text-muted">
                          {dict.stonesTable.totalCarat}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2 py-1.5">{s.color ?? '—'}</td>
                <td className="px-2 py-1.5">{s.clarity ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatPrice(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
