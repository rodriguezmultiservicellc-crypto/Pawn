'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { ArrowsClockwise, CaretLeft, CaretRight, Star, Trash, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { FOCUS } from '@/lib/ui/ledger'

/** A photo the viewer can show: a key, a URL (null = the browser cannot
 *  paint it, the name shows instead) and a name. */
export type ViewerPhoto = {
  path: string
  url: string | null
  name: string
}

/** What the viewer may change. Left out (a saved ticket), it only shows. */
export type ViewerEdit = {
  /** A photo is uploading: the buttons wait. */
  busy: boolean
  error: string | null
  accept: string
  onMakeMain: (path: string) => void
  onRemove: (path: string, index: number) => void
  onReplace: (path: string, file: File) => void
}

/**
 * One photo, big, in a popup, with arrows through the item's other photos.
 * With `edit`, it can also replace the photo, make it the main one, or
 * remove it (intake — components/uploads/PhotoStrip).
 *
 * A <dialog> opened with showModal(), so it stacks above an item popup it
 * may sit in. Its cancel / close events are stopped here: React passes them
 * up its tree, and that popup would take them for its own and close too.
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  edit,
}: {
  photos: ViewerPhoto[]
  /** The photo showing (its place in `photos`), or null = closed. */
  index: number | null
  onIndex: (i: number | null) => void
  edit?: ViewerEdit
}) {
  const { t } = useI18n()
  const tp = t.common.photoStrip
  const dialogRef = useRef<HTMLDialogElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const photo = index != null ? photos[index] ?? null : null
  const open = photo != null
  const busy = edit?.busy ?? false

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

  const iconBtn = `inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-navy shadow-lg hover:bg-white ${FOCUS}`
  const actionBtn = `inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-background disabled:opacity-50 ${FOCUS}`
  const closeOnBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onIndex(null)
  }

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
      onClick={closeOnBackdrop}
      className="m-0 h-full max-h-none w-full max-w-none bg-navy/70 p-4 text-left text-sm font-normal text-foreground"
    >
      {photo ? (
        <div className="flex h-full items-center justify-center" onClick={closeOnBackdrop}>
          <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-sm font-semibold">
                {tp.viewerTitle
                  .replace('{n}', String((index ?? 0) + 1))
                  .replace('{total}', String(count))}
                {index === 0 && count > 1 ? (
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

            {edit ? (
              <>
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
                      onClick={() => edit.onMakeMain(photo.path)}
                      className={actionBtn}
                    >
                      <Star size={16} weight="bold" />
                      {tp.makeMain}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => edit.onRemove(photo.path, index ?? 0)}
                    className={`${actionBtn} ml-auto text-danger`}
                  >
                    <Trash size={16} weight="bold" />
                    {tp.remove}
                  </button>
                </div>
                {edit.error ? <p className="px-4 pb-3 text-xs text-danger">{edit.error}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {edit ? (
        <input
          ref={replaceRef}
          type="file"
          accept={edit.accept}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file && photo) edit.onReplace(photo.path, file)
          }}
          className="sr-only"
          tabIndex={-1}
        />
      ) : null}
    </dialog>
  )
}
