'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  updateGeneralAction,
  type UpdateGeneralState,
} from './actions'

export type TenantGeneralView = {
  id: string
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  has_pawn: boolean
  has_repair: boolean
  has_retail: boolean
  tenant_type: string
  parent_tenant_id: string | null
  police_report_format: string | null
  agency_store_id: string | null
}

export default function GeneralSettingsContent({
  tenant,
}: {
  tenant: TenantGeneralView
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    UpdateGeneralState,
    FormData
  >(updateGeneralAction, {})

  // Echo + remount on validation error — same pattern as the customer/
  // inventory forms (compute during render based on prev state).
  const initial = state.values
    ? { ...defaultsFromTenant(tenant), ...state.values }
    : defaultsFromTenant(tenant)
  const [lastState, setLastState] = useState(state)
  const [formGen, setFormGen] = useState(0)
  if (state !== lastState) {
    setLastState(state)
    if (state.values) setFormGen((g) => g + 1)
  }

  const fe = (k: string) => state.fieldErrors?.[k]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={14} weight="bold" />
          Back to settings
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-ink">Tenant info</h1>
        <p className="mt-1 text-sm text-ash">
          Identity, contact, and compliance settings for this tenant.
          Module flags and police-report format are read-only here —
          they&apos;re set when the tenant is provisioned by the platform
          admin.
        </p>
      </header>

      {state.error ? (
        <div className="flex items-start gap-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          <Warning size={14} weight="bold" />
          <span>{state.error}</span>
        </div>
      ) : null}
      {state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}
      {state.ok ? (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          <CheckCircle size={14} weight="bold" />
          <span>Saved.</span>
        </div>
      ) : null}

      <form action={formAction} key={formGen} className="space-y-6">
        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            Identity
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label="Legal name"
              name="name"
              required
              defaultValue={initial.name}
              error={fe('name')}
            />
            <Field
              label="DBA"
              name="dba"
              defaultValue={initial.dba ?? ''}
              error={fe('dba')}
              hint="Doing-business-as / public name (if different)"
            />
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            Contact
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label="Phone"
              name="phone"
              type="tel"
              defaultValue={initial.phone ?? ''}
              error={fe('phone')}
              autoComplete="tel"
            />
            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={initial.email ?? ''}
              error={fe('email')}
              autoComplete="email"
            />
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            Address
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="md:col-span-6">
              <Field
                label="Street address"
                name="address"
                defaultValue={initial.address ?? ''}
                error={fe('address')}
                autoComplete="street-address"
              />
            </div>
            <div className="md:col-span-3">
              <Field
                label="City"
                name="city"
                defaultValue={initial.city ?? ''}
                error={fe('city')}
                autoComplete="address-level2"
              />
            </div>
            <div className="md:col-span-1">
              <Field
                label="State"
                name="state"
                defaultValue={initial.state ?? ''}
                error={fe('state')}
                autoComplete="address-level1"
                maxLength={2}
                placeholder="FL"
              />
            </div>
            <div className="md:col-span-2">
              <Field
                label="ZIP"
                name="zip"
                defaultValue={initial.zip ?? ''}
                error={fe('zip')}
                autoComplete="postal-code"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            Compliance
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label="Agency store ID"
              name="agency_store_id"
              defaultValue={initial.agency_store_id ?? ''}
              error={fe('agency_store_id')}
              hint="Compliance-agency-assigned store identifier (e.g. LeadsOnline). Falls back to tenant UUID when blank."
              maxLength={64}
            />
            <ReadOnly
              label="Police-report format"
              value={tenant.police_report_format ?? '—'}
            />
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            Modules (read-only)
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ReadOnly label="Tenant type" value={tenant.tenant_type.replace('_', ' ')} />
            <ReadOnly
              label="Modules enabled"
              value={[
                tenant.has_pawn && 'Pawn',
                tenant.has_repair && 'Repair',
                tenant.has_retail && 'Retail',
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            />
            {tenant.parent_tenant_id ? (
              <ReadOnly
                label="Parent (chain HQ)"
                value={tenant.parent_tenant_id}
                mono
              />
            ) : null}
          </div>
          <p className="mt-3 text-xs text-ash">
            To change modules, plan, or police-report format, contact the
            platform admin.
          </p>
        </fieldset>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rausch px-4 py-2.5 font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
          >
            {pending ? t.common.saving : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

function defaultsFromTenant(t: TenantGeneralView): {
  name: string
  dba: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  email: string
  agency_store_id: string
} {
  return {
    name: t.name,
    dba: t.dba ?? '',
    address: t.address ?? '',
    city: t.city ?? '',
    state: t.state ?? '',
    zip: t.zip ?? '',
    phone: t.phone ?? '',
    email: t.email ?? '',
    agency_store_id: t.agency_store_id ?? '',
  }
}

function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  error,
  hint,
  autoComplete,
  maxLength,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
  error?: string
  hint?: string
  autoComplete?: string
  maxLength?: number
  placeholder?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-ink">
        {label}
        {required ? ' *' : null}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
        className={`block w-full rounded-md border bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
          error ? 'border-error/60' : 'border-hairline'
        }`}
      />
      {error ? (
        <span className="block text-xs text-error">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-ash">{hint}</span>
      ) : null}
    </label>
  )
}

function ReadOnly({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="block space-y-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div
        className={`block w-full rounded-md border border-hairline bg-cloud/50 px-3 py-2 text-ash ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value}
      </div>
    </div>
  )
}
