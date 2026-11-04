import { getDictionary } from '@/lib/i18n/config'
import { detectLanguageFromHeaders } from '@/lib/i18n/server'

/** Generic bilingual 404 for a bad quote token — server component (see item 420). */
export default async function QuoteNotFound() {
  const t = getDictionary(await detectLanguageFromHeaders())
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="font-display text-3xl font-bold text-foreground">
        {t.quotePublic.notFoundTitle}
      </h1>
      <p className="mt-3 text-sm text-muted">{t.quotePublic.notFoundBody}</p>
    </main>
  )
}
