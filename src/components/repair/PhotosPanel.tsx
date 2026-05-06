'use client'

import { useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { Image as ImageIcon, Plus, Trash, Upload } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
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

export function PhotosPanel({
  ticketId,
  photos,
  readOnly,
  onUpload,
  onRemove,
  onSetCaption,
}: {
  ticketId: string
  photos: RepairPhotoItem[]
  readOnly?: boolean
  onUpload: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
  onRemove: (
    photoId: string,
  ) => Promise<{ error?: string; ok?: boolean }>
  onSetCaption: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [activeKind, setActiveKind] = useState<RepairPhotoKind>('intake')
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const filtered = photos.filter((p) => p.kind === activeKind)

  function pick() {
    setError(null)
    fileRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    fd.set('kind', activeKind)
    fd.set('file', f)
    startTransition(async () => {
      const res = await onUpload(fd)
      if (res.error) setError(res.error)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ImageIcon size={14} weight="regular" />
          {t.repair.detail.sectionPhotos}
        </h2>
      </header>
      <div className="border-b border-border px-4 pt-3">
        <div className="flex flex-wrap gap-2">
          {KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setActiveKind(k)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                activeKind === k
                  ? 'border-navy/40 bg-background text-foreground'
                  : 'border-border bg-card text-muted hover:bg-background'
              }`}
            >
              {kindLabel(k, t)}
              <span className="ml-2 font-mono text-[10px] text-muted">
                {photos.filter((p) => p.kind === k).length}
              </span>
            </button>
          ))}
        </div>
        {!readOnly ? (
          <div className="mt-3 mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={pick}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-foreground disabled:opacity-50"
            >
              <Upload size={14} weight="bold" />
              {pending ? t.common.uploading : t.repair.actions.addPhoto}
            </button>
            {error ? (
              <span className="text-xs text-danger">{error}</span>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={onFileChange}
              className="sr-only"
            />
          </div>
        ) : (
          <div className="mb-3" />
        )}
      </div>
      {filtered.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted">
          {t.repair.detail.noPhotos}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:grid-cols-3">
          {filtered.map((p) => (
            <PhotoTile
              key={p.id}
              photo={p}
              readOnly={readOnly}
              onRemove={onRemove}
              onSetCaption={onSetCaption}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function PhotoTile({
  photo,
  readOnly,
  onRemove,
  onSetCaption,
}: {
  photo: RepairPhotoItem
  readOnly?: boolean
  onRemove: (
    photoId: string,
  ) => Promise<{ error?: string; ok?: boolean }>
  onSetCaption: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [caption, setCaption] = useState<string>(photo.caption ?? '')

  function remove() {
    startTransition(async () => {
      await onRemove(photo.id)
    })
  }

  function saveCaption() {
    const fd = new FormData()
    fd.set('photo_id', photo.id)
    fd.set('caption', caption)
    startTransition(async () => {
      await onSetCaption(fd)
    })
  }

  const dirty = (caption || '') !== (photo.caption ?? '')

  return (
    <li className="overflow-hidden rounded-md border border-border bg-card">
      <div className="relative aspect-[4/3] w-full bg-background">
        {photo.signed_url ? (
          <Image
            src={photo.signed_url}
            alt={photo.caption ?? ''}
            fill
            sizes="(min-width: 768px) 33vw, 100vw"
            unoptimized
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <ImageIcon size={28} weight="light" />
          </div>
        )}
      </div>
      <div className="space-y-2 p-2">
        {readOnly ? (
          photo.caption ? (
            <div className="text-xs text-foreground">{photo.caption}</div>
          ) : null
        ) : (
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t.inventory.photoCaption}
            className="block w-full rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        )}
        {!readOnly ? (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-0.5 text-[11px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              <Trash size={10} weight="bold" />
              {t.repair.actions.removePhoto}
            </button>
            {dirty ? (
              <button
                type="button"
                onClick={saveCaption}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground hover:border-foreground disabled:opacity-50"
              >
                <Plus size={10} weight="bold" />
                {t.repair.actions.saveCaption}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
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
