'use client'

import { useActionState, useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowLeft,
  Camera,
  Eye,
  Trash,
  Upload,
  Prohibit,
  User,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  CustomerFormFields,
  type CustomerFieldValues,
} from '@/components/customers/CustomerFormFields'
import { PortalInvitePanel } from '@/components/customers/PortalInvitePanel'
import WebcamCapture from '@/components/customers/WebcamCapture'
import {
  banCustomerAction,
  deleteCustomerAction,
  deleteCustomerDocumentAction,
  updateCustomerAction,
  uploadCustomerDocumentAction,
  uploadCustomerPhotoAction,
  type UpdateCustomerState,
} from './actions'
import type {
  CommPreference,
  CustomerDocKind,
  IdDocumentType,
  Language,
  LayawayStatus,
  LoanStatus,
  RepairStatus,
  SaleKind,
  SaleStatus,
  ServiceType,
} from '@/types/database-aliases'
import { ServiceTypeBadge } from '@/components/repair/ServiceTypeBadge'
import { StatusBadge as RepairStatusBadge } from '@/components/repair/StatusBadge'
import {
  LayawayStatusBadge,
  SaleStatusBadge,
} from '@/components/pos/Badges'
import LoyaltyPanel, {
  type LoyaltyEventView,
} from '@/components/loyalty/LoyaltyPanel'

/**
 * Map a flat string-only echo from the server-action error response back
 * into CustomerFieldValues so uncontrolled inputs can be repopulated
 * after React 19's auto-form-reset.
 */
function echoToCustomerFieldValues(
  echo: Record<string, string>,
  fallback: CustomerFieldValues,
): CustomerFieldValues {
  const s = (k: string): string | null => {
    const v = echo[k]
    return v == null || v === '' ? null : v
  }
  const num = (k: string): number | null => {
    const v = echo[k]
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    ...fallback,
    first_name: echo.first_name ?? '',
    last_name: echo.last_name ?? '',
    middle_name: s('middle_name'),
    date_of_birth: s('date_of_birth'),
    phone: s('phone'),
    phone_alt: s('phone_alt'),
    email: s('email'),
    address1: s('address1'),
    address2: s('address2'),
    city: s('city'),
    state: s('state'),
    zip: s('zip'),
    country: echo.country || 'US',
    id_type: (s('id_type') as IdDocumentType | null) ?? null,
    id_number: s('id_number'),
    id_state: s('id_state'),
    id_country: echo.id_country || 'US',
    id_expiry: s('id_expiry'),
    comm_preference: (echo.comm_preference || 'sms') as CommPreference,
    language: (echo.language || 'en') as Language,
    marketing_opt_in: echo.marketing_opt_in === 'on',
    height_inches: num('height_inches'),
    weight_lbs: num('weight_lbs'),
    sex: s('sex'),
    hair_color: s('hair_color'),
    eye_color: s('eye_color'),
    identifying_marks: s('identifying_marks'),
    place_of_employment: s('place_of_employment'),
    notes: s('notes'),
    tags:
      typeof echo.tags === 'string' && echo.tags.trim() !== ''
        ? echo.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
  }
}

export type CustomerLoanRow = {
  id: string
  ticket_number: string
  principal: number
  due_date: string
  status: LoanStatus
  created_at: string
}

export type CustomerRepairRow = {
  id: string
  ticket_number: string
  service_type: ServiceType
  title: string
  promised_date: string | null
  status: RepairStatus
  balance_due: number | null
  created_at: string
}

export type CustomerSaleRow = {
  id: string
  sale_number: string
  sale_kind: SaleKind
  status: SaleStatus
  total: number
  completed_at: string | null
  created_at: string
}

export type CustomerLayawayRow = {
  id: string
  layaway_number: string
  status: LayawayStatus
  total_due: number
  paid_total: number
  balance_remaining: number
  first_payment_due: string | null
  created_at: string
}

export type CustomerDocumentItem = {
  id: string
  kind: CustomerDocKind
  mime_type: string | null
  id_type: IdDocumentType | null
  id_number: string | null
  id_state: string | null
  id_expiry: string | null
  created_at: string
  signed_url: string | null
}

