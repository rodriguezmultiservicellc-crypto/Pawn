'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, Plus, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  ADDRESS_TYPES,
  BLANK_OFFICER,
  ENTITY_TYPES,
  type BusinessProfile,
  type Officer,
} from '@/lib/agency-forms/profile'
import { US_STATES } from '@/lib/agency-forms/us-states'
import { saveBusinessProfileAction, type SaveProfileState } from '../actions'

const INPUT =
  'block w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10'
const LABEL = 'flex flex-col gap-1 text-xs font-semibold text-foreground'

export default function ProfileForm({ initial }: { initial: BusinessProfile }) {
  const { t } = useI18n()
  const a = t.agencyForms
  const f = a.fields
  const [state, formAction, pending] = useActionState<SaveProfileState, FormData>(saveBusinessProfileAction, {})
  const [physicalSame, setPhysicalSame] = useState(initial.physical_same)
  const [officers, setOfficers] = useState<Officer[]>(
    initial.officers.length > 0 ? initial.officers : [{ ...BLANK_OFFICER }],
  )

  const err = (key: string) => {
    const code = state.fieldErrors?.[key]
    if (!code) return null
    const msg = (a.errors as Record<string, string>)[code] ?? a.errors.invalid
    return <span className="text-xs font-normal text-danger">{msg}</span>
  }

  const text = (name: keyof BusinessProfile, label: string, opts: { span?: string; inputMode?: 'numeric' | 'email' | 'tel' } = {}) => (
    <label className={`${LABEL} ${opts.span ?? ''}`}>
      {label}
      <input
        name={name}
        defaultValue={(initial[name] as string | number | null) ?? ''}
        inputMode={opts.inputMode}
        className={INPUT}
      />
      {err(name)}
    </label>
  )

  const stateSelect = (name: keyof BusinessProfile, label: string) => (
    <label className={LABEL}>
      {label}
      <select name={name} defaultValue={(initial[name] as string | null) ?? ''} className={INPUT}>
        <option value="">—</option>
        {US_STATES.map(([code, nm]) => (
          <option key={code} value={code}>
            {nm}
          </option>
        ))}
      </select>
      {err(name)}
    </label>
  )

  const typeSelect = (name: 'mailing_type' | 'physical_type', choices: readonly string[]) => (
    <label className={LABEL}>
      {f.address_type}
      <select name={name} defaultValue={initial[name] ?? ''} className={INPUT}>
        <option value="">—</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {a.addressTypes[c as keyof typeof a.addressTypes]}
          </option>
        ))}
      </select>
    </label>
  )

  const setOfficer = (i: number, patch: Partial<Officer>) =>
    setOfficers((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)))

  return (
    <form action={formAction} className="space-y-6">
      <div>
        <Link href="/government-forms" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft size={14} weight="bold" />
          {a.back}
        </Link>
        <h1 className="font-display mt-1 text-2xl font-bold text-foreground">{a.profileTitle}</h1>
        <p className="mt-1 text-sm text-muted">{a.profileSubtitle}</p>
      </div>

      <Section title={a.sections.company}>
        {text('legal_name', f.legal_name, { span: 'md:col-span-2' })}
        {text('ein', f.ein, { inputMode: 'numeric' })}
        <label className={LABEL}>
          {f.entity_type}
          <select name="entity_type" defaultValue={initial.entity_type ?? ''} className={INPUT}>
            <option value="">—</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e} value={e}>
                {a.entityTypes[e]}
              </option>
            ))}
          </select>
        </label>
        {stateSelect('incorporation_state', f.incorporation_state)}
        {text('incorporation_number', f.incorporation_number)}
        {text('year_established', f.year_established, { inputMode: 'numeric' })}
        {text('naics_code', f.naics_code, { inputMode: 'numeric' })}
        {text('duns', f.duns)}
        {text('business_description', f.business_description, { span: 'md:col-span-3' })}
      </Section>

      <Section title={a.sections.contact}>
        {text('phone', f.phone, { inputMode: 'tel' })}
        {text('phone_ext', f.phone_ext)}
        {text('fax', f.fax, { inputMode: 'tel' })}
        {text('email', f.email, { inputMode: 'email', span: 'md:col-span-2' })}
        {text('website', f.website)}
      </Section>

      <Section title={a.sections.mailing}>
        {text('mailing_address1', f.address1, { span: 'md:col-span-2' })}
        {text('mailing_address2', f.address2)}
        {text('mailing_city', f.city)}
        {stateSelect('mailing_state', f.state)}
        {text('mailing_zip', f.zip, { inputMode: 'numeric' })}
        {typeSelect('mailing_type', ADDRESS_TYPES)}
      </Section>

      <Section title={a.sections.physical}>
        <label className="flex items-center gap-2 text-sm text-foreground md:col-span-3">
          <input
            type="checkbox"
            name="physical_same"
            checked={physicalSame}
            onChange={(e) => setPhysicalSame(e.target.checked)}
            className="accent-gold"
          />
          {f.physical_same}
        </label>
        {physicalSame ? null : (
          <>
            {text('physical_address1', f.address1, { span: 'md:col-span-2' })}
            {text('physical_address2', f.address2)}
            {text('physical_city', f.city)}
            {stateSelect('physical_state', f.state)}
            {text('physical_zip', f.zip, { inputMode: 'numeric' })}
            {/* A physical location is never a P.O. box or a service center. */}
            {typeSelect('physical_type', ADDRESS_TYPES.filter((x) => x !== 'po_box' && x !== 'business_service_center'))}
          </>
        )}
      </Section>

      <Section title={a.sections.bank}>
        {text('bank_name', f.bank_name, { span: 'md:col-span-2' })}
        {text('bank_routing', f.bank_routing, { inputMode: 'numeric' })}
        {text('bank_city', f.bank_city)}
        {stateSelect('bank_state', f.bank_state)}
      </Section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{a.sections.officers}</h2>
        <p className="mt-1 text-xs text-muted">
          {f.first_officer_signs} {a.noSsnNote}
        </p>
        <input type="hidden" name="officers" value={JSON.stringify(officers)} />
        <div className="mt-3 space-y-4">
          {officers.map((o, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 md:grid-cols-6">
              <OfficerInput label={f.officer_title} value={o.title} onChange={(v) => setOfficer(i, { title: v })} span="md:col-span-2" />
              <OfficerInput label={f.officer_last} value={o.last_name} onChange={(v) => setOfficer(i, { last_name: v })} span="md:col-span-2" />
              <OfficerInput label={f.officer_first} value={o.first_name} onChange={(v) => setOfficer(i, { first_name: v })} />
              <OfficerInput label={f.officer_mi} value={o.middle_initial} onChange={(v) => setOfficer(i, { middle_initial: v.slice(0, 1).toUpperCase() })} />
              <OfficerInput label={f.officer_phone} value={o.phone} onChange={(v) => setOfficer(i, { phone: v })} span="md:col-span-2" />
              <OfficerInput label={f.officer_ext} value={o.phone_ext} onChange={(v) => setOfficer(i, { phone_ext: v })} />
              <OfficerInput label={f.officer_email} value={o.email} onChange={(v) => setOfficer(i, { email: v })} span="md:col-span-3" />
              <OfficerInput label={f.officer_home} value={o.home_address} onChange={(v) => setOfficer(i, { home_address: v })} span="md:col-span-5" />
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setOfficers((prev) => prev.filter((_, j) => j !== i))}
                  className="text-sm text-danger hover:underline"
                >
                  {f.remove_officer}
                </button>
              </div>
            </div>
          ))}
        </div>
        {officers.length < 8 ? (
          <button
            type="button"
            onClick={() => setOfficers((prev) => [...prev, { ...BLANK_OFFICER }])}
            className="mt-3 inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-gold"
          >
            <Plus size={14} weight="bold" />
            {f.add_officer}
          </button>
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
        >
          {pending ? t.common.saving : t.common.save}
        </button>
        {state.ok ? (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <CheckCircle size={16} weight="fill" />
            {a.saved}
          </span>
        ) : null}
        {state.error ? (
          <span className="inline-flex items-center gap-1 text-sm text-danger">
            <Warning size={16} weight="fill" />
            {state.error === 'invalid' ? a.errors.invalid : state.error}
          </span>
        ) : null}
      </div>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{children}</div>
    </section>
  )
}

function OfficerInput({
  label,
  value,
  onChange,
  span,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  span?: string
}) {
  return (
    <label className={`${LABEL} ${span ?? ''}`}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
    </label>
  )
}
