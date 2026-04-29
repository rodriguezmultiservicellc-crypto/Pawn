'use client'

import { useActionState, useRef, useState } from 'react'
import {
  Calculator,
  CaretDown,
  CaretUp,
  Lightning,
  Warning,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  suggestLoanFromCollateralAction,
  type SuggestLoanState,
} from '@/app/(staff)/pawn/new/actions'

/**
 * Inline calculator embedded inside /pawn/new. Reads the parent form's
 * collateral_<n>_* fields directly via formRef.current — no need to
 * lift collateral state up to the page level. Shows a suggested
 * principal with a one-click "Use this amount" button that writes
 * directly to the form's <input name="principal"> via DOM access.
 *
 * Uncontrolled-input compatible: setting input.value programmatically
 * mirrors a user keystroke for React's purposes. No state lift, no
 * controlled-input refactor, no risk of breaking the Session-8
 * form-reset workaround.
 */
export function InlinePawnCalculator({
  formId,
}: {
  formId: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [ltv, setLtv] = useState('50')
  const [state, formAction, pending] = useActionState<
    SuggestLoanState,
    FormData
  >(suggestLoanFromCollateralAction, { status: 'idle' })
  const calcFormRef = useRef<HTMLFormElement>(null)

  function calculate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const parent =
      typeof document !== 'undefined'
        ? (document.getElementById(formId) as HTMLFormElement | null)
        : null
    if (!parent) return

    // Build a FormData from the parent form, then patch in the LTV from
    // our local input. This is the cleanest way to reuse the operator's
    // typed collateral without lifting state.
    const fd = new FormData(parent)
    fd.set('ltv_percent', ltv)
    formAction(fd)
  }

  function applySuggestion(amount: number) {
    if (typeof document === 'undefined') return
    const parent = document.getElementById(formId) as HTMLFormElement | null
    if (!parent) return
    const principalInput = parent.elements.namedItem(
      'principal',
    ) as HTMLInputElement | null
    if (!principalInput) return
    principalInput.value = amount.toFixed(2)
    // Notify React (uncontrolled inputs still benefit from a synthetic
    // change event so any onChange handlers fire). The pawn-new form's
    // principal field is uncontrolled so this is just for completeness.
    principalInput.dispatchEvent(new Event('input', { bubbles: true }))
    principalInput.focus()
    principalInput.select()
  }

  return (
    <fieldset className="rounded-lg border border-hairline bg-canvas">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Calculator size={16} weight="bold" className="text-rausch" />
          {t.pawn.inlineCalc.title}
        </span>
        <span className="text-xs text-ash">
          {open ? <CaretUp size={14} /> : <CaretDown size={14} />}
        </span>
      </button>

      {open ? (
        <div className="border-t border-hairline p-4">
          <p className="mb-3 text-xs text-ash">
            {t.pawn.inlineCalc.help}
          </p>

          <form
            ref={calcFormRef}
            onSubmit={calculate}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink">
                {t.pawn.inlineCalc.ltvLabel}
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="1"
                  min={1}
                  max={100}
                  value={ltv}
                  onChange={(e) => setLtv(e.target.value)}
                  className="w-20 rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
                />
                <span className="text-sm text-ash">%</span>
              </div>
            </label>

            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-rausch px-3 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
            >
              <Lightning size={14} weight="bold" />
              {pending
                ? t.common.loading
                : t.pawn.inlineCalc.calculateButton}
            </button>
          </form>

          {state.status === 'error' ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
              <Warning size={12} weight="bold" />
              <span>{translateError(state.error, t)}</span>
            </div>
          ) : null}

          {state.status === 'ok' ? (
            <SuggestionResult
              result={state.result}
              onApply={applySuggestion}
            />
          ) : null}
        </div>
      ) : null}
    </fieldset>
  )
}

function SuggestionResult({
  result,
  onApply,
}: {
  result: import('@/lib/pawn/suggested-loan').SuggestedLoanResult
  onApply: (amount: number) => void
}) {
  const { t } = useI18n()
  const usd = (n: number) =>
    n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    })

  const totalWarnings = [
    ...result.warnings,
    ...result.rows.flatMap((r) => r.warnings),
  ]

  return (
    <div className="mt-3 rounded-lg border border-success/30 bg-success/5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs text-ash">
            {t.pawn.inlineCalc.suggestedLabel}
          </div>
          <div className="font-mono text-2xl font-bold text-success">
            {usd(result.totalSuggestedPrincipal)}
          </div>
          <div className="mt-1 text-[11px] text-ash">
            {t.pawn.inlineCalc.basisLabel}: {usd(result.totalValueBasis)} ·{' '}
            LTV {result.ltvPercent}%
          </div>
        </div>
        <button
          type="button"
          onClick={() => onApply(result.totalSuggestedPrincipal)}
          disabled={result.totalSuggestedPrincipal <= 0}
          className="rounded-md border border-success/30 bg-canvas px-3 py-2 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
        >
          {t.pawn.inlineCalc.useAmount}
        </button>
      </div>

      {result.rows.length > 1 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-ash hover:text-ink">
            {t.pawn.inlineCalc.perRowBreakdown}
          </summary>
          <ul className="mt-2 space-y-1 text-[11px]">
            {result.rows.map((r, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between rounded border border-hairline bg-canvas px-2 py-1"
              >
                <span className="text-ink">
                  #{idx + 1} · {r.valueBasisSource}
                </span>
                <span className="font-mono text-ink">
                  {usd(r.suggestedPrincipal)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {totalWarnings.length > 0 ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[10px] text-warning">
          {totalWarnings.map((w, i) => (
            <div key={i}>• {w}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function translateError(
  reason: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const map: Record<string, string> = {
    no_rows: t.pawn.inlineCalc.errNoRows,
  }
  return map[reason] ?? reason
}
