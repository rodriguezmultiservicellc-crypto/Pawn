// src/app/(staff)/settings/integrations/google-reviews/content.tsx
'use client'

import { useActionState, useState } from 'react'
import {
  CheckCircle,
  Warning,
  Circle,
  EyeSlash,
  Eye,
  Star,
} from '@phosphor-icons/react'
import {
  updateGoogleReviewsSettingsAction,
  testGoogleReviewsConnectionAction,
  toggleHideReviewAction,
  type UpdateGoogleReviewsSettingsState,
  type TestConnectionState,
  type ToggleHideReviewState,
} from './actions'

export type GoogleReviewsSettingsReview = {
  time: number
  authorName: string
  rating: number
  text: string | null
  hidden: boolean
}

export type GoogleReviewsSettingsView = {
  placeId: string
  apiKeyConfigured: boolean
  minStarFloor: number
  cache: {
    rating: number | null
    totalReviewCount: number | null
    fetchedAt: string
    lastError: string | null
    lastErrorAt: string | null
  } | null
  reviews: GoogleReviewsSettingsReview[]
}

const initialState: UpdateGoogleReviewsSettingsState = {}
const initialTestState: TestConnectionState = {}
const initialToggleState: ToggleHideReviewState = {}

export default function GoogleReviewsSettingsContent({
  view,
}: {
  view: GoogleReviewsSettingsView
}) {
  const [state, formAction, pending] = useActionState(
    updateGoogleReviewsSettingsAction,
    initialState,
  )
  const [testState, testAction, testing] = useActionState(
    testGoogleReviewsConnectionAction,
    initialTestState,
  )

  const [showAdvanced, setShowAdvanced] = useState(view.apiKeyConfigured)

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">
        Google Reviews
      </h1>
      <p className="mt-1 text-sm text-muted">
        Show your Google rating and recent reviews on your public landing page.
      </p>

      <div className="mt-6">
        <StatusChip view={view} />
      </div>

      <form action={formAction} className="mt-6 space-y-6">
        <Field
          label="Place ID"
          name="google_place_id"
          defaultValue={view.placeId}
          help="Your Google Place ID identifies your shop on Google Maps."
          helpLink={{
            href: 'https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder',
            label: 'Find your Place ID',
          }}
          fieldErrors={state.fieldErrors}
        />

        <SelectField
          label="Hide reviews below"
          name="google_reviews_min_star_floor"
          defaultValue={String(view.minStarFloor)}
          help="Reviews under this rating won't show on your landing page. Aggregate rating is unaffected."
          options={[
            { value: '1', label: '1 ★' },
            { value: '2', label: '2 ★' },
            { value: '3', label: '3 ★' },
            { value: '4', label: '4 ★' },
            { value: '5', label: '5 ★' },
          ]}
          fieldErrors={state.fieldErrors}
        />

        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          className="text-sm font-medium text-gold hover:underline"
        >
          Advanced (optional) {showAdvanced ? '▴' : '▾'}
        </button>

        {showAdvanced ? (
          <ApiKeySecretField
            name="google_places_api_key"
            isSet={view.apiKeyConfigured}
            error={state.fieldErrors?.['google_places_api_key']}
          />
        ) : null}

        {state.error && state.error !== 'validation_failed' ? (
          <p className="text-sm text-danger">{state.error}</p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy hover:bg-gold/90 disabled:opacity-50"
          >
            {pending ? 'Save…' : 'Save'}
          </button>

          {state.ok ? (
            <span className="text-sm text-success">Saved</span>
          ) : null}
        </div>
      </form>

      <div className="mt-8 border-t border-border pt-6">
        <form action={testAction}>
          <button
            type="submit"
            disabled={testing || !view.placeId}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-background disabled:opacity-50"
          >
            {testing ? 'Test connection…' : 'Test connection'}
          </button>
        </form>

        {testState.ok ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-success">
            <CheckCircle size={16} weight="fill" />
            Synced — {testState.rating ?? '—'} ★ · {testState.totalReviewCount ?? 0} reviews
          </p>
        ) : testState.error ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-danger">
            <Warning size={16} weight="fill" />
            Failed: {testState.error}
          </p>
        ) : null}
      </div>

      {view.reviews.length > 0 ? (
        <div className="mt-8 border-t border-border pt-6">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-foreground">
            Cached reviews
          </h2>
          <p className="mt-1 text-sm text-muted">
            Hide an individual review without changing the star floor. Hidden
            reviews still count in the aggregate rating Google shows.
          </p>
          <ul className="mt-4 space-y-3">
            {view.reviews.map((review) => (
              <ReviewRow key={review.time} review={review} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ReviewRow({ review }: { review: GoogleReviewsSettingsReview }) {
  const [, toggleAction, toggling] = useActionState(
    toggleHideReviewAction,
    initialToggleState,
  )

  return (
    <li
      className={`rounded-lg border border-border p-3 ${
        review.hidden ? 'bg-background opacity-60' : 'bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="truncate">{review.authorName}</span>
            <span className="inline-flex items-center gap-0.5 text-warning">
              <Star size={12} weight="fill" />
              {review.rating}
            </span>
          </div>
          {review.text ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted">{review.text}</p>
          ) : (
            <p className="mt-1 text-sm italic text-muted">No comment</p>
          )}
        </div>
        <form action={toggleAction} className="flex-shrink-0">
          <input type="hidden" name="time" value={review.time} />
          <input
            type="hidden"
            name="action"
            value={review.hidden ? 'unhide' : 'hide'}
          />
          <button
            type="submit"
            disabled={toggling}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
          >
            {review.hidden ? (
              <>
                <Eye size={12} />
                Unhide
              </>
            ) : (
              <>
                <EyeSlash size={12} />
                Hide
              </>
            )}
          </button>
        </form>
      </div>
    </li>
  )
}

function StatusChip({ view }: { view: GoogleReviewsSettingsView }) {
  if (!view.placeId) {
    return (
      <Chip color="ash" icon={<Circle size={12} weight="fill" />}>
        Not configured
      </Chip>
    )
  }
  if (!view.cache) {
    return (
      <Chip color="ash" icon={<Circle size={12} weight="fill" />}>
        Pending — first sync runs on next visit
      </Chip>
    )
  }
  if (view.cache.lastError) {
    return (
      <Chip color="error" icon={<Warning size={12} weight="fill" />}>
        Last sync failed: {view.cache.lastError}
      </Chip>
    )
  }
  return (
    <Chip color="success" icon={<CheckCircle size={12} weight="fill" />}>
      Connected · last sync {relativeAgo(view.cache.fetchedAt)} ago
    </Chip>
  )
}

function Chip({
  color,
  icon,
  children,
}: {
  color: 'ash' | 'success' | 'error'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const colorMap = {
    ash: 'border-border bg-background text-muted',
    success: 'border-border bg-background text-success',
    error: 'border-border bg-background text-danger',
  }
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1 text-xs font-medium ${colorMap[color]}`}
    >
      {icon}
      {children}
    </span>
  )
}

function relativeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return '<1 min'
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60_000)} min`
  if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / (60 * 60 * 1000))}h`
  return `${Math.floor(ms / (24 * 60 * 60 * 1000))}d`
}

function Field({
  label,
  name,
  defaultValue,
  help,
  helpLink,
  type = 'text',
  fieldErrors,
}: {
  label: string
  name: string
  defaultValue: string
  help: string
  helpLink?: { href: string; label: string }
  type?: 'text' | 'password'
  fieldErrors?: Record<string, string>
}) {
  const err = fieldErrors?.[name]
  return (
    <label className="block">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        className="mt-2 block w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
      />
      <p className="mt-2 text-xs text-muted">
        {help}
        {helpLink ? (
          <>
            {' '}
            <a
              href={helpLink.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue hover:underline"
            >
              {helpLink.label}
            </a>
          </>
        ) : null}
      </p>
      {err ? <p className="mt-1 text-xs text-danger">{err}</p> : null}
    </label>
  )
}

function ApiKeySecretField({
  name,
  isSet,
  error,
}: {
  name: string
  isSet: boolean
  error?: string
}) {
  const [editing, setEditing] = useState<boolean>(!isSet)
  const [clear, setClear] = useState<boolean>(false)
  const [value, setValue] = useState<string>('')

  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">
        <span>Use my own Google API key</span>
        {isSet ? (
          <span className="text-xs text-success">Configured</span>
        ) : (
          <span className="text-xs text-muted">Not configured</span>
        )}
      </span>
      {editing ? (
        <input
          type="password"
          name={name}
          value={clear ? '__CLEAR__' : value}
          onChange={(e) => {
            setClear(false)
            setValue(e.target.value)
          }}
          placeholder={isSet ? 'Leave blank to keep current key' : ''}
          className="mt-2 block w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
        />
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value="••••••••••••••••"
            readOnly
            className="block flex-1 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm text-muted"
          />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground"
          >
            Update
          </button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        Leave blank to use the platform default. Provide a Places API key here only if you want to bill Google directly.
      </p>
      {editing && isSet ? (
        <button
          type="button"
          onClick={() => setClear(true)}
          className="mt-1 text-xs text-danger hover:underline"
        >
          Clear stored key
        </button>
      ) : null}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </label>
  )
}

function SelectField({
  label,
  name,
  defaultValue,
  help,
  options,
  fieldErrors,
}: {
  label: string
  name: string
  defaultValue: string
  help: string
  options: { value: string; label: string }[]
  fieldErrors?: Record<string, string>
}) {
  const err = fieldErrors?.[name]
  return (
    <label className="block">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-2 block w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs text-muted">{help}</p>
      {err ? <p className="mt-1 text-xs text-danger">{err}</p> : null}
    </label>
  )
}
