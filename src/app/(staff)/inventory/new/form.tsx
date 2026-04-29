'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import {
  InventoryFormFields,
  emptyInventoryItem,
  type InventoryFieldValues,
} from '@/components/inventory/InventoryFormFields'
import type {
  InventoryCategory,
  InventoryLocation,
  InventorySource,
  InventoryStatus,
  MetalType,
} from '@/types/database-aliases'
import {
  createInventoryItemAction,
  type CreateInventoryItemState,
} from './actions'

/**
 * Map a flat string-only echo from a server-action error response back
 * into InventoryFieldValues so the form's uncontrolled inputs can be
 * repopulated after React 19's auto-form-reset.
 */
function echoToFieldValues(
  echo: Record<string, string>,
  fallback: InventoryFieldValues,
): InventoryFieldValues {
  const s = (k: string): string | null => {
    const v = echo[k]
    return v == null || v === '' ? null : v
  }
  return {
    ...fallback,
    sku: s('sku'),
    description: echo.description ?? '',
    category: ((echo.category || 'other') as InventoryCategory),
    brand: s('brand'),
    model: s('model'),
    serial_number: s('serial_number'),
    metal: (s('metal') as MetalType | null) ?? null,
    karat: s('karat'),
    weight_grams: s('weight_grams'),
    weight_dwt: s('weight_dwt'),
    cost_basis: echo.cost_basis ?? '0',
    list_price: s('list_price'),
    sale_price: fallback.sale_price,
    source: ((echo.source || 'bought') as InventorySource),
    source_vendor: s('source_vendor'),
    acquired_at:
      echo.acquired_at && echo.acquired_at.trim() !== ''
        ? echo.acquired_at
        : fallback.acquired_at,
    acquired_cost: s('acquired_cost'),
    hold_until: s('hold_until'),
    location: ((echo.location || 'case') as InventoryLocation),
    status: ((echo.status || 'available') as InventoryStatus),
    notes: s('notes'),
    staff_memo: s('staff_memo'),
    tags:
      typeof echo.tags === 'string' && echo.tags.trim() !== ''
        ? echo.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
  }
}

export default function NewInventoryItemForm() {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    CreateInventoryItemState,
    FormData
  >(createInventoryItemAction, {})

  // Form-reset workaround: React 19 auto-resets <form action={fn}> after
  // submission. On validation error we bump a key + repopulate from the
  // echoed FormData so the user's typed values aren't wiped. Uses the
  // official "compute state during render based on prev state" pattern
  // (avoids react-hooks/set-state-in-effect + react-hooks/refs).
  const baseInitial = emptyInventoryItem()
  const initial: InventoryFieldValues = state.values
    ? echoToFieldValues(state.values, baseInitial)
    : baseInitial
  const [lastState, setLastState] = useState(state)
  const [formGen, setFormGen] = useState(0)
  if (state !== lastState) {
    setLastState(state)
    if (state.values) setFormGen((g) => g + 1)
  }

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
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        <InventoryFormFields
          key={formGen}
          initial={initial}
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
