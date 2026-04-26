'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import {
  createTenantAction,
  type CreateTenantState,
} from './actions'
import type { TenantType } from '@/types/database-aliases'

export type ChainParentOption = { id: string; label: string }

const initialState: CreateTenantState = {}

export default function NewTenantForm({
  parentOptions,
}: {
  parentOptions: ChainParentOption[]
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState(
    createTenantAction,
    initialState,
  )
  const [tenantType, setTenantType] = useState<TenantType>('standalone')

  const fieldError = (key: string) => state.fieldErrors?.[key]

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.admin.newTenant.title}</h1>
        <Link
          href="/admin/tenants"
          className="text-sm text-ash hover:text-ink"
        >
          {t.common.back}
        </Link>
      </div>

      {state.error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {state.error}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6 rounded-lg border border-hairline bg-canvas p-6">
        {/* Identity */}
        <fieldset className="space-y-3">
          <Field
            label={t.admin.newTenant.name}
            name="name"
            required
            error={fieldError('name')}
          />
          <Field
            label={t.admin.newTenant.dba}
            name="dba"
          />
        </fieldset>

        {/* Type + parent */}
        <fieldset className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.admin.newTenant.tenantType}
            </span>
            <select
              name="tenant_type"
              value={tenantType}
              onChange={(e) => setTenantType(e.target.value as TenantType)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            >
              <option value="standalone">
                {t.admin.tenants.typeStandalone}
              </option>
              <option value="chain_hq">{t.admin.tenants.typeChainHq}</option>
              <option value="shop">{t.admin.tenants.typeShop}</option>
            </select>
          </label>

          {tenantType === 'shop' ? (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.admin.newTenant.parent}
              </span>
              <select
                name="parent_tenant_id"
                required
                className={`block w-full rounded-md border bg-canvas px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
                  fieldError('parent_tenant_id')
                    ? 'border-error'
                    : 'border-hairline focus:border-ink'
                }`}
              >
                <option value="">{t.admin.newTenant.noParent}</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {fieldError('parent_tenant_id') ? (
                <span className="text-xs text-error">
                  {t.common.requiredField}
                </span>
              ) : null}
            </label>
          ) : null}
        </fieldset>

        {/* Modules */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">
            {t.admin.newTenant.modules}
          </legend>
          <ModuleCheckbox
            name="has_pawn"
            label={t.admin.newTenant.pawn}
            defaultChecked
          />
          <ModuleCheckbox
            name="has_repair"
            label={t.admin.newTenant.repair}
            defaultChecked
          />
          <ModuleCheckbox
            name="has_retail"
            label={t.admin.newTenant.retail}
            defaultChecked
          />
        </fieldset>

        {/* Compliance */}
        <fieldset>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.admin.newTenant.policeReportFormat}
            </span>
            <select
              name="police_report_format"
              defaultValue="fl_leadsonline"
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            >
              <option value="fl_leadsonline">FL — LeadsOnline</option>
            </select>
          </label>
        </fieldset>

        {/* Address + contact */}
        <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t.admin.newTenant.address} name="address" />
          <Field label={t.admin.newTenant.city} name="city" />
          <Field label={t.admin.newTenant.state} name="state" defaultValue="FL" />
          <Field label={t.admin.newTenant.zip} name="zip" />
          <Field label={t.admin.newTenant.phone} name="phone" />
          <Field label={t.admin.newTenant.email} name="email" type="email" />
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/admin/tenants"
            className="rounded-md border border-hairline px-4 py-2 text-sm text-ink"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rausch px-4 py-2 text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
          >
            {pending ? t.common.saving : t.admin.newTenant.submit}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  name,
  required,
  type = 'text',
  defaultValue,
  error,
}: {
  label: string
  name: string
  required?: boolean
  type?: string
  defaultValue?: string
  error?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        className={`block w-full rounded-md border bg-canvas px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
          error
            ? 'border-error focus:border-error'
            : 'border-hairline focus:border-ink'
        }`}
      />
      {error ? (
        <span className="text-xs text-error">required</span>
      ) : null}
    </label>
  )
}

function ModuleCheckbox({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-hairline text-rausch focus:ring-ink/10"
      />
      <span>{label}</span>
    </label>
  )
}
