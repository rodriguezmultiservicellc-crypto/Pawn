'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import DlScanner from '@/components/customers/DlScanner'
import { searchAcrossModule, type SearchResult } from './actions'
import './dashboard.css'

/**
 * /staff/dashboard — vibrant dark variant ported from the standalone
 * design kit. Visual system is intentionally separate from the rest of
 * the staff app (which is locked to Airbnb-light per DESIGN-airbnb.md).
 * All styles are scoped under `.dashboard` so its dark tokens never
 * bleed into other surfaces.
 *
 * TODO(i18n): user-facing strings are inlined for the first pass since
 * the source kit was English-only. Move to t.dashboard.* once the new
 * surface stabilizes.
 */

export type RecentCustomer = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  created_at: string
}

export type RecentItem = {
  id: string
  sku: string
  description: string
  status: string
  list_price: number | string | null
  created_at: string
}

type TabId = 'overview' | 'sales' | 'layaways' | 'pawn' | 'repairs'
type RangeId = 'today' | '7d' | '14d' | '30d'
type ModuleId = Exclude<TabId, 'overview'>

const ALL_TABS: TabId[] = ['overview', 'sales', 'layaways', 'pawn', 'repairs']

const STORAGE_KEYS = {
  tab: 'dash.activeTab',
  range: 'dash.activeRange',
  recent: (m: ModuleId) => `dash.recent.${m}`,
}

type RecentChip = { id: string; label: string; href: string }

type Props = {
  customerCount: number
  bannedCount: number
  inventoryCount: number
  heldCount: number
  recentCustomers: RecentCustomer[]
  recentItems: RecentItem[]
  hasPawn?: boolean
  activeLoanCount?: number
  dueThisWeekCount?: number
  hasRepair?: boolean
  activeRepairCount?: number
  readyForPickupCount?: number
  hasRetail?: boolean
  todaySalesCount?: number
  todayRevenue?: number
  activeLayawayCount?: number
}

export default function DashboardContent(props: Props) {
  const router = useRouter()
  // Lazy initializers read from localStorage on first render (client only —
  // SSR passes the typeof check via the explicit guard). Same pattern used
  // elsewhere in the project for purity-rule-safe initial state.
  const [tab, setTab] = useState<TabId>(() => readStored<TabId>(
    STORAGE_KEYS.tab,
    'overview',
    (v): v is TabId => ALL_TABS.includes(v as TabId),
  ))
  const [range, setRange] = useState<RangeId>(() => readStored<RangeId>(
    STORAGE_KEYS.range,
    '7d',
    (v): v is RangeId => ['today', '7d', '14d', '30d'].includes(v),
  ))

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.tab, tab)
    } catch {}
  }, [tab])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.range, range)
    } catch {}
  }, [range])

  // Keyboard shortcuts — `/` focuses the active search, 1-5 switch tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (e.key === '/' && !typing) {
        const search = document.querySelector<HTMLInputElement>(
          `.dashboard [data-search="${tab}"]`,
        )
        if (search) {
          e.preventDefault()
          search.focus()
          search.select()
        }
        return
      }
      if (['1', '2', '3', '4', '5'].includes(e.key) && !typing) {
        setTab(ALL_TABS[parseInt(e.key, 10) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab])

  return (
    <div className="dashboard" data-active-tab={tab} data-active-range={range}>
      <Header tab={tab} setTab={setTab} range={range} setRange={setRange} />

      <Panel id="overview" active={tab === 'overview'}>
        <OverviewPanel {...props} />
      </Panel>

      <Panel id="sales" active={tab === 'sales'}>
        <SalesPanel
          router={router}
          revenueToday={props.todayRevenue ?? 0}
          txCount={props.todaySalesCount ?? 0}
          inventoryAvailable={props.inventoryCount}
        />
      </Panel>

      <Panel id="layaways" active={tab === 'layaways'}>
        <LayawaysPanel
          router={router}
          activeCount={props.activeLayawayCount ?? 0}
        />
      </Panel>

      <Panel id="pawn" active={tab === 'pawn'}>
        <PawnPanel
          router={router}
          activeLoans={props.activeLoanCount ?? 0}
          dueThisWeek={props.dueThisWeekCount ?? 0}
        />
      </Panel>

      <Panel id="repairs" active={tab === 'repairs'}>
        <RepairsPanel
          router={router}
          openCount={props.activeRepairCount ?? 0}
          readyCount={props.readyForPickupCount ?? 0}
        />
      </Panel>
    </div>
  )
}