type CustomerRecord = {
  id: string
  tenant_id: string
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
  height_inches: number | null
  weight_lbs: number | null
  sex: string | null
  hair_color: string | null
  eye_color: string | null
  identifying_marks: string | null
  place_of_employment: string | null
  notes: string | null
  tags: string[] | null
  is_banned: boolean
  banned_reason: string | null
  banned_at: string | null
  banned_by: string | null
  created_at: string
  updated_at: string
}

export type PortalInfo = {
  hasPortalAccess: boolean
  lastInvite: {
    sentAt: string
    expiresAt: string
    consumedAt: string | null
  } | null
  canManage: boolean
  portalLoginUrl: string
}

export default function CustomerDetail({
  customer,
  documents,
  hasPawn = false,
  hasRepair = false,
  hasRetail = false,
  photoSignedUrl,
  loans = [],
  repairs = [],
  sales = [],
  layaways = [],
  portal,
  loyalty,
}: {
  customer: CustomerRecord
  documents: CustomerDocumentItem[]
  hasPawn?: boolean
  hasRepair?: boolean
  hasRetail?: boolean
  photoSignedUrl?: string | null
  loans?: CustomerLoanRow[]
  repairs?: CustomerRepairRow[]
  sales?: CustomerSaleRow[]
  layaways?: CustomerLayawayRow[]
  portal: PortalInfo
  loyalty: {
    enabled: boolean
    balance: number
    referralCode: string | null
    recentEvents: LoyaltyEventView[]
    redemptionRate: number
    canAdjust: boolean
  }
}) {
  const { t } = useI18n()

  const [state, formAction, pending] = useActionState<
    UpdateCustomerState,
    FormData
  >(updateCustomerAction, {})

  const fieldError = (key: string) => state.fieldErrors?.[key]

  const recordInitial: CustomerFieldValues = {
    first_name: customer.first_name,
    last_name: customer.last_name,
    middle_name: customer.middle_name,
    date_of_birth: customer.date_of_birth,
    phone: customer.phone,
    phone_alt: customer.phone_alt,
    email: customer.email,
    address1: customer.address1,
    address2: customer.address2,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    country: customer.country ?? 'US',
    id_type: customer.id_type,
    id_number: customer.id_number,
    id_state: customer.id_state,
    id_country: customer.id_country ?? 'US',
    id_expiry: customer.id_expiry,
    comm_preference: customer.comm_preference,
    language: customer.language,
    marketing_opt_in: customer.marketing_opt_in,
    height_inches: customer.height_inches,
    weight_lbs: customer.weight_lbs,
    sex: customer.sex,
    hair_color: customer.hair_color,
    eye_color: customer.eye_color,
    identifying_marks: customer.identifying_marks,
    place_of_employment: customer.place_of_employment,
    notes: customer.notes,
    tags: customer.tags ?? [],
  }

  // The form uses uncontrolled defaultValue inputs. React 19 auto-resets
  // <form action={fn}> after submission, so on a validation error we
  // bump a key + repopulate from the echoed FormData so the operator's
  // edits aren't lost.
  //
  // Implemented via the official "compute state during render based on
  // prev state" pattern (https://react.dev/reference/react/useState
  // #storing-information-from-previous-renders). React handles setState
  // calls during render by re-rendering immediately without flushing.
  // This avoids react-hooks/set-state-in-effect + react-hooks/refs.
  const initial: CustomerFieldValues = state.values
    ? echoToCustomerFieldValues(state.values, recordInitial)
    : recordInitial
  const [lastState, setLastState] = useState(state)
  const [formGen, setFormGen] = useState(0)
  if (state !== lastState) {
    setLastState(state)
    if (state.values) setFormGen((g) => g + 1)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/customers"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeft size={14} weight="bold" />
            {t.customers.backToList}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {customer.is_banned ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-medium text-danger">
              <Prohibit size={12} weight="bold" />
              {t.customers.bannedBadge}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-start gap-4">
        <PhotoBlock
          customerId={customer.id}
          signedUrl={photoSignedUrl ?? null}
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold">
            {customer.last_name}, {customer.first_name}
            {customer.middle_name ? ` ${customer.middle_name}` : ''}
          </h1>
          {customer.phone || customer.email ? (
            <div className="mt-1 text-sm text-muted">
              {[customer.phone, customer.email].filter(Boolean).join(' · ')}
            </div>
          ) : null}
        </div>
      </div>

      {state.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}
      {state.ok ? (
        <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          {t.common.save} ✓
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="id" value={customer.id} />
        <CustomerFormFields
          key={formGen}
          initial={initial}
          fieldError={fieldError}
          hasPawn={hasPawn}
        />

        <BanSection
          customerId={customer.id}
          isBanned={customer.is_banned}
          bannedReason={customer.banned_reason}
        />

        <div className="flex items-center justify-end gap-3">
          <DeleteCustomerButton customerId={customer.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? t.common.saving : t.customers.submitUpdate}
          </button>
        </div>
      </form>

      <DocumentsPanel
        customerId={customer.id}
        documents={documents}
        defaultIdType={customer.id_type}
        defaultIdNumber={customer.id_number}
        defaultIdState={customer.id_state}
        defaultIdExpiry={customer.id_expiry}
      />

      <LoyaltyPanel
        enabled={loyalty.enabled}
        customer={{
          id: customer.id,
          first_name: customer.first_name,
          last_name: customer.last_name,
          loyalty_points_balance: loyalty.balance,
          referral_code: loyalty.referralCode,
          is_banned: !!customer.is_banned,
        }}
        recentEvents={loyalty.recentEvents}
        redemptionRate={loyalty.redemptionRate}
        canAdjust={loyalty.canAdjust}
      />

      <PortalInvitePanel
        customerId={customer.id}
        customerEmail={customer.email}
        hasPortalAccess={portal.hasPortalAccess}
        lastInvite={portal.lastInvite}
        canManage={portal.canManage}
        portalLoginUrl={portal.portalLoginUrl}
      />

      {hasPawn ? (
        <CustomerLoansPanel customerId={customer.id} loans={loans} />
      ) : null}

      {hasRepair ? (
        <CustomerRepairsPanel customerId={customer.id} repairs={repairs} />
      ) : null}

      {hasRetail ? (
        <CustomerSalesPanel customerId={customer.id} sales={sales} />
      ) : null}

      {hasRetail ? (
        <CustomerLayawaysPanel
          customerId={customer.id}
          layaways={layaways}
        />
      ) : null}
    </div>
  )
}

function CustomerSalesPanel({
  customerId,
  sales,
}: {
  customerId: string
  sales: CustomerSaleRow[]
}) {
  const { t } = useI18n()
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
        <span>{t.pos.customerSales.title}</span>
        <Link
          href={`/pos/sales?customer=${customerId}`}
          className="text-xs font-normal text-muted hover:text-foreground"
        >
          {t.pos.customerSales.viewAll}
        </Link>
      </legend>
      {sales.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          {t.pos.customerSales.empty}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {sales.map((s) => (
            <li key={s.id}>
              <Link
                href={`/pos/sales/${s.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-background"
              >
                <div className="font-mono text-xs text-foreground">
                  {s.sale_number}
                </div>
                <div className="flex-1 px-3 font-mono text-xs text-foreground">
                  {s.total.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 2,
                  })}
                </div>
                <div className="font-mono text-xs text-muted">
                  {(s.completed_at ?? s.created_at).slice(0, 10)}
                </div>
                <SaleStatusBadge status={s.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}

function CustomerLayawaysPanel({
  customerId,
  layaways,
}: {
  customerId: string
  layaways: CustomerLayawayRow[]
}) {
  const { t } = useI18n()
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
        <span>{t.pos.customerLayaways.title}</span>
        <Link
          href={`/pos/layaways?customer=${customerId}`}
          className="text-xs font-normal text-muted hover:text-foreground"
        >
          {t.pos.customerLayaways.viewAll}
        </Link>
      </legend>
      {layaways.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          {t.pos.customerLayaways.empty}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {layaways.map((l) => (
            <li key={l.id}>
              <Link
                href={`/pos/layaways/${l.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-background"
              >
                <div className="font-mono text-xs text-foreground">
                  {l.layaway_number}
                </div>
                <div className="flex-1 px-3 font-mono text-xs text-foreground">
                  {l.balance_remaining.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 2,
                  })}
                </div>
                <div className="font-mono text-xs text-muted">
                  {l.first_payment_due ?? '—'}
                </div>
                <LayawayStatusBadge status={l.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}

function CustomerRepairsPanel({
  customerId,
  repairs,
}: {
  customerId: string
  repairs: CustomerRepairRow[]
}) {
  const { t } = useI18n()
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
        <span>{t.repair.customerTickets.title}</span>
        <Link
          href={`/repair?customer=${customerId}`}
          className="text-xs font-normal text-muted hover:text-foreground"
        >
          {t.repair.customerTickets.viewAll}
        </Link>
      </legend>
      {repairs.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t.repair.customerTickets.empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {repairs.map((r) => (
            <li key={r.id}>
              <Link
                href={`/repair/${r.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-background"
              >
                <div className="font-mono text-xs text-foreground">
                  {r.ticket_number}
                </div>
                <ServiceTypeBadge type={r.service_type} />
                <div className="flex-1 px-2 text-xs text-foreground line-clamp-1">
                  {r.title}
                </div>
                <div className="font-mono text-xs text-muted">
                  {r.promised_date ?? '—'}
                </div>
                <div className="font-mono text-xs text-foreground">
                  {r.balance_due == null
                    ? '—'
                    : r.balance_due.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: 2,
                      })}
                </div>
                <RepairStatusBadge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}

function CustomerLoansPanel({
  customerId,
  loans,
}: {
  customerId: string
  loans: CustomerLoanRow[]
}) {
  const { t } = useI18n()
  const STATUS_BADGE: Record<LoanStatus, { bg: string; text: string }> = {
    active: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
    extended: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
    partial_paid: {
      bg: 'bg-warning/10 border-warning/30',
      text: 'text-warning',
    },
    redeemed: { bg: 'bg-background border-border', text: 'text-muted' },
    forfeited: { bg: 'bg-background border-border', text: 'text-muted' },
    voided: { bg: 'bg-background border-border', text: 'text-muted' },
  }
  const STATUS_LABEL: Record<LoanStatus, string> = {
    active: t.pawn.statusActive,
    extended: t.pawn.statusExtended,
    partial_paid: t.pawn.statusPartialPaid,
    redeemed: t.pawn.statusRedeemed,
    forfeited: t.pawn.statusForfeited,
    voided: t.pawn.statusVoided,
  }
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
        <span>{t.pawn.customerLoans.title}</span>
        <Link
          href={`/pawn?customer=${customerId}`}
          className="text-xs font-normal text-muted hover:text-foreground"
        >
          {t.pawn.customerLoans.viewAll}
        </Link>
      </legend>
      {loans.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t.pawn.customerLoans.empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {loans.map((l) => {
            const badge = STATUS_BADGE[l.status]
            return (
              <li key={l.id}>
                <Link
                  href={`/pawn/${l.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-background"
                >
                  <div className="font-mono text-xs text-foreground">
                    {l.ticket_number}
                  </div>
                  <div className="flex-1 px-3 font-mono text-xs text-foreground">
                    {l.principal.toLocaleString('en-US', {
                      style: 'currency',
                      currency: 'USD',
                      minimumFractionDigits: 2,
                    })}
                  </div>
                  <div className="font-mono text-xs text-muted">{l.due_date}</div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
                  >
                    {STATUS_LABEL[l.status]}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </fieldset>
  )
}

function PhotoBlock({
  customerId,
  signedUrl,
}: {
  customerId: string
  signedUrl: string | null
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onPick() {
    setError(null)
    ref.current?.click()
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('file', file)
    startTransition(async () => {
      const res = await uploadCustomerPhotoAction(fd)
      if (res.error) setError(res.error)
      if (ref.current) ref.current.value = ''
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={onPick}
        disabled={pending}
        className="group relative h-24 w-24 overflow-hidden rounded-full border border-border bg-background disabled:opacity-50"
        title="Upload photo"
      >
        {signedUrl ? (
          <Image
            src={signedUrl}
            alt=""
            fill
            sizes="96px"
            unoptimized
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <User size={36} weight="light" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-navy/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Camera size={20} weight="bold" className="text-white" />
        </div>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        onChange={onChange}
        className="sr-only"
      />
      {error ? <div className="mt-1 text-xs text-danger">{error}</div> : null}
    </div>
  )
}

function BanSection({
  customerId,
  isBanned,
  bannedReason,
}: {
  customerId: string
  isBanned: boolean
  bannedReason: string | null
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState(bannedReason ?? '')

  function toggleBan() {
    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('is_banned', !isBanned ? 'on' : '')
    if (!isBanned) fd.set('reason', reason)
    startTransition(() => {
      banCustomerAction(fd)
    })
  }

  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">
        {t.customers.sectionBan}
      </legend>
      <div className="mt-2 space-y-3">
        {isBanned ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-foreground">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-danger">
                  {t.customers.isBanned}
                </div>
                {bannedReason ? (
                  <div className="mt-1 text-foreground">{bannedReason}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={toggleBan}
                disabled={pending}
                className="shrink-0 rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
              >
                {pending ? t.common.saving : t.common.remove}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.customers.bannedReason}
              </span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>
            <button
              type="button"
              onClick={toggleBan}
              disabled={pending}
              className="rounded-md border border-danger/30 bg-danger/5 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              {pending ? t.common.saving : t.customers.isBanned}
            </button>
          </div>
        )}
      </div>
    </fieldset>
  )
}

function DeleteCustomerButton({ customerId }: { customerId: string }) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()

  function onClick() {
    if (!confirm(t.customers.confirmDelete)) return
    const fd = new FormData()
    fd.set('id', customerId)
    startTransition(() => {
      deleteCustomerAction(fd)
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
    >
      <Trash size={14} weight="bold" />
      {pending ? t.common.saving : t.common.delete}
    </button>
  )
}

function DocumentsPanel({
  customerId,
  documents,
  defaultIdType,
  defaultIdNumber,
  defaultIdState,
  defaultIdExpiry,
}: {
  customerId: string
  documents: CustomerDocumentItem[]
  defaultIdType: IdDocumentType | null
  defaultIdNumber: string | null
  defaultIdState: string | null
  defaultIdExpiry: string | null
}) {
  const { t } = useI18n()

  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">
        {t.customers.sectionDocuments}
      </legend>
      <div className="mt-2 space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <UploadButton
            customerId={customerId}
            kind="id_scan"
            label={t.customers.uploadIdScan}
            defaultIdType={defaultIdType}
            defaultIdNumber={defaultIdNumber}
            defaultIdState={defaultIdState}
            defaultIdExpiry={defaultIdExpiry}
          />
          <WebcamCaptureForId
            customerId={customerId}
            defaultIdType={defaultIdType}
            defaultIdNumber={defaultIdNumber}
            defaultIdState={defaultIdState}
            defaultIdExpiry={defaultIdExpiry}
          />
          <UploadButton
            customerId={customerId}
            kind="signature"
            label={t.customers.uploadSignature}
          />
        </div>

        {documents.length === 0 ? (
          <p className="text-sm text-muted">{t.customers.documentNone}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {doc.kind === 'id_scan'
                      ? t.customers.documentIdScan
                      : t.customers.documentSignature}
                    {doc.id_type ? (
                      <span className="ml-2 text-xs text-muted">
                        {labelForIdType(doc.id_type, t)}
                        {doc.id_state ? ` · ${doc.id_state}` : ''}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted">
                    {t.customers.capturedOn}{' '}
                    {new Date(doc.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {doc.signed_url ? (
                    <a
                      href={doc.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-background hover:text-foreground"
                    >
                      <Eye size={12} weight="bold" />
                      {t.customers.viewDocument}
                    </a>
                  ) : null}
                  <DeleteDocumentButton
                    documentId={doc.id}
                    customerId={customerId}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  )
}

function labelForIdType(
  type: IdDocumentType,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (type) {
    case 'drivers_license':
      return t.customers.idTypeDriversLicense
    case 'state_id':
      return t.customers.idTypeStateId
    case 'passport':
      return t.customers.idTypePassport
    case 'military_id':
      return t.customers.idTypeMilitary
    case 'permanent_resident_card':
      return t.customers.idTypePermanentResident
    case 'other':
      return t.customers.idTypeOther
  }
}

function UploadButton({
  customerId,
  kind,
  label,
  defaultIdType,
  defaultIdNumber,
  defaultIdState,
  defaultIdExpiry,
}: {
  customerId: string
  kind: CustomerDocKind
  label: string
  defaultIdType?: IdDocumentType | null
  defaultIdNumber?: string | null
  defaultIdState?: string | null
  defaultIdExpiry?: string | null
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    ref.current?.click()
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('kind', kind)
    fd.set('file', file)
    if (kind === 'id_scan') {
      if (defaultIdType) fd.set('id_type', defaultIdType)
      if (defaultIdNumber) fd.set('id_number', defaultIdNumber)
      if (defaultIdState) fd.set('id_state', defaultIdState)
      if (defaultIdExpiry) fd.set('id_expiry', defaultIdExpiry)
    }
    startTransition(async () => {
      const res = await uploadCustomerDocumentAction(fd)
      if (res.error) setError(res.error)
      if (ref.current) ref.current.value = ''
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-3 text-sm font-medium text-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
      >
        <Upload size={14} weight="bold" />
        {pending ? t.common.uploading : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        onChange={onChange}
        className="sr-only"
      />
      {error ? (
        <div className="mt-1 text-xs text-danger">{error}</div>
      ) : null}
    </div>
  )
}

/**
 * Wrap the generic WebcamCapture component to upload its captured Blob
 * through the same uploadCustomerDocumentAction the file-picker
 * UploadButton uses. Carries the customer's existing id_type / number /
 * state / expiry so the new id_scan row inherits them — same shape as
 * UploadButton.
 */
function WebcamCaptureForId({
  customerId,
  defaultIdType,
  defaultIdNumber,
  defaultIdState,
  defaultIdExpiry,
}: {
  customerId: string
  defaultIdType: IdDocumentType | null
  defaultIdNumber: string | null
  defaultIdState: string | null
  defaultIdExpiry: string | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onCapture(blob: Blob) {
    setError(null)
    setPending(true)
    try {
      const fd = new FormData()
      fd.set('customer_id', customerId)
      fd.set('kind', 'id_scan')
      // Server validates MIME against ALLOWED_DOCUMENT_MIME_TYPES; the
      // capture component encodes JPEG so we name the file accordingly.
      fd.set('file', new File([blob], `id-front-${Date.now()}.jpg`, { type: blob.type }))
      if (defaultIdType) fd.set('id_type', defaultIdType)
      if (defaultIdNumber) fd.set('id_number', defaultIdNumber)
      if (defaultIdState) fd.set('id_state', defaultIdState)
      if (defaultIdExpiry) fd.set('id_expiry', defaultIdExpiry)
      const res = await uploadCustomerDocumentAction(fd)
      if (res.error) setError(res.error)
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <WebcamCapture
        onCapture={onCapture}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-3 text-sm font-medium text-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
      />
      {error ? <div className="mt-1 text-xs text-danger">{error}</div> : null}
    </div>
  )
}

function DeleteDocumentButton({
  documentId,
  customerId,
}: {
  documentId: string
  customerId: string
}) {
  const [pending, startTransition] = useTransition()
  function onClick() {
    const fd = new FormData()
    fd.set('document_id', documentId)
    fd.set('customer_id', customerId)
    startTransition(() => {
      deleteCustomerDocumentAction(fd)
    })
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted hover:text-danger disabled:opacity-50"
      aria-label="delete"
    >
      <Trash size={12} weight="bold" />
    </button>
  )
}
