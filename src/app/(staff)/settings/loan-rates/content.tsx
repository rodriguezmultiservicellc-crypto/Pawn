'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle,
  PencilSimple,
  Plus,
  Star,
  Trash,
  Warning,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  saveLoanRateAction,
  saveTenantLoanPolicyAction,
  deleteLoanRateAction,
  type SaveRateState,
  type SavePolicyState,
} from './actions'

export type LoanRateRow = {
  id: string
  rateMonthly: number
  minMonthlyCharge: number | null
  label: string
  description: string | null
  sortOrder: number
  isDefault: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function LoanRatesContent({
  rows,
  minLoanAmount,
}: {
  rows: LoanRateRow[]
  minLoanAmount: number | null
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<LoanRateRow | 'new' | null>(null)

  const active = rows.filter((r) => r.isActive)
  const inactive = rows.filter((r) => !r.isActive)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.common.back}
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            {t.settingsLoanRates.title}
          </h1>
          <p className="mt-1 text-sm text-ash">
            {t.settingsLoanRates.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1 rounded-md bg-rausch px-3 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep"
        >
          <Plus size={14} weight="bold" />
          {t.settingsLoanRates.add}
        </button>
      </header>

      <PolicyCard initial={minLoanAmount} />

      <RateTable
        title={t.settingsLoanRates.activeTitle}
        rows={active}
        onEdit={(r) => setEditing(r)}
      />

      {inactive.length > 0 ? (
        <RateTable
          title={t.settingsLoanRates.deactivatedTitle}
          rows={inactive}
          onEdit={(r) => setEditing(r)}
          dim
        />
      ) : null}

      {editing ? (
        <EditDialog
          row={editing === 'new' ? null : editing}
          existingDefault={
            rows.find((r) => r.isDefault)?.id ?? null
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}

function PolicyCard({ initial }: { initial: number | null }) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    SavePolicyState,
    FormData
  >(saveTenantLoanPolicyAction, {})

  const fe = state.fieldErrors?.['min_loan_amount']

  return (
    <section className="rounded-lg border border-hairline bg-canvas p-4">
      <h2 className="text-sm font-semibold text-ink">
        {t.settingsLoanRates.policyTitle}
      </h2>
      <p className="mt-1 text-xs text-ash">
        {t.settingsLoanRates.policySubtitle}
      </p>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.settingsLoanRates.minLoanAmountLabel}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ash">$</span>
            <input
              type="number"
              name="min_loan_amount"
              step="0.01"
              min={0}
              defaultValue={initial == null ? '' : initial.toString()}
              placeholder={t.settingsLoanRates.minLoanAmountPlaceholder}
              className={`block w-40 rounded-md border bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
                fe ? 'border-error/60' : 'border-hairline'
              }`}
            />
          </div>
          {fe ? (
            <span className="block text-xs text-error">{fe}</span>
          ) : (
            <span className="block text-xs text-ash">
              {t.settingsLoanRates.minLoanAmountHint}
            </span>
          )}
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rausch px-3 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
        >
          {pending ? t.common.saving : t.common.save}
        </button>
        {state.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle size={12} weight="bold" />
            {t.common.save} ✓
          </span>
        ) : null}
        {state.error ? (
          <span className="inline-flex items-center gap-1 text-xs text-error">
            <Warning size={12} weight="bold" />
            {state.error}
          </span>
        ) : null}
      </form>
    </section>
  )
}

function RateTable({
  title,
  rows,
  onEdit,
  dim = false,
}: {
  title: string
  rows: LoanRateRow[]
  onEdit: (r: LoanRateRow) => void
  dim?: boolean
}) {
  const { t } = useI18n()
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-ink">{title}</h2>
      <div
        className={`overflow-hidden rounded-lg border border-hairline ${
          dim ? 'opacity-60' : ''
        }`}
      >
        <table className="w-full text-sm">
          <thead className="bg-cloud text-xs text-ash">
            <tr>
              <th className="w-16 px-3 py-2 text-left font-medium" />
              <th className="px-3 py-2 text-right font-medium">
                {t.settingsLoanRates.rateColumn}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {t.settingsLoanRates.labelColumn}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {t.settingsLoanRates.descriptionColumn}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t.common.actions}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-center">
                  {r.isDefault ? (
                    <Star
                      size={14}
                      weight="fill"
                      className="inline text-rausch"
                      aria-label={t.settingsLoanRates.defaultBadge}
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right font-mono text-ink">
                  <div>{(r.rateMonthly * 100).toFixed(2)}% / mo</div>
                  {r.minMonthlyCharge != null ? (
                    <div className="text-xs text-ash">
                      {t.settingsLoanRates.minMonthlyChargeShort.replace(
                        '{amount}',
                        `$${r.minMonthlyCharge.toFixed(2)}`,
                      )}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-ink">{r.label}</td>
                <td className="px-3 py-2 text-xs text-ash">
                  {r.description ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onEdit(r)}
                    className="inline-flex items-center gap-1 rounded-md border border-hairline bg-canvas px-2 py-1 text-xs text-ink hover:border-ink"
                  >
                    <PencilSimple size={11} weight="bold" />
                    {t.common.edit}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-sm text-ash"
                >
                  {t.settingsLoanRates.empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EditDialog({
  row,
  existingDefault,
  onClose,
}: {
  row: LoanRateRow | null
  existingDefault: string | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<SaveRateState, FormData>(
    saveLoanRateAction,
    {},
  )
  const [delState, delAction, delPending] = useActionState<
    { ok?: boolean; error?: string },
    FormData
  >(deleteLoanRateAction, {})

  const fe = (k: string) => state.fieldErrors?.[k]

  if (state.ok || delState.ok) {
    setTimeout(onClose, 250)
  }

  const isDefault = row?.isDefault ?? false
  const wouldReplaceDefault =
    !isDefault && existingDefault !== null && existingDefault !== (row?.id ?? null)

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
    >
      <div className="w-full max-w-lg rounded-lg border border-hairline bg-canvas p-5 shadow-lg">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">
            {row ? t.settingsLoanRates.editTitle : t.settingsLoanRates.addTitle}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ash hover:bg-cloud hover:text-ink"
            aria-label="close"
          >
            ×
          </button>
        </header>

        {state.error || delState.error ? (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
            <Warning size={14} weight="bold" />
            <span>
              {translateError(state.error ?? delState.error ?? '', t)}
            </span>
          </div>
        ) : null}
        {state.ok || delState.ok ? (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
            <CheckCircle size={14} weight="bold" />
            <span>{t.common.save} ✓</span>
          </div>
        ) : null}

        <form action={formAction} className="space-y-3">
          {row ? <input type="hidden" name="id" value={row.id} /> : null}

          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.settingsLoanRates.fieldRate} *
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                name="rate_monthly"
                required
                step="0.0001"
                min={0}
                max={0.25}
                defaultValue={row?.rateMonthly?.toString() ?? '0.10'}
                className={`block w-32 rounded-md border bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
                  fe('rate_monthly') ? 'border-error/60' : 'border-hairline'
                }`}
              />
              <span className="text-xs text-ash">
                {t.settingsLoanRates.fieldRateHint}
              </span>
            </div>
            {fe('rate_monthly') ? (
              <span className="block text-xs text-error">
                {fe('rate_monthly')}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.settingsLoanRates.fieldMinMonthlyCharge}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-ash">$</span>
              <input
                type="number"
                name="min_monthly_charge"
                step="0.01"
                min={0}
                defaultValue={
                  row?.minMonthlyCharge == null
                    ? ''
                    : row.minMonthlyCharge.toString()
                }
                placeholder={
                  t.settingsLoanRates.fieldMinMonthlyChargePlaceholder
                }
                className={`block w-32 rounded-md border bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
                  fe('min_monthly_charge')
                    ? 'border-error/60'
                    : 'border-hairline'
                }`}
              />
              <span className="text-xs text-ash">
                {t.settingsLoanRates.fieldMinMonthlyChargeHint}
              </span>
            </div>
            {fe('min_monthly_charge') ? (
              <span className="block text-xs text-error">
                {fe('min_monthly_charge')}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.settingsLoanRates.fieldLabel} *
            </span>
            <input
              type="text"
              name="label"
              required
              maxLength={80}
              defaultValue={row?.label ?? ''}
              placeholder={t.settingsLoanRates.fieldLabelPlaceholder}
              className={`block w-full rounded-md border bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 ${
                fe('label') ? 'border-error/60' : 'border-hairline'
              }`}
            />
            {fe('label') ? (
              <span className="block text-xs text-error">{fe('label')}</span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.settingsLoanRates.fieldDescription}
            </span>
            <textarea
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={row?.description ?? ''}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.settingsLoanRates.fieldSortOrder}
              </span>
              <input
                type="number"
                name="sort_order"
                min={0}
                max={9999}
                defaultValue={row?.sortOrder?.toString() ?? '100'}
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
              <span className="block text-xs text-ash">
                {t.settingsLoanRates.fieldSortOrderHint}
              </span>
            </label>
            <div className="flex flex-col gap-2 pt-6">
              <label className="inline-flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="is_default"
                  defaultChecked={isDefault}
                />
                <span>{t.settingsLoanRates.fieldIsDefault}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked={row?.isActive ?? true}
                />
                <span>{t.settingsLoanRates.fieldIsActive}</span>
              </label>
            </div>
          </div>

          {wouldReplaceDefault ? (
            <p className="text-xs text-ash">
              {t.settingsLoanRates.replaceDefaultNote}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-3">
            {row && !row.isDefault ? (
              <form action={delAction}>
                <input type="hidden" name="id" value={row.id} />
                <button
                  type="submit"
                  disabled={delPending}
                  className="inline-flex items-center gap-1 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50"
                >
                  <Trash size={12} weight="bold" />
                  {delPending
                    ? t.common.saving
                    : t.settingsLoanRates.deactivate}
                </button>
              </form>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-hairline px-3 py-2 text-sm text-ink hover:border-ink"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-rausch px-3 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
              >
                {pending ? t.common.saving : t.common.save}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function translateError(
  reason: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const map: Record<string, string> = {
    cannot_delete_default: t.settingsLoanRates.errCannotDeleteDefault,
    not_found: t.common.error,
    invalid: t.common.error,
  }
  return map[reason] ?? reason
}
