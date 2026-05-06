import Link from 'next/link'

/**
 * Rendered when fetchPublicTenant returns null — the slug doesn't exist,
 * the landing isn't published, or the tenant is suspended. RLS makes
 * those three indistinguishable; we keep the message generic so we
 * don't confirm slug existence to a probe.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="font-display text-3xl font-bold text-foreground">
        Not found
      </h1>
      <p className="mt-3 text-sm text-muted">
        We couldn&rsquo;t find a shop at this address. The link may be
        outdated or the shop may have moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
      >
        Back to home
      </Link>
    </main>
  )
}
