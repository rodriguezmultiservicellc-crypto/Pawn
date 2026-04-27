'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import {
  InventoryFormFields,
  emptyInventoryItem,
} from '@/components/inventory/InventoryFormFields'
import {
  createInventoryItemAction,
  type CreateInventoryItemState,
} from './actions'

export default function NewInventoryItemForm() {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    CreateInventoryItemState,
    FormData
  >(createInventoryItemAction, {})

  const fieldError = (key: string) => state.fieldErrors?.[key]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.inventory.new}</h1>
        <Link
          href="/inventory"
          className="text-sm text-ash hover:text-ink"
        >
          {t.inventory.backToList}
        </Link>
      </div>

      {state.error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {state.error}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        <InventoryFormFields
          initial={emptyInventoryItem()}
          fieldError={fieldError}
        />

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/inventory"
            className="rounded-md border border-hairline px-4 py-2 text-sm text-ink"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rausch px-4 py-2 text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
          >
            {pending ? t.common.creating : t.inventory.submitCreate}
          </button>
        </div>
      </form>
    </div>
  )
}
