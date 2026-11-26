'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Camera, Star, X } from '@phosphor-icons/react'
import { PhotoViewer } from '@/components/uploads/PhotoViewer'
import { useI18n } from '@/lib/i18n/context'
import { createClient } from '@/lib/supabase/client'
import { fitPhotoForUpload } from '@/lib/uploads/fit-photo'
import {
  INTAKE_PHOTOS_BUCKET,
  INTAKE_PHOTO_MAX,
  intakePhotoPath,
} from '@/lib/uploads/intake-photos'
import {
  PHOTO_ACCEPT as ACCEPT,
  extensionForUpload,
  isBrowserRenderableImage,
  resolveUploadMime,
} from '@/lib/uploads/mime'
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
 *
 * Clicking a photo opens it big in a viewer, where it can be replaced, made
 * the main one or removed.
 */
export function PhotoStrip({
  tenantId,
  name,
  photos,
  onChange,
  label,
  large = false,
}: {
  tenantId: string
  /** The hidden input that carries the paths (JSON). */
  name: string
  photos: StripPhoto[]
  onChange: (photos: StripPhoto[]) => void
  label: string
  /** Big tiles showing the whole photo (the pawn item popup's Photos step). */
  large?: boolean
}) {
  const { t } = useI18n()
  const tp = t.common.photoStrip
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** The photo open in the viewer (its place in the list), or null. */
  const [viewing, setViewing] = useState<number | null>(null)
  // The list as it is now, for uploads that finish one by one.
  const TILE = large ? "h-44" : "h-20"
  const photosNow = useRef(photos)
  useEffect(() => {
    photosNow.current = photos
  })

  useEffect(() => {
    busyRef.current?.setCustomValidity(uploading > 0 ? t.common.preparingPhoto : '')
  }, [uploading, t.common.preparingPhoto])

  /** Fits one picked file and uploads it to the shop's intake folder. */
  async function uploadOne(picked: File): Promise<StripPhoto> {
    const file = await fitPhotoForUpload(picked)
    const mime = resolveUploadMime(file)
    const path = intakePhotoPath(tenantId, extensionForUpload(mime, file.name))
    const { error: upErr } = await createClient()
      .storage.from(INTAKE_PHOTOS_BUCKET)
      .upload(path, file, { contentType: mime, upsert: false })
    if (upErr) throw upErr
    return {
      path,
      url: isBrowserRenderableImage(mime) ? URL.createObjectURL(file) : null,
      name: file.name,
    }
  }

  async function addFiles(files: File[]) {
    setError(null)
    const room = INTAKE_PHOTO_MAX - photosNow.current.length
    if (files.length > room) setError(tp.max.replace('{n}', String(INTAKE_PHOTO_MAX)))
    const take = files.slice(0, Math.max(0, room))
    if (take.length === 0) return
    setUploading((n) => n + take.length)
    for (const picked of take) {
      try {
        const photo = await uploadOne(picked)
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

  /** Puts a new photo in the place of the one at `path` (same position, so
   *  a replaced main photo stays the main one). */
  async function replaceFile(path: string, picked: File) {
    setError(null)
    setUploading((n) => n + 1)
    try {
      const photo = await uploadOne(picked)
      const next = photosNow.current.map((p) => (p.path === path ? photo : p))
      photosNow.current = next
      onChange(next)
    } catch (err) {
      console.error('[photos] replace failed', err)
      setError(tp.failed)
    } finally {
      setUploading((n) => n - 1)
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
      <div className={large ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" : "grid grid-cols-2 gap-2"}>
        {photos.map((p, i) => (
          <div
            key={p.path}
            className={`group relative ${TILE} overflow-hidden rounded-md border border-border bg-background`}
          >
            {/* The whole tile opens the viewer; the corner buttons sit above it. */}
            <button
              type="button"
              onClick={() => setViewing(i)}
              title={tp.view}
              aria-label={tp.view}
              className={`absolute inset-0 h-full w-full cursor-zoom-in ${FOCUS}`}
            >
              {p.url ? (
                <Image src={p.url} alt="" fill sizes={large ? "300px" : "100px"} unoptimized className={large ? "object-contain" : "object-cover"} />
              ) : (
                <span className="flex h-full items-center justify-center break-all px-1 text-center text-[10px] text-foreground">
                  {p.name}
                </span>
              )}
            </button>
            {i === 0 ? (
              <span className="pointer-events-none absolute left-1 top-1 rounded bg-navy/80 px-1 text-[10px] font-semibold text-white">
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
                className={`flex ${TILE} items-center justify-center rounded-md border border-dashed border-border bg-background px-1 text-center text-[10px] text-muted`}
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
            className={`flex ${TILE} flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background text-muted hover:text-foreground ${FOCUS}`}
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
        accept={ACCEPT}
        onChange={(e) => {
          const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : []
          e.currentTarget.value = ''
          void addFiles(files)
        }}
        className="sr-only"
        tabIndex={-1}
      />
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      <PhotoViewer
        photos={photos}
        index={viewing}
        onIndex={setViewing}
        edit={{
          busy: uploading > 0,
          error,
          accept: ACCEPT,
          onMakeMain: (path) => {
            makeMain(path)
            setViewing(0)
          },
          onRemove: (path, i) => {
            remove(path)
            const left = photos.length - 1
            setViewing(left === 0 ? null : Math.min(i, left - 1))
          },
          onReplace: (path, file) => void replaceFile(path, file),
        }}
      />
    </div>
  )
}
