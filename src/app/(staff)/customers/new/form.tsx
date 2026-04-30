'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import {
  CustomerFormFields,
  emptyCustomer,
  type CustomerFieldValues,
} from '@/components/customers/CustomerFormFields'
import DlScanner from '@/components/customers/DlScanner'
import { parseHeightInches, type DLInfo } from '@/lib/dl-parser'
import type { CommPreference, IdDocumentType, Language } from '@/types/database-aliases'
import {
  createCustomerAction,
  type CreateCustomerState,
} from './actions'

/**
 * Map a flat string-only echo from a server-action error response back
 * into CustomerFieldValues. The action echoes whatever the user typed
 * (raw FormData strings) so we can repopulate uncontrolled inputs after
 * React 19's auto-form-reset.
 */
function echoToFieldValues(
  echo: Record<string, string>,
  fallback: CustomerFieldValues,
): CustomerFieldValues {
  const s = (k: string): string | null => {
    const v = echo[k]
    return v == null || v === '' ? null : v
  }
  const num = (k: string): number | null => {
    const v = echo[k]
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    ...fallback,
    first_name: echo.first_name ?? '',
    last_name: echo.last_name ?? '',
    middle_name: s('middle_name'),
    date_of_birth: s('date_of_birth'),
    phone: s('phone'),
    phone_alt: s('phone_alt'),
    email: s('email'),
    address1: s('address1'),
    address2: s('address2'),
    city: s('city'),
    state: s('state'),
    zip: s('zip'),
    country: echo.country || 'US',
    id_type: (s('id_type') as IdDocumentType | null) ?? null,
    id_number: s('id_number'),
    id_state: s('id_state'),
    id_country: echo.id_country || 'US',
    id_expiry: s('id_expiry'),
    comm_preference: (echo.comm_preference || 'sms') as CommPreference,
    language: (echo.language || 'en') as Language,
    marketing_opt_in: echo.marketing_opt_in === 'on',
    height_inches: num('height_inches'),
    weight_lbs: num('weight_lbs'),
    sex: s('sex'),
    hair_color: s('hair_color'),
    eye_color: s('eye_color'),
    identifying_marks: s('identifying_marks'),
    place_of_employment: s('place_of_employment'),
    notes: s('notes'),
    tags:
      typeof echo.tags === 'string' && echo.tags.trim() !== ''
        ? echo.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
  }
}

/**
 * Map a parsed AAMVA payload into our customer field shape. The PDF417
 * barcode is a US/Canada driver-license format, so we force id_type =
 * 'drivers_license' and id_country = 'US' on a successful scan. The
 * license-issuing state is mirrored into both the mailing-address state
 * and id_state since AAMVA encodes the same value for both — the
 * scanner-fill is best-effort and the operator can correct anything that
 * looks wrong before saving.
 */
function mergeScanIntoCustomer(
  current: CustomerFieldValues,
  info: DLInfo,
): CustomerFieldValues {
  const next: CustomerFieldValues = { ...current }
  if (info.firstName) next.first_name = info.firstName
  if (info.middleName) next.middle_name = info.middleName
  if (info.lastName) next.last_name = info.lastName
  if (info.dob) next.date_of_birth = info.dob
  if (info.gender) next.sex = info.gender
  if (info.licenseNumber) next.id_number = info.licenseNumber
  if (info.expirationDate) next.id_expiry = info.expirationDate
  if (info.address) next.address1 = info.address
  if (info.city) next.city = info.city
  if (info.state) {
    next.state = info.state
    next.id_state = info.state
  }
  if (info.zip) next.zip = info.zip
  const inches = parseHeightInches(info.height)
  if (inches != null) next.height_inches = inches
  // Force these on a successful scan.
  next.id_type = 'drivers_license'
  next.id_country = 'US'
  return next
}

export default function NewCustomerForm({
  hasPawn = false,
}: {
  hasPawn?: boolean
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    CreateCustomerState,
    FormData
  >(createCustomerAction, {})

  // Defaults reload via key-bump when a scan completes OR when the
  // server action returns an error — CustomerFormFields uses uncontrolled
  // defaultValue inputs, so a remount is the simplest way to push new
  // values into the DOM. (React 19 auto-resets <form action={fn}> after
  // submission, which would otherwise wipe the user's typed values on a
  // validation error.)
  const [initial, setInitial] = useState<CustomerFieldValues>(() =>
    emptyCustomer(),
  )
  const [formGen, setFormGen] = useState(0)
  const [autoFilledFlash, setAutoFilledFlash] = useState(false)
  // Raw AAMVA payload from the most recent scan. Carried in a hidden
  // field so the server action can persist it to customers.dl_raw_payload
  // (lands via patches/0025) for compliance audits.
  const [rawPayload, setRawPayload] = useState('')
  // Surfaced when the most recent scan returned an id_expiry that's
  // already past. Operator can still save (some flows accept expired
  // ID with documentation), but the warning ensures it's a deliberate
  // decision, not a missed detail.
  const [expiredAt, setExpiredAt] = useState<string | null>(null)

  // On each new server-action response carrying echoed values,
  // repopulate `initial` and bump the key so CustomerFormFields
  // remounts with the echoed values as new defaults. Compute-during-
  // render pattern per Session 8 — useEffect+setState would trip
  // react-hooks/set-state-in-effect.
  const [lastState, setLastState] = useState(state)
  if (state !== lastState) {
    setLastState(state)
    if (state.values) {
      setInitial((cur) => echoToFieldValues(state.values!, cur))
      setFormGen((g) => g + 1)
    }
  }

  function handleScanResult(info: DLInfo, raw: string) {
    setInitial((cur) => mergeScanIntoCustomer(cur, info))
    setRawPayload(raw)
    setFormGen((g) => g + 1)
    setAutoFilledFlash(true)
    // YYYY-MM-DD lexical compare against today's date string is correct
    // because both are zero-padded ISO and the AAMVA expiry is a calendar
    // date, not a timestamp.
    const today = new Date().toISOString().slice(0, 10)
    if (info.expirationDate && info.expirationDate < today) {
      setExpiredAt(info.expirationDate)
    } else {
      setExpiredAt(null)
    }
  }

  const fieldError = (key: string) => state.fieldErrors?.[key]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.customers.new}</h1>
        <div className="flex items-center gap-2">
          <DlScanner onResult={handleScanResult} />
          <Link
            href="/customers"
            className="text-sm text-ash hover:text-ink"
          >
            {t.customers.backToList}
          </Link>
        </div>
      </div>

      {state.error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {state.error}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      {autoFilledFlash ? (
        <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          {t.dlScanner.autoFilled} ✓
        </div>
      ) : null}

      {expiredAt ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          {t.dlScanner.expiredWarning} ({expiredAt})
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        <CustomerFormFields
          key={formGen}
          initial={initial}
          fieldError={fieldError}
          hasPawn={hasPawn}
        />

        {rawPayload ? (
          <input type="hidden" name="dl_raw_payload" value={rawPayload} />
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/customers"
            className="rounded-md border border-hairline px-4 py-2 text-sm text-ink"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rausch px-4 py-2 text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
          >
            {pending ? t.common.creating : t.customers.submitCreate}
          </button>
        </div>
      </form>
    </div>
  )
}
