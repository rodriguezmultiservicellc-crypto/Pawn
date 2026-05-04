'use client'

import Link from 'next/link'
import {
  MapPin,
  Phone,
  EnvelopeSimple,
  Clock,
  Storefront,
  Wrench,
  ShoppingBag,
  ArrowUpRight,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { PublicTenant, PublicHoursDay } from '@/lib/tenant-resolver'
import LanguageToggle from './LanguageToggle'

/**
 * Public landing content. Client component because the language toggle
 * (and any future interactive bits — image carousel, contact form, etc.)
 * live here. Keeps the page.tsx thin and lets us render the toggle and
 * dictionary-driven copy from the same context.
 */
export default function LandingPageContent({
  tenant,
}: {
  tenant: PublicTenant
}) {
  const { t } = useI18n()
  const dict = t.landing
  const display = tenant.dba ?? tenant.name
  const addressLine = formatAddress(tenant)
  const mapLink = addressLine
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${display} ${addressLine}`,
      )}`
    : null

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {tenant.logo_url ? (
              // Operator-supplied URL, possibly off-platform — next/image
              // would require adding the host to remotePatterns. The image
              // is 36×36 so optimization gains are negligible.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logo_url}
                alt=""
                className="h-9 w-9 rounded-md object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-rausch text-canvas">
                <Storefront size={18} weight="bold" />
              </div>
            )}
            <span className="text-base font-semibold tracking-[-0.01em] text-ink">
              {display}
            </span>
          </div>
          <LanguageToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
        {/* Hero */}
        <section className="mb-10 text-center sm:mb-14">
          <h1 className="text-3xl font-bold tracking-[-0.01em] text-ink sm:text-5xl">
            {display}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-ash sm:text-lg">
            {tenant.city && tenant.state
              ? dict.heroWithCity
                  .replace('{city}', tenant.city)
                  .replace('{state}', tenant.state)
              : dict.heroDefault}
          </p>

          <ServiceBadges tenant={tenant} dict={dict} />
        </section>

        {/* Visit + Hours */}
        <section className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardTitle icon={<MapPin size={18} weight="bold" />}>
              {dict.visit}
            </CardTitle>
            <div className="mt-3 space-y-2 text-sm text-ink">
              {addressLine ? (
                <p className="leading-snug">{addressLine}</p>
              ) : (
                <p className="text-ash">{dict.addressUnavailable}</p>
              )}
              {mapLink ? (
                <a
                  href={mapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-info-link hover:underline"
                >
                  {dict.openInMaps}
                  <ArrowUpRight size={14} weight="bold" />
                </a>
              ) : null}
              {tenant.phone ? (
                <p className="flex items-center gap-2 pt-2">
                  <Phone size={14} weight="bold" className="text-ash" />
                  <a
                    href={`tel:${tenant.phone.replace(/\s/g, '')}`}
                    className="font-mono text-sm text-ink hover:underline"
                  >
                    {tenant.phone}
                  </a>
                </p>
              ) : null}
              {tenant.email ? (
                <p className="flex items-center gap-2">
                  <EnvelopeSimple
                    size={14}
                    weight="bold"
                    className="text-ash"
                  />
                  <a
                    href={`mailto:${tenant.email}`}
                    className="text-sm text-ink hover:underline"
                  >
                    {tenant.email}
                  </a>
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardTitle icon={<Clock size={18} weight="bold" />}>
              {dict.hours}
            </CardTitle>
            <HoursList hours={tenant.public_hours} dict={dict} />
          </Card>
        </section>

        {/* About */}
        {tenant.public_about ? (
          <section className="mb-10 rounded-lg border border-hairline bg-canvas p-6">
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">
              {dict.about}
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-charcoal">
              {tenant.public_about}
            </p>
          </section>
        ) : null}

        {/* CTAs */}
        <section className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tenant.has_pawn ? (
            <CTAPlaceholder
              icon={<Storefront size={18} weight="bold" />}
              label={dict.ctas.getQuote}
              hint={dict.ctaSoonHint}
            />
          ) : null}
          {tenant.has_repair ? (
            <CTAPlaceholder
              icon={<Wrench size={18} weight="bold" />}
              label={dict.ctas.dropOffRepair}
              hint={dict.ctaSoonHint}
            />
          ) : null}
          {tenant.has_retail && tenant.public_catalog_enabled ? (
            <Link
              href={`/s/${tenant.public_slug}/catalog`}
              className="inline-flex items-center justify-between gap-2 rounded-lg border border-hairline bg-canvas px-4 py-3 text-sm font-medium text-ink transition hover:bg-cloud"
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-rausch">
                  <ShoppingBag size={18} weight="bold" />
                </span>
                {dict.ctas.shopInventory}
              </span>
              <ArrowUpRight size={14} weight="bold" className="text-ash" />
            </Link>
          ) : tenant.has_retail ? (
            <CTAPlaceholder
              icon={<ShoppingBag size={18} weight="bold" />}
              label={dict.ctas.shopInventory}
              hint={dict.ctaSoonHint}
            />
          ) : null}
          <Link
            href="/portal/login"
            className="inline-flex items-center justify-between gap-2 rounded-lg border border-hairline bg-canvas px-4 py-3 text-sm font-medium text-ink transition hover:bg-cloud"
          >
            <span className="inline-flex items-center gap-2">
              <span className="text-rausch">●</span>
              {dict.ctas.portalLogin}
            </span>
            <ArrowUpRight size={14} weight="bold" className="text-ash" />
          </Link>
        </section>
      </main>

      <footer className="border-t border-hairline py-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 text-xs text-ash sm:flex-row">
          <span>
            © {new Date().getFullYear()} {tenant.name}
          </span>
          <span>{dict.poweredBy}</span>
        </div>
      </footer>
    </>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas p-5">
      {children}
    </div>
  )
}

function CardTitle({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-ink">
      <span className="text-rausch">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

type Badge = { label: string; icon: React.ReactNode }

function ServiceBadges({
  tenant,
  dict,
}: {
  tenant: PublicTenant
  dict: ReturnType<typeof useI18n>['t']['landing']
}) {
  const items: Badge[] = []
  if (tenant.has_pawn) {
    items.push({
      label: dict.services.pawn,
      icon: <Storefront size={12} weight="bold" />,
    })
  }
  if (tenant.has_repair) {
    items.push({
      label: dict.services.repair,
      icon: <Wrench size={12} weight="bold" />,
    })
  }
  if (tenant.has_retail) {
    items.push({
      label: dict.services.retail,
      icon: <ShoppingBag size={12} weight="bold" />,
    })
  }

  if (items.length === 0) return null

  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-cloud px-3 py-1 text-xs font-medium text-ink"
        >
          {it.icon}
          {it.label}
        </span>
      ))}
    </div>
  )
}

