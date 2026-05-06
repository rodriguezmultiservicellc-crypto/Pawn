import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { loadCredentialsRow } from '@/lib/ebay/auth'
import EbaySettingsContent, { type EbayCredentialsView } from './content'

const OWNER_ROLES = new Set(['owner', 'chain_admin', 'manager'])

type SearchParams = Promise<{ success?: string; error?: string }>

export default async function EbayIntegrationsPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !OWNER_ROLES.has(ctx.tenantRole)) {
    redirect('/dashboard')
  }

  const params = await props.searchParams
  const success = params.success === '1'
  const errorParam = params.error ?? null

  const row = await loadCredentialsRow(ctx.tenantId)

  const view: EbayCredentialsView = {
    connected: !!(row?.refresh_token_configured && !row.disconnected_at),
    ebay_user_id: row?.ebay_user_id ?? null,
    environment: row?.environment ?? 'sandbox',
    site_id: row?.site_id ?? 'EBAY_US',
    merchant_location_key: row?.merchant_location_key ?? null,
    fulfillment_policy_id: row?.fulfillment_policy_id ?? null,
    payment_policy_id: row?.payment_policy_id ?? null,
    return_policy_id: row?.return_policy_id ?? null,
    access_token_expires_at: row?.access_token_expires_at ?? null,
    refresh_token_expires_at: row?.refresh_token_expires_at ?? null,
    connected_at: row?.connected_at ?? null,
    disconnected_at: row?.disconnected_at ?? null,
  }

  return (
    <EbaySettingsContent
      view={view}
      success={success}
      errorParam={errorParam}
    />
  )
}
