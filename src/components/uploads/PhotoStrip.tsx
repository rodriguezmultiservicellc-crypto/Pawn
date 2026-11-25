'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import {
  ArrowsClockwise,
  Camera,
  CaretLeft,
  CaretRight,
  Star,
  Trash,
  X,
} from '@phosphor-icons/react'
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

const ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif'

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
  /** The photo open in the viewer (its place in the list), or null. */
  const [viewing, setViewing] = useState<number | null>(null)
  // The list as it is now, for uploads that finish one by one.
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
  async function replaceFile(path: string, picked: File): Promise<boolean> {
    setError(null)
    setUploading((n) => n + 1)
    try {
      const photo = await uploadOne(picked)
      const next = photosNow.current.map((p) => (p.path === path ? photo : p))
      photosNow.current = next
      onChange(next)
      return true
    } catch (err) {
      console.error('[photos] replace failed', err)
      setError(tp.failed)
      return false
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
      <div className="grid grid-cols-2 gap-2">
        {photos.map((p, i) => (
          <div
            key={p.path}
            className="group relative h-20 overflow-hidden rounded-md border border-border bg-background"
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
                <Image src={p.url} alt="" fill sizes="100px" unoptimized className="object-cover" />
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
        busy={uploading > 0}
        error={error}
        onIndex={setViewing}
        onMakeMain={(path) => {
          makeMain(path)
          setViewing(0)
        }}
        onRemove={(path, i) => {
          remove(path)
          const left = photos.length - 1
          setViewing(left === 0 ? null : Math.min(i, left - 1))
        }}
        onReplace={replaceFile}
      />
    </div>
  )
}

/**
 * One photo, big, in a popup: browse the item's photos, replace this one,
 * make it the main one, or remove it.
 *
 * A <dialog> opened with showModal(), so it stacks above the item popup it
 * usually sits in. Its cancel / close events are stopped here: React passes
 * them up its tree, and the item popup would take them for its own and
 * close too.
 */
function PhotoViewer({
  photos,
  index,
  busy,
  error,
  onIndex,
  onMakeMain,
  onRemove,
  onReplace,
}: {
  photos: StripPhoto[]
  index: number | null
  busy: boolean
  error: string | null
  onIndex: (i: number | null) => void
  onMakeMain: (path: string) => void
  onRemove: (path: string, i: number) => void
  onReplace: (path: string, file: File) => Promise<boolean>
}) {
  const { t } = useI18n()
  const tp = t.common.photoStrip
  const dialogRef = useRef<HTMLDialogElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const photo = index != null ? photos[index] ?? null : null
  const open = photo != null

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const count = photos.length
  const go = (step: number) => {
    if (index == null || count < 2) return
    onIndex((index + step + count) % count)
  }

  const iconBtn = `inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-navy shadow-lg hover:bg-white disabled:opacity-40 ${FOCUS}`
  const actionBtn = `inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-background disabled:opacity-50 ${FOCUS}`

  return (
    <dialog
      ref={dialogRef}
      aria-label={tp.view}
      onCancel={(e) => {
        e.stopPropagation()
        // A file picker dismissed without a file fires its own "cancel".
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        onIndex(null)
      }}
      onClose={(e) => {
        e.stopPropagation()
        if (open) onIndex(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1)
        else if (e.key === 'ArrowRight') go(1)
        else return
        e.preventDefault()
      }}
      // A click on the dimmed backdrop (outside the card) closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onIndex(null)
      }}
      className="m-0 h-full max-h-none w-full max-w-none bg-navy/70 p-4 text-left text-sm font-normal text-foreground"
    >
      {photo ? (
        <div
          className="flex h-full items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) onIndex(null)
          }}
        >
          <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-sm font-semibold">
                {tp.viewerTitle
                  .replace('{n}', String((index ?? 0) + 1))
                  .replace('{total}', String(count))}
                {index === 0 ? (
                  <span className="ml-2 rounded bg-navy px-1.5 py-0.5 text-[11px] text-white">
                    {tp.main}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => onIndex(null)}
                title={t.common.close}
                aria-label={t.common.close}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:text-foreground ${FOCUS}`}
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="relative h-[65vh] min-h-48 bg-background">
              {photo.url ? (
                <Image
                  key={photo.path}
                  src={photo.url}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 100vw, 768px"
                  unoptimized
                  className="object-contain"
                />
              ) : (
                <span className="flex h-full items-center justify-center break-all px-4 text-center text-sm text-foreground">
                  {photo.name}
                </span>
              )}
              {busy ? (
                <span className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-md bg-navy/80 px-3 py-1 text-xs text-white">
                  {t.common.preparingPhoto}
                </span>
              ) : null}
              {count > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    title={t.common.previous}
                    aria-label={t.common.previous}
                    className={`absolute left-3 top-1/2 -translate-y-1/2 ${iconBtn}`}
                  >
                    <CaretLeft size={18} weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    title={t.common.next}
                    aria-label={t.common.next}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 ${iconBtn}`}
                  >
                    <CaretRight size={18} weight="bold" />
                  </button>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => replaceRef.current?.click()}
                className={actionBtn}
              >
                <ArrowsClockwise size={16} weight="bold" />
                {tp.replace}
              </button>
              {index !== 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMakeMain(photo.path)}
                  className={actionBtn}
                >
                  <Star size={16} weight="bold" />
                  {tp.makeMain}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(photo.path, index ?? 0)}
                className={`${actionBtn} ml-auto text-danger`}
              >
                <Trash size={16} weight="bold" />
                {tp.remove}
              </button>
            </div>
            {error ? <p className="px-4 pb-3 text-xs text-danger">{error}</p> : null}
          </div>
        </div>
      ) : null}
      <input
        ref={replaceRef}
        type="file"
        accept={ACCEPT}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file && photo) void onReplace(photo.path, file)
        }}
        className="sr-only"
        tabIndex={-1}
      />
    </dialog>
  )
}
