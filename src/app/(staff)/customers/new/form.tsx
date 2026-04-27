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
import {
  createCustomerAction,
  type CreateCustomerState,
} from './actions'

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

  // Defaults reload via key-bump when a scan completes; CustomerFormFields
  // uses uncontrolled defaultValue inputs, so a remount is the simplest way
  // to push the parsed values into the DOM.
  const [initial, setInitial] = useState<CustomerFieldValues>(() =>
    emptyCustomer(),
  )
  const [scanCount, setScanCount] = useState(0)
  const [autoFilledFlash, setAutoFilledFlash] = useState(false)
  // Raw AAMVA payload from the most recent scan. Carried in a hidden field
  // so a future schema upgrade (customers.dl_raw_payload TEXT) can capture
  // it without changing the scanner UI. The server action ignores it for
  // now — wire it in when the column lands.
  const [rawPayload, setRawPayload] = useState('')

  function handleScanResult(info: DLInfo, raw: string) {
    setInitial((cur) => mergeScanIntoCustomer(cur, info))
    setRawPayload(raw)
    setScanCount((c) => c + 1)
    setAutoFilledFlash(true)
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

      <form action={formAction} className="space-y-6">
        <CustomerFormFields
          key={scanCount}
          initial={initial}
          fieldError={fieldError}
          hasPawn={hasPawn}
        />

        {/* Reserved for the optional dl_raw_payload column upgrade. */}
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
