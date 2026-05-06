'use client'

import { useState, useTransition } from 'react'
import { useI18n } from '@/lib/i18n/context'
import type { EbayListingFormat } from '@/types/database-aliases'

export type ListingDraftFormValues = {
  title: string
  condition_id: string
  category_id: string
  format: EbayListingFormat
  list_price: string
  currency: string
  quantity: string
  description: string
  marketing_message: string | null
  photo_urls: string[]
}

export type ListingDraftFormProps = {
  initial: ListingDraftFormValues
  /** Inventory item photos available for selection. Already signed URLs. */
  photoChoices: Array<{ id: string; url: string; is_primary: boolean }>
  /** Server action invoked on submit. Returns { ok, error?, listingId? }. */
  saveAction: (
    form: FormData,
  ) => Promise<{ ok: true; listingId: string } | { ok: false; error: string }>
  /** Optional publish action — only shown when a draft exists. */
  publishAction?: () => Promise<{ ok: true } | { ok: false; error: string }>
  /** Optional end action — only shown when status='active'. */
  endAction?: () => Promise<{ ok: true } | { ok: false; error: string }>
  /** Optional sync action — only shown when status='active'. */
  syncAction?: () => Promise<{ ok: true } | { ok: false; error: string }>
  status?:
    | 'draft'
    | 'submitting'
    | 'active'
    | 'ended'
    | 'sold'
    | 'error'
  ebayListingUrl?: string | null
  errorText?: string | null
}

export function ListingDraftForm(props: ListingDraftFormProps) {
  const { t } = useI18n()
  const { initial, photoChoices } = props
  const [pending, startTransition] = useTransition()
  const [actionMessage, setActionMessage] = useState<{
    kind: 'ok' | 'error'
    text: string
  } | null>(null)

  const [selectedPhotos, setSelectedPhotos] = useState<string[]>(
    initial.photo_urls,
  )

  function togglePhoto(url: string) {
    setSelectedPhotos((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    )
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setActionMessage(null)
    const fd = new FormData(e.currentTarget)
    fd.set('photo_urls', JSON.stringify(selectedPhotos))
    startTransition(async () => {
      const res = await props.saveAction(fd)
      if (res.ok) {
        setActionMessage({ kind: 'ok', text: t.common.save + ' ✓' })
      } else {
        setActionMessage({ kind: 'error', text: res.error })
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t.ebay.formTitle}</h3>
          <p className="text-xs text-muted">{t.ebay.formHelp}</p>
        </div>
        {props.ebayListingUrl ? (
          <a
            href={props.ebayListingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-gold hover:underline"
          >
            {t.ebay.viewOnEbay} ↗
          </a>
        ) : null}
      </div>

      {props.errorText ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {props.errorText}
        </div>
      ) : null}

      {actionMessage ? (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            actionMessage.kind === 'ok'
              ? 'border-success/30 bg-success/5 text-success'
              : 'border-danger/30 bg-danger/5 text-danger'
          }`}
        >
          {actionMessage.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t.ebay.title} name="title" defaultValue={initial.title} />
        <Field
          label={t.ebay.categoryId}
          name="category_id"
          defaultValue={initial.category_id}
          help={t.ebay.categoryIdHelp}
        />
        <Field
          label={t.ebay.conditionId}
          name="condition_id"
          defaultValue={initial.condition_id}
          help={t.ebay.conditionIdHelp}
        />
        <SelectField
          label={t.ebay.format}
          name="format"
          defaultValue={initial.format}
          options={[
            { value: 'FIXED_PRICE', label: t.ebay.formatFixed },
            { value: 'AUCTION', label: t.ebay.formatAuction },
          ]}
        />
        <Field
          label={t.ebay.listPrice}
          name="list_price"
          type="number"
          step="0.0001"
          min="0"
          defaultValue={initial.list_price}
        />
        <Field
          label={t.ebay.currency}
          name="currency"
          defaultValue={initial.currency}
        />
        <Field
          label={t.ebay.quantity}
          name="quantity"
          type="number"
          min="1"
          defaultValue={initial.quantity}
        />
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-muted">
          {t.ebay.description}
        </label>
        <textarea
          name="description"
          defaultValue={initial.description}
          rows={6}
          className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        />
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-muted">
          {t.ebay.marketingMessage}
        </label>
        <input
          name="marketing_message"
          defaultValue={initial.marketing_message ?? ''}
          className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        />
      </div>

      <fieldset className="rounded-md border border-border bg-background p-3">
        <legend className="px-1 text-xs font-semibold text-foreground">
          {t.ebay.photos}
        </legend>
        <p className="text-xs text-muted">{t.ebay.photosHelp}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photoChoices.length === 0 ? (
            <div className="col-span-full text-xs text-muted">
              {t.ebay.photosEmpty}
            </div>
          ) : null}
          {photoChoices.map((p) => {
            const checked = selectedPhotos.includes(p.url)
            return (
              <label
                key={p.id}
                className={`relative block aspect-square cursor-pointer overflow-hidden rounded-md border ${
                  checked ? 'border-gold ring-2 ring-gold/30' : 'border-border'
                } bg-card`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => togglePhoto(p.url)}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {p.is_primary ? (
                  <span className="absolute left-1 top-1 rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-medium text-navy">
                    1°
                  </span>
                ) : null}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {props.status === 'active' && props.syncAction ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setActionMessage(null)
              startTransition(async () => {
                const res = await props.syncAction!()
                if (!res.ok) {
                  setActionMessage({ kind: 'error', text: res.error })
                } else {
                  setActionMessage({ kind: 'ok', text: t.ebay.syncedToast })
                }
              })
            }}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground disabled:opacity-50"
          >
            {t.ebay.syncNow}
          </button>
        ) : null}

        {props.status === 'active' && props.endAction ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm(t.ebay.confirmEnd)) return
              setActionMessage(null)
              startTransition(async () => {
                const res = await props.endAction!()
                if (!res.ok) {
                  setActionMessage({ kind: 'error', text: res.error })
                } else {
                  setActionMessage({ kind: 'ok', text: t.ebay.endedToast })
                }
              })
            }}
            className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {t.ebay.endListing}
          </button>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground disabled:opacity-50"
        >
          {pending ? t.common.saving : t.common.save}
        </button>

        {(props.status === 'draft' || props.status === 'error') &&
        props.publishAction ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setActionMessage(null)
              startTransition(async () => {
                const res = await props.publishAction!()
                if (!res.ok) {
                  setActionMessage({ kind: 'error', text: res.error })
                } else {
                  setActionMessage({ kind: 'ok', text: t.ebay.publishedToast })
                }
              })
            }}
            className="rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
          >
            {t.ebay.publish}
          </button>
        ) : null}
      </div>
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  step,
  min,
  help,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  step?: string
  min?: string
  help?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        step={step}
        min={min}
        className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
      />
      {help ? <span className="mt-0.5 block text-[11px] text-muted">{help}</span> : null}
    </label>
  )
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string
  name: string
  defaultValue?: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
