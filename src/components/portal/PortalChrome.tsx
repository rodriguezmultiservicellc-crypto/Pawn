'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Coins,
  Wrench,
  Tag,
  SignOut,
  Translate,
  User,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { createClient } from '@/lib/supabase/client'

/**
 * Portal chrome — top bar (tenant name + lang toggle + sign-out) and a
 * mobile bottom nav (Loans / Repairs / Layaways). Renders inside the
 * (portal)/layout.tsx server component, between I18nProvider and {children}.
 */
export function PortalChrome({
  tenantName,
  customerName,
}: {
  tenantName: string
  customerName: string | null
}) {
  const { t, lang, setLang } = useI18n()
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    // Hard nav so the proxy sees the cleared cookie. Customers land
    // back on the portal sign-in page, not the staff /login.
    window.location.assign('/portal/login')
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/portal/loans" className="flex flex-col leading-tight">
            <span className="font-display text-lg font-bold text-navy">
              {tenantName}
            </span>
            {customerName ? (
              <span className="truncate text-xs text-muted">{customerName}</span>
            ) : null}
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-background hover:text-foreground"
              aria-label={t.lang.toggle}
            >
              <Translate size={16} weight="regular" />
              <span>{lang === 'en' ? 'ES' : 'EN'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSignOut()
                router.refresh()
              }}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-background hover:text-foreground"
            >
              <SignOut size={16} weight="regular" />
              <span className="hidden sm:inline">
                {t.portal.common.signOut}
              </span>
            </button>
          </div>
        </div>
        {/* Tablet/desktop secondary nav */}
        <nav className="hidden border-t border-border bg-card sm:block">
          <div className="mx-auto flex max-w-4xl items-center gap-2 px-4">
            <PortalTopLink
              href="/portal/loans"
              label={t.portal.nav.loans}
              icon={<Coins size={16} weight="regular" />}
              active={pathname.startsWith('/portal/loans')}
            />
            <PortalTopLink
              href="/portal/repairs"
              label={t.portal.nav.repairs}
              icon={<Wrench size={16} weight="regular" />}
              active={pathname.startsWith('/portal/repairs')}
            />
            <PortalTopLink
              href="/portal/layaways"
              label={t.portal.nav.layaways}
              icon={<Tag size={16} weight="regular" />}
              active={pathname.startsWith('/portal/layaways')}
            />
            <PortalTopLink
              href="/portal/account"
              label={t.portal.nav.account}
              icon={<User size={16} weight="regular" />}
              active={pathname.startsWith('/portal/account')}
            />
          </div>
        </nav>
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card sm:hidden">
        <div className="mx-auto flex max-w-4xl items-stretch">
          <PortalBottomLink
            href="/portal/loans"
            label={t.portal.nav.loans}
            icon={<Coins size={20} weight="regular" />}
            active={pathname.startsWith('/portal/loans')}
          />
          <PortalBottomLink
            href="/portal/repairs"
            label={t.portal.nav.repairs}
            icon={<Wrench size={20} weight="regular" />}
            active={pathname.startsWith('/portal/repairs')}
          />
          <PortalBottomLink
            href="/portal/layaways"
            label={t.portal.nav.layaways}
            icon={<Tag size={20} weight="regular" />}
            active={pathname.startsWith('/portal/layaways')}
          />
          <PortalBottomLink
            href="/portal/account"
            label={t.portal.nav.account}
            icon={<User size={20} weight="regular" />}
            active={pathname.startsWith('/portal/account')}
          />
        </div>
      </nav>
    </>
  )
}

function PortalTopLink({
  href,
  label,
  icon,
  active,
}: {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
        active
          ? 'border-gold font-medium text-foreground'
          : 'border-transparent text-muted hover:text-foreground'
      }`}
    >
      <span className={active ? 'text-gold' : 'text-muted'}>{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

function PortalBottomLink({
  href,
  label,
  icon,
  active,
}: {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-xs transition-colors ${
        active ? 'text-gold' : 'text-muted hover:text-foreground'
      }`}
    >
      <span>{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  )
}
