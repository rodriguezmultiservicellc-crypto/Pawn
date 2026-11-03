import { getDictionary } from '@/lib/i18n/config'
import { detectLanguageFromHeaders } from '@/lib/i18n/server'

/**
 * Rendered for an invalid / revoked / replaced tracking token. Generic on
 * purpose: the same answer whether the token never existed, was revoked,
 * or the ticket was voided, so the page cannot confirm anything to a probe.
 *
 * Server component, same shape as /s/[slug]/not-found.tsx; the language
 * comes from Accept-Language because there is no customer record to read
 * it from (that is the point of a bad token).
 */
export default async function TrackingNotFound() {
  const t = getDictionary(await detectLanguageFromHeaders())
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="font-display text-3xl font-bold text-foreground">
        {t.tracking.notFoundTitle}
      </h1>
      <p className="mt-3 text-sm text-muted">{t.tracking.notFoundBody}</p>
    </main>
  )
}
