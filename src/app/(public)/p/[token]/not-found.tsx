import { getDictionary } from '@/lib/i18n/config'
import { detectLanguageFromHeaders } from '@/lib/i18n/server'

/**
 * An unknown, revoked or voided pawn link. Generic on purpose, like the
 * repair page's: the same answer whatever the reason, so a probe learns
 * nothing.
 */
export default async function PawnTicketNotFound() {
  const t = getDictionary(await detectLanguageFromHeaders())
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="font-display text-3xl font-bold text-foreground">{t.pawnPublic.notFoundTitle}</h1>
      <p className="mt-3 text-sm text-text-secondary">{t.pawnPublic.notFoundBody}</p>
    </main>
  )
}
