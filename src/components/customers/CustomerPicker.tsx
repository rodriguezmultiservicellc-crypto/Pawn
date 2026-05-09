'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from 'react'
import { MagnifyingGlass, X, CaretDown } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
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
  },
  ref,
) {
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
    onChange?.(c)
  }

  function clearSelection() {
    setSelected(null)
    setQuery('')
    setResults([])
    setIsOpen(false)
    onChange?.(null)
    requestAnimationFrame(() => inputRef.current?.focus())
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
      <div className="relative">
        <MagnifyingGlass
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
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
          placeholder={cp.placeholder}
          className="w-full rounded-xl border-2 border-border bg-background py-3 pl-9 pr-9 text-sm text-foreground outline-none transition-colors focus:border-blue"
        />
        <CaretDown
          size={14}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>

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
