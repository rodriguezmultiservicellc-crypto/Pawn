'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Camera, Star, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { createClient } from '@/lib/supabase/client'
import { fitPhotoForUpload } from '@/lib/uploads/fit-photo'
import {
  INTAKE_PHOTOS_BUCKET,
  INTAKE_PHOTO_MAX,
  intakePhotoPath,
} from '@/lib/uploads/intake-photos'
import { extensionForUpload, isBrowserRenderableImage, resolveUploadMime } from '@/lib/uploads/mime'
import { FOCUS } from '@/lib/ui/ledger'

/** A photo of the item: where it is stored, and what to show for it. */
export type StripPhoto = {
  path: string
  /** A preview URL (local or signed); null when the browser cannot paint
   *  it (a HEIC it could not convert) — the name shows instead. */
  url: string | null
  name: string
}

/**
 * The photos of ONE item at intake (pawn ticket collateral, buy outright):
 * up to INTAKE_PHOTO_MAX, the first is the main one.
 *
 * Each photo picked is fitted (HEIC → JPEG, shrunk — lib/uploads/fit-photo)
 * and uploaded straight to the shop's folder in inventory-photos
 * (lib/uploads/intake-photos). The form gets only the list of paths, in the
 * hidden input `name`. While a photo is uploading, a hidden field is
 * invalid, so the item popup's Done and the form's submit wait for it.
 */
export function PhotoStrip({
  tenantId,
  name,
  photos,
  onChange,
  label,
}: {
  tenantId: string
  /** The hidden input that carries the paths (JSON). */
  name: string
  photos: StripPhoto[]
  onChange: (photos: StripPhoto[]) => void
  label: string
}) {
  const { t } = useI18n()
  const tp = t.common.photoStrip
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // The list as it is now, for uploads that finish one by one.
  const photosNow = useRef(photos)
  useEffect(() => {
    photosNow.current = photos
  })

  useEffect(() => {
    busyRef.current?.setCustomValidity(uploading > 0 ? t.common.preparingPhoto : '')
  }, [uploading, t.common.preparingPhoto])

  async function addFiles(files: File[]) {
    setError(null)
    const room = INTAKE_PHOTO_MAX - photosNow.current.length
    if (files.length > room) setError(tp.max.replace('{n}', String(INTAKE_PHOTO_MAX)))
    const take = files.slice(0, Math.max(0, room))
    if (take.length === 0) return
    setUploading((n) => n + take.length)
    const supabase = createClient()
    for (const picked of take) {
      try {
        const file = await fitPhotoForUpload(picked)
        const mime = resolveUploadMime(file)
        const path = intakePhotoPath(tenantId, extensionForUpload(mime, file.name))
        const { error: upErr } = await supabase.storage
          .from(INTAKE_PHOTOS_BUCKET)
          .upload(path, file, { contentType: mime, upsert: false })
        if (upErr) throw upErr
        const photo: StripPhoto = {
          path,
          url: isBrowserRenderableImage(mime) ? URL.createObjectURL(file) : null,
          name: file.name,
        }
        const next = [...photosNow.current, photo]
        photosNow.current = next
        onChange(next)
      } catch (err) {
        console.error('[photos] upload failed', err)
        setError(tp.failed)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  function remove(path: string) {
    onChange(photos.filter((p) => p.path !== path))
  }

  function makeMain(path: string) {
    const p = photos.find((x) => x.path === path)
    if (p) onChange([p, ...photos.filter((x) => x.path !== path)])
  }

  const full = photos.length >= INTAKE_PHOTO_MAX

  return (
    <div>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <input type="hidden" name={name} value={JSON.stringify(photos.map((p) => p.path))} />
      {/* Invalid while a photo uploads: holds Done / submit until it is in. */}
      <input
        ref={busyRef}
        type="text"
        tabIndex={-1}
        aria-hidden
        value=""
        onChange={() => {}}
        className="sr-only"
      />
      <div className="grid grid-cols-2 gap-2">
        {photos.map((p, i) => (
          <div
            key={p.path}
            className="group relative h-20 overflow-hidden rounded-md border border-border bg-background"
          >
            {p.url ? (
              <Image src={p.url} alt="" fill sizes="100px" unoptimized className="object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center break-all px-1 text-center text-[10px] text-foreground">
                {p.name}
              </span>
            )}
            {i === 0 ? (
              <span className="absolute left-1 top-1 rounded bg-navy/80 px-1 text-[10px] font-semibold text-white">
                {tp.main}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => makeMain(p.path)}
                title={tp.makeMain}
                aria-label={tp.makeMain}
                className={`absolute left-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded bg-white/85 text-navy hover:bg-white ${FOCUS}`}
              >
                <Star size={12} weight="bold" />
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(p.path)}
              title={tp.remove}
              aria-label={tp.remove}
              className={`absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded bg-white/85 text-danger hover:bg-white ${FOCUS}`}
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        ))}
        {uploading > 0
          ? Array.from({ length: uploading }, (_, i) => (
              <div
                key={`up-${i}`}
                className="flex h-20 items-center justify-center rounded-md border border-dashed border-border bg-background px-1 text-center text-[10px] text-muted"
              >
                {t.common.preparingPhoto}
              </div>
            ))
          : null}
        {!full ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label={tp.add}
            className={`flex h-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background text-muted hover:text-foreground ${FOCUS}`}
          >
            <Camera size={18} weight="regular" />
            <span className="text-[10px]">{photos.length === 0 ? t.common.upload : tp.add}</span>
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
        onChange={(e) => {
          const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : []
          e.currentTarget.value = ''
          void addFiles(files)
        }}
        className="sr-only"
        tabIndex={-1}
      />
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  )
}
