'use client'

import { useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { Image as ImageIcon, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { fitPhotoForUpload } from '@/lib/uploads/fit-photo'
import { PHOTO_ACCEPT } from '@/lib/uploads/mime'
import { FOCUS } from '@/lib/ui/ledger'
import { PhotoViewer } from '@/components/uploads/PhotoViewer'
import type { RepairPhotoKind } from '@/types/database-aliases'

export type RepairPhotoItem = {
  id: string
  storage_path: string
  signed_url: string | null
  kind: RepairPhotoKind
  caption: string | null
  position: number
}

const KIND_ORDER: ReadonlyArray<RepairPhotoKind> = [
  'intake',
  'in_progress',
  'final',
  'reference',
]

/**
 * The ticket's photos, compact, laid out as "Item and work": 112px
 * thumbnails of the chosen kind on the left, `aside` (the item lines) on the
 * right, and under it a chip per kind with its count, `extras` (the stones
 * line) and Add photo. A thumbnail opens the photo big with its caption,
 * Replace and Remove.
 */
export function PhotosPanel({
  ticketId,
  photos,
  readOnly,
  onUpload,
  onRemove,
  onReplace,
  onSetCaption,
  aside,
  extras,
}: {
  ticketId: string
  /** Beside the thumbnails: the item line(s). */
  aside?: React.ReactNode
  /** In the chip row, after the kind chips: the stones line. */
  extras?: React.ReactNode
  photos: RepairPhotoItem[]
  readOnly?: boolean
  onUpload: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
  onRemove: (
    photoId: string,
  ) => Promise<{ error?: string; ok?: boolean }>
  /** FormData: photo_id + file. */
  onReplace: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
  onSetCaption: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  // The photo open in the viewer (its place in this kind's photos), or null.
  const [viewing, setViewing] = useState<number | null>(null)
  const [viewerPending, startViewer] = useTransition()
  const [viewerError, setViewerError] = useState<string | null>(null)
  // Start on the first kind that has photos, so the strip is never empty
  // when the ticket has any.
  const [activeKind, setActiveKind] = useState<RepairPhotoKind>(
    () => KIND_ORDER.find((k) => photos.some((p) => p.kind === k)) ?? 'intake',
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const filtered = photos.filter((p) => p.kind === activeKind)
  const open = viewing != null ? filtered[viewing] ?? null : null

  function pick() {
    setError(null)
    fileRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (!picked) return
    const kind = activeKind
    startTransition(async () => {
      // HEIC becomes JPEG and a big photo shrinks (lib/uploads/fit-photo).
      const f = await fitPhotoForUpload(picked)
      const fd = new FormData()
      fd.set('ticket_id', ticketId)
      fd.set('kind', kind)
      fd.set('file', f)
      const res = await onUpload(fd)
      if (res.error) setError(res.error)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  const thumbs =
    filtered.length === 0 ? (
      readOnly ? null : (
        <button
          type="button"
          onClick={pick}
          disabled={pending}
          title={t.repair.actions.addPhoto}
          aria-label={t.repair.actions.addPhoto}
          className={`flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background text-xs font-semibold text-text-secondary hover:border-blue hover:text-blue disabled:opacity-50 ${FOCUS}`}
        >
          <ImageIcon size={26} weight="light" />
          {pending ? t.common.uploading : t.repair.detail.noPhotos}
        </button>
      )
    ) : (
      <ul className="flex max-w-[232px] shrink-0 flex-wrap gap-2">
        {filtered.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => {
                setViewerError(null)
                setViewing(i)
              }}
              title={p.caption || t.common.photoStrip.view}
              aria-label={p.caption || t.common.photoStrip.view}
              className={`relative block h-28 w-28 cursor-zoom-in overflow-hidden rounded-md border border-border bg-background ${FOCUS}`}
            >
              {p.signed_url ? (
                <Image src={p.signed_url} alt="" fill sizes="112px" unoptimized className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted">
                  <ImageIcon size={28} weight="light" />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    )

  return (
    <div className="flex flex-wrap gap-4">
      {thumbs}
      <div className="min-w-0 flex-[1_1_280px]">
        {aside}
        <div className={`flex flex-wrap items-center gap-2 ${aside ? 'mt-3' : ''}`}>
          {KIND_ORDER.map((k) => {
            const on = activeKind === k
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => setActiveKind(k)}
                className={`rounded-full border px-2.5 py-0.5 text-[13px] font-semibold transition-colors ${FOCUS} ${
                  on
                    ? 'border-navy bg-navy text-white'
                    : 'border-border bg-background text-text-secondary hover:border-navy/40'
                }`}
              >
                {kindLabel(k, t)}
                <span className={`ml-1.5 font-mono text-[11px] ${on ? 'text-white/80' : ''}`}>
                  {photos.filter((p) => p.kind === k).length}
                </span>
              </button>
            )
          })}
          {!readOnly ? (
            <>
              <button
                type="button"
                onClick={pick}
                disabled={pending}
                className={`inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-bold text-blue hover:underline disabled:opacity-50 ${FOCUS}`}
              >
                <Plus size={14} weight="bold" />
                {pending ? t.common.uploading : t.repair.actions.addPhoto}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={PHOTO_ACCEPT}
                onChange={onFileChange}
                className="sr-only"
                tabIndex={-1}
              />
            </>
          ) : null}
          {extras}
        </div>
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>

      <PhotoViewer
        photos={filtered.map((p) => ({ path: p.id, url: p.signed_url, name: p.caption ?? '' }))}
        index={viewing}
        onIndex={setViewing}
        noMain
        below={
          open ? (
            readOnly ? (
              open.caption ? <p className="text-sm text-foreground">{open.caption}</p> : null
            ) : (
              <CaptionField key={open.id} photo={open} onSetCaption={onSetCaption} />
            )
          ) : null
        }
        edit={
          readOnly
            ? undefined
            : {
                busy: viewerPending,
                error: viewerError,
                accept: PHOTO_ACCEPT,
                onRemove: (id, i) =>
                  startViewer(async () => {
                    const res = await onRemove(id)
                    if (res.error) return setViewerError(res.error)
                    const left = filtered.length - 1
                    setViewing(left === 0 ? null : Math.min(i, left - 1))
                  }),
                onReplace: (id, picked) =>
                  startViewer(async () => {
                    setViewerError(null)
                    const fd = new FormData()
                    fd.set('photo_id', id)
                    fd.set('file', await fitPhotoForUpload(picked))
                    const res = await onReplace(fd)
                    if (res.error) setViewerError(res.error)
                  }),
              }
        }
      />
    </div>
  )
}

/** The open photo's caption: type, then Save caption. */
function CaptionField({
  photo,
  onSetCaption,
}: {
  photo: RepairPhotoItem
  onSetCaption: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [caption, setCaption] = useState<string>(photo.caption ?? '')
  const dirty = caption !== (photo.caption ?? '')

  function save() {
    const fd = new FormData()
    fd.set('photo_id', photo.id)
    fd.set('caption', caption)
    startTransition(async () => {
      await onSetCaption(fd)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && dirty) {
            e.preventDefault()
            save()
          }
        }}
        placeholder={t.inventory.photoCaption}
        aria-label={t.inventory.photoCaption}
        className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty}
        className={`inline-flex min-h-10 items-center rounded-md border border-border bg-card px-3 text-sm font-bold text-foreground hover:bg-background disabled:opacity-50 ${FOCUS}`}
      >
        {t.repair.actions.saveCaption}
      </button>
    </div>
  )
}

function kindLabel(
  kind: RepairPhotoKind,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (kind) {
    case 'intake':
      return t.repair.detail.photoTabIntake
    case 'in_progress':
      return t.repair.detail.photoTabInProgress
    case 'final':
      return t.repair.detail.photoTabFinal
    case 'reference':
      return t.repair.detail.photoTabReference
  }
}
