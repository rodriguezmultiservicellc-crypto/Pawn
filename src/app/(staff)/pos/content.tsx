'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  CashRegister,
  Plus,
  ShoppingBag,
  ArrowsClockwise,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  RegisterStatusBadge,
  SaleStatusBadge,
} from '@/components/pos/Badges'
import { OpenRegisterDialog } from '@/components/pos/OpenRegisterDialog'
import { CloseRegisterDialog } from '@/components/pos/CloseRegisterDialog'
import { closeRegisterAction, openRegisterAction } from './actions'
import type { SaleStatus } from '@/types/database-aliases'

export type PosHomeOpenSession = {
  id: string
  opened_at: string
  opened_by: string | null
  opening_cash: number
  cash_sales: number
  card_sales: number
  cash_refunds: number
  expected_cash: number
  notes: string | null
}

export type PosHomeRecentSale = {
  id: string
  sale_number: string
  sale_kind: 'retail' | 'layaway'
  status: SaleStatus
  total: number
  paid_total: number
  completed_at: string | null
  created_at: string
  customer_id: string | null
  customer_name: string | null
}

export default function PosHomeContent({
  openSession,
  recentSales,
}: {
  openSession: PosHomeOpenSession | null
  recentSales: PosHomeRecentSale[]
}) {
  const { t } = useI18n()
  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{t.pos.title}</h1>
          <p className="text-sm text-muted">{t.pos.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {openSession ? (
            <>
              <Link
                href="/pos/sales/new"
                className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold-2"
              >
                <Plus size={14} weight="bold" />
                {t.pos.register.newSale}
              </Link>
              <button
                type="button"
                onClick={() => setShowClose(true)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
              >
                <CashRegister size={14} weight="bold" />
                {t.pos.register.closeSession}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold-2"
            >
              <CashRegister size={14} weight="bold" />
              {t.pos.register.open}
            </button>
          )}
          <Link
            href="/pos/layaways"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
          >
            <ShoppingBag size={14} weight="bold" />
            {t.pos.layaway.list}
          </Link>
        </div>
      </header>

      {openSession ? (
        <SessionPanel session={openSession} />
      ) : (
        <NoSessionPanel onOpen={() => setShowOpen(true)} />
      )}

      <RecentSalesPanel rows={recentSales} />

      {showOpen ? (
        <OpenRegisterDialog
          onClose={() => setShowOpen(false)}
          onSubmit={openRegisterAction}
        />
      ) : null}
      {showClose && openSession ? (
        <CloseRegisterDialog
          sessionId={openSession.id}
          expectedCash={openSession.expected_cash}
          onClose={() => setShowClose(false)}
          onSubmit={closeRegisterAction}
        />
      ) : null}
    </div>
  )
}

function SessionPanel({ session }: { session: PosHomeOpenSession }) {
  const { t } = useI18n()
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CashRegister size={16} weight="regular" />
          {t.pos.register.title}
        </h2>
        <RegisterStatusBadge status="open" />
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={t.pos.register.openedAt}
          value={new Date(session.opened_at).toLocaleString()}
        />
        <Stat
          label={t.pos.register.openingCash}
          value={fmtMoney(session.opening_cash)}
        />
        <Stat
          label={t.pos.register.todayCash}
          value={fmtMoney(session.cash_sales)}
        />
        <Stat
          label={t.pos.register.todayCard}
          value={fmtMoney(session.card_sales)}
        />
        <Stat
          label={t.pos.register.expected}
          value={fmtMoney(session.expected_cash)}
        />
      </div>
      {session.cash_refunds > 0 ? (
        <p className="mt-2 text-xs text-muted">
          {t.pos.register.cashRefunds}: {fmtMoney(session.cash_refunds)}
        </p>
      ) : null}
    </section>
  )
}

function NoSessionPanel({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n()
  return (
    <section className="rounded-lg border border-warning/30 bg-warning/5 p-6 text-center">
      <CashRegister
        size={28}
        weight="regular"
        className="mx-auto text-warning"
      />
      <h2 className="mt-2 text-base font-semibold text-foreground">
        {t.pos.register.notOpen}
      </h2>
      <p className="mt-1 text-sm text-muted">{t.pos.register.notOpenBody}</p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2"
      >
        <CashRegister size={14} weight="bold" />
        {t.pos.register.openSession}
      </button>
    </section>
  )
}

function RecentSalesPanel({ rows }: { rows: PosHomeRecentSale[] }) {
  const { t } = useI18n()
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ArrowsClockwise size={14} weight="regular" />
          {t.pos.register.todaySales}
        </h2>
      </header>
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted">
          {t.dashboard.none}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={
                  r.sale_kind === 'layaway'
                    ? `/pos/sales/${r.id}`
                    : `/pos/sales/${r.id}`
                }
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-background"
              >
                <div className="font-mono text-xs text-foreground">{r.sale_number}</div>
                <div className="min-w-0 flex-1 truncate text-xs text-muted">
                  {r.customer_name ?? t.pos.sale.anonymous}
                </div>
                <div className="font-mono text-xs text-foreground">
                  {fmtMoney(r.total)}
                </div>
                <SaleStatusBadge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="font-mono text-sm text-foreground">{value}</div>
    </div>
  )
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
