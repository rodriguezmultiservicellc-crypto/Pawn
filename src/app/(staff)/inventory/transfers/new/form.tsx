'use client'

import { useActionState, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowsLeftRight,
  Image as ImageIcon,
  Info,
  Package,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  createTransferAction,
  type CreateTransferState,
} from './actions'
import type { InventoryCategory } from '@/types/database-aliases'

export type SiblingTenant = {
  id: string
  label: string
}

export type TransferableItem = {
  id: string
  sku: string
  description: string
  category: InventoryCategory
  brand: string | null
  model: string | null
  list_price: number | null
  cost_basis: number | null
  thumb_url: string | null
}

export default function NewTransferForm({
  noSiblings,
  siblings,
  availableItems,
}: {
  noSiblings: boolean
  siblings: SiblingTenant[]
  availableItems: TransferableItem[]
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    CreateTransferState,
    FormData
  >(createTransferAction, {})

  const [destination, setDestination] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState<string>('')

  const selectedTotal = useMemo(() => {
    let sum = 0
    for (const item of availableItems) {
      if (selected.has(item.id)) {
        const v = item.list_price ?? item.cost_basis ?? 0
        sum += v
      }
    }
    return sum
  }, [availableItems, selected])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === availableItems.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(availableItems.map((i) => i.id)))
    }
  }

  if (noSiblings) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {t.inventory.transfers.new.title}
          </h1>
          <Link
            href="/inventory/transfers"
            className="text-sm text-muted hover:text-foreground"
          >
            {t.inventory.transfers.new.backToList}
          </Link>
        </div>
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-6">
          <div className="flex items-start gap-3">
            <Info size={18} weight="regular" className="mt-0.5 text-warning" />
            <p className="text-sm text-foreground">
              {t.inventory.transfers.new.noSiblings}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (availableItems.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {t.inventory.transfers.new.title}
          </h1>
          <Link
            href="/inventory/transfers"
            className="text-sm text-muted hover:text-foreground"
          >
            {t.inventory.transfers.new.backToList}
          </Link>
        </div>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Package
            size={28}
            weight="regular"
            className="mx-auto mb-3 text-muted"
          />
          <p className="text-sm text-muted">
            {t.inventory.transfers.new.noAvailableItems}
          </p>
        </div>
      </div>
    )
  }

  const allChecked =
    selected.size === availableItems.length && availableItems.length > 0
  const fieldError = (key: string) => state.fieldErrors?.[key]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowsLeftRight size={22} weight="regular" className="text-muted" />
          <h1 className="text-2xl font-bold">
            {t.inventory.transfers.new.title}
          </h1>
        </div>
        <Link
          href="/inventory/transfers"
          className="text-sm text-muted hover:text-foreground"
        >
          {t.inventory.transfers.new.backToList}
        </Link>
      </div>

      {state.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <label
            htmlFor="destination_tenant_id"
            className="block text-sm font-medium text-foreground"
          >
            {t.inventory.transfers.new.destinationShop}
          </label>
          <select
            id="destination_tenant_id"
            name="destination_tenant_id"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          >
            <option value="">
              {t.inventory.transfers.new.destinationPlaceholder}
            </option>
            {siblings.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {fieldError('destination_tenant_id') ? (
            <p className="mt-1 text-xs text-danger">
              {fieldError('destination_tenant_id')}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {t.inventory.transfers.new.selectItems}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {t.inventory.transfers.new.selectItemsHelp}
              </p>
            </div>
            <div className="text-xs text-muted">
              {selected.size} / {availableItems.length}
              {selectedTotal > 0 ? (
                <span className="ml-3 font-mono text-foreground">
                  {formatMoney(selectedTotal)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-border text-gold focus:ring-blue/10"
                    />
                  </th>
                  <th className="w-14 px-3 py-3" aria-label="thumbnail" />
                  <th className="px-4 py-3 font-medium">
                    {t.inventory.skuColumn}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t.inventory.descriptionColumn}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t.inventory.categoryColumn}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t.inventory.priceColumn}
                  </th>
                </tr>
              </thead>
              <tbody>
                {availableItems.map((item) => {
                  const checked = selected.has(item.id)
                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-border last:border-0 ${
                        checked ? 'bg-background/60' : ''
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          name="item_ids"
                          value={item.id}
                          checked={checked}
                          onChange={() => toggle(item.id)}
                          className="h-4 w-4 rounded border-border text-gold focus:ring-blue/10"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative h-10 w-10 overflow-hidden rounded-md border border-border bg-background">
                          {item.thumb_url ? (
                            <Image
                              src={item.thumb_url}
                              alt=""
                              fill
                              sizes="40px"
                              unoptimized
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted">
                              <ImageIcon size={16} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {item.sku}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">
                          {item.description}
                        </div>
                        {item.brand || item.model ? (
                          <div className="text-xs text-muted">
                            {[item.brand, item.model]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-foreground">{item.category}</td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {item.list_price != null
                          ? formatMoney(item.list_price)
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {fieldError('item_ids') ? (
            <p className="border-t border-border px-5 py-2 text-xs text-danger">
              {fieldError('item_ids')}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <label htmlFor="notes" className="block text-sm font-medium text-foreground">
            {t.inventory.transfers.new.notes}{' '}
            <span className="text-muted">({t.common.optional})</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t.inventory.transfers.new.notesPlaceholder}
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/inventory/transfers"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending || selected.size === 0 || !destination}
            className="rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
          >
            {selected.size === 0
              ? t.inventory.transfers.new.submitZero
              : pending
              ? t.common.creating
              : t.inventory.transfers.new.submitWithCount.replace(
                  '{count}',
                  String(selected.size),
                )}
          </button>
        </div>
      </form>
    </div>
  )
}

function formatMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
