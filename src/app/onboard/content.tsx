'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useLangLocal } from '@/lib/i18n/use-lang'
import { claimTenantAction } from './actions'

type Props = {
  token: string | null
  tenantName: string | null
}

export default function OnboardContent({ token, tenantName }: Props) {
  const { t } = useLangLocal()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Token missing entirely.
  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t.onboard.invalidTitle}
        </h2>
        <p className="text-sm text-muted">{t.onboard.missingToken}</p>
        <Link
          href="/login"
          className="inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground"
        >
          {t.onboard.backToLogin}
        </Link>
      </div>
    )
  }

  // Token present but no matching active tenant — invalid or already used.
  if (!tenantName) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t.onboard.invalidTitle}
        </h2>
        <p className="text-sm text-muted">{t.onboard.invalidBody}</p>
        <Link
          href="/login"
          className="inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground"
        >
          {t.onboard.backToLogin}
        </Link>
      </div>
    )
  }

  function onAccept() {
    setError(null)
    startTransition(async () => {
      const result = await claimTenantAction(token!)
      // claimTenantAction redirects on success (component unmounts before
      // we ever reach this line). We only see a return value on failure.
      if (result?.error) {
        setError(result.error)
      }
    })
  }

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold text-foreground">{t.onboard.title}</h2>
      <p className="text-sm text-foreground">
        {t.onboard.subtitleBefore}
        <strong className="font-semibold">{tenantName}</strong>
        {t.onboard.subtitleAfter}
      </p>

      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onAccept}
        disabled={isPending}
        className="w-full rounded-md bg-gold px-4 py-2.5 text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
      >
        {isPending ? t.onboard.accepting : t.onboard.accept}
      </button>
    </div>
  )
}
