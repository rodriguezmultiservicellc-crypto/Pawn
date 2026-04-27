'use client'

import { useActionState, useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowLeft,
  Image as ImageIcon,
  Plus,
  Star,
  StarFour,
  Trash,
  Upload,
  X,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  InventoryFormFields,
  type InventoryFieldValues,
} from '@/components/inventory/InventoryFormFields'
import {
  addInventoryStoneAction,
  deleteInventoryItemAction,
  deleteInventoryPhotoAction,
  deleteInventoryStoneAction,
  makePhotoPrimaryAction,
  updateInventoryItemAction,
  uploadInventoryPhotoAction,
  type UpdateInventoryItemState,
} from './actions'
import type {
  InventoryCategory,
  InventoryLocation,
  InventorySource,
  InventoryStatus,
  MetalType,
} from '@/types/database-aliases'

export type InventoryPhotoItem = {
  id: string
  mime_type: string | null
  position: number
  is_primary: boolean
  caption: string | null
  created_at: string
  signed_url: string | null
}

export type InventoryStoneItem = {
  id: string
  count: number
  stone_type: string | null
  cut: string | null
  carat: number | null
  is_total_carat: boolean
  color: string | null
  clarity: string | null
  certificate: string | null
  position: number
  notes: string | null
}

type ItemRecord = {
  id: string
  tenant_id: string
  sku: string
  sku_number: number
  description: string
  category: InventoryCategory
  brand: string | null
  model: string | null
  serial_number: string | null
  metal: MetalType | null
  karat: string | null
  weight_grams: number | string | null
  weight_dwt: number | string | null
  cost_basis: number | string
  list_price: number | string | null
  sale_price: number | string | null
  sold_at: string | null
  source: InventorySource
  source_vendor: string | null
  acquired_at: string
  acquired_cost: number | string | null
  hold_until: string | null
  location: InventoryLocation
  status: InventoryStatus
  notes: string | null
  staff_memo: string | null
  tags: string[] | null
  created_at: string
  updated_at: string
}

function asFieldStr(v: number | string | null | undefined): string | null {
  if (v == null) return null
  return typeof v === 'string' ? v : String(v)
}

export default function InventoryDetail({
  item,
  photos,
  stones,
}: {
  item: ItemRecord
  photos: InventoryPhotoItem[]
  stones: InventoryStoneItem[]
}) {
  const { t } = useI18n()

  const [state, formAction, pending] = useActionState<
    UpdateInventoryItemState,
    FormData
  >(updateInventoryItemAction, {})

  const fieldError = (key: string) => state.fieldErrors?.[key]

  const initial: InventoryFieldValues = {
    sku: item.sku,
    description: item.description,
    category: item.category,
    brand: item.brand,
    model: item.model,
    serial_number: item.serial_number,
    metal: item.metal,
    karat: item.karat,
    weight_grams: asFieldStr(item.weight_grams),
    weight_dwt: asFieldStr(item.weight_dwt),
    cost_basis: asFieldStr(item.cost_basis) ?? '0',
    list_price: asFieldStr(item.list_price),
    sale_price: asFieldStr(item.sale_price),
    source: item.source,
    source_vendor: item.source_vendor,
    acquired_at: item.acquired_at,
    acquired_cost: asFieldStr(item.acquired_cost),
    hold_until: item.hold_until,
    location: item.location,
    status: item.status,
    notes: item.notes,
    staff_memo: item.staff_memo,
    tags: item.tags ?? [],
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.inventory.backToList}
        </Link>
        <span className="font-mono text-xs text-ash">{item.sku}</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{item.description}</h1>
      </div>

      <PhotosPanel itemId={item.id} photos={photos} />

      {state.error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {state.error}
        </div>
      ) : null}
      {state.ok ? (
        <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          {t.common.save} ✓
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="id" value={item.id} />
        <input
          type="hidden"
          name="__current_sold_at"
          value={item.sold_at ?? ''}
        />
        <InventoryFormFields
          initial={initial}
          fieldError={fieldError}
          isEdit
        />

        <div className="flex items-center justify-end gap-3">
          <DeleteItemButton itemId={item.id} status={item.status} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rausch px-4 py-2 text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
          >
            {pending ? t.common.saving : t.inventory.submitUpdate}
          </button>
        </div>
      </form>

      <StonesPanel itemId={item.id} stones={stones} />
    </div>
  )
}

