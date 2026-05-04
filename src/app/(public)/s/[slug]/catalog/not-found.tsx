import Link from 'next/link'

/**
 * Generic 404 — never confirms whether the slug exists, the catalog flag
 * is off, or has_retail is false. Probe-resistant.
 */
export default function CatalogNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-ink">Not found</h1>
      <p className="mt-3 max-w-md text-sm text-ash">
        We couldn&apos;t find what you were looking for. Double-check the
        link, or head back to the home page.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-rausch px-4 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep"
      >
        Back to home
      </Link>
    </main>
  )
}
