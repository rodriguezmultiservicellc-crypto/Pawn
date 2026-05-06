'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  CheckCircle,
  Link as LinkIcon,
  PaperPlaneTilt,
  UserPlus,
  Warning,
} from '@phosphor-icons/react'
import {
  inviteTeamMemberAction,
  changeMemberRoleAction,
  setMemberActiveAction,
  type InviteState,
  type ChangeRoleState,
  type StaffRole,
} from './actions'
import type { TenantRole } from '@/types/database-aliases'

export type TeamMemberRow = {
  id: string
  userId: string
  email: string | null
  fullName: string | null
  role: TenantRole
  isActive: boolean
  lastSignInAt: string | null
  memberSince: string
  isYou: boolean
}

const STAFF_ROLES: StaffRole[] = [
  'owner',
  'chain_admin',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'appraiser',
]

const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Owner',
  chain_admin: 'Chain admin',
  manager: 'Manager',
  pawn_clerk: 'Pawn clerk',
  repair_tech: 'Repair tech',
  appraiser: 'Appraiser',
  client: 'Customer (portal)',
}

const ROLE_HELP: Record<StaffRole, string> = {
  owner: 'Full access. Manages team, billing, settings, deletes.',
  chain_admin: 'Cross-shop access at chain HQ. Same powers as owner across child shops.',
  manager: 'Operations + reports. No team management or billing.',
  pawn_clerk: 'Pawn intake/redeem/extend, sales, customer mgmt. No reports beyond daily register.',
  repair_tech: 'Repair workflow only.',
  appraiser: 'Read-only on pawn intake. Can quote / counter. No write to ledger.',
}

export default function TeamContent({
  tenantId,
  members,
  canManage,
  currentUserId,
}: {
  tenantId: string
  members: TeamMemberRow[]
  canManage: boolean
  currentUserId: string
}) {
  // tenantId / currentUserId currently informational only — server
  // actions re-resolve the active tenant from getCtx() so we can't be
  // tricked by a stale cookie. Touch them so the props don't get
  // dropped by ESLint.
  void tenantId
  void currentUserId

  const active = members.filter((m) => m.isActive)
  const inactive = members.filter((m) => !m.isActive)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-foreground">Team</h1>
        <p className="mt-1 text-sm text-muted">
          {active.length} active member{active.length === 1 ? '' : 's'}
          {inactive.length > 0
            ? ` · ${inactive.length} deactivated`
            : ''}
          .{' '}
          {canManage
            ? 'You can invite new members, change roles, and deactivate accounts.'
            : 'You can view the team but not change membership. Ask an owner.'}
        </p>
      </header>

      {canManage ? <InvitePanel /> : null}

      <MemberTable
        title="Active"
        members={active}
        canManage={canManage}
      />

      {inactive.length > 0 ? (
        <MemberTable
          title="Deactivated"
          members={inactive}
          canManage={canManage}
        />
      ) : null}
    </div>
  )
}

