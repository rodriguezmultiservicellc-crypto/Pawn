'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Auth callback handler. Supports BOTH:
 *   1. PKCE flow — `?code=` in the query string. Exchange via
 *      `exchangeCodeForSession`. Used for email/password reset and OAuth
 *      providers.
 *   2. Implicit flow — `#access_token=...&refresh_token=...` in the hash
 *      fragment. Used by Supabase admin.generateLink({type:'invite'}) and
 *      magiclink. Hash fragments NEVER reach the server, so this MUST be
 *      a client component.
 *
 * Lessons from Abacus Session 6: a server-only route handler can't read
 * the hash, so all "missing_code" errors on invite links trace back to
 * forgetting the hash-fragment branch.
 *
 * Errors flow back to /login with `?error=...` so the login form can
 * render a friendly message.
 */
export default function CallbackHandler() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const supabase = createClient()
    const next = params.get('next') ?? '/'

    async function run() {
      const code = params.get('code')

      // PKCE: ?code= present → exchange for session
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          // Common case: user opened the reset link in a different browser
          // than where they requested it (PKCE code_verifier missing). Try
          // session fallback before giving up.
          const { data: sess } = await supabase.auth.getSession()
          if (!sess.session) {
            router.replace('/login?error=pkce_mismatch')
            return
          }
        }
        router.replace(next)
        return
      }

      // Implicit flow: hash fragment carries access_token + refresh_token
      if (typeof window !== 'undefined' && window.location.hash) {
        const hash = new URLSearchParams(window.location.hash.slice(1))
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (error) {
            router.replace('/login?error=session_expired')
            return
          }
          router.replace(next)
          return
        }
      }

      // Neither — bad link.
      router.replace('/login?error=invite_expired')
    }

    void run()
  }, [params, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted">Signing you in…</p>
    </div>
  )
}
