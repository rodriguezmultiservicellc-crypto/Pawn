'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  CheckCircle,
  Plus,
  Printer,
  Prohibit,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatAppraisalMoney } from '@/lib/appraisals/format'
import {
  addPhotoAction,
  finalizeAppraisalAction,
  removePhotoAction,
  removeStoneAction,
  upsertStoneAction,
  voidAppraisalAction,
} from './actions'
import type {
  AppraisalPhotoKind,
  AppraisalPurpose,
  AppraisalStatus,
  MetalType,
} from '@/types/database-aliases'

export type AppraisalDetailView = {
  id: string
  tenant_id: string
  appraisal_number: string
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  inventory_item_id: string | null
  inventory_item_label: string | null
  item_description: string
  metal_type: MetalType | null
  karat: number | null
  weight_grams: number | null
  purpose: AppraisalPurpose
  appraised_value: number
  replacement_value: number | null
  valuation_method: string | null
  notes: string | null
  appraiser_user_id: string | null
  appraiser_name: string | null
  appraiser_email: string | null
  valid_from: string
  valid_until: string | null
  status: AppraisalStatus
  finalized_at: string | null
  voided_at: string | null
  void_reason: string | null
  is_printed: boolean
  printed_at: string | null
  created_at: string
}

export type AppraisalStoneDetailView = {
  id: string
  position: number
  count: number
  type: string | null
  cut: string | null
  est_carat: number | null
  color: string | null
  clarity: string | null
  certified: boolean
  cert_lab: string | null
  cert_number: string | null
  notes: string | null
}

export type AppraisalPhotoDetailView = {
  id: string
  storage_path: string
  kind: AppraisalPhotoKind
  caption: string | null
  position: number
  signed_url: string | null
}

const PHOTO_KINDS: ReadonlyArray<AppraisalPhotoKind> = [
  'front',
  'back',
  'detail',
  'serial',
  'cert',
  'reference',
]

