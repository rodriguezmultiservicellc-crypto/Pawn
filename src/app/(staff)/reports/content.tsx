'use client'

import Link from 'next/link'
import {
  CashRegister,
  Coins,
  Receipt,
  Package,
  ShoppingBag,
  Wrench,
  Shield,
  Buildings,
  ChartBar,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { Dictionary } from '@/lib/i18n/en'

type Modules = {
  has_pawn: boolean
  has_repair: boolean
  has_retail: boolean
}

type CardDef = {
  href: string
  icon: React.ReactNode
  title: keyof Dictionary['reports']['landing']
  visible: boolean
}

export default function ReportsLanding({
  modules,
  isChainHq,
}: {
  modules: Modules
  isChainHq: boolean
}) {
  const { t } = useI18n()

  const cards: CardDef[] = [
    {
      href: '/reports/daily-register',
      icon: <CashRegister size={20} weight="regular" />,
      title: 'dailyRegister',
      visible: modules.has_retail,
    },
    {
      href: '/reports/pawn-aging',
      icon: <Coins size={20} weight="regular" />,
      title: 'pawnAging',
      visible: modules.has_pawn,
    },
    {
      href: '/reports/loan-activity',
      icon: <Receipt size={20} weight="regular" />,
      title: 'loanActivity',
      visible: modules.has_pawn,
    },
    {
      href: '/reports/inventory-turn',
      icon: <Package size={20} weight="regular" />,
      title: 'inventoryTurn',
      visible: true,
    },
    {
      href: '/reports/sales-summary',
      icon: <ShoppingBag size={20} weight="regular" />,
      title: 'salesSummary',
      visible: modules.has_retail,
    },
    {
      href: '/reports/repair-summary',
      icon: <Wrench size={20} weight="regular" />,
      title: 'repairSummary',
      visible: modules.has_repair,
    },
    {
      href: '/reports/police-report',
      icon: <Shield size={20} weight="regular" />,
      title: 'policeReport',
      visible: modules.has_pawn || modules.has_retail,
    },
    {
      href: '/reports/cross-shop',
      icon: <Buildings size={20} weight="regular" />,
      title: 'crossShop',
      visible: isChainHq,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ChartBar size={28} weight="regular" className="text-rausch" />
        <div>
          <h1 className="text-2xl font-bold text-ink">{t.reports.title}</h1>
          <p className="text-sm text-ash">{t.reports.subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards
          .filter((c) => c.visible)
          .map((c) => {
            const meta = t.reports.landing[c.title]
            return (
              <Link
                key={c.href}
                href={c.href}
                className="flex flex-col gap-3 rounded-lg border border-hairline bg-canvas p-5 transition-colors hover:border-ink"
              >
                <div className="flex items-center gap-2">
                  <span className="text-rausch">{c.icon}</span>
                  <span className="text-sm font-medium text-ink">
                    {meta.title}
                  </span>
                </div>
                <p className="text-xs text-ash">{meta.description}</p>
                <span className="mt-auto text-xs font-medium text-ink underline-offset-2 hover:underline">
                  {t.reports.runReport}
                </span>
              </Link>
            )
          })}
      </div>
    </div>
  )
}
