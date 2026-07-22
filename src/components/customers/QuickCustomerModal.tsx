'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  createCustomerInlineAction,
  type InlineCustomerState,
} from '@/app/(staff)/customers/new/inline-actions'
import type { PickerCustomerResult } from '@/lib/customers/picker-search'

/**
 * Inline "new customer" modal. Creates a customer via a server action that
 * returns the new id + picker label WITHOUT navigating, then hands it to the
 * caller (typically to drop straight into a CustomerPicker). Used by the
 * pawn-intake flow so staff never leave a half-filled ticket to add a walk-in.
 */
export default function QuickCustomerModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (customer: PickerCustomerResult) => void
}) {
  const { t } = useI18n()
  const tc = t.customers
  const tn = t.pawn.new_
  const [state, formAction, pending] = useActionState<
    InlineCustomerState,
    FormData
  >(createCustomerInlineAction, {})
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const handledRef = useRef(false)

  // Height is captured as feet + inches and composed into the single
  // height_inches value Zod consumes (mirrors CustomerFormFields).
  const [heightFeet, setHeightFeet] = useState('')
  const [heightInches, setHeightInches] = useState('')
  const composedHeight = (() => {
    const ft = parseInt(heightFeet, 10)
    const inch = parseInt(heightInches, 10)
    if (isNaN(ft) && isNaN(inch)) return ''
    return String((isNaN(ft) ? 0 : ft) * 12 + (isNaN(inch) ? 0 : inch))
  })()

  // On a successful create, hand the new customer up and close — once.
  useEffect(() => {
    if (state.customer && !handledRef.current) {
      handledRef.current = true
      onCreated(state.customer)
      onClose()
    }
  }, [state.customer, onCreated, onClose])

  // Reset the one-shot guard + focus the first field whenever we open.
  useEffect(() => {
    if (open) {
      handledRef.current = false
      requestAnimationFrame(() => firstFieldRef.current?.focus())
    }
  }, [open])

  // Escape to close.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const fe = state.fieldErrors ?? {}

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/40 p-4 sm:items-center"
      onMouseDown={onClose}
    >
      <div
        className="relative my-8 w-full max-w-lg rounded-xl border border-border bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">
              {tn.quickCustomerTitle}
            </h2>
            <p className="mt-0.5 text-xs text-muted">{tn.quickCustomerHelp}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-md p-1 text-muted hover:bg-background hover:text-danger"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <form action={formAction} className="space-y-4 px-5 py-4">
          {state.error ? (
            <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {state.error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label={tc.firstName} required error={fe.first_name}>
              <input
                ref={firstFieldRef}
                name="first_name"
                required
                className={inputCls(!!fe.first_name)}
              />
            </Field>
            <Field label={tc.lastName} required error={fe.last_name}>
              <input name="last_name" required className={inputCls(!!fe.last_name)} />
            </Field>
            <Field label={tc.phone} error={fe.phone}>
              <input name="phone" inputMode="tel" className={inputCls(!!fe.phone)} />
            </Field>
            <Field label={tc.email} error={fe.email}>
              <input name="email" type="email" className={inputCls(!!fe.email)} />
            </Field>
            <Field label={tc.dob} error={fe.date_of_birth}>
              <input
                name="date_of_birth"
                type="date"
                className={inputCls(!!fe.date_of_birth)}
              />
            </Field>
          </div>

          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-muted">
              {tn.quickCustomerIdSection}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tc.idType} error={fe.id_type}>
                <select name="id_type" className={inputCls(!!fe.id_type)} defaultValue="">
                  <option value="">—</option>
                  <option value="drivers_license">{tc.idTypeDriversLicense}</option>
                  <option value="state_id">{tc.idTypeStateId}</option>
                  <option value="passport">{tc.idTypePassport}</option>
                  <option value="military_id">{tc.idTypeMilitary}</option>
                  <option value="permanent_resident_card">
                    {tc.idTypePermanentResident}
                  </option>
                  <option value="other">{tc.idTypeOther}</option>
                </select>
              </Field>
              <Field label={tc.idNumber} error={fe.id_number}>
                <input name="id_number" className={inputCls(!!fe.id_number)} />
              </Field>
              <Field label={tc.idIssuingState} error={fe.id_state}>
                <input name="id_state" className={inputCls(!!fe.id_state)} />
              </Field>
              <Field label={tc.idExpiry} error={fe.id_expiry}>
                <input
                  name="id_expiry"
                  type="date"
                  className={inputCls(!!fe.id_expiry)}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-muted">
              {tc.sectionPawnRequired}
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={tc.heightFeet} error={fe.height_inches}>
                <input
                  name="height_feet_display"
                  type="number"
                  min={1}
                  max={8}
                  value={heightFeet}
                  onChange={(e) => setHeightFeet(e.target.value)}
                  className={inputCls(!!fe.height_inches)}
                />
              </Field>
              <Field label={tc.heightInches}>
                <input
                  name="height_inches_display"
                  type="number"
                  min={0}
                  max={11}
                  value={heightInches}
                  onChange={(e) => setHeightInches(e.target.value)}
                  className={inputCls(false)}
                />
              </Field>
              <input type="hidden" name="height_inches" value={composedHeight} />
              <Field label={tc.weightLbs} error={fe.weight_lbs}>
                <input
                  name="weight_lbs"
                  type="number"
                  className={inputCls(!!fe.weight_lbs)}
                />
              </Field>
              <Field label={tc.sex} error={fe.sex}>
                <input name="sex" placeholder="M / F / X" className={inputCls(!!fe.sex)} />
              </Field>
              <Field label={tc.hairColor} error={fe.hair_color}>
                <input name="hair_color" className={inputCls(!!fe.hair_color)} />
              </Field>
              <Field label={tc.eyeColor} error={fe.eye_color}>
                <input name="eye_color" className={inputCls(!!fe.eye_color)} />
              </Field>
              <div className="col-span-2">
                <Field
                  label={tc.placeOfEmployment}
                  error={fe.place_of_employment}
                >
                  <input
                    name="place_of_employment"
                    className={inputCls(!!fe.place_of_employment)}
                  />
                </Field>
              </div>
            </div>
            <div className="mt-3">
              <Field label={tc.identifyingMarks} error={fe.identifying_marks}>
                <textarea
                  name="identifying_marks"
                  rows={2}
                  className={inputCls(!!fe.identifying_marks)}
                />
                <span className="text-xs text-muted">
                  {tc.identifyingMarksHelp}
                </span>
              </Field>
            </div>
          </fieldset>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-background"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-navy hover:bg-gold-2 disabled:opacity-60"
            >
              {pending ? t.common.creating : tn.quickCustomerSave}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-foreground">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  )
}

function inputCls(hasError: boolean): string {
  return `w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-blue ${
    hasError ? 'border-danger' : 'border-border'
  }`
}
