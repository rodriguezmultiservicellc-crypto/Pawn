'use client'

import Image from 'next/image'
import { Image as ImageIcon } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { FOCUS } from '@/lib/ui/ledger'

/**
 * A 48px table thumbnail of an item's main photo, "+N" when it has more.
 * A click opens the PhotoViewer (the caller owns it). No photo: a
 * placeholder, nothing to click.
 */
export function ItemPhotoThumb({
  urls,
  onOpen,
}: {
  /** Signed URLs, main first. */
  urls: string[]
  onOpen: () => void
}) {
  const { t } = useI18n()
  if (!urls[0]) {
    return (
      <span className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-background text-muted">
        <ImageIcon size={16} />
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t.common.photoStrip.view}
      aria-label={t.common.photoStrip.view}
      className={`relative block h-12 w-12 cursor-zoom-in overflow-hidden rounded-md border border-border bg-background ${FOCUS}`}
    >
      <Image src={urls[0]} alt="" fill sizes="48px" unoptimized className="object-cover" />
      {urls.length > 1 ? (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-navy/80 px-1 font-mono text-[9px] text-white">
          +{urls.length - 1}
        </span>
      ) : null}
    </button>
  )
}
