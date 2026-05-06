'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  CheckCircle,
  EnvelopeSimple,
  Key,
  Link as LinkIcon,
  Warning,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  sendPortalInviteAction,
  revokePortalInvitesAction,
  generatePortalSignInLinkAction,
  type SendPortalInviteState,
  type GenerateSignInLinkState,
} from '@/app/(staff)/customers/[id]/portal-actions'

export type PortalInvitePanelProps = {
  customerId: string
  customerEmail: string | null
  hasPortalAccess: boolean
  /** Most recent invite for this customer, regardless of status. */
  lastInvite: {
    sentAt: string
    expiresAt: string
    consumedAt: string | null
  } | null
  canManage: boolean
  /** Portal sign-in URL — operator can copy + share with the customer.
   *  Resolved server-side so we don't need window.location.origin in
   *  this client component. */
  portalLoginUrl: string
}

export function PortalInvitePanel(props: PortalInvitePanelProps) {
  const { t } = useI18n()
  const [sendState, sendAction, sendPending] = useActionState<
    SendPortalInviteState,
    FormData
  >(sendPortalInviteAction, {})
  const [revokeState, revokeAction, revokePending] = useActionState<
    { ok?: boolean; error?: string },
    FormData
  >(revokePortalInvitesAction, {})
  const [signInState, signInAction, signInPending] = useActionState<
    GenerateSignInLinkState,
    FormData
  >(generatePortalSignInLinkAction, {})
  const [copied, setCopied] = useState<'manual' | 'signin' | 'portal' | null>(
    null,
  )

  // Auto-clear the "copied" affordance after 2s.
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(id)
  }, [copied])

  // Capture "now" once per mount via a lazy state initializer — the only
  // pattern that satisfies react-hooks/purity for Date.now() (per the
  // Session 8 CLAUDE.md gotcha). Stable across re-renders is fine here:
  // the panel just decides expired-vs-pending against load time.
  const [nowMs] = useState<number>(() => Date.now())
  const status = resolveStatus(props, nowMs)

  const onCopy = (link: string, which: 'manual' | 'signin' | 'portal') => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(link).then(
      () => setCopied(which),
      () => undefined,
    )
  }

  return (
    <fieldset className="rounded-lg border border-border bg-card p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">
        {t.customers.portalInvite.title}
      </legend>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StatusPill status={status} />
          <div className="mt-2 text-sm text-foreground">
            {props.customerEmail ?? (
              <span className="italic text-muted">
                {t.customers.portalInvite.noEmailOnFile}
              </span>
            )}
          </div>
          {props.lastInvite ? (
            <div className="mt-1 text-xs text-muted">
              {props.lastInvite.consumedAt ? (
                <>
                  {t.customers.portalInvite.claimedOn}{' '}
                  {new Date(props.lastInvite.consumedAt).toLocaleString()}
                </>
              ) : new Date(props.lastInvite.expiresAt).getTime() < nowMs ? (
                <>
                  {t.customers.portalInvite.lastInviteExpired}{' '}
                  {new Date(props.lastInvite.sentAt).toLocaleString()}
                </>
              ) : (
                <>
                  {t.customers.portalInvite.lastInviteSent}{' '}
                  {new Date(props.lastInvite.sentAt).toLocaleString()}
                </>
              )}
            </div>
          ) : null}
        </div>

        {props.canManage && status !== 'active' ? (
          <form action={sendAction} className="shrink-0">
            <input type="hidden" name="customer_id" value={props.customerId} />
            <button
              type="submit"
              disabled={sendPending || !props.customerEmail}
              className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
              title={
                props.customerEmail
                  ? undefined
                  : t.customers.portalInvite.noEmailOnFile
              }
            >
              <EnvelopeSimple size={14} weight="bold" />
              {sendPending
                ? t.common.saving
                : status === 'pending'
                  ? t.customers.portalInvite.resend
                  : t.customers.portalInvite.send}
            </button>
          </form>
        ) : null}
      </div>

      {sendState.error ? (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <div className="flex items-start gap-2">
            <Warning size={14} weight="bold" />
            <span>{translateError(sendState.error, t)}</span>
          </div>
          {sendState.details ? (
            <div className="mt-1 ml-5 font-mono text-[11px] text-danger/80">
              {sendState.details}
            </div>
          ) : null}
        </div>
      ) : null}

      {sendState.ok ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
            <CheckCircle size={14} weight="bold" />
            <span>
              {sendState.delivered === 'email'
                ? t.customers.portalInvite.deliveredEmail
                : t.customers.portalInvite.deliveredManual}
            </span>
          </div>
          {sendState.delivered === 'manual' && sendState.manualLink ? (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
              <div className="text-xs font-medium text-warning">
                {t.customers.portalInvite.manualLinkHelp}
              </div>
              <div className="mt-2 flex items-stretch gap-2">
                <input
                  type="text"
                  readOnly
                  value={sendState.manualLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="block w-full min-w-0 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
                />
                <button
                  type="button"
                  onClick={() => onCopy(sendState.manualLink!, 'manual')}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:border-foreground"
                >
                  <LinkIcon size={12} weight="bold" />
                  {copied === 'manual'
                    ? t.customers.portalInvite.copied
                    : t.customers.portalInvite.copy}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Always-visible: portal sign-in URL — operator can copy + share. */}
      <div className="mt-3 border-t border-border pt-3">
        <div className="text-xs font-medium text-foreground">
          {t.customers.portalInvite.signInUrlLabel}
        </div>
        <div className="mt-1 flex items-stretch gap-2">
          <input
            type="text"
            readOnly
            value={props.portalLoginUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="block w-full min-w-0 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          />
          <button
            type="button"
            onClick={() => onCopy(props.portalLoginUrl, 'portal')}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:border-foreground"
          >
            <LinkIcon size={12} weight="bold" />
            {copied === 'portal'
              ? t.customers.portalInvite.copied
              : t.customers.portalInvite.copy}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          {t.customers.portalInvite.signInUrlHelp}
        </p>
      </div>

      {/* When the customer has already claimed: let the operator mint a
          fresh one-time sign-in link for in-store assists. */}
      {props.canManage && status === 'active' ? (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">
                {t.customers.portalInvite.tempSignInTitle}
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                {t.customers.portalInvite.tempSignInHelp}
              </p>
            </div>
            <form action={signInAction} className="shrink-0">
              <input
                type="hidden"
                name="customer_id"
                value={props.customerId}
              />
              <button
                type="submit"
                disabled={signInPending || !props.customerEmail}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-foreground disabled:opacity-50"
              >
                <Key size={12} weight="bold" />
                {signInPending
                  ? t.common.saving
                  : t.customers.portalInvite.tempSignInButton}
              </button>
            </form>
          </div>
          {signInState.error ? (
            <div className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              <div className="flex items-start gap-2">
                <Warning size={12} weight="bold" />
                <span>{translateError(signInState.error, t)}</span>
              </div>
              {signInState.details ? (
                <div className="mt-1 ml-4 font-mono text-[10px] text-danger/80">
                  {signInState.details}
                </div>
              ) : null}
            </div>
          ) : null}
          {signInState.ok && signInState.magicLink ? (
            <div className="mt-2 rounded-md border border-success/30 bg-success/5 p-3">
              <div className="text-xs font-medium text-success">
                {signInState.emailed
                  ? t.customers.portalInvite.tempSignInDeliveredBoth
                  : t.customers.portalInvite.tempSignInDeliveredManualOnly}
              </div>
              <div className="mt-2 flex items-stretch gap-2">
                <input
                  type="text"
                  readOnly
                  value={signInState.magicLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="block w-full min-w-0 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
                />
                <button
                  type="button"
                  onClick={() => onCopy(signInState.magicLink!, 'signin')}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:border-foreground"
                >
                  <LinkIcon size={12} weight="bold" />
                  {copied === 'signin'
                    ? t.customers.portalInvite.copied
                    : t.customers.portalInvite.copy}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-muted">
                {t.customers.portalInvite.tempSignInExpires}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {props.canManage && status === 'pending' ? (
        <div className="mt-3 border-t border-border pt-3">
          <form action={revokeAction}>
            <input type="hidden" name="customer_id" value={props.customerId} />
            <button
              type="submit"
              disabled={revokePending}
              className="text-xs text-muted hover:text-danger disabled:opacity-50"
            >
              {revokePending
                ? t.common.saving
                : t.customers.portalInvite.revoke}
            </button>
          </form>
          {revokeState.error ? (
            <div className="mt-1 text-xs text-danger">
              {translateError(revokeState.error, t)}
            </div>
          ) : null}
          {revokeState.ok ? (
            <div className="mt-1 text-xs text-success">
              {t.customers.portalInvite.revoked}
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  )
}

type Status = 'active' | 'pending' | 'expired' | 'never'

function resolveStatus(props: PortalInvitePanelProps, nowMs: number): Status {
  if (props.hasPortalAccess) return 'active'
  if (!props.lastInvite) return 'never'
  if (props.lastInvite.consumedAt) return 'active' // shouldn't happen, but safe
  if (new Date(props.lastInvite.expiresAt).getTime() < nowMs) return 'expired'
  return 'pending'
}

function StatusPill({ status }: { status: Status }) {
  const { t } = useI18n()
  const map: Record<
    Status,
    { label: string; bg: string; text: string }
  > = {
    active: {
      label: t.customers.portalInvite.statusActive,
      bg: 'bg-success/10 border-success/30',
      text: 'text-success',
    },
    pending: {
      label: t.customers.portalInvite.statusPending,
      bg: 'bg-warning/10 border-warning/30',
      text: 'text-warning',
    },
    expired: {
      label: t.customers.portalInvite.statusExpired,
      bg: 'bg-background border-border',
      text: 'text-muted',
    },
    never: {
      label: t.customers.portalInvite.statusNever,
      bg: 'bg-background border-border',
      text: 'text-muted',
    },
  }
  const { label, bg, text } = map[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${bg} ${text}`}
    >
      {label}
    </span>
  )
}

function translateError(
  reason: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const map: Record<string, string> = {
    no_email: t.customers.portalInvite.errNoEmail,
    already_linked: t.customers.portalInvite.errAlreadyLinked,
    auth_invite_failed: t.customers.portalInvite.errAuthFailed,
    auth_link_failed: t.customers.portalInvite.errAuthFailed,
    invite_insert_failed: t.customers.portalInvite.errInsertFailed,
    app_url_not_configured: t.customers.portalInvite.errAppUrlMissing,
    not_yet_claimed: t.customers.portalInvite.errNotYetClaimed,
    customer_not_found: t.common.error,
  }
  return map[reason] ?? reason
}
