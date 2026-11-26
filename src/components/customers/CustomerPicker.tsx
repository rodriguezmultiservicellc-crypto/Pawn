'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from 'react'
import { createPortal } from 'react-dom'
import { MagnifyingGlass, X, CaretDown, UserPlus, IdentificationCard } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import DlScanner from '@/components/customers/DlScanner'
import type { DLInfo } from '@/lib/dl-parser'
import type { CustomerScan } from '@/lib/customers/scan-prefill'
import { updateIdFromScanAction } from '@/app/(staff)/customers/[id]/actions'
import {
  findCustomerForScan,
  getCustomerForPicker,
  searchCustomersForPicker,
  type PickerCustomerResult,
} from '@/lib/customers/picker-search'

const DEBOUNCE_MS = 250
const MIN_QUERY_LEN = 2

export type CustomerPickerHandle = {
  /** Programmatically set the picked customer (e.g. from voice intake). */
  set: (c: PickerCustomerResult) => void
  /** Clear the current selection back to the search state. */
  clear: () => void
}

/**
 * Server-typeahead customer picker. Replaces the old 500-cap <select>
 * dropdown with a search-as-you-type input. Returns up to 20 matches per
 * keystroke (debounced). Renders a hidden form input named `name` so it
 * drops into existing <form action={...}> handlers without changes.
 *
 * Scales: server-side index scan + LIMIT 20 means a tenant with 50k
 * customers performs the same as one with 50.
 *
 * Imperative handle exposes set()/clear() for programmatic prefill —
 * used by the pawn voice-intake flow.
 */
const CustomerPicker = forwardRef<
  CustomerPickerHandle,
  {
    name: string
    required?: boolean
    initialCustomer?: PickerCustomerResult | null
    /** When a UUID is provided, the picker fetches the customer label
     *  on mount and pre-selects them. Useful for validation-echo
     *  restoration when only the ID survives in form state. */
    initialCustomerId?: string | null
    error?: string
    autoFocus?: boolean
    /** Called whenever the selection changes. Useful for non-form
     *  consumers (e.g., POS cart) that need to read the customer id
     *  outside of FormData submission. Unselect = null. */
    onChange?: (customer: PickerCustomerResult | null) => void
    /** When true, renders a "Scan ID" button next to the search input.
     *  Scanning a US driver's license PDF417 barcode triggers an
     *  exact-match search by id_number. If a customer with that DL is
     *  found, it's auto-selected. If not, an inline notice surfaces.
     *  Use on intake flows where physical IDs are required (pawn /
     *  buy-outright per FL Ch. 539). */
    enableDlScan?: boolean
    /** 'lg' = the Ledger intake style (52px search, 2px blue border, 44px
     *  buttons). Default 'md' is the look every other page uses. */
    size?: 'md' | 'lg'
    /** Extra controls rendered at the end of the search row (and beside
     *  the selected customer), e.g. "+ New customer". */
    trailing?: React.ReactNode
    /** A scanned license with no customer on file opens a popup that asks
     *  "Add customer" or "Search another way". Add hands the scan here so
     *  the page can open New customer filled from the license. Without it,
     *  the picker only shows an inline notice. */
    onAddFromScan?: (scan: CustomerScan) => void
  }
