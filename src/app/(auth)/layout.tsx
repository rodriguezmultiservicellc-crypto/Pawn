import type { ReactNode } from 'react'

/**
 * (auth) route group layout. Navy full-bleed background with a centered
 * white card — DESIGN-lunaazul.md §6 (Auth Card). No sidebar, no top nav.
 * Uses useLangLocal in the form components so we don't need an
 * I18nProvider here.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 bg-navy px-4 py-12">
      <h1 className="font-display text-3xl font-bold text-white">Pawn</h1>
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-card p-10 shadow-lg">
        {children}
      </div>
    </div>
  )
}
