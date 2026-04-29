import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getCtx } from '@/lib/supabase/ctx'
import { I18nProvider } from '@/lib/i18n/context'
import { isLanguage } from '@/lib/i18n/config'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalChrome } from '@/components/portal/PortalChrome'

/**
 * Customer portal route group. tenantRole='client' only.
 *
 * Defense-in-depth gating — proxy already redirects non-client tenantRole
 * away. We additionally resolve the customer's row via auth_user_id (added
 * in patches/0009-customer-portal.sql) so the chrome can render their name
 * and the active tenant.
 */
export default async function PortalLayout({
  children,
}: {
  children: ReactNode
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/portal/login')
  if (ctx.tenantRole !== 'client') redirect('/no-tenant')

  const admin = createAdminClient()

  // customers.auth_user_id ships in 0009 — cast eq() so TS doesn't flag it
  // before db:types regenerates.
  type PortalCustomer = {
    id: string
    tenant_id: string
    first_name: string | null
    last_name: string | null
    language: string | null
  }
  const customerLookup = await admin
    .from('customers')
    .select('id, tenant_id, first_name, last_name, language')
    .eq('auth_user_id', ctx.userId)
    .is('deleted_at', null)
    .maybeSingle()
  const customer = (customerLookup.data ?? null) as PortalCustomer | null

  if (!customer) redirect('/no-tenant')

  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, dba')
    .eq('id', customer.tenant_id)
    .maybeSingle()

  if (!tenant) redirect('/no-tenant')

  const { data: profile } = await ctx.supabase
    .from('profiles')
    .select('language, full_name')
    .eq('id', ctx.userId)
    .maybeSingle()

  const initialLang = isLanguage(profile?.language)
    ? profile.language
    : isLanguage(customer.language)
    ? customer.language
    : 'en'

  const customerName =
    customer.first_name || customer.last_name
      ? [customer.first_name, customer.last_name].filter(Boolean).join(' ')
      : profile?.full_name ?? null

  return (
    <I18nProvider initialLang={initialLang}>
      <div className="flex min-h-screen flex-col bg-cloud">
        <PortalChrome
          tenantName={tenant.dba ?? tenant.name}
          customerName={customerName}
        />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 pb-24 sm:pb-6">
          {children}
        </main>
      </div>
    </I18nProvider>
  )
}
