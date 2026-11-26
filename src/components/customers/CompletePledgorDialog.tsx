'use client'

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import { Modal } from '@/components/pos/Modal'
import { completePledgorRecordAction } from '@/app/(staff)/customers/pledgor-actions'
import {
  descriptionOptions,
  EYE_COLOR_OPTIONS,
  HAIR_COLOR_OPTIONS,
  RACE_OPTIONS,
  SEX_OPTIONS,
} from '@/lib/customers/physical-description'
import {
  pledgorColumnsFor,
  type PledgorColumn,
  type PledgorField,
  type PledgorRecord,
} from '@/lib/customers/pledgor-record'

const INPUT =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10'

/**
 * Fill in what the customer's record lacks for the ticket, without leaving
 * New pawn / New buy (Eddy, 2026-11-25). Only the missing fields show, and
 * only they are saved (completePledgorRecordAction).
 *
 * Portaled to <body> and built without a <form>: the banner sits INSIDE the
 * ticket form, and none of these inputs may be submitted with the ticket.
 * Enter saves here and never submits the ticket.
 */
export function CompletePledgorDialog({
  customerId,
  missing,
  record,
  onClose,
  onSaved,
}: {
  customerId: string
  missing: PledgorField[]
  /** What the record holds now, to start the boxes from (address parts). */
  record: PledgorRecord
  onClose: () => void
  onSaved: (missing: PledgorField[]) => void
}) {
  const { t } = useI18n()
  const p = t.pledgorRecord
  const c = t.customers
  const columns = pledgorColumnsFor(missing)
  const [values, setValues] = useState<Partial<Record<PledgorColumn, string>>>(() =>
    Object.fromEntries(
      columns.map((col) => {
        const v = record[col as keyof PledgorRecord]
        return [col, v == null || col === 'height_inches' ? '' : String(v)]
      }),
    ),
  )
  const [feet, setFeet] = useState('')
  const [inches, setInches] = useState('')
  const [errors, setErrors] = useState<Partial<Record<PledgorColumn, string>>>({})
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  const set = (col: PledgorColumn) => (v: string) => setValues((s) => ({ ...s, [col]: v }))
  const errText = (col: PledgorColumn) => {
    const code = errors[col]
    if (!code) return null
    return (c.fieldErrors as Record<string, string>)[code] ?? code
  }

  function save() {
    const sent = { ...values }
    if (columns.includes('height_inches')) {
      const ft = parseInt(feet, 10)
      const inch = parseInt(inches, 10)
      const total = (isNaN(ft) ? 0 : ft) * 12 + (isNaN(inch) ? 0 : inch)
      sent.height_inches = total > 0 ? String(total) : ''
    }
    setFailed(false)
    startTransition(async () => {
      const res = await completePledgorRecordAction(customerId, sent)
      if (res.ok) {
        onSaved(res.missing)
        return
      }
      setErrors(res.fieldErrors ?? {})
      setFailed(true)
    })
  }

  function text(col: PledgorColumn, label: string, type = 'text', wide = false) {
    return (
      <label key={col} className={`block space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
        <span className="text-sm font-medium text-foreground">{label}</span>
        <input
          type={type}
          value={values[col] ?? ''}
          onChange={(e) => set(col)(e.target.value)}
          className={INPUT}
        />
        {errText(col) ? <span className="text-xs text-danger">{errText(col)}</span> : null}
      </label>
    )
  }

  function select(
    col: PledgorColumn,
    label: string,
    options: ReadonlyArray<{ value: string; label: string }>,
  ) {
    return (
      <label key={col} className="block space-y-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <select
          value={values[col] ?? ''}
          onChange={(e) => set(col)(e.target.value)}
          className={INPUT}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {errText(col) ? <span className="text-xs text-danger">{errText(col)}</span> : null}
      </label>
    )
  }

  const fieldsFor = (f: PledgorField) => {
    switch (f) {
      case 'last_name':
        return text('last_name', c.lastName)
      case 'first_name':
        return text('first_name', c.firstName)
      case 'address':
        return [
          text('address1', c.address1, 'text', true),
          text('city', c.city),
          text('state', c.state),
          text('zip', c.zip),
        ]
      case 'phone':
        return text('phone', c.phone, 'tel')
      case 'place_of_employment':
        return text('place_of_employment', c.placeOfEmployment, 'text', true)
      case 'date_of_birth':
        return text('date_of_birth', c.dob, 'date')
      case 'sex':
        return select('sex', c.sex, descriptionOptions(SEX_OPTIONS, c.sexOptions, null))
      case 'race':
        return select('race', c.race, descriptionOptions(RACE_OPTIONS, c.raceOptions, null))
      case 'hair_color':
        return select(
          'hair_color',
          c.hairColor,
          descriptionOptions(HAIR_COLOR_OPTIONS, c.hairColorOptions, null),
        )
      case 'eye_color':
        return select(
          'eye_color',
          c.eyeColor,
          descriptionOptions(EYE_COLOR_OPTIONS, c.eyeColorOptions, null),
        )
      case 'height_inches':
        return (
          <div key="height" className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{c.heightFeet}</span>
              <input
                type="number"
                min={1}
                max={8}
                value={feet}
                onChange={(e) => setFeet(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{c.heightInches}</span>
              <input
                type="number"
                min={0}
                max={11}
                value={inches}
                onChange={(e) => setInches(e.target.value)}
                className={INPUT}
              />
            </label>
            {errText('height_inches') ? (
              <span className="col-span-2 text-xs text-danger">{errText('height_inches')}</span>
            ) : null}
          </div>
        )
      case 'weight_lbs':
        return text('weight_lbs', c.weightLbs, 'number')
      case 'id_type':
        return select('id_type', c.idType, [
          { value: '', label: '—' },
          { value: 'drivers_license', label: c.idTypeDriversLicense },
          { value: 'state_id', label: c.idTypeStateId },
          { value: 'passport', label: c.idTypePassport },
          { value: 'military_id', label: c.idTypeMilitary },
          { value: 'permanent_resident_card', label: c.idTypePermanentResident },
          { value: 'other', label: c.idTypeOther },
        ])
      case 'id_number':
        return text('id_number', c.idNumber)
      case 'id_state':
        return text('id_state', c.idIssuingState)
    }
  }

  return createPortal(
    <Modal title={p.completeRecord} onClose={onClose} size="lg">
      <div
        onKeyDown={(e) => {
          // React events bubble through the portal to the ticket form.
          e.stopPropagation()
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault()
            save()
          }
        }}
      >
        <p className="mb-4 text-sm text-text-secondary">{p.popupBody}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {missing.map((f) => fieldsFor(f))}
        </div>
        {failed ? <p className="mt-3 text-sm text-danger">{p.popupFailed}</p> : null}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/customers/${customerId}`}
            target="_blank"
            className="text-sm text-blue hover:underline"
          >
            {p.openFullRecord}
          </Link>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex h-11 items-center rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
            >
              {t.common.save}
            </button>
          </div>
        </div>
      </div>
    </Modal>,
    document.body,
  )
}
