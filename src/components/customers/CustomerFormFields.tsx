'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n/context'
import type {
  CommPreference,
  IdDocumentType,
  Language,
} from '@/types/database-aliases'

export type CustomerFieldValues = {
  first_name: string
  last_name: string
  middle_name: string | null
  date_of_birth: string | null
  phone: string | null
  phone_alt: string | null
  email: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  id_type: IdDocumentType | null
  id_number: string | null
  id_state: string | null
  id_country: string | null
  id_expiry: string | null
  comm_preference: CommPreference
  language: Language
  marketing_opt_in: boolean
  // Pawn-only physical description + employment.
  height_inches: number | null
  weight_lbs: number | null
  sex: string | null
  hair_color: string | null
  eye_color: string | null
  identifying_marks: string | null
  place_of_employment: string | null
  notes: string | null
  tags: string[]
}

const EMPTY: CustomerFieldValues = {
  first_name: '',
  last_name: '',
  middle_name: null,
  date_of_birth: null,
  phone: null,
  phone_alt: null,
  email: null,
  address1: null,
  address2: null,
  city: null,
  state: null,
  zip: null,
  country: 'US',
  id_type: null,
  id_number: null,
  id_state: null,
  id_country: 'US',
  id_expiry: null,
  comm_preference: 'sms',
  language: 'en',
  marketing_opt_in: false,
  height_inches: null,
  weight_lbs: null,
  sex: null,
  hair_color: null,
  eye_color: null,
  identifying_marks: null,
  place_of_employment: null,
  notes: null,
  tags: [],
}

export function emptyCustomer(): CustomerFieldValues {
  return { ...EMPTY }
}

/**
 * Shared customer form fields. Used by both /customers/new/form.tsx and
 * /customers/[id]/content.tsx. Rendered inside a parent <form action={fn}>.
 *
 * Tags are kept in component state and serialized as a comma-separated
 * string in a hidden input. The Zod schema's tagsSchema preprocessor
 * splits and trims.
 *
 * The "Physical description & employment" section is gated by `hasPawn` —
 * jewelry-only / repair-only shops never see it. The columns exist on
 * the customer row regardless; they just stay null when not collected.
 */
