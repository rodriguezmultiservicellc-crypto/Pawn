import type { ReactNode } from 'react'

/**
 * /onboard sits outside the (auth) route group because authenticated users
 * also reach it (the RPC checks the token + claims). Local layout mirrors
 * the (auth) chrome so the card looks consistent — DESIGN-lunaazul.md §6.
 */
export default function OnboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 bg-navy px-4 py-12">
      <h1 className="font-display text-3xl font-bold text-white">Pawn</h1>
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-card p-10 shadow-lg">
        {children}
      </div>
    </div>
  )
}
