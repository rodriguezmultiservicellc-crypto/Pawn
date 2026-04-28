'use client'

import { useState, useTransition } from 'react'
import { useI18n } from '@/lib/i18n/context'
import { ListingDraftForm, type ListingDraftFormValues } from './ListingDraftForm'
import { EbayStatusPill } from './StatusPill'
import type {
  EbayListingFormat,
  EbayListingStatus,
} from '@/types/database-aliases'

export type EbayPanelListing = {
  id: string
  status: EbayListingStatus
  ebay_listing_id: string | null
  ebay_offer_id: string | null
  ebay_sku: string | null
  title: string
  condition_id: string
  category_id: string
  format: EbayListingFormat
  list_price: string
  currency: string
  quantity: number
  description: string
  marketing_message: string | null
  photo_urls: string[]
  view_count: number | null
  watcher_count: number | null
  last_synced_at: string | null
  error_text: string | null
}

export type InventoryEbayPanelProps = {
  inventoryItemId: string
  ebayConnected: boolean
  /** Existing listing draft / live row (or null when none yet). */
  listing: EbayPanelListing | null
  photoChoices: Array<{ id: string; url: string; is_primary: boolean }>
  defaultDraft: ListingDraftFormValues
  /** Server actions (bound by the caller). */
  createDraftAction: (
    form: FormData,
  ) => Promise<{ ok: true; listingId: string } | { ok: false; error: string }>
  updateListingAction: (
    listingId: string,
    form: FormData,
  ) => Promise<{ ok: true; listingId: string } | { ok: false; error: string }>
  publishListingAction: (
    listingId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  endListingAction: (
    listingId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  syncListingAction: (
    listingId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}

export default function InventoryEbayPanel(props: InventoryEbayPanelProps) {
  const { t } = useI18n()
  const [showForm, setShowForm] = useState(props.listing != null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!props.ebayConnected) {
    return (
      <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
        <legend className="px-1 text-sm font-semibold text-ink">
          {t.ebay.panelTitle}
        </legend>
        <p className="mt-2 text-sm text-ash">{t.ebay.notConnected}</p>
        <a
          href="/settings/integrations/ebay"
          className="mt-2 inline-block text-sm font-medium text-rausch hover:underline"
        >
          {t.ebay.connectCta} →
        </a>
      </fieldset>
    )
  }

  const listingUrl =
    props.listing?.ebay_listing_id && !isStubId(props.listing.ebay_listing_id)
      ? `https://www.ebay.com/itm/${props.listing.ebay_listing_id}`
      : null

  // No listing yet → "Create eBay listing" button.
  if (!props.listing && !showForm) {
    return (
      <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
        <legend className="px-1 text-sm font-semibold text-ink">
          {t.ebay.panelTitle}
        </legend>
        <p className="mt-2 text-sm text-ash">{t.ebay.noDraft}</p>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-2 rounded-md bg-rausch px-3 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep"
        >
          {t.ebay.createDraft}
        </button>
      </fieldset>
    )
  }

  const listing = props.listing
  const initial: ListingDraftFormValues =
    listing
      ? {
          title: listing.title,
          condition_id: listing.condition_id,
          category_id: listing.category_id,
          format: listing.format,
          list_price: String(listing.list_price ?? ''),
          currency: listing.currency,
          quantity: String(listing.quantity ?? 1),
          description: listing.description,
          marketing_message: listing.marketing_message,
          photo_urls: listing.photo_urls ?? [],
        }
      : props.defaultDraft

  const saveAction = listing
    ? (form: FormData) => props.updateListingAction(listing.id, form)
    : props.createDraftAction

  return (
    <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
      <legend className="px-1 text-sm font-semibold text-ink">
        {t.ebay.panelTitle}
      </legend>

      {listing ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-ash">
          <EbayStatusPill status={listing.status} />
          {listing.ebay_sku ? (
            <span>
              {t.ebay.sku}: <span className="font-mono">{listing.ebay_sku}</span>
            </span>
          ) : null}
          {listing.view_count != null ? (
            <span>{listing.view_count} {t.ebay.views}</span>
          ) : null}
          {listing.watcher_count != null ? (
            <span>{listing.watcher_count} {t.ebay.watchers}</span>
          ) : null}
          {listing.last_synced_at ? (
            <span>
              {t.ebay.lastSyncedAt}:{' '}
              {new Date(listing.last_synced_at).toLocaleString()}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mb-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {error}
        </div>
      ) : null}

      <ListingDraftForm
        initial={initial}
        photoChoices={props.photoChoices}
        saveAction={async (fd) => {
          fd.set('inventory_item_id', props.inventoryItemId)
          const res = await saveAction(fd)
          return res
        }}
        publishAction={
          listing
            ? async () => {
                setError(null)
                return props.publishListingAction(listing.id)
              }
            : undefined
        }
        endAction={
          listing
            ? async () => {
                setError(null)
                return props.endListingAction(listing.id)
              }
            : undefined
        }
        syncAction={
          listing
            ? async () => {
                setError(null)
                return props.syncListingAction(listing.id)
              }
            : undefined
        }
        status={listing?.status ?? 'draft'}
        ebayListingUrl={listingUrl}
        errorText={listing?.error_text ?? null}
      />

      {/* Discard button — only when creating a brand-new draft and the user
          has clicked "Create eBay listing" but hasn't saved yet. */}
      {!listing && showForm ? (
        <div className="mt-2 text-right">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(() => setShowForm(false))
            }}
            className="text-xs text-ash hover:text-ink"
          >
            {t.common.cancel}
          </button>
        </div>
      ) : null}
    </fieldset>
  )
}

function isStubId(id: string): boolean {
  return id.startsWith('STUB-')
}
