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
  public_slug: string | null
  public_landing_enabled: boolean
  public_about: string | null
  public_hours: unknown
  public_catalog_enabled: boolean
}

const HOURS_DAYS: ReadonlyArray<{
  key: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  label: string
}> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

type HoursDay = { open: string; close: string; closed: boolean }
type HoursMap = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', HoursDay>
>

function hoursFromUnknown(raw: unknown): HoursMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: HoursMap = {}
  for (const { key } of HOURS_DAYS) {
    const v = (raw as Record<string, unknown>)[key]
    if (!v || typeof v !== 'object') continue
    const d = v as Record<string, unknown>
    out[key] = {
      open: typeof d.open === 'string' ? d.open : '',
      close: typeof d.close === 'string' ? d.close : '',
      closed: d.closed === true,
    }
  }
  return out
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
            Public landing page
          </legend>
          <p className="mt-1 px-1 text-xs text-ash">
            Customer-facing landing rendered at{' '}
            <code className="font-mono text-[11px]">/s/&lt;slug&gt;</code> and
            (when wildcard DNS is configured) at
            <code className="font-mono text-[11px]"> &lt;slug&gt;.&lt;domain&gt;</code>.
            Set the slug, then flip Publish to make it live. Leave Publish
            off to reserve a slug without going public.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label="URL slug"
              name="public_slug"
              defaultValue={initial.public_slug ?? ''}
              error={fe('public_slug')}
              hint="3–40 chars, lowercase letters, digits, hyphens. e.g. main-st-pawn"
              maxLength={40}
              autoComplete="off"
            />
            <label className="flex items-center gap-3 self-end pb-2 text-sm">
              <input
                type="checkbox"
                name="public_landing_enabled"
                value="on"
                defaultChecked={tenant.public_landing_enabled}
                className="h-4 w-4 rounded border-hairline text-rausch focus:ring-rausch"
              />
              <span className="font-medium text-ink">Publish landing page</span>
            </label>
            <label className="flex items-start gap-3 self-end pb-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                name="public_catalog_enabled"
                value="on"
                defaultChecked={tenant.public_catalog_enabled}
                disabled={!tenant.has_retail}
                className="mt-0.5 h-4 w-4 rounded border-hairline text-rausch focus:ring-rausch disabled:opacity-50"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">Publish public catalog</span>
                <span className="text-xs text-ash">
                  {tenant.has_retail
                    ? 'Auto-publishes available items with a list price at /s/<slug>/catalog. Per-item Hide flag overrides.'
                    : 'Retail module disabled — catalog unavailable.'}
                </span>
              </span>
            </label>
            <div className="md:col-span-2">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-ink">About</span>
                <textarea
                  name="public_about"
                  defaultValue={initial.public_about ?? ''}
                  rows={4}
                  maxLength={2000}
                  className={`block w-full rounded-md border bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
                    fe('public_about') ? 'border-error/60' : 'border-hairline'
                  }`}
                />
                {fe('public_about') ? (
                  <span className="block text-xs text-error">
                    {fe('public_about')}
                  </span>
                ) : (
                  <span className="block text-xs text-ash">
                    Optional. Plain text shown under the contact info. 2,000
                    characters max.
                  </span>
                )}
              </label>
            </div>
          </div>

          <div className="mt-4">
            <p className="px-1 text-sm font-medium text-ink">Hours</p>
            <p className="mt-1 px-1 text-xs text-ash">
              24-hour format (e.g. 09:00, 18:00). Tick Closed to hide a day.
              Leave blank to render as Closed.
            </p>
            {fe('public_hours') ? (
              <p className="mt-1 px-1 text-xs text-error">
                {fe('public_hours')}
              </p>
            ) : null}
            <div className="mt-2 space-y-1">
              {HOURS_DAYS.map(({ key, label }) => {
                const day = initial.hours_map[key] ?? {
                  open: '',
                  close: '',
                  closed: false,
                }
                return (
                  <div
                    key={key}
                    className="grid grid-cols-12 items-center gap-2 rounded-md border border-hairline px-3 py-2"
                  >
                    <span className="col-span-2 text-sm font-medium text-ink">
                      {label}
                    </span>
                    <input
                      type="time"
                      name={`hours_${key}_open`}
                      defaultValue={day.open}
                      className="col-span-3 rounded-md border border-hairline bg-canvas px-2 py-1 font-mono text-xs text-ink focus:border-ink focus:outline-none"
                    />
                    <span className="col-span-1 text-center text-xs text-ash">
                      –
                    </span>
                    <input
                      type="time"
                      name={`hours_${key}_close`}
                      defaultValue={day.close}
                      className="col-span-3 rounded-md border border-hairline bg-canvas px-2 py-1 font-mono text-xs text-ink focus:border-ink focus:outline-none"
                    />
                    <label className="col-span-3 flex items-center gap-2 text-xs text-ink">
                      <input
                        type="checkbox"
                        name={`hours_${key}_closed`}
                        value="on"
                        defaultChecked={day.closed}
                        className="h-3.5 w-3.5 rounded border-hairline text-rausch focus:ring-rausch"
                      />
                      Closed
                    </label>
                  </div>
                )
              })}
            </div>
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
  public_slug: string
  public_about: string
  hours_map: HoursMap
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
    public_slug: t.public_slug ?? '',
    public_about: t.public_about ?? '',
    hours_map: hoursFromUnknown(t.public_hours),
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