export function CustomerFormFields({
  initial = EMPTY,
  fieldError,
  hasPawn = false,
}: {
  initial?: CustomerFieldValues
  fieldError?: (key: string) => string | undefined
  hasPawn?: boolean
}) {
  const { t } = useI18n()
  const [tags, setTags] = useState<string[]>(initial.tags ?? [])
  const [tagInput, setTagInput] = useState('')

  // Split height_inches into feet + inches for the form display.
  const initialFeet =
    initial.height_inches != null ? Math.floor(initial.height_inches / 12) : null
  const initialInches =
    initial.height_inches != null ? initial.height_inches % 12 : null
  const [heightFeet, setHeightFeet] = useState<string>(
    initialFeet != null ? String(initialFeet) : '',
  )
  const [heightInches, setHeightInches] = useState<string>(
    initialInches != null ? String(initialInches) : '',
  )

  // Compose the hidden height_inches value Zod consumes.
  const composedHeight = (() => {
    const ft = parseInt(heightFeet, 10)
    const inch = parseInt(heightInches, 10)
    if (isNaN(ft) && isNaN(inch)) return ''
    const totalIn = (isNaN(ft) ? 0 : ft) * 12 + (isNaN(inch) ? 0 : inch)
    if (totalIn <= 0) return ''
    return String(totalIn)
  })()

  function addTag() {
    const v = tagInput.trim()
    if (!v) return
    if (tags.includes(v)) {
      setTagInput('')
      return
    }
    setTags([...tags, v])
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag))
  }

  return (
    <div className="space-y-6">
      {/* Identity */}
      <Section label={t.customers.sectionIdentity}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label={t.customers.firstName}
            name="first_name"
            required
            defaultValue={initial.first_name}
            error={fieldError?.('first_name')}
          />
          <Field
            label={t.customers.lastName}
            name="last_name"
            required
            defaultValue={initial.last_name}
            error={fieldError?.('last_name')}
          />
          <Field
            label={t.customers.middleName}
            name="middle_name"
            defaultValue={initial.middle_name ?? ''}
          />
          <Field
            label={t.customers.dob}
            name="date_of_birth"
            type="date"
            defaultValue={initial.date_of_birth ?? ''}
          />
        </div>
      </Section>

      {/* Contact */}
      <Section label={t.customers.sectionContact}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label={t.customers.phone}
            name="phone"
            type="tel"
            defaultValue={initial.phone ?? ''}
          />
          <Field
            label={t.customers.phoneAlt}
            name="phone_alt"
            type="tel"
            defaultValue={initial.phone_alt ?? ''}
          />
          <Field
            label={t.customers.email}
            name="email"
            type="email"
            defaultValue={initial.email ?? ''}
            className="md:col-span-2"
          />
        </div>
      </Section>

      {/* Address */}
      <Section label={t.customers.sectionAddress}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label={t.customers.address1}
            name="address1"
            defaultValue={initial.address1 ?? ''}
            className="md:col-span-2"
          />
          <Field
            label={t.customers.address2}
            name="address2"
            defaultValue={initial.address2 ?? ''}
            className="md:col-span-2"
          />
          <Field
            label={t.customers.city}
            name="city"
            defaultValue={initial.city ?? ''}
          />
          <Field
            label={t.customers.state}
            name="state"
            defaultValue={initial.state ?? ''}
          />
          <Field
            label={t.customers.zip}
            name="zip"
            defaultValue={initial.zip ?? ''}
          />
          <Field
            label={t.customers.country}
            name="country"
            defaultValue={initial.country ?? 'US'}
          />
        </div>
      </Section>

      {/* Government ID */}
      <Section label={t.customers.sectionGovernmentId}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            label={t.customers.idType}
            name="id_type"
            defaultValue={initial.id_type ?? ''}
            error={fieldError?.('id_type')}
            options={[
              { value: '', label: '—' },
              {
                value: 'drivers_license',
                label: t.customers.idTypeDriversLicense,
              },
              { value: 'state_id', label: t.customers.idTypeStateId },
              { value: 'passport', label: t.customers.idTypePassport },
              { value: 'military_id', label: t.customers.idTypeMilitary },
              {
                value: 'permanent_resident_card',
                label: t.customers.idTypePermanentResident,
              },
              { value: 'other', label: t.customers.idTypeOther },
            ]}
          />
          <Field
            label={t.customers.idNumber}
            name="id_number"
            defaultValue={initial.id_number ?? ''}
          />
          <Field
            label={t.customers.idIssuingState}
            name="id_state"
            defaultValue={initial.id_state ?? ''}
          />
          <Field
            label={t.customers.idIssuingCountry}
            name="id_country"
            defaultValue={initial.id_country ?? 'US'}
          />
          <Field
            label={t.customers.idExpiry}
            name="id_expiry"
            type="date"
            defaultValue={initial.id_expiry ?? ''}
          />
        </div>
      </Section>

      {/* Physical description & employment — pawn-only */}
      {hasPawn ? (
        <Section
          label={t.customers.sectionPawnRequired}
          help={t.customers.sectionPawnRequiredHelp}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.customers.heightFeet}
              </span>
              <input
                type="number"
                min={1}
                max={8}
                value={heightFeet}
                onChange={(e) => setHeightFeet(e.target.value)}
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.customers.heightInches}
              </span>
              <input
                type="number"
                min={0}
                max={11}
                value={heightInches}
                onChange={(e) => setHeightInches(e.target.value)}
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
            </label>
            <input type="hidden" name="height_inches" value={composedHeight} />
            <Field
              label={t.customers.weightLbs}
              name="weight_lbs"
              type="number"
              defaultValue={
                initial.weight_lbs != null ? String(initial.weight_lbs) : ''
              }
            />
            <Field
              label={t.customers.sex}
              name="sex"
              defaultValue={initial.sex ?? ''}
              placeholder="M / F / X"
            />
            <Field
              label={t.customers.hairColor}
              name="hair_color"
              defaultValue={initial.hair_color ?? ''}
            />
            <Field
              label={t.customers.eyeColor}
              name="eye_color"
              defaultValue={initial.eye_color ?? ''}
            />
            <Field
              label={t.customers.placeOfEmployment}
              name="place_of_employment"
              defaultValue={initial.place_of_employment ?? ''}
              className="md:col-span-2"
            />
          </div>
          <div className="mt-3">
            <Textarea
              label={t.customers.identifyingMarks}
              name="identifying_marks"
              rows={2}
              defaultValue={initial.identifying_marks ?? ''}
              help={t.customers.identifyingMarksHelp}
            />
          </div>
        </Section>
      ) : null}

      {/* Preferences */}
      <Section label={t.customers.sectionPreferences}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            label={t.customers.commPreference}
            name="comm_preference"
            defaultValue={initial.comm_preference}
            error={fieldError?.('comm_preference')}
            options={[
              { value: 'sms', label: t.customers.commPrefSms },
              { value: 'email', label: t.customers.commPrefEmail },
              { value: 'whatsapp', label: t.customers.commPrefWhatsapp },
              { value: 'none', label: t.customers.commPrefNone },
            ]}
          />
          <Select
            label={t.customers.language}
            name="language"
            defaultValue={initial.language}
            error={fieldError?.('language')}
            options={[
              { value: 'en', label: t.lang.en },
              { value: 'es', label: t.lang.es },
            ]}
          />
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="marketing_opt_in"
            value="on"
            defaultChecked={initial.marketing_opt_in}
            className="h-4 w-4 rounded border-hairline text-rausch focus:ring-ink/10"
          />
          <span>{t.customers.marketingOptIn}</span>
        </label>
      </Section>

      {/* Staff-only */}
      <Section label={t.customers.sectionStaffOnly}>
        <Textarea
          label={t.customers.notes}
          name="notes"
          rows={3}
          defaultValue={initial.notes ?? ''}
          help={t.customers.notesHelp}
        />
        <div className="mt-3">
          <span className="block text-sm font-medium text-ink">
            {t.customers.tags}
          </span>
          <p className="mb-1 text-xs text-ash">{t.customers.tagsHelp}</p>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-canvas p-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-hairline bg-cloud px-2 py-0.5 text-xs text-ink"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-ash hover:text-ink"
                  aria-label={`remove ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                } else if (
                  e.key === 'Backspace' &&
                  !tagInput &&
                  tags.length > 0
                ) {
                  setTags(tags.slice(0, -1))
                }
              }}
              onBlur={addTag}
              className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-none"
            />
          </div>
          <input type="hidden" name="tags" value={tags.join(',')} />
        </div>
      </Section>
    </div>
  )
}

function Section({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{label}</legend>
      {help ? <p className="mt-1 text-xs text-ash">{help}</p> : null}
      <div className="mt-2">{children}</div>
    </fieldset>
  )
}

function Field({
  label,
  name,
  required,
  type = 'text',
  defaultValue,
  placeholder,
  error,
  className,
}: {
  label: string
  name: string
  required?: boolean
  type?: string
  defaultValue?: string
  placeholder?: string
  error?: string
  className?: string
}) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`block w-full rounded-md border bg-canvas px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
          error
            ? 'border-error focus:border-error'
            : 'border-hairline focus:border-ink'
        }`}
      />
      {error ? <span className="text-xs text-error">{error}</span> : null}
    </label>
  )
}

function Select({
  label,
  name,
  defaultValue,
  options,
  error,
  className,
}: {
  label: string
  name: string
  defaultValue?: string
  options: ReadonlyArray<{ value: string; label: string }>
  error?: string
  className?: string
}) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-sm font-medium text-ink">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className={`block w-full rounded-md border bg-canvas px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
          error
            ? 'border-error focus:border-error'
            : 'border-hairline focus:border-ink'
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-error">{error}</span> : null}
    </label>
  )
}

function Textarea({
  label,
  name,
  rows = 3,
  defaultValue,
  help,
}: {
  label: string
  name: string
  rows?: number
  defaultValue?: string
  help?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
      />
      {help ? <span className="text-xs text-ash">{help}</span> : null}
    </label>
  )
}
