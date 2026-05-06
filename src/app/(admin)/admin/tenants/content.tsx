'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import type { TenantType } from '@/types/database-aliases'

export type TenantRow = {
  id: string
  name: string
  dba: string | null
  tenant_type: TenantType
  has_pawn: boolean
  has_repair: boolean
  has_retail: boolean
  parent_tenant_id: string | null
  is_active: boolean
  created_at: string
}

type FlashCreated = {
  tenantId: string
  licenseKey: string
  tenantName: string
}

export default function TenantsContent({
  tenants,
  flash,
}: {
  tenants: TenantRow[]
  flash: FlashCreated | null
}) {
  const { t } = useI18n()

  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  // Build the onboard URL identically on server and client (no `typeof window`
  // branch — that caused a hydration mismatch). NEXT_PUBLIC_APP_URL is
  // inlined at build time, so this resolves to the same string in both
  // render passes.
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const onboardUrl = flash
    ? `${origin}/onboard?token=${encodeURIComponent(flash.licenseKey)}`
    : null

  // POST to /api/tenant/switch then full-page navigate to /dashboard so the
  // new cookie is read by getCtx() on the next request. router.push() doesn't
  // always re-run the proxy + server layout against the new cookie reliably.
  async function openTenant(tenantId: string) {
    setPendingTenantId(tenantId)
    setOpenError(null)
    try {
      const res = await fetch('/api/tenant/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        setOpenError(body?.error ?? 'switch_failed')
        setPendingTenantId(null)
        return
      }
      window.location.assign('/dashboard')
    } catch {
      setOpenError('network_error')
      setPendingTenantId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.admin.tenants.title}</h1>
        <Link
          href="/admin/tenants/new"
          className="rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2"
        >
          {t.admin.tenants.newTenant}
        </Link>
      </div>

      {flash ? (
        <div className="rounded-lg border border-success/40 bg-success/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-success">
                {t.admin.newTenant.successTitle} — {flash.tenantName}
              </div>
              <p className="mt-1 text-sm text-foreground/90">
                {t.admin.newTenant.successBody}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openTenant(flash.tenantId)}
              disabled={pendingTenantId === flash.tenantId}
              className="shrink-0 rounded-md bg-navy px-3 py-1.5 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {pendingTenantId === flash.tenantId
                ? t.common.opening
                : t.common.open}
            </button>
          </div>
          <div className="mt-3 rounded-md bg-card border border-border p-3 font-mono text-xs break-all">
            {onboardUrl}
          </div>
        </div>
      ) : null}

      {openError ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {openError}
        </div>
      ) : null}

      {tenants.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted">{t.admin.tenants.empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t.admin.newTenant.name}</th>
                <th className="px-4 py-3 font-medium">
                  {t.admin.tenants.tenantType}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.admin.tenants.modules}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.admin.tenants.created}
                </th>
                <th className="px-4 py-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((tn) => (
                <tr key={tn.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{tn.name}</div>
                    {tn.dba ? (
                      <div className="text-xs text-muted">{tn.dba}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {tn.tenant_type === 'chain_hq'
                      ? t.admin.tenants.typeChainHq
                      : tn.tenant_type === 'shop'
                      ? t.admin.tenants.typeShop
                      : t.admin.tenants.typeStandalone}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <div className="flex flex-wrap gap-1">
                      {tn.has_pawn ? (
                        <ModuleChip label={t.admin.tenants.pawn} />
                      ) : null}
                      {tn.has_repair ? (
                        <ModuleChip label={t.admin.tenants.repair} />
                      ) : null}
                      {tn.has_retail ? (
                        <ModuleChip label={t.admin.tenants.retail} />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(tn.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openTenant(tn.id)}
                      disabled={pendingTenantId === tn.id}
                      className="rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                    >
                      {pendingTenantId === tn.id
                        ? t.common.opening
                        : t.common.open}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ModuleChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground">
      {label}
    </span>
  )
}