export default function AppraisalDetail({
  appraisal,
  stones,
  photos,
}: {
  appraisal: AppraisalDetailView
  stones: AppraisalStoneDetailView[]
  photos: AppraisalPhotoDetailView[]
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showVoid, setShowVoid] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [showAddStone, setShowAddStone] = useState(false)

  const isLocked = appraisal.is_printed && appraisal.status === 'finalized'
  const isVoided = appraisal.status === 'voided'
  const isDraft = appraisal.status === 'draft'

  function lookupErrorMsg(error: string | undefined): string | null {
    if (!error) return null
    const errMap = t.appraisal.errors as Record<string, string>
    return errMap[error] ?? error
  }

  function onFinalize() {
    if (!confirm(t.appraisal.detail.finalizeConfirm)) return
    startTransition(async () => {
      const fd = new FormData()
      fd.append('appraisal_id', appraisal.id)
      const r = await finalizeAppraisalAction(fd)
      setErrorMsg(lookupErrorMsg(r.error))
    })
  }

  function onVoidSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (voidReason.trim().length < 10) {
      setErrorMsg(t.appraisal.errors.validation_failed)
      return
    }
    startTransition(async () => {
      const fd = new FormData()
      fd.append('appraisal_id', appraisal.id)
      fd.append('void_reason', voidReason.trim())
      const r = await voidAppraisalAction(fd)
      if (r.ok) {
        setShowVoid(false)
        setVoidReason('')
        setErrorMsg(null)
      } else {
        setErrorMsg(lookupErrorMsg(r.error))
      }
    })
  }

  function onAddStoneSubmit(formData: FormData) {
    startTransition(async () => {
      formData.append('appraisal_id', appraisal.id)
      const r = await upsertStoneAction(formData)
      if (r.ok) {
        setShowAddStone(false)
        setErrorMsg(null)
      } else {
        setErrorMsg(lookupErrorMsg(r.error))
      }
    })
  }

  function onAddPhotoSubmit(formData: FormData) {
    startTransition(async () => {
      formData.append('appraisal_id', appraisal.id)
      const r = await addPhotoAction(formData)
      if (!r.ok) setErrorMsg(lookupErrorMsg(r.error))
    })
  }

  function onRemoveStone(stoneId: string) {
    if (!confirm(t.common.confirm)) return
    startTransition(async () => {
      const r = await removeStoneAction(stoneId)
      if (!r.ok) setErrorMsg(lookupErrorMsg(r.error))
    })
  }

  function onRemovePhoto(photoId: string) {
    if (!confirm(t.common.confirm)) return
    startTransition(async () => {
      const r = await removePhotoAction(photoId)
      if (!r.ok) setErrorMsg(lookupErrorMsg(r.error))
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/appraisals"
            className="text-xs text-muted hover:text-foreground"
          >
            ← {t.appraisal.backToList}
          </Link>
          <h1 className="font-display mt-1 text-2xl font-bold">
            <span className="font-mono">{appraisal.appraisal_number}</span>
          </h1>
          <p className="text-sm text-muted">{appraisal.item_description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={appraisal.status} />
          {isDraft ? (
            <button
              type="button"
              onClick={onFinalize}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
            >
              <CheckCircle size={14} weight="bold" />
              {pending
                ? t.appraisal.detail.finalizeSubmitting
                : t.appraisal.detail.finalize}
            </button>
          ) : null}
          {appraisal.status === 'finalized' ? (
            <a
              href={`/api/appraisals/${appraisal.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background hover:text-foreground"
            >
              <Printer size={14} weight="bold" />
              {t.appraisal.detail.printPdf}
            </a>
          ) : null}
          {!isVoided ? (
            <button
              type="button"
              onClick={() => setShowVoid((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
            >
              <Prohibit size={14} weight="bold" />
              {t.appraisal.detail.voidBtn}
            </button>
          ) : null}
        </div>
      </div>

      {errorMsg ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {errorMsg}
        </div>
      ) : null}

      {isLocked ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          {t.appraisal.detail.lockedNotice}
        </div>
      ) : null}

      {isVoided ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <strong>{t.appraisal.detail.voidedNotice}</strong>
          {appraisal.void_reason ? (
            <div className="mt-1 text-xs text-muted">{appraisal.void_reason}</div>
          ) : null}
        </div>
      ) : null}

      {showVoid && !isVoided ? (
        <form
          onSubmit={onVoidSubmit}
          className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-4"
        >
          <label className="block space-y-1">
            <span className="text-sm font-medium text-danger">
              {t.appraisal.detail.voidReasonLabel}
            </span>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={3}
              required
              className="block w-full rounded-md border border-danger/30 bg-card px-3 py-2 text-sm text-foreground"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowVoid(false)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:bg-danger/90 disabled:opacity-50"
            >
              {pending
                ? t.appraisal.detail.voidSubmitting
                : t.appraisal.detail.voidBtn}
            </button>
          </div>
        </form>
      ) : null}

      {/* Subject */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t.appraisal.detail.sectionSubject}
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm">
          <Field label={t.appraisal.list.customer}>
            {appraisal.customer_id && appraisal.customer_name ? (
              <Link
                href={`/customers/${appraisal.customer_id}`}
                className="text-foreground underline-offset-2 hover:underline"
              >
                {appraisal.customer_name}
              </Link>
            ) : (
              <span className="text-muted">—</span>
            )}
            {appraisal.customer_phone ? (
              <span className="ml-2 text-xs text-muted">
                {appraisal.customer_phone}
              </span>
            ) : null}
          </Field>
          <Field label={t.appraisal.new_.pickInventory}>
            {appraisal.inventory_item_id && appraisal.inventory_item_label ? (
              <Link
                href={`/inventory/${appraisal.inventory_item_id}`}
                className="text-foreground underline-offset-2 hover:underline"
              >
                {appraisal.inventory_item_label}
              </Link>
            ) : (
              <span className="text-muted">—</span>
            )}
          </Field>
        </div>
      </section>

      {/* Item */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t.appraisal.detail.sectionItem}
        </h2>
        <p className="text-sm text-foreground whitespace-pre-wrap">
          {appraisal.item_description}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
          <Field label={t.appraisal.new_.metal}>
            {appraisal.metal_type ?? '—'}
          </Field>
          <Field label={t.appraisal.new_.karat}>
            <span className="font-mono">
              {appraisal.karat == null ? '—' : `${appraisal.karat}k`}
            </span>
          </Field>
          <Field label={t.appraisal.new_.weightGrams}>
            <span className="font-mono">
              {appraisal.weight_grams == null
                ? '—'
                : `${appraisal.weight_grams.toFixed(2)} g`}
            </span>
          </Field>
        </div>
      </section>

      {/* Photos */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t.appraisal.detail.sectionPhotos}
          </h2>
          {!isLocked ? (
            <PhotoUploader onSubmit={onAddPhotoSubmit} pending={pending} />
          ) : null}
        </div>
        {photos.length === 0 ? (
          <p className="text-sm text-muted">{t.appraisal.detail.noPhotos}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {photos.map((p) => (
              <div
                key={p.id}
                className="overflow-hidden rounded-lg border border-border bg-background"
              >
                <div className="relative aspect-square">
                  {p.signed_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.signed_url}
                      alt={p.caption ?? p.kind}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-2 p-2 text-xs">
                  <span className="truncate text-muted">
                    {t.appraisal.photoKinds[p.kind]}
                    {p.caption ? ` · ${p.caption}` : ''}
                  </span>
                  {!isLocked ? (
                    <button
                      type="button"
                      onClick={() => onRemovePhoto(p.id)}
                      className="text-danger hover:opacity-80"
                      title={t.common.remove}
                    >
                      <Trash size={12} weight="bold" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Stones */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t.appraisal.detail.sectionStones}
          </h2>
          {!isLocked ? (
            <button
              type="button"
              onClick={() => setShowAddStone((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-background hover:text-foreground"
            >
              <Plus size={12} weight="bold" />
              {t.appraisal.detail.addStone}
            </button>
          ) : null}
        </div>

        {showAddStone ? (
          <AddStoneInline
            nextPosition={(stones[stones.length - 1]?.position ?? 0) + 1}
            onSubmit={onAddStoneSubmit}
            onCancel={() => setShowAddStone(false)}
            pending={pending}
          />
        ) : null}

        {stones.length === 0 ? (
          <p className="text-sm text-muted">{t.appraisal.detail.noStones}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">
                    {t.appraisal.new_.stoneCount}
                  </th>
                  <th className="px-2 py-2">{t.appraisal.new_.stoneType}</th>
                  <th className="px-2 py-2">{t.appraisal.new_.stoneCut}</th>
                  <th className="px-2 py-2">{t.appraisal.new_.stoneCarat}</th>
                  <th className="px-2 py-2">{t.appraisal.new_.stoneColor}</th>
                  <th className="px-2 py-2">
                    {t.appraisal.new_.stoneClarity}
                  </th>
                  <th className="px-2 py-2">
                    {t.appraisal.new_.stoneCertified}
                  </th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {stones.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-border text-foreground"
                  >
                    <td className="px-2 py-2 font-mono">{s.position}</td>
                    <td className="px-2 py-2 font-mono">{s.count}</td>
                    <td className="px-2 py-2">{s.type ?? '—'}</td>
                    <td className="px-2 py-2">{s.cut ?? '—'}</td>
                    <td className="px-2 py-2 font-mono">
                      {s.est_carat == null ? '—' : s.est_carat.toFixed(3)}
                    </td>
                    <td className="px-2 py-2">{s.color ?? '—'}</td>
                    <td className="px-2 py-2">{s.clarity ?? '—'}</td>
                    <td className="px-2 py-2 text-xs">
                      {s.certified
                        ? `${s.cert_lab ?? ''} ${s.cert_number ?? ''}`.trim() ||
                          '✓'
                        : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {!isLocked ? (
                        <button
                          type="button"
                          onClick={() => onRemoveStone(s.id)}
                          className="text-danger hover:opacity-80"
                          title={t.common.remove}
                        >
                          <Trash size={12} weight="bold" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Valuation */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t.appraisal.detail.sectionValuation}
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm">
          <Field label={t.appraisal.new_.purpose}>
            {t.appraisal.purposes[appraisal.purpose]}
          </Field>
          <Field label={t.appraisal.detail.appraisedValue}>
            <span className="font-mono text-base font-semibold text-foreground">
              {formatAppraisalMoney(appraisal.appraised_value)}
            </span>
          </Field>
          <Field label={t.appraisal.detail.replacementValue}>
            <span className="font-mono">
              {formatAppraisalMoney(appraisal.replacement_value)}
            </span>
          </Field>
          <Field label={t.appraisal.detail.method}>
            {appraisal.valuation_method ?? '—'}
          </Field>
        </div>
        {appraisal.notes ? (
          <div className="text-sm">
            <span className="text-xs text-muted">
              {t.appraisal.new_.notes}:{' '}
            </span>
            <span className="text-foreground">{appraisal.notes}</span>
          </div>
        ) : null}
      </section>

      {/* Validity + Appraiser */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t.appraisal.detail.sectionValidity}
          </h2>
          <div className="text-sm">
            <Field label={t.appraisal.list.validFrom}>
              <span className="font-mono">{appraisal.valid_from}</span>
            </Field>
            <Field label={t.appraisal.list.validUntil}>
              <span className="font-mono">
                {appraisal.valid_until ?? '—'}
              </span>
            </Field>
          </div>
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t.appraisal.detail.sectionAppraiser}
          </h2>
          <div className="text-sm">
            <Field label={t.appraisal.list.appraiser}>
              {appraisal.appraiser_name ??
                appraisal.appraiser_email ??
                '—'}
            </Field>
            {appraisal.finalized_at ? (
              <Field label={t.appraisal.detail.finalizedAt}>
                <span className="font-mono text-xs">
                  {appraisal.finalized_at}
                </span>
              </Field>
            ) : null}
            {appraisal.printed_at ? (
              <Field label={t.appraisal.detail.printedAt}>
                <span className="font-mono text-xs">
                  {appraisal.printed_at}
                </span>
              </Field>
            ) : null}
            {appraisal.voided_at ? (
              <Field label={t.appraisal.detail.voidedAt}>
                <span className="font-mono text-xs">
                  {appraisal.voided_at}
                </span>
              </Field>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

function StatusBadge({ status }: { status: AppraisalStatus }) {
  const { t } = useI18n()
  const tone =
    status === 'finalized'
      ? 'border-success/30 bg-success/5 text-success'
      : status === 'voided'
      ? 'border-danger/30 bg-danger/5 text-danger'
      : 'border-border bg-background text-foreground'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {t.appraisal.statuses[status]}
    </span>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-1.5">
      <div className="text-[11px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="text-foreground">{children}</div>
    </div>
  )
}

function PhotoUploader({
  onSubmit,
  pending,
}: {
  onSubmit: (fd: FormData) => void
  pending: boolean
}) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  const [kind, setKind] = useState<AppraisalPhotoKind>('detail')

  function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    onSubmit(fd)
    e.currentTarget.reset()
    setShow(false)
  }

  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-background hover:text-foreground"
      >
        <UploadSimple size={12} weight="bold" />
        {t.appraisal.detail.addPhoto}
      </button>
    )
  }

  return (
    <form onSubmit={handle} className="flex items-center gap-2">
      <select
        name="kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as AppraisalPhotoKind)}
        className="rounded-md border border-border bg-card px-2 py-1 text-xs"
      >
        {PHOTO_KINDS.map((k) => (
          <option key={k} value={k}>
            {t.appraisal.photoKinds[k]}
          </option>
        ))}
      </select>
      <input
        type="file"
        name="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        required
        className="text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gold px-2 py-1 text-xs font-medium text-navy disabled:opacity-50"
      >
        {pending ? t.common.uploading : t.common.upload}
      </button>
      <button
        type="button"
        onClick={() => setShow(false)}
        className="rounded-md border border-border bg-card px-2 py-1 text-xs"
      >
        {t.common.cancel}
      </button>
    </form>
  )
}

function AddStoneInline({
  nextPosition,
  onSubmit,
  onCancel,
  pending,
}: {
  nextPosition: number
  onSubmit: (fd: FormData) => void
  onCancel: () => void
  pending: boolean
}) {
  const { t } = useI18n()

  function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    onSubmit(fd)
  }

  return (
    <form
      onSubmit={handle}
      className="space-y-2 rounded-lg border border-dashed border-border bg-background/40 p-3"
    >
      <input type="hidden" name="position" value={nextPosition} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <Inline
          name="count"
          label={t.appraisal.new_.stoneCount}
          defaultValue="1"
          type="number"
        />
        <Inline
          name="type"
          label={t.appraisal.new_.stoneType}
          colSpan={2}
        />
        <Inline name="cut" label={t.appraisal.new_.stoneCut} />
        <Inline
          name="est_carat"
          label={t.appraisal.new_.stoneCarat}
          type="number"
          step="0.001"
          colSpan={2}
        />
        <Inline name="color" label={t.appraisal.new_.stoneColor} />
        <Inline
          name="clarity"
          label={t.appraisal.new_.stoneClarity}
        />
        <label className="flex items-center gap-1 text-xs md:col-span-2">
          <input type="checkbox" name="certified" value="true" />
          {t.appraisal.new_.stoneCertified}
        </label>
        <Inline name="cert_lab" label={t.appraisal.new_.stoneCertLab} />
        <Inline
          name="cert_number"
          label={t.appraisal.new_.stoneCertNumber}
          colSpan={2}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-card px-3 py-1 text-xs"
        >
          {t.common.cancel}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-navy px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? t.common.saving : t.common.save}
        </button>
      </div>
    </form>
  )
}

function Inline({
  name,
  label,
  defaultValue,
  type = 'text',
  step,
  colSpan = 1,
}: {
  name: string
  label: string
  defaultValue?: string
  type?: string
  step?: string
  colSpan?: number
}) {
  const colSpanClass =
    colSpan === 2 ? 'md:col-span-2' : colSpan === 3 ? 'md:col-span-3' : ''
  return (
    <label className={`block space-y-0.5 ${colSpanClass}`}>
      <span className="text-[11px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className="block w-full rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-blue focus:outline-none"
      />
    </label>
  )
}