>(function CustomerPicker(
  {
    name,
    required = false,
    initialCustomer = null,
    initialCustomerId = null,
    error,
    autoFocus = false,
    onChange,
    enableDlScan = false,
    size = 'md',
    trailing = null,
    onAddFromScan,
  },
  ref,
) {
  const lg = size === 'lg'
  const focusRing =
    'focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue'
  const { t } = useI18n()
  const cp = t.common.customerPicker
  const [selected, setSelected] = useState<PickerCustomerResult | null>(
    initialCustomer,
  )
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickerCustomerResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [isSearching, startTransition] = useTransition()
  const [scanNotice, setScanNotice] = useState<string | null>(null)
  // The scan found no one, and the page can add a customer: ask what to do.
  const [noMatch, setNoMatch] = useState<CustomerScan | null>(null)
  // A scan found the customer by name + birth date, not by number: a renewed
  // license. Offer to put the new number on file.
  const [renewal, setRenewal] = useState<{
    customerId: string
    info: DLInfo
    onFile: string | null
    status: 'ask' | 'saving' | 'saved' | 'failed'
  } | null>(null)
  const [, startRenewal] = useTransition()
  function saveRenewal() {
    if (!renewal) return
    const r = renewal
    setRenewal({ ...r, status: 'saving' })
    startRenewal(async () => {
      const res = await updateIdFromScanAction({
        customerId: r.customerId,
        licenseNumber: r.info.licenseNumber,
        expiry: r.info.expirationDate,
        state: r.info.state,
      })
      setRenewal({ ...r, status: 'ok' in res ? 'saved' : 'failed' })
    })
  }
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Click-outside to close.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // If parent passed an initialCustomerId (e.g., after a server-side
  // validation failure echoed customer_id back without a label), look
  // up the customer once and pre-select. Only runs when no
  // initialCustomer prop was provided AND we don't already have a
  // selection.
  useEffect(() => {
    if (!initialCustomerId) return
    if (selected) return
    let cancelled = false
    void (async () => {
      const c = await getCustomerForPicker(initialCustomerId)
      if (!cancelled && c) {
        setSelected(c)
        onChange?.(c)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerId])

  useImperativeHandle(
    ref,
    () => ({
      set: (c) => {
        setSelected(c)
        setQuery('')
        setResults([])
        setIsOpen(false)
        onChange?.(c)
      },
      clear: () => {
        setSelected(null)
        setQuery('')
        setResults([])
        setIsOpen(false)
        onChange?.(null)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Debounced search.
  function onQueryChange(value: string) {
    setQuery(value)
    setIsOpen(true)
    setHighlightIndex(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.trim().length < MIN_QUERY_LEN) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const matches = await searchCustomersForPicker(value)
        setResults(matches)
        setHighlightIndex(0)
      })
    }, DEBOUNCE_MS)
  }

  function pick(c: PickerCustomerResult) {
    setSelected(c)
    setQuery('')
    setResults([])
    setIsOpen(false)
    setScanNotice(null)
    onChange?.(c)
  }

  function clearSelection() {
    setSelected(null)
    setQuery('')
    setResults([])
    setIsOpen(false)
    setScanNotice(null)
    setRenewal(null)
    onChange?.(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function onDlScan(info: DLInfo, raw: string) {
    setScanNotice(null)
    setNoMatch(null)
    if (!info.licenseNumber) {
      setScanNotice(cp.scanNoNumber)
      return
    }
    startTransition(async () => {
      const match = await findCustomerForScan({
        licenseNumber: info.licenseNumber,
        firstName: info.firstName,
        lastName: info.lastName,
        dob: info.dob,
      })
      if (match) {
        pick(match)
        setRenewal(
          match.by === 'name_dob'
            ? { customerId: match.id, info, onFile: match.idNumberOnFile, status: 'ask' }
            : null,
        )
      } else if (onAddFromScan) {
        setNoMatch({ info, raw })
      } else {
        const name =
          [info.firstName, info.lastName].filter(Boolean).join(' ').trim() ||
          info.licenseNumber
        setScanNotice(`${cp.scanNoMatch} (${name})`)
      }
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length > 0) {
        setIsOpen(true)
        setHighlightIndex((i) => Math.min(i + 1, results.length - 1))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (isOpen && results[highlightIndex]) {
        e.preventDefault()
        pick(results[highlightIndex])
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  // SELECTED STATE — show the picked customer with a clear (X) button.
  if (selected) {
    return (
      <div className="flex flex-col gap-1" ref={containerRef}>
        <input type="hidden" name={name} value={selected.id} />
        {lg ? (
          <div className="flex flex-wrap items-stretch gap-2">
            <div className="flex min-h-[52px] min-w-[240px] flex-1 items-center gap-2 rounded-md border-2 border-blue bg-background px-4">
              <div className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                {selected.label}
              </div>
              <button
                type="button"
                onClick={clearSelection}
                className={`grid h-11 w-11 place-items-center rounded-md text-muted transition-colors hover:bg-background hover:text-danger ${focusRing}`}
                aria-label={cp.clear}
              >
                <X size={16} weight="bold" />
              </button>
            </div>
            {trailing}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-xl border-2 border-blue/40 bg-blue/5 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
                {selected.label}
              </div>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md p-1 text-muted transition-colors hover:bg-background hover:text-danger"
                aria-label={cp.clear}
              >
                <X size={16} weight="bold" />
              </button>
            </div>
            {trailing}
          </>
        )}
        {renewal && renewal.customerId === selected.id ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground">
            <span>
              {renewal.status === 'saved'
                ? cp.renewedSaved
                : renewal.status === 'failed'
                  ? cp.renewedFailed
                  : cp.renewedFound
                      .replace('{old}', renewal.onFile || '—')
                      .replace('{new}', renewal.info.licenseNumber)}
            </span>
            {renewal.status === 'ask' || renewal.status === 'saving' || renewal.status === 'failed' ? (
              <button
                type="button"
                onClick={saveRenewal}
                disabled={renewal.status === 'saving'}
                className="rounded-md bg-gold px-3 py-1.5 text-xs font-bold text-navy hover:bg-gold-2 disabled:opacity-50"
              >
                {cp.renewedUpdate}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    )
  }

  // SEARCH STATE — input + dropdown of matches.
  return (
    <div className="relative flex flex-col gap-1" ref={containerRef}>
      {/* Empty hidden input so the form submits an empty value if not
          picked — server-side validation surfaces the "required" error. */}
      {required ? <input type="hidden" name={name} value="" /> : null}
      <div className={lg ? 'flex flex-wrap items-stretch gap-2' : 'flex items-stretch gap-2'}>
        <div className={lg ? 'relative min-w-[240px] flex-1' : 'relative flex-1'}>
          <MagnifyingGlass
            size={lg ? 20 : 16}
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted ${lg ? 'left-4' : 'left-3'}`}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setIsOpen(true)}
            autoFocus={autoFocus}
            autoComplete="off"
            placeholder={enableDlScan ? cp.placeholderWithDl : cp.placeholder}
            className={
              lg
                ? `h-[52px] w-full rounded-md border-2 border-blue bg-background pl-11 pr-9 text-base text-foreground outline-none ${focusRing}`
                : 'w-full rounded-xl border-2 border-border bg-background py-3 pl-9 pr-9 text-sm text-foreground outline-none transition-colors focus:border-blue'
            }
          />
          <CaretDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
          />
        </div>
        {enableDlScan ? (
          <DlScanner
            onResult={onDlScan}
            label={cp.scanButton}
            className={
              lg
                ? `inline-flex h-[52px] shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background ${focusRing}`
                : 'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-blue/40 hover:bg-blue/5 hover:text-blue'
            }
          />
        ) : null}
        {trailing}
      </div>

      {noMatch ? (
        <ScanNoMatchDialog
          scan={noMatch}
          onAdd={() => {
            const s = noMatch
            setNoMatch(null)
            onAddFromScan?.(s)
          }}
          onSearch={() => {
            setNoMatch(null)
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
        />
      ) : null}

      {scanNotice ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          {scanNotice}
        </div>
      ) : null}

      {isOpen ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
          {query.trim().length < MIN_QUERY_LEN ? (
            <div className="px-4 py-3 text-xs text-muted">{cp.typeMore}</div>
          ) : isSearching && results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted">{cp.searching}</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted">{cp.noResults}</div>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((c, i) => {
                const isHighlighted = i === highlightIndex
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(c)
                      }}
                      onMouseEnter={() => setHighlightIndex(i)}
                      className={`block w-full px-4 py-2 text-left text-sm transition-colors ${
                        isHighlighted
                          ? 'bg-blue/10 text-foreground'
                          : 'text-foreground hover:bg-background'
                      }`}
                    >
                      {c.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  )
})

export default CustomerPicker

/**
 * "No customer with this license" — the two ways on: add the customer from
 * the license, or go back and search by name / phone (a customer on file
 * under an old or mistyped license number).
 */
function ScanNoMatchDialog({
  scan,
  onAdd,
  onSearch,
}: {
  scan: CustomerScan
  onAdd: () => void
  onSearch: () => void
}) {
  const { t } = useI18n()
  const cp = t.common.customerPicker
  const addRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    addRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onSearch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSearch])

  const { info } = scan
  const name = [info.firstName, info.middleName, info.lastName].filter(Boolean).join(' ').trim()
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      onMouseDown={onSearch}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="scan-no-match-title"
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
            <IdentificationCard size={20} weight="bold" />
          </span>
          <div className="min-w-0">
            <h2 id="scan-no-match-title" className="font-display text-lg font-bold text-foreground">
              {cp.noMatchTitle}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">{cp.noMatchBody}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-border bg-background px-4 py-3 text-sm">
          <dt className="text-muted">{cp.noMatchName}</dt>
          <dd className="font-semibold text-foreground">{name || '—'}</dd>
          <dt className="text-muted">{cp.noMatchLicense}</dt>
          <dd className="font-mono text-foreground">
            {info.licenseNumber}
            {info.state ? ` · ${info.state}` : ''}
          </dd>
        </dl>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onSearch}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-background"
          >
            <MagnifyingGlass size={16} weight="bold" />
            {cp.noMatchSearch}
          </button>
          <button
            ref={addRef}
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg"
          >
            <UserPlus size={16} weight="bold" />
            {cp.noMatchAdd}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
