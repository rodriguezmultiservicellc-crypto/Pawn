'use client'

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

  const onboardUrl =
    flash && typeof window !== 'undefined'
      ? `${window.location.origin}/onboard?token=${encodeURIComponent(flash.licenseKey)}`
      : flash
      ? `/onboard?token=${flash.licenseKey}`
      : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.admin.tenants.title}</h1>
        <Link
          href="/admin/tenants/new"
          className="rounded-md bg-rausch px-4 py-2 text-canvas font-medium hover:bg-rausch-deep"
        >
          {t.admin.tenants.newTenant}
        </Link>
      </div>

      {flash ? (
        <div className="rounded-lg border border-success/40 bg-success/5 p-4">
          <div className="text-sm font-semibold text-success">
            {t.admin.newTenant.successTitle} — {flash.tenantName}
          </div>
          <p className="mt-1 text-sm text-ink/90">
            {t.admin.newTenant.successBody}
          </p>
          <div className="mt-3 rounded-md bg-canvas border border-hairline p-3 font-mono text-xs break-all">
            {onboardUrl}
          </div>
        </div>
      ) : null}

      {tenants.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-canvas p-12 text-center">
          <p className="text-ash">{t.admin.tenants.empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-canvas">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hairline text-ash">
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
              </tr>
            </thead>
            <tbody>
              {tenants.map((tn) => (
                <tr key={tn.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{tn.name}</div>
                    {tn.dba ? (
                      <div className="text-xs text-ash">{tn.dba}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {tn.tenant_type === 'chain_hq'
                      ? t.admin.tenants.typeChainHq
                      : tn.tenant_type === 'shop'
                      ? t.admin.tenants.typeShop
                      : t.admin.tenants.typeStandalone}
                  </td>
                  <td className="px-4 py-3 text-ink">
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
                  <td className="px-4 py-3 text-ash">
                    {new Date(tn.created_at).toLocaleDateString()}
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
    <span className="rounded-full border border-hairline bg-cloud px-2 py-0.5 text-xs text-ink">
      {label}
    </span>
  )
}
