'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { CheckCircle, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { claimPortalAction, type ClaimState } from './actions'

export type ClaimPageState =
  | { kind: 'ready'; shopName: string; customerName: string }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'already_used' }
  | { kind: 'already_linked_other' }
  | {
      kind: 'wrong_user'
      inviteEmail: string
      userEmail: string | null
    }

export default function ClaimContent({
  state,
  token,
}: {
  state: ClaimPageState
  token: string
}) {
  const { t } = useI18n()
  const [actionState, formAction, pending] = useActionState<
    ClaimState,
    FormData
  >(claimPortalAction, {})

  return (
    <div className="flex min-h-screen items-center justify-center bg-cloud px-4 py-10">
      <div
        className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-8"
        style={{
          boxShadow:
            'rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0',
        }}
      >
        <h1 className="text-2xl font-bold text-ink">
          {t.portal.claim.title}
        </h1>

        {state.kind === 'ready' ? (
          <>
            <p className="mt-3 text-sm text-ink">
              {state.customerName ? (
                <>
                  {t.portal.claim.greeting} <strong>{state.customerName}</strong>,
                </>
              ) : (
                t.portal.claim.greetingNoName
              )}
            </p>
            <p className="mt-3 text-sm text-ink">
              {t.portal.claim.intro1} <strong>{state.shopName}</strong>{' '}
              {t.portal.claim.intro2}
            </p>
            <ul className="mt-3 space-y-1 text-sm text-ink">
              <li className="flex items-start gap-2">
                <CheckCircle
                  size={14}
                  weight="fill"
                  className="mt-0.5 text-success"
                />
                <span>{t.portal.claim.bullet1}</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle
                  size={14}
                  weight="fill"
                  className="mt-0.5 text-success"
                />
                <span>{t.portal.claim.bullet2}</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle
                  size={14}
                  weight="fill"
                  className="mt-0.5 text-success"
                />
                <span>{t.portal.claim.bullet3}</span>
              </li>
            </ul>

            {actionState.error ? (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
                <Warning size={14} weight="bold" />
                <span>{translateError(actionState.error, t)}</span>
              </div>
            ) : null}

            <form action={formAction} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-md bg-rausch px-4 py-3 text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
              >
                {pending ? t.common.saving : t.portal.claim.confirm}
              </button>
            </form>
          </>
        ) : (
          <BadStateBlock state={state} />
        )}
      </div>
    </div>
  )
}

function BadStateBlock({
  state,
}: {
  state: Exclude<ClaimPageState, { kind: 'ready' }>
}) {
  const { t } = useI18n()
  const map: Record<typeof state.kind, string> = {
    invalid: t.portal.claim.errInvalid,
    expired: t.portal.claim.errExpired,
    already_used: t.portal.claim.errAlreadyUsed,
    already_linked_other: t.portal.claim.errAlreadyLinkedOther,
    wrong_user: t.portal.claim.errWrongUser,
  }
  const message = map[state.kind] ?? t.common.error

  return (
    <>
      <div className="mt-3 flex items-start gap-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
        <Warning size={14} weight="bold" />
        <span>{message}</span>
      </div>
      {state.kind === 'wrong_user' ? (
        <div className="mt-3 text-xs text-ash">
          {t.portal.claim.wrongUserHint}{' '}
          <span className="font-medium text-ink">{state.inviteEmail}</span>
          {state.userEmail ? (
            <>
              {' '}
              ·{' '}
              {t.portal.claim.signedInAs}{' '}
              <span className="font-medium text-ink">{state.userEmail}</span>
            </>
          ) : null}
        </div>
      ) : null}
      <Link
        href="/login"
        className="mt-6 block w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-center text-ink hover:border-ink"
      >
        {t.portal.claim.backToLogin}
      </Link>
    </>
  )
}

function translateError(
  reason: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const map: Record<string, string> = {
    token_missing: t.portal.claim.errInvalid,
    unauthenticated: t.portal.claim.errUnauthenticated,
    invalid: t.portal.claim.errInvalid,
    expired: t.portal.claim.errExpired,
    already_used: t.portal.claim.errAlreadyUsed,
    already_linked_other: t.portal.claim.errAlreadyLinkedOther,
    wrong_user: t.portal.claim.errWrongUser,
    link_failed: t.portal.claim.errLinkFailed,
    membership_failed: t.portal.claim.errLinkFailed,
    consume_failed: t.portal.claim.errLinkFailed,
  }
  return map[reason] ?? t.common.error
}
