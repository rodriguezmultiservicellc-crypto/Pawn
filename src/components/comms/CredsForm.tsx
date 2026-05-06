'use client'

import { useState, useTransition } from 'react'
import { CheckCircle, FloppyDisk, Lock, LockOpen } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

export type CredsFormProps = {
  settings: {
    twilio_account_sid: string | null
    twilio_auth_token_set: boolean
    twilio_sms_from: string | null
    twilio_whatsapp_from: string | null
    twilio_messaging_service_sid: string | null
    resend_api_key_set: boolean
    resend_from_email: string | null
    resend_from_name: string | null
  }
  action: (
    prev: { ok: true } | { error: string; fieldErrors?: Record<string, string> } | null,
    formData: FormData,
  ) => Promise<{ ok: true } | { error: string; fieldErrors?: Record<string, string> }>
}

/**
 * Per-tenant Twilio + Resend credentials form. Auth-token + API key fields
 * stay masked once saved — submitting blank means "no change". A "Clear"
 * button on each masked field sets the underlying value to '__CLEAR__' so
 * the server action knows to nullify it.
 */
export function CredsForm({ settings, action }: CredsFormProps) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState<boolean>(false)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setSuccess(false)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await action(null, fd)
      if ('error' in res) {
        setError(res.error)
        setFieldErrors(res.fieldErrors ?? {})
      } else {
        setSuccess(true)
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-xl border border-border bg-card p-5"
    >
      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/5 px-3 py-1.5 text-sm text-success-deep">
          <CheckCircle size={14} weight="bold" />
          {t.comms.savedToast}
        </div>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-foreground">
          {t.comms.twilioSection}
        </legend>
        <p className="text-xs text-muted">{t.comms.twilioHelp}</p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label={t.comms.twilioAccountSid}
            name="twilio_account_sid"
            defaultValue={settings.twilio_account_sid ?? ''}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            error={fieldErrors['twilio_account_sid']}
          />
          <SecretField
            label={t.comms.twilioAuthToken}
            name="twilio_auth_token"
            isSet={settings.twilio_auth_token_set}
            error={fieldErrors['twilio_auth_token']}
          />
          <Field
            label={t.comms.twilioSmsFrom}
            name="twilio_sms_from"
            defaultValue={settings.twilio_sms_from ?? ''}
            placeholder="+18135551234"
            error={fieldErrors['twilio_sms_from']}
            help={t.comms.twilioSmsFromHelp}
          />
          <Field
            label={t.comms.twilioWhatsappFrom}
            name="twilio_whatsapp_from"
            defaultValue={settings.twilio_whatsapp_from ?? ''}
            placeholder="+18135551234"
            error={fieldErrors['twilio_whatsapp_from']}
            help={t.comms.twilioWhatsappFromHelp}
          />
          <Field
            label={t.comms.twilioMessagingServiceSid}
            name="twilio_messaging_service_sid"
            defaultValue={settings.twilio_messaging_service_sid ?? ''}
            placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            error={fieldErrors['twilio_messaging_service_sid']}
            help={t.comms.twilioMessagingServiceSidHelp}
          />
        </div>
      </fieldset>

      <hr className="border-border" />

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-foreground">
          {t.comms.resendSection}
        </legend>
        <p className="text-xs text-muted">{t.comms.resendHelp}</p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SecretField
            label={t.comms.resendApiKey}
            name="resend_api_key"
            isSet={settings.resend_api_key_set}
            error={fieldErrors['resend_api_key']}
          />
          <Field
            label={t.comms.resendFromEmail}
            name="resend_from_email"
            type="email"
            defaultValue={settings.resend_from_email ?? ''}
            placeholder="hello@yourshop.com"
            error={fieldErrors['resend_from_email']}
          />
          <Field
            label={t.comms.resendFromName}
            name="resend_from_name"
            defaultValue={settings.resend_from_name ?? ''}
            placeholder="Your Shop"
            error={fieldErrors['resend_from_name']}
          />
        </div>
      </fieldset>

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          <FloppyDisk size={14} weight="bold" />
          {pending ? t.common.saving : t.common.save}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  name,
  defaultValue,
  type,
  placeholder,
  error,
  help,
}: {
  label: string
  name: string
  defaultValue: string
  type?: string
  placeholder?: string
  error?: string
  help?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type={type ?? 'text'}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`block w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
          error ? 'border-danger' : 'border-border focus:border-blue'
        }`}
      />
      {help ? <span className="block text-xs text-muted">{help}</span> : null}
      {error ? <span className="block text-xs text-danger">{error}</span> : null}
    </label>
  )
}

function SecretField({
  label,
  name,
  isSet,
  error,
}: {
  label: string
  name: string
  isSet: boolean
  error?: string
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<boolean>(!isSet)
  const [value, setValue] = useState<string>('')
  const [clear, setClear] = useState<boolean>(false)

  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">
        <span>{label}</span>
        {isSet ? (
          <span className="inline-flex items-center gap-1 text-xs text-success-deep">
            <Lock size={11} weight="bold" />
            {t.comms.secretConfigured}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <LockOpen size={11} weight="bold" />
            {t.comms.secretMissing}
          </span>
        )}
      </span>
      {editing ? (
        <input
          type="password"
          name={name}
          value={clear ? '__CLEAR__' : value}
          onChange={(e) => {
            setClear(false)
            setValue(e.target.value)
          }}
          placeholder={isSet ? t.comms.secretLeaveBlank : ''}
          className={`block w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
            error ? 'border-danger' : 'border-border focus:border-blue'
          }`}
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value="••••••••••••••••"
            readOnly
            className="block flex-1 rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted"
          />
          {/* Hidden name="" so submitting unchanged sends nothing for this field. */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
          >
            {t.common.update}
          </button>
        </div>
      )}
      {editing && isSet ? (
        <button
          type="button"
          onClick={() => setClear(true)}
          className="text-xs text-danger hover:underline"
        >
          {t.comms.secretClear}
        </button>
      ) : null}
      {error ? <span className="block text-xs text-danger">{error}</span> : null}
    </label>
  )
}
