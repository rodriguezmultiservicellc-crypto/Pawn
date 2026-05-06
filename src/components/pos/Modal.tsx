'use client'

import { X } from '@phosphor-icons/react'

/**
 * Shared dialog primitive for the POS surface. Mirrors the Modal/Footer
 * pattern in src/components/pawn/RecordPaymentDialog.tsx.
 */

export function Modal({
  title,
  onClose,
  size = 'md',
  children,
}: {
  title: string
  onClose: () => void
  size?: 'md' | 'lg' | 'xl'
  children: React.ReactNode
}) {
  const widthCls =
    size === 'xl'
      ? 'max-w-3xl'
      : size === 'lg'
        ? 'max-w-2xl'
        : 'max-w-lg'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${widthCls} rounded-lg border border-border bg-card p-5 shadow-lg`}
      >
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
            aria-label="close"
          >
            <X size={16} weight="bold" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2">{children}</div>
  )
}
