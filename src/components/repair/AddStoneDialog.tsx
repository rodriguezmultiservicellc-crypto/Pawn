'use client'

import { useState, useTransition } from 'react'
import { Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from '@/components/pawn/RecordPaymentDialog'

export function AddStoneDialog({
  ticketId,
  nextIndex,
  onClose,
  onSubmit,
}: {
  ticketId: string
  nextIndex: number
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [stoneType, setStoneType] = useState('')
  const [shape, setShape] = useState('')
  const [size, setSize] = useState('')
  const [weight, setWeight] = useState('')
  const [color, setColor] = useState('')
  const [clarity, setClarity] = useState('')
  const [mounting, setMounting] = useState('')
  const [position, setPosition] = useState('')
  const [source, setSource] = useState<'customer_supplied' | 'shop_supplied'>(
    'customer_supplied',
  )
  const [notes, setNotes] = useState('')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    fd.set('stone_index', String(nextIndex))
    fd.set('stone_type', stoneType)
    if (shape) fd.set('shape', shape)
    if (size) fd.set('size_mm', size)
    if (weight) fd.set('weight_carats', weight)
    if (color) fd.set('color', color)
    if (clarity) fd.set('clarity', clarity)
    if (mounting) fd.set('mounting_type', mounting)
    if (position) fd.set('mounting_position', position)
    fd.set('source', source)
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const canSubmit = stoneType.trim().length > 0

  return (
    <Modal title={t.repair.dialogs.addStone.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}
      <p className="mb-3 text-sm text-ash">{t.repair.dialogs.addStone.body}</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t.repair.new_.stoneType + ' *'}
            value={stoneType}
            onChange={setStoneType}
            placeholder={t.repair.new_.stoneTypePlaceholder}
          />
          <Field
            label={t.repair.new_.stoneShape}
            value={shape}
            onChange={setShape}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t.repair.new_.stoneSize}
            value={size}
            onChange={setSize}
            type="number"
            step="0.01"
          />
          <Field
            label={t.repair.new_.stoneWeight}
            value={weight}
            onChange={setWeight}
            type="number"
            step="0.001"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t.repair.new_.stoneColor}
            value={color}
            onChange={setColor}
          />
          <Field
            label={t.repair.new_.stoneClarity}
            value={clarity}
            onChange={setClarity}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t.repair.new_.mountingType}
            value={mounting}
            onChange={setMounting}
          />
          <Field
            label={t.repair.new_.mountingPosition}
            value={position}
            onChange={setPosition}
          />
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.repair.new_.stoneSource}
          </span>
          <select
            value={source}
            onChange={(e) =>
              setSource(e.target.value as 'customer_supplied' | 'shop_supplied')
            }
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          >
            <option value="customer_supplied">
              {t.repair.new_.stoneSourceCustomer}
            </option>
            <option value="shop_supplied">{t.repair.new_.stoneSourceShop}</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.repair.new_.stoneNotes}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
        </label>
      </div>
      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink hover:border-ink"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={pending || !canSubmit}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-rausch px-4 py-2 text-sm text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
        >
          <Plus size={14} weight="bold" />
          {pending ? t.common.saving : t.repair.actions.addStone}
        </button>
      </Footer>
    </Modal>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  step,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  step?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
      />
    </label>
  )
}
