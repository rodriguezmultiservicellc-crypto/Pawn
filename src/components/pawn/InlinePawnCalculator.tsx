'use client'

import { useActionState, useRef, useState } from 'react'
import {
  Calculator,
  CaretDown,
  CaretUp,
  Check,
  ClipboardText,
  Lightning,
  MagnifyingGlass,
  Warning,
  Watch,
  X,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  suggestLoanFromCollateralAction,
  type SuggestLoanState,
} from '@/app/(staff)/pawn/new/actions'

type WatchModelMatch = {
  id: string
  brand: string
  model: string
  reference_no: string
  nickname: string
  year_start: number
  year_end: number
  est_value_min: number
  est_value_max: number
}

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
          <WatchLookupSection />

          <p className="mb-3 mt-4 text-xs text-ash">
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

/**
 * Embedded watch-model reference tool. Searches the curated
 * `watch_models` table via /api/watch-models/search and displays
 * brand / model / ref / year range / wholesale-floor value range
 * for a selected match.
 *
 * Read-only on purpose: the parent /pawn/new collateral rows are
 * controlled React inputs, so writing values via DOM would require
 * the native-setter shim and ties this lookup to the form's internal
 * state. We surface the data clearly + offer copy-to-clipboard so the
 * operator types it into the collateral row themselves.
 */
function WatchLookupSection() {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WatchModelMatch[]>([])
  const [selected, setSelected] = useState<WatchModelMatch | null>(null)
  const [loading, setLoading] = useState(false)
  const [errored, setErrored] = useState(false)
  const [copied, setCopied] = useState(false)
  // Debounce timer + abort controller live in refs so rapid keystrokes
  // cancel the prior request cleanly. Per the project gotcha, debounced
  // search MUST live in onChange — never useEffect+setState.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function runFetch(q: string) {
    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setErrored(false)
    fetch(
      `/api/watch-models/search?q=${encodeURIComponent(q)}&limit=20`,
      { signal: ac.signal },
    )
      .then(async (res) => {
        if (ac.signal.aborted) return
        if (!res.ok) {
          setErrored(true)
          setResults([])
          return
        }
        const data = (await res.json()) as { items?: WatchModelMatch[] }
        if (ac.signal.aborted) return
        setResults(data.items ?? [])
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setErrored(true)
        setResults([])
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
  }

  function onQueryChange(v: string) {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.trim().length < 2) {
      setResults([])
      setLoading(false)
      if (abortRef.current) abortRef.current.abort()
      return
    }
    debounceRef.current = setTimeout(() => runFetch(v.trim()), 200)
  }

  function pickResult(m: WatchModelMatch) {
    setSelected(m)
    setResults([])
    setQuery('')
    setCopied(false)
  }

  function clearSelection() {
    setSelected(null)
    setCopied(false)
  }

  async function copyDescription() {
    if (!selected) return
    const text = describeWatch(selected)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard write blocked (e.g. insecure context). Fall back: leave
      // the user to manually copy from the displayed text.
    }
  }

  return (
    <section className="rounded-md border border-hairline bg-cloud/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
        <Watch size={14} weight="bold" className="text-rausch" />
        {t.pawn.inlineCalc.watchLookup.title}
      </div>

      {selected ? (
        <SelectedWatchCard
          match={selected}
          onClear={clearSelection}
          onCopy={copyDescription}
          copied={copied}
        />
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ash"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={t.pawn.inlineCalc.watchLookup.placeholder}
              className="block w-full rounded-md border border-hairline bg-canvas py-2 pl-9 pr-3 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </div>

          {loading ? (
            <div className="text-[11px] text-ash">{t.common.loading}</div>
          ) : null}
          {errored ? (
            <div className="flex items-center gap-1 text-[11px] text-error">
              <Warning size={12} weight="bold" />
              {t.pawn.inlineCalc.watchLookup.errFetch}
            </div>
          ) : null}
          {!loading && !errored && query.trim().length >= 2 && results.length === 0 ? (
            <div className="text-[11px] text-ash">
              {t.pawn.inlineCalc.watchLookup.noMatches}
            </div>
          ) : null}

          {results.length > 0 ? (
            <ul className="max-h-56 overflow-y-auto rounded-md border border-hairline bg-canvas">
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => pickResult(m)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-hairline px-3 py-2 text-left last:border-0 hover:bg-cloud"
                  >
                    <span className="text-sm font-medium text-ink">
                      {m.brand} {m.model}
                      {m.nickname ? (
                        <span className="ml-1 text-ash">
                          “{m.nickname}”
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono text-[11px] text-ash">
                      ref {m.reference_no} · {m.year_start}
                      {m.year_end !== m.year_start ? `–${m.year_end}` : ''}
                      {' · '}
                      {fmtUsd(m.est_value_min)}–{fmtUsd(m.est_value_max)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {query.trim().length < 2 ? (
            <p className="text-[10px] text-ash">
              {t.pawn.inlineCalc.watchLookup.minLengthHint}
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SelectedWatchCard({
  match,
  onClear,
  onCopy,
  copied,
}: {
  match: WatchModelMatch
  onClear: () => void
  onCopy: () => void
  copied: boolean
}) {
  const { t } = useI18n()
  const midpoint = Math.round((match.est_value_min + match.est_value_max) / 2)
  const yearLabel =
    match.year_start === match.year_end
      ? `${match.year_start}`
      : `${match.year_start}–${match.year_end}`
  return (
    <div className="rounded-md border border-rausch/20 bg-canvas p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink">
            {match.brand} {match.model}
            {match.nickname ? (
              <span className="ml-1 text-ash">“{match.nickname}”</span>
            ) : null}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ash">
            ref {match.reference_no} · {yearLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded p-1 text-ash hover:bg-cloud hover:text-ink"
          aria-label={t.common.clear}
        >
          <X size={12} weight="bold" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat
          label={t.pawn.inlineCalc.watchLookup.minValue}
          value={fmtUsd(match.est_value_min)}
        />
        <Stat
          label={t.pawn.inlineCalc.watchLookup.midValue}
          value={fmtUsd(midpoint)}
          accent
        />
        <Stat
          label={t.pawn.inlineCalc.watchLookup.maxValue}
          value={fmtUsd(match.est_value_max)}
        />
      </div>

      <button
        type="button"
        onClick={onCopy}
        className="mt-3 inline-flex items-center gap-1 rounded-md border border-hairline bg-canvas px-2 py-1 text-[11px] font-medium text-ink hover:bg-cloud"
      >
        {copied ? (
          <>
            <Check size={12} weight="bold" className="text-success" />
            {t.pawn.inlineCalc.watchLookup.copied}
          </>
        ) : (
          <>
            <ClipboardText size={12} weight="bold" />
            {t.pawn.inlineCalc.watchLookup.copyDescription}
          </>
        )}
      </button>
      <p className="mt-2 text-[10px] text-ash">
        {t.pawn.inlineCalc.watchLookup.disclaimer}
      </p>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        accent
          ? 'border-success/30 bg-success/5 text-success'
          : 'border-hairline bg-cloud text-ink'
      }`}
    >
      <div className="font-mono text-sm font-semibold">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-ash">{label}</div>
    </div>
  )
}

function describeWatch(m: WatchModelMatch): string {
  const yearLabel =
    m.year_start === m.year_end
      ? `${m.year_start}`
      : `${m.year_start}–${m.year_end}`
  return `${m.brand} ${m.model} ref ${m.reference_no} (${yearLabel})`
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