function InvitePanel() {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(
    inviteTeamMemberAction,
    {},
  )
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const onCopy = (link: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => undefined,
    )
  }

  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="flex items-center gap-1 px-1 text-sm font-semibold text-foreground">
        <UserPlus size={14} weight="bold" />
        <span>Invite a team member</span>
      </legend>

      <form action={formAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
        <label className="md:col-span-4 block space-y-1">
          <span className="text-sm font-medium text-foreground">Email *</span>
          <input
            type="email"
            name="email"
            required
            placeholder="staff@yourshop.com"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            autoComplete="off"
          />
          {state.fieldErrors?.email ? (
            <span className="block text-xs text-danger">
              {state.fieldErrors.email}
            </span>
          ) : null}
        </label>

        <label className="md:col-span-3 block space-y-1">
          <span className="text-sm font-medium text-foreground">Full name</span>
          <input
            type="text"
            name="full_name"
            placeholder="optional"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        </label>

        <label className="md:col-span-3 block space-y-1">
          <span className="text-sm font-medium text-foreground">Role *</span>
          <select
            name="role"
            required
            defaultValue="pawn_clerk"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {state.fieldErrors?.role ? (
            <span className="block text-xs text-danger">
              {state.fieldErrors.role}
            </span>
          ) : null}
        </label>

        <div className="md:col-span-2 flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            <PaperPlaneTilt size={14} weight="bold" />
            {pending ? 'Inviting…' : 'Send invite'}
          </button>
        </div>
      </form>

      {state.error ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <Warning size={14} weight="bold" />
          <span>{translateInviteError(state.error)}</span>
        </div>
      ) : null}

      {state.ok && state.manualLink ? (
        <div className="mt-3 rounded-md border border-success/30 bg-success/5 p-3">
          <div className="flex items-start gap-2 text-sm font-medium text-success">
            <CheckCircle size={14} weight="bold" />
            <span>Invite created. Send this link to the new team member:</span>
          </div>
          <div className="mt-2 flex items-stretch gap-2">
            <input
              type="text"
              readOnly
              value={state.manualLink}
              onFocus={(e) => e.currentTarget.select()}
              className="block w-full min-w-0 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
            />
            <button
              type="button"
              onClick={() => onCopy(state.manualLink!)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:bg-background hover:text-foreground"
            >
              <LinkIcon size={12} weight="bold" />
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            They&apos;ll click the link, sign in, and land on the dashboard.
            If they already had an account on another tenant, this just
            adds them to this tenant.
          </p>
        </div>
      ) : null}

      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer hover:text-foreground">
          Role descriptions
        </summary>
        <dl className="mt-2 space-y-1">
          {STAFF_ROLES.map((r) => (
            <div key={r}>
              <dt className="inline font-semibold text-foreground">
                {ROLE_LABELS[r]}:
              </dt>{' '}
              <dd className="inline">{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </fieldset>
  )
}

function MemberTable({
  title,
  members,
  canManage,
}: {
  title: string
  members: TeamMemberRow[]
  canManage: boolean
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-background text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Member</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Last sign-in</th>
              <th className="px-3 py-2 text-left font-medium">Joined</th>
              {canManage ? (
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => (
              <MemberRow key={m.id} member={m} canManage={canManage} />
            ))}
            {members.length === 0 ? (
              <tr>
                <td
                  colSpan={canManage ? 5 : 4}
                  className="px-3 py-6 text-center text-sm text-muted"
                >
                  No members.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function MemberRow({
  member,
  canManage,
}: {
  member: TeamMemberRow
  canManage: boolean
}) {
  return (
    <tr className={member.isActive ? '' : 'bg-background/30 text-muted'}>
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            {member.fullName ?? '—'}
            {member.isYou ? (
              <span className="ml-2 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted">
                you
              </span>
            ) : null}
          </span>
          <span className="font-mono text-[11px] text-muted">
            {member.email ?? '(no email)'}
          </span>
        </div>
      </td>
      <td className="px-3 py-2">
        {canManage && member.isActive ? (
          <RoleSelector member={member} />
        ) : (
          <span className="inline-flex items-center rounded-full bg-background px-2 py-0.5 text-xs font-medium text-foreground">
            {ROLE_LABELS[member.role]}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted">
        {member.lastSignInAt
          ? new Date(member.lastSignInAt).toLocaleDateString()
          : 'never'}
      </td>
      <td className="px-3 py-2 text-xs text-muted">
        {new Date(member.memberSince).toLocaleDateString()}
      </td>
      {canManage ? (
        <td className="px-3 py-2 text-right">
          <ToggleActiveButton member={member} />
        </td>
      ) : null}
    </tr>
  )
}

function RoleSelector({ member }: { member: TeamMemberRow }) {
  const [state, formAction, pending] = useActionState<
    ChangeRoleState,
    FormData
  >(changeMemberRoleAction, {})

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={member.userId} />
      <select
        name="role"
        defaultValue={member.role}
        disabled={pending}
        className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10 disabled:opacity-50"
        onChange={(e) => {
          // Auto-submit on change for snappy UX.
          ;(e.currentTarget.form as HTMLFormElement | null)?.requestSubmit()
        }}
      >
        {STAFF_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      {state.error ? (
        <span className="text-[10px] text-danger">
          {state.error === 'last_owner'
            ? 'last owner'
            : state.error}
        </span>
      ) : null}
    </form>
  )
}

function ToggleActiveButton({ member }: { member: TeamMemberRow }) {
  const [state, formAction, pending] = useActionState<
    { ok?: boolean; error?: string },
    FormData
  >(setMemberActiveAction, {})

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="user_id" value={member.userId} />
      <input
        type="hidden"
        name="is_active"
        value={member.isActive ? '' : 'on'}
      />
      <button
        type="submit"
        disabled={pending || member.isYou}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
          member.isActive
            ? 'border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
            : 'border-success/30 bg-success/5 text-success hover:bg-success/10'
        }`}
        title={member.isYou ? 'You cannot deactivate yourself.' : undefined}
      >
        {pending
          ? '…'
          : member.isActive
            ? 'Deactivate'
            : 'Reactivate'}
      </button>
      {state.error ? (
        <span className="text-[10px] text-danger">
          {state.error === 'last_owner' ? 'last owner' : state.error}
        </span>
      ) : null}
    </form>
  )
}

function translateInviteError(reason: string): string {
  const map: Record<string, string> = {
    auth_invite_failed: 'Could not generate the invite link. Try again.',
    auth_lookup_failed: 'Could not find the new user account after invite.',
    membership_failed: 'Could not save the team-membership row.',
    app_url_not_configured:
      'The platform is misconfigured (NEXT_PUBLIC_APP_URL missing).',
  }
  return map[reason] ?? reason
}
