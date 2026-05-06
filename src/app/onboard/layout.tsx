import type { ReactNode } from 'react'

/**
 * /onboard sits outside the (auth) route group because authenticated users
 * also reach it (the RPC checks the token + claims). Local layout mirrors
 * the (auth) chrome so the card looks consistent.
 */
export default function OnboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8">
        <div className="text-center">
          <h1
            className="font-display bg-clip-text text-2xl font-bold text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(90deg, #ff385c 0%, #e00b41 50%, #92174d 100%)',
            }}
          >
            Pawn
          </h1>
        </div>
        {children}
      </div>
    </div>
  )
}