/* ─────────── HEADER (tabs + range) ─────────── */
function Header({
  tab,
  setTab,
  range,
  setRange,
}: {
  tab: TabId
  setTab: (t: TabId) => void
  range: RangeId
  setRange: (r: RangeId) => void
}) {
  return (
    <header className="dash-head">
      <nav className="dash-tabs" role="tablist">
        {ALL_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-tab={id}
            className={`dash-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {tabLabel(id)}
          </button>
        ))}
      </nav>
      <div className="dash-range" role="radiogroup" aria-label="Time range">
        {(['today', '7d', '14d', '30d'] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={range === r}
            data-range={r}
            className={`range-btn${range === r ? ' active' : ''}`}
            onClick={() => setRange(r)}
          >
            {r === 'today' ? 'Today' : r}
          </button>
        ))}
      </div>
    </header>
  )
}

function tabLabel(t: TabId): string {
  switch (t) {
    case 'overview':
      return 'Overview'
    case 'sales':
      return 'Sales'
    case 'layaways':
      return 'Layaways'
    case 'pawn':
      return 'Pawn'
    case 'repairs':
      return 'Repairs'
  }
}

/* ─────────── PANEL WRAPPER ─────────── */
function Panel({
  id,
  active,
  children,
}: {
  id: TabId
  active: boolean
  children: React.ReactNode
}) {
  return (
    <section
      role="tabpanel"
      id={`panel-${id}`}
      className={`dash-panel${active ? ' active' : ''}`}
    >
      {children}
    </section>
  )
}

/* ─────────── OVERVIEW ─────────── */
function OverviewPanel(props: Props) {
  const totalRevenue = props.todayRevenue ?? 0
  return (
    <>
      <div className="hero">
        <div className="row">
          <p className="hero-l">Total revenue · today</p>
          <span className="live-indicator">
            <span className="pulse" />
            <span>Live · just now</span>
          </span>
        </div>
        <p className="hero-v">{fmtMoney(totalRevenue)}</p>
        <div className="hero-row">
          <div className="hero-stat">
            <p>Sales</p>
            <p style={{ color: '#67E8F9' }}>{fmtMoney(totalRevenue)}</p>
          </div>
          <div className="hero-stat">
            <p>Pawn</p>
            <p style={{ color: '#FCD34D' }}>—</p>
          </div>
          <div className="hero-stat">
            <p>Repairs</p>
            <p style={{ color: '#6EE7B7' }}>—</p>
          </div>
          <div className="hero-stat" style={{ marginLeft: 'auto' }}>
            <p>Transactions</p>
            <p style={{ color: '#34D399' }}>{props.todaySalesCount ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="module-grid">
        <ModuleCard
          tone="cyan"
          tag="Sales"
          value={fmtMoney(totalRevenue)}
          sub={`${props.todaySalesCount ?? 0} transactions today`}
        />
        <ModuleCard
          tone="amber"
          tag="Pawn"
          value={`${props.activeLoanCount ?? 0}`}
          sub={
            <>
              {props.activeLoanCount ?? 0} active
              {props.dueThisWeekCount ? (
                <>
                  {' · '}
                  <span className="text-warning">
                    {props.dueThisWeekCount} due this week
                  </span>
                </>
              ) : null}
            </>
          }
        />
        <ModuleCard
          tone="emerald"
          tag="Repairs"
          value={`${props.activeRepairCount ?? 0}`}
          sub={
            <>
              {props.readyForPickupCount ?? 0} ready ·{' '}
              {props.activeRepairCount ?? 0} open
            </>
          }
        />
      </div>

      <div className="panel">
        <div className="row">
          <h2 className="p-title">Recent activity</h2>
          <span className="p-meta">all modules</span>
        </div>
        <div className="feed">
          {props.recentCustomers.slice(0, 3).map((c) => (
            <div key={`c-${c.id}`} className="feed-item">
              <span className="tag emerald">New</span>
              <div style={{ flex: 1 }}>
                <p className="ti">
                  {c.last_name}, {c.first_name}
                </p>
                <p className="su">Customer · {relTime(c.created_at)}</p>
              </div>
              <span className="am" style={{ color: 'var(--m-repair-text)' }}>
                {c.phone ?? '—'}
              </span>
            </div>
          ))}
          {props.recentItems.slice(0, 3).map((it) => (
            <div key={`i-${it.id}`} className="feed-item">
              <span className="tag cyan">Inv</span>
              <div style={{ flex: 1 }}>
                <p className="ti">{it.description}</p>
                <p className="su">
                  {it.sku} · {relTime(it.created_at)}
                </p>
              </div>
              <span className="am" style={{ color: 'var(--m-sales-text)' }}>
                {it.list_price != null ? fmtMoney(it.list_price) : '—'}
              </span>
            </div>
          ))}
          {props.recentCustomers.length === 0 &&
          props.recentItems.length === 0 ? (
            <div className="feed-item" style={{ borderBottom: 'none' }}>
              <p className="ti" style={{ color: 'var(--text-dim)' }}>
                Nothing yet.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}

function ModuleCard({
  tone,
  tag,
  value,
  sub,
}: {
  tone: 'cyan' | 'amber' | 'emerald'
  tag: string
  value: string
  sub: React.ReactNode
}) {
  const tagClass =
    tone === 'cyan' ? 'cyan' : tone === 'amber' ? 'amber' : 'emerald'
  const modClass =
    tone === 'cyan'
      ? 'mod-cyan'
      : tone === 'amber'
        ? 'mod-amber'
        : 'mod-emerald'
  return (
    <article className={`mod-card ${modClass}`}>
      <div className="row">
        <span className={`tag ${tagClass}`}>{tag}</span>
        <span className="arr">→</span>
      </div>
      <p className="mod-v">{value}</p>
      <p className="mod-s">{sub}</p>
      <Sparkline tone={tone} />
    </article>
  )
}

function Sparkline({ tone }: { tone: 'cyan' | 'amber' | 'emerald' }) {
  // Deterministic-but-static demo line. Wire to real series when reports
  // queries land. (See Phase 7 — operator merges that branch shortly.)
  const seed = tone === 'cyan' ? 1 : tone === 'amber' ? 2 : 3
  const points = useMemo(() => {
    const arr: number[] = []
    let s = seed
    for (let i = 0; i < 9; i += 1) {
      s = (s * 9301 + 49297) % 233280
      arr.push(4 + (s / 233280) * 24)
    }
    return arr
  }, [seed])
  const path = points.map((y, i) => `${i * 25},${y}`).join(' ')
  const lineColor =
    tone === 'cyan' ? '#22D3EE' : tone === 'amber' ? '#FBBF24' : '#34D399'
  const fillColor =
    tone === 'cyan' ? '#06B6D4' : tone === 'amber' ? '#F59E0B' : '#10B981'
  const gid = `sp-${tone}`
  return (
    <svg className="spark" viewBox="0 0 200 36" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={fillColor} stopOpacity="0.4" />
          <stop offset="1" stopColor={fillColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`M ${path} L 200,36 L 0,36 Z`}
        fill={`url(#${gid})`}
      />
      <polyline points={path} fill="none" stroke={lineColor} strokeWidth="2" />
    </svg>
  )
}

/* ─────────── PER-TAB PANELS ─────────── */
function SalesPanel({
  router,
  revenueToday,
  txCount,
  inventoryAvailable,
}: {
  router: ReturnType<typeof useRouter>
  revenueToday: number
  txCount: number
  inventoryAvailable: number
}) {
  return (
    <>
      <Lookup
        module="sales"
        placeholder="Lookup receipt # or customer name"
        actionTone="cyan"
        actionLabel="Scan barcode"
        actionKind="barcode"
        router={router}
      />
      <div className="kpi-row">
        <Kpi
          tone="cyan"
          label="Sales today"
          value={fmtMoney(revenueToday)}
          sub="real-time"
          subTone="ok"
        />
        <Kpi
          tone="cyan"
          label="Transactions"
          value={`${txCount}`}
          sub="completed today"
        />
        <Kpi
          tone="cyan"
          label="Avg ticket"
          value={fmtMoney(txCount > 0 ? revenueToday / txCount : 0)}
        />
        <Kpi
          tone="cyan"
          drillHref="/inventory"
          label="In stock"
          value={`${inventoryAvailable}`}
          sub="available items"
          router={router}
        />
      </div>
      <div className="split">
        <ChartPanel
          title="Sales · last 14 days"
          legend={[
            { color: 'bg-cyan', label: 'Cash' },
            { color: 'bg-violet', label: 'Card' },
          ]}
        >
          <Bars
            tone="cyan"
            max={Math.max(1500, revenueToday * 1.5)}
            data={demoBars(14, 32)}
          />
        </ChartPanel>
        <div className="side-stack">
          <SidePanel title="Top sellers">
            <PlaceholderRows />
          </SidePanel>
          <SidePanel title="Payment mix">
            <PlaceholderBars />
          </SidePanel>
        </div>
      </div>
    </>
  )
}

function LayawaysPanel({
  router,
  activeCount,
}: {
  router: ReturnType<typeof useRouter>
  activeCount: number
}) {
  return (
    <>
      <Lookup
        module="layaways"
        placeholder="Lookup layaway # or customer name"
        actionTone="indigo"
        actionLabel="Scan license"
        actionKind="license"
        router={router}
      />
      <div className="kpi-row">
        <Kpi
          tone="indigo"
          label="Active layaways"
          value={`${activeCount}`}
          drillHref="/pos/layaways?status=active"
          router={router}
        />
        <Kpi tone="indigo" label="Total owed" value="—" sub="see /pos/layaways" />
        <Kpi tone="indigo" label="Payments today" value="—" />
        <Kpi
          tone="red"
          drillHref="/pos/layaways?status=active&filter=late"
          label="Late"
          value="—"
          sub="check the late filter"
          subTone="err"
          router={router}
        />
      </div>
      <div className="split">
        <ChartPanel
          title="Payments collected · 14d"
          legend={[{ color: 'bg-indigo', label: 'Payments' }]}
        >
          <Bars tone="indigo" max={500} data={demoBars(14, 11)} />
        </ChartPanel>
        <div className="side-stack">
          <SidePanel title="Layaway status">
            <PlaceholderRows />
          </SidePanel>
          <SidePanel title="Item categories">
            <PlaceholderBars />
          </SidePanel>
        </div>
      </div>
    </>
  )
}

function PawnPanel({
  router,
  activeLoans,
  dueThisWeek,
}: {
  router: ReturnType<typeof useRouter>
  activeLoans: number
  dueThisWeek: number
}) {
  return (
    <>
      <Lookup
        module="pawn"
        placeholder="Lookup pawn ticket # or customer name"
        actionTone="amber"
        actionLabel="Scan license"
        actionKind="license"
        router={router}
      />
      <div className="kpi-row">
        <Kpi tone="amber" label="Active loans" value={`${activeLoans}`} sub="all open tickets" />
        <Kpi tone="amber" label="Pawn fees today" value="—" sub="aggregate today" />
        <Kpi
          tone="amber"
          drillHref="/pawn?status=active&due=dueSoon7"
          label="Due this week"
          value={`${dueThisWeek}`}
          sub={dueThisWeek > 0 ? 'follow up' : 'all clear'}
          subTone={dueThisWeek > 0 ? 'warn' : 'ok'}
          router={router}
        />
        <Kpi
          tone="red"
          drillHref="/pawn?status=overdue"
          label="At risk"
          value="—"
          sub="overdue + grace"
          subTone="err"
          router={router}
        />
      </div>
      <div className="split">
        <ChartPanel
          title="Pawns vs redemptions"
          legend={[
            { color: 'bg-amber', label: 'Pawns' },
            { color: 'bg-cyan', label: 'Redeem' },
          ]}
        >
          <Lines max={20} a={demoSeries(13, 13)} b={demoSeries(13, 11)} />
        </ChartPanel>
        <div className="side-stack">
          <SidePanel title="Loan health">
            <div className="healthbar">
              <span style={{ flex: 6, background: 'var(--dash-success)' }} />
              <span style={{ flex: 2, background: 'var(--dash-warning)' }} />
              <span style={{ flex: 1, background: 'var(--dash-error)' }} />
            </div>
            <PlaceholderRows />
          </SidePanel>
          <SidePanel title="Top collateral">
            <PlaceholderBars />
          </SidePanel>
        </div>
      </div>
    </>
  )
}

function RepairsPanel({
  router,
  openCount,
  readyCount,
}: {
  router: ReturnType<typeof useRouter>
  openCount: number
  readyCount: number
}) {
  return (
    <>
      <Lookup
        module="repairs"
        placeholder="Lookup repair ticket # or customer name"
        router={router}
      />
      <div className="kpi-row">
        <Kpi tone="emerald" label="Open tickets" value={`${openCount}`} />
        <Kpi
          tone="emerald"
          drillHref="/repair?status=ready"
          label="Ready for pickup"
          value={`${readyCount}`}
          sub={readyCount > 0 ? 'awaiting customer' : 'none'}
          subTone={readyCount > 0 ? 'warn' : 'ok'}
          router={router}
        />
        <Kpi tone="emerald" label="Revenue MTD" value="—" sub="month to date" />
        <Kpi tone="emerald" label="Avg turnaround" value="—" sub="target 4d" />
      </div>
      <div className="split">
        <ChartPanel
          title="Tickets completed · 14d"
          legend={[{ color: 'bg-emerald', label: 'Completed' }]}
        >
          <Bars tone="emerald" max={10} data={demoBars(14, 5)} />
        </ChartPanel>
        <div className="side-stack">
          <SidePanel title="Pipeline">
            <PlaceholderRows />
          </SidePanel>
          <SidePanel title="Top types">
            <PlaceholderBars />
          </SidePanel>
        </div>
      </div>
    </>
  )
}

/* ─────────── LOOKUP (search + recent + scan) ─────────── */
function Lookup({
  module,
  placeholder,
  actionTone,
  actionLabel,
  actionKind,
  router,
}: {
  module: ModuleId
  placeholder: string
  actionTone?: 'amber' | 'indigo' | 'cyan'
  actionLabel?: string
  actionKind?: 'license' | 'barcode'
  router: ReturnType<typeof useRouter>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [recents, setRecents] = useRecentSearches(module)

  // Cancel any in-flight debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [])

  // onChange handler — debounces a server-action call. Done in the event
  // handler instead of an effect so we don't trip react-hooks/set-state-in-effect.
  const onQueryChange = (next: string) => {
    setQuery(next)
    if (debounce.current) clearTimeout(debounce.current)
    if (next.trim().length < 1) {
      setResults([])
      setOpen(false)
      return
    }
    debounce.current = setTimeout(async () => {
      try {
        const r = await searchAcrossModule(module, next)
        setResults(r)
        setOpen(true)
        setFocusIdx(-1)
      } catch {
        setResults([])
        setOpen(true)
      }
    }, 200)
  }

  // Click outside closes the dropdown.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const onPick = useCallback(
    (r: SearchResult) => {
      setRecents((prev) => {
        const trimmed = prev.filter((x) => x.id !== r.id)
        return [
          { id: r.id, label: r.primary, href: r.href },
          ...trimmed,
        ].slice(0, 5)
      })
      setOpen(false)
      setQuery('')
      router.push(r.href)
    },
    [router, setRecents],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[focusIdx >= 0 ? focusIdx : 0]
      if (r) onPick(r)
    } else if (e.key === 'Escape') {
      setOpen(false)
      e.currentTarget.blur()
    }
  }

  return (
    <>
      <div className="lookup">
        <div className="search-wrap" ref={wrapRef}>
          <svg
            className="search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            type="text"
            data-search={module}
            placeholder={placeholder}
            autoComplete="off"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => {
              if (results.length > 0) setOpen(true)
            }}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">/</span>
          {open ? (
            <div className="autocomplete" role="listbox">
              {results.length === 0 ? (
                <div className="ac-empty">No matches</div>
              ) : (
                results.map((r, i) => (
                  <div
                    key={r.id}
                    role="option"
                    aria-selected={i === focusIdx}
                    className={`ac-item${i === focusIdx ? ' focus' : ''}`}
                    onClick={() => onPick(r)}
                  >
                    <div className="ac-avatar">
                      {initials(r.customer?.name ?? r.primary)}
                    </div>
                    <div className="ac-body">
                      <p className="ac-primary">
                        {r.customer?.name ?? r.primary}
                      </p>
                      <p className="ac-secondary">
                        {[r.primary, r.secondary].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {r.status ? (
                      <span className={`ac-status ${r.status.tone}`}>
                        {r.status.label}
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
        {actionTone && actionLabel && actionKind ? (
          <ScanAction
            tone={actionTone}
            label={actionLabel}
            kind={actionKind}
            module={module}
            router={router}
          />
        ) : null}
      </div>
      {recents.length > 0 ? (
        <div className="recent-row">
          {recents.map((c) => (
            <span
              key={c.id}
              className="recent-chip"
              onClick={() => router.push(c.href)}
            >
              <span className="lbl">{c.label}</span>
              <span
                className="x"
                onClick={(e) => {
                  e.stopPropagation()
                  setRecents((prev) => prev.filter((x) => x.id !== c.id))
                }}
                aria-label="Remove"
              >
                ×
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </>
  )
}

function ScanAction({
  tone,
  label,
  kind,
  module,
  router,
}: {
  tone: 'amber' | 'indigo' | 'cyan'
  label: string
  kind: 'license' | 'barcode'
  module: ModuleId
  router: ReturnType<typeof useRouter>
}) {
  if (kind === 'license') {
    // Reuse the existing PDF417 USB scanner. On a successful scan we land
    // on /customers/new with the parsed values pre-filled — operator can
    // then start the module-specific workflow from the customer detail.
    return (
      <DlScanner
        label={label}
        className={`action-btn ${tone}`}
        onResult={(_info, raw) => {
          // TODO(scanner): wire to a "look up existing customer by license"
          // flow once that endpoint exists. For v1, route to /customers/new
          // and let the existing scanner-fill on that page take it from
          // there. The raw payload is logged so you can audit.
          console.info(`[dashboard] license scan from ${module}`, raw.length)
          router.push('/customers/new')
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className={`action-btn ${tone}`}
      onClick={() => {
        const sku = window.prompt('Scan / enter SKU:')
        if (sku) router.push(`/inventory?q=${encodeURIComponent(sku)}`)
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden="true"
      >
        <path d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14" />
      </svg>
      {label}
    </button>
  )
}

/* ─────────── KPI ─────────── */
function Kpi({
  tone,
  label,
  value,
  sub,
  subTone,
  drillHref,
  router,
}: {
  tone: 'cyan' | 'indigo' | 'amber' | 'emerald' | 'red'
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  subTone?: 'ok' | 'warn' | 'err'
  drillHref?: string
  router?: ReturnType<typeof useRouter>
}) {
  const drillProps = drillHref
    ? { 'data-drill': '1', onClick: () => router?.push(drillHref) }
    : {}
  const subClass = subTone ? ` ${subTone}` : ''
  const valueClass = tone === 'red' ? ' text-error' : ''
  const labelClass = tone === 'red' ? ' text-error' : ''
  return (
    <div className={`kpi acc-${tone}`} {...drillProps}>
      <p className={`kpi-l${labelClass}`}>{label}</p>
      <p className={`kpi-v${valueClass}`}>{value}</p>
      {sub != null ? <p className={`kpi-s${subClass}`}>{sub}</p> : null}
    </div>
  )
}

/* ─────────── CHART PANELS ─────────── */
function ChartPanel({
  title,
  legend,
  children,
}: {
  title: string
  legend?: { color: string; label: string }[]
  children: React.ReactNode
}) {
  return (
    <div className="panel">
      <div className="row">
        <h2 className="p-title">{title}</h2>
        {legend ? (
          <div className="lg">
            {legend.map((l) => (
              <span key={l.label}>
                <span className={`dot ${l.color}`} />
                {l.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function SidePanel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="panel">
      <h2 className="p-title">{title}</h2>
      {children}
    </div>
  )
}

function PlaceholderRows() {
  return (
    <div className="rows" style={{ marginTop: 12 }}>
      <div className="h-row" style={{ color: 'var(--text-dim)' }}>
        <span>Wire to real data after Phase 7 merges.</span>
        <span>—</span>
      </div>
    </div>
  )
}

function PlaceholderBars() {
  return (
    <div className="bars" style={{ marginTop: 12 }}>
      <div className="bar-row">
        <div className="row" style={{ color: 'var(--text-dim)' }}>
          <span>Awaiting reports query layer.</span>
          <span>—</span>
        </div>
        <div className="bar-track" />
      </div>
    </div>
  )
}

/* ─────────── INLINE SVG CHARTS ─────────── */
function Bars({
  tone,
  max,
  data,
}: {
  tone: 'cyan' | 'indigo' | 'amber' | 'emerald'
  max: number
  data: number[]
}) {
  const w = 420
  const h = 160
  const xs = (i: number) => 42 + i * 28
  const yScale = (v: number) => 140 - (v / max) * 130
  const stops =
    tone === 'cyan'
      ? [
          { o: '0', c: '#22D3EE' },
          { o: '1', c: '#06B6D4' },
        ]
      : tone === 'indigo'
        ? [
            { o: '0', c: '#A5B4FC' },
            { o: '1', c: '#6366F1' },
          ]
        : tone === 'amber'
          ? [
              { o: '0', c: '#FBBF24' },
              { o: '1', c: '#F59E0B' },
            ]
          : [
              { o: '0', c: '#34D399' },
              { o: '1', c: '#10B981' },
            ]
  const gid = `g-bar-${tone}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          {stops.map((s) => (
            <stop key={s.o} offset={s.o} stopColor={s.c} />
          ))}
        </linearGradient>
      </defs>
      <line x1="30" y1="50" x2="410" y2="50" stroke="rgba(255,255,255,0.04)" />
      <line x1="30" y1="95" x2="410" y2="95" stroke="rgba(255,255,255,0.04)" />
      <line x1="30" y1="140" x2="410" y2="140" stroke="rgba(255,255,255,0.08)" />
      {data.map((v, i) => (
        <rect
          key={i}
          x={xs(i)}
          y={yScale(v)}
          width="14"
          height={140 - yScale(v)}
          fill={`url(#${gid})`}
          rx="3"
        />
      ))}
    </svg>
  )
}

function Lines({
  max,
  a,
  b,
}: {
  max: number
  a: number[]
  b: number[]
}) {
  const w = 420
  const h = 160
  const xs = (i: number) => 47 + i * (336 / (a.length - 1))
  const yScale = (v: number) => 140 - (v / max) * 130
  const ptsA = a.map((v, i) => `${xs(i)},${yScale(v)}`)
  const ptsB = b.map((v, i) => `${xs(i)},${yScale(v)}`)
  const last = a.length - 1
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      <defs>
        <linearGradient id="g-amber-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#F59E0B" stopOpacity="0.35" />
          <stop offset="1" stopColor="#F59E0B" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="g-cyan-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#06B6D4" stopOpacity="0.25" />
          <stop offset="1" stopColor="#06B6D4" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="30" y1="50" x2="410" y2="50" stroke="rgba(255,255,255,0.04)" />
      <line x1="30" y1="95" x2="410" y2="95" stroke="rgba(255,255,255,0.04)" />
      <line x1="30" y1="140" x2="410" y2="140" stroke="rgba(255,255,255,0.08)" />
      <path
        d={`M${ptsA[0]} ${ptsA.slice(1).map((p) => 'L' + p).join(' ')} L${xs(
          last,
        )},140 L47,140 Z`}
        fill="url(#g-amber-fill)"
      />
      <polyline
        points={ptsA.join(' ')}
        fill="none"
        stroke="#FBBF24"
        strokeWidth="2.5"
      />
      <path
        d={`M${ptsB[0]} ${ptsB.slice(1).map((p) => 'L' + p).join(' ')} L${xs(
          last,
        )},140 L47,140 Z`}
        fill="url(#g-cyan-fill)"
      />
      <polyline
        points={ptsB.join(' ')}
        fill="none"
        stroke="#22D3EE"
        strokeWidth="2.5"
      />
      <circle cx={xs(last)} cy={yScale(a[last])} r="4" fill="#FBBF24" />
      <circle cx={xs(last)} cy={yScale(b[last])} r="4" fill="#22D3EE" />
    </svg>
  )
}

/* ─────────── HELPERS ─────────── */
function useRecentSearches(module: ModuleId) {
  // Lazy initializer — reads localStorage on first render only. SSR-safe
  // via the typeof window guard inside readStoredJson.
  const [recents, setRecents] = useState<RecentChip[]>(() =>
    readStoredJson<RecentChip[]>(STORAGE_KEYS.recent(module), []),
  )
  const setAndPersist = useCallback(
    (next: RecentChip[] | ((prev: RecentChip[]) => RecentChip[])) => {
      setRecents((prev) => {
        const value = typeof next === 'function' ? next(prev) : next
        try {
          localStorage.setItem(STORAGE_KEYS.recent(module), JSON.stringify(value))
        } catch {}
        return value
      })
    },
    [module],
  )
  return [recents, setAndPersist] as const
}

/* ─────────── localStorage HELPERS (SSR-safe) ─────────── */
function readStored<T extends string>(
  key: string,
  fallback: T,
  validate: (v: string) => v is T,
): T {
  if (typeof window === 'undefined') return fallback
  try {
    const v = localStorage.getItem(key)
    return v != null && validate(v) ? v : fallback
  } catch {
    return fallback
  }
}

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function fmtMoney(v: number | string): string {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString()
}

function initials(name: string): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

// Deterministic demo data for the chart placeholders. Swap with real
// reports queries once Phase 7 merges.
function demoBars(n: number, base: number): number[] {
  const out: number[] = []
  let s = n + base
  for (let i = 0; i < n; i += 1) {
    s = (s * 9301 + 49297) % 233280
    out.push(base * 0.5 + (s / 233280) * base * 1.5)
  }
  return out
}

function demoSeries(n: number, base: number): number[] {
  return demoBars(n, base)
}
