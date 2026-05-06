import Link from 'next/link'

export default function CatalogItemNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="font-display text-2xl font-bold text-foreground">Not found</h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        This item is no longer available, or the link may be wrong.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2"
      >
        Back to home
      </Link>
    </main>
  )
}