const DAYS: Array<keyof NonNullable<PublicTenant['public_hours']>> = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]

function HoursList({
  hours,
  dict,
}: {
  hours: PublicTenant['public_hours']
  dict: ReturnType<typeof useI18n>['t']['landing']
}) {
  if (!hours) {
    return <p className="mt-3 text-sm text-ash">{dict.hoursUnavailable}</p>
  }
  return (
    <dl className="mt-3 space-y-1.5 text-sm">
      {DAYS.map((d) => {
        const day = hours[d]
        return (
          <div key={d} className="flex items-baseline justify-between gap-3">
            <dt className="text-charcoal">{dict.days[d]}</dt>
            <dd className="font-mono text-xs text-ink">
              {formatDay(day, dict)}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function formatDay(
  day: PublicHoursDay | undefined,
  dict: ReturnType<typeof useI18n>['t']['landing'],
): string {
  if (!day || day.closed || !day.open || !day.close) return dict.closed
  return `${day.open} – ${day.close}`
}

function CTAPlaceholder({
  icon,
  label,
  hint,
}: {
  icon: React.ReactNode
  label: string
  hint: string
}) {
  return (
    <div className="rounded-lg border border-hairline bg-cloud/50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-ink">
        <span className="text-rausch">{icon}</span>
        {label}
      </div>
      <p className="mt-1 text-xs text-ash">{hint}</p>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatAddress(t: PublicTenant): string | null {
  const line1 = t.address?.trim() || null
  const cityStateZip = [t.city, t.state, t.zip].filter(Boolean).join(', ')
  const parts = [line1, cityStateZip || null].filter(Boolean) as string[]
  return parts.length > 0 ? parts.join(' · ') : null
}
