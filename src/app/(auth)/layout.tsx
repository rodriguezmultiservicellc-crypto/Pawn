import type { ReactNode } from 'react'

/**
 * (auth) route group layout. Centered card on Canvas White. No sidebar,
 * no top nav. Uses useLangLocal in the form components so we don't need
 * an I18nProvider here.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-cloud px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-hairline bg-canvas p-8">
        <div className="text-center">
          <h1
            className="bg-clip-text text-2xl font-bold text-transparent"
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
