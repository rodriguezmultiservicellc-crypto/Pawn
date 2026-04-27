'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import {
  CustomerFormFields,
  emptyCustomer,
} from '@/components/customers/CustomerFormFields'
import {
  createCustomerAction,
  createCustomerInitialState,
  type CreateCustomerState,
} from './actions'

export default function NewCustomerForm({
  hasPawn = false,
}: {
  hasPawn?: boolean
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    CreateCustomerState,
    FormData
  >(createCustomerAction, createCustomerInitialState)

  const fieldError = (key: string) => state.fieldErrors?.[key]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.customers.new}</h1>
        <Link
          href="/customers"
          className="text-sm text-ash hover:text-ink"
        >
          {t.customers.backToList}
        </Link>
      </div>

      {state.error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {state.error}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        <CustomerFormFields
          initial={emptyCustomer()}
          fieldError={fieldError}
          hasPawn={hasPawn}
        />

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