function PhotosPanel({
  itemId,
  photos,
}: {
  itemId: string
  photos: InventoryPhotoItem[]
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onPick() {
    setError(null)
    ref.current?.click()
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.set('item_id', itemId)
    fd.set('file', file)
    startTransition(async () => {
      const res = await uploadInventoryPhotoAction(fd)
      if (res.error) setError(res.error)
      if (ref.current) ref.current.value = ''
    })
  }

  return (
    <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
      <legend className="px-1 text-sm font-semibold text-ink">
        {t.inventory.sectionPhotos}
      </legend>
      <div className="mt-2 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((p) => (
            <PhotoTile key={p.id} itemId={itemId} photo={p} />
          ))}
          <button
            type="button"
            onClick={onPick}
            disabled={pending}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-hairline bg-canvas text-sm font-medium text-ink hover:border-ink disabled:opacity-50"
          >
            <Upload size={20} weight="bold" />
            <span>{pending ? t.common.uploading : t.inventory.addPhoto}</span>
          </button>
          <input
            ref={ref}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={onChange}
            className="sr-only"
          />
        </div>
        {error ? <div className="text-xs text-error">{error}</div> : null}
      </div>
    </fieldset>
  )
}

function PhotoTile({
  itemId,
  photo,
}: {
  itemId: string
  photo: InventoryPhotoItem
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()

  function makePrimary() {
    const fd = new FormData()
    fd.set('photo_id', photo.id)
    fd.set('item_id', itemId)
    startTransition(() => {
      makePhotoPrimaryAction(fd)
    })
  }
  function remove() {
    const fd = new FormData()
    fd.set('photo_id', photo.id)
    fd.set('item_id', itemId)
    startTransition(() => {
      deleteInventoryPhotoAction(fd)
    })
  }

  return (
    <div className="relative aspect-square overflow-hidden rounded-md border border-hairline bg-cloud">
      {photo.signed_url ? (
        <Image
          src={photo.signed_url}
          alt={photo.caption ?? ''}
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
          unoptimized
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ash">
          <ImageIcon size={24} />
        </div>
      )}
      {photo.is_primary ? (
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-rausch px-2 py-0.5 text-xs font-medium text-canvas">
          <StarFour size={10} weight="fill" />
          {t.inventory.primary}
        </span>
      ) : null}
      <div className="absolute right-1 top-1 flex flex-col gap-1">
        {!photo.is_primary ? (
          <button
            type="button"
            onClick={makePrimary}
            disabled={pending}
            className="rounded-md bg-canvas/90 p-1 text-ink hover:bg-canvas disabled:opacity-50"
            title={t.inventory.makePrimary}
          >
            <Star size={14} weight="bold" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-md bg-canvas/90 p-1 text-error hover:bg-canvas disabled:opacity-50"
          title={t.common.remove}
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </div>
  )
}

function StonesPanel({
  itemId,
  stones,
}: {
  itemId: string
  stones: InventoryStoneItem[]
}) {
  const { t } = useI18n()

  return (
    <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
      <legend className="px-1 text-sm font-semibold text-ink">
        {t.inventory.sectionStones}
      </legend>
      <div className="mt-2 space-y-3">
        {stones.length === 0 ? (
          <p className="text-sm text-ash">—</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-md border border-hairline">
            {stones.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1 grid grid-cols-2 gap-x-3 md:grid-cols-6">
                  <Cell label={t.inventory.stoneCount} value={String(s.count)} />
                  <Cell
                    label={t.inventory.stoneType}
                    value={s.stone_type ?? '—'}
                  />
                  <Cell label={t.inventory.stoneCut} value={s.cut ?? '—'} />
                  <Cell
                    label={
                      s.is_total_carat
                        ? t.inventory.stoneIsTotalCarat
                        : t.inventory.stoneCarat
                    }
                    value={s.carat == null ? '—' : String(s.carat)}
                  />
                  <Cell
                    label={t.inventory.stoneColor}
                    value={s.color ?? '—'}
                  />
                  <Cell
                    label={t.inventory.stoneClarity}
                    value={s.clarity ?? '—'}
                  />
                </div>
                <DeleteStoneButton stoneId={s.id} itemId={itemId} />
              </li>
            ))}
          </ul>
        )}
        <AddStoneForm itemId={itemId} />
      </div>
    </fieldset>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-ash">{label}</div>
      <div className="truncate text-ink">{value}</div>
    </div>
  )
}

function DeleteStoneButton({
  stoneId,
  itemId,
}: {
  stoneId: string
  itemId: string
}) {
  const [pending, startTransition] = useTransition()
  function onClick() {
    const fd = new FormData()
    fd.set('stone_id', stoneId)
    fd.set('item_id', itemId)
    startTransition(() => {
      deleteInventoryStoneAction(fd)
    })
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="shrink-0 rounded-md border border-hairline bg-canvas px-2 py-1 text-xs text-ash hover:text-error disabled:opacity-50"
      aria-label="delete"
    >
      <Trash size={12} weight="bold" />
    </button>
  )
}

function AddStoneForm({ itemId }: { itemId: string }) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set('item_id', itemId)
    startTransition(async () => {
      const res = await addInventoryStoneAction(fd)
      if (res.error) {
        setError(res.error)
      } else {
        formRef.current?.reset()
      }
    })
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="grid grid-cols-2 gap-2 rounded-md border border-dashed border-hairline bg-cloud p-3 md:grid-cols-7"
    >
      <SmallField
        label={t.inventory.stoneCount}
        name="count"
        type="number"
        defaultValue="1"
        min="1"
      />
      <SmallField label={t.inventory.stoneType} name="stone_type" />
      <SmallField label={t.inventory.stoneCut} name="cut" />
      <SmallField
        label={t.inventory.stoneCarat}
        name="carat"
        type="number"
        step="0.0001"
      />
      <SmallField label={t.inventory.stoneColor} name="color" />
      <SmallField label={t.inventory.stoneClarity} name="clarity" />
      <div className="col-span-2 flex items-end justify-between gap-2 md:col-span-1">
        <label className="flex items-center gap-1 text-xs text-ink">
          <input
            type="checkbox"
            name="is_total_carat"
            value="on"
            className="h-3 w-3 rounded border-hairline"
          />
          {t.inventory.stoneIsTotalCarat}
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-ink px-2 py-1 text-xs text-canvas hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={10} weight="bold" />
          {pending ? t.common.saving : t.inventory.addStone}
        </button>
      </div>
      {error ? (
        <div className="col-span-full text-xs text-error">{error}</div>
      ) : null}
    </form>
  )
}

function SmallField({
  label,
  name,
  type = 'text',
  defaultValue,
  step,
  min,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  step?: string
  min?: string
}) {
  return (
    <label className="block space-y-0.5">
      <span className="block text-[10px] uppercase tracking-wide text-ash">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        step={step}
        min={min}
        className="block w-full rounded border border-hairline bg-canvas px-2 py-1 text-sm text-ink focus:border-ink focus:outline-none"
      />
    </label>
  )
}

function DeleteItemButton({
  itemId,
  status,
}: {
  itemId: string
  status: InventoryStatus
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()

  if (status === 'sold') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-hairline bg-cloud px-3 py-2 text-sm text-ash"
        title={t.inventory.deleteBlockedSold}
      >
        <Trash size={14} weight="bold" />
        {t.common.delete}
      </span>
    )
  }

  function onClick() {
    if (!confirm(t.inventory.confirmDelete)) return
    const fd = new FormData()
    fd.set('id', itemId)
    startTransition(() => {
      deleteInventoryItemAction(fd)
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm font-medium text-error hover:bg-error/10 disabled:opacity-50"
    >
      <Trash size={14} weight="bold" />
      {pending ? t.common.saving : t.common.delete}
    </button>
  )
}
