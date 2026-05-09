'use client'

import { useActionState, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  PencilSimple,
  Trash,
  Warning,
} from '@phosphor-icons/react'
import { SUPPORTED_ICONS } from '@/components/pawn/CategoryPicker'
import {
  saveCategoryAction,
  deactivateCategoryAction,
  saveHasFirearmsAction,
  type SaveCategoryState,
} from './actions'

export type CategoryRow = {
  id: string
  slug: string
  label: string
  icon: string
  sort_order: number
  is_active: boolean
  requires_ffl: boolean
  /** NULL = top-level. Otherwise UUID of the parent top-level row. */
  parent_id: string | null
}

export default function PawnCategoriesContent({
  categories,
  hasFirearms,
  canManage,
  canFlipFirearms,
}: {
  categories: CategoryRow[]
  hasFirearms: boolean
  canManage: boolean
  canFlipFirearms: boolean
}) {
  const [editing, setEditing] = useState<CategoryRow | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  // When the operator clicks "+ Add sub-category" on a top-level row,
  // the modal opens with the parent_id pre-filled to that top.
  const [addUnderParentId, setAddUnderParentId] = useState<string | null>(null)

  // Group subs by parent_id for nested rendering.
  const topLevels = categories.filter((c) => c.parent_id == null)
  const subsByParent = new Map<string, CategoryRow[]>()
  for (const c of categories) {
    if (c.parent_id != null) {
      const arr = subsByParent.get(c.parent_id) ?? []
      arr.push(c)
      subsByParent.set(c.parent_id, arr)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          Back to settings
        </Link>
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold text-navy">
          Pawn categories
        </h1>
        <p className="mt-1 text-sm text-muted">
          The tile buttons shown on /pawn/new step 1. Operators pick one
          before filling in the rest of the ticket.
        </p>
      </div>

      {/* HAS_FIREARMS TOGGLE */}
      <FirearmsToggle initialValue={hasFirearms} canEdit={canFlipFirearms} />

      {/* CATEGORY LIST — top-levels with subs nested under each */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-lg font-bold text-foreground">
            Categories
          </h2>
          {canManage ? (
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setAddUnderParentId(null)
                setShowAdd(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-navy hover:bg-gold-2"
            >
              <Plus size={14} weight="bold" />
              Add top-level
            </button>
          ) : null}
        </header>
        {topLevels.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">
            No categories yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {topLevels.map((c) => {
              const subs = subsByParent.get(c.id) ?? []
              return (
                <li key={c.id} className="px-5 py-3">
                  <CategoryRowDisplay
                    row={c}
                    canManage={canManage}
                    onEdit={() => {
                      setEditing(c)
                      setAddUnderParentId(null)
                      setShowAdd(false)
                    }}
                    onAddSub={
                      canManage
                        ? () => {
                            setEditing(null)
                            setAddUnderParentId(c.id)
                            setShowAdd(true)
                          }
                        : null
                    }
                  />
                  {subs.length > 0 ? (
                    <ul className="mt-2 ml-8 space-y-1 border-l border-border pl-4">
                      {subs.map((sub) => (
                        <li key={sub.id}>
                          <CategoryRowDisplay
                            row={sub}
                            canManage={canManage}
                            onEdit={() => {
                              setEditing(sub)
                              setAddUnderParentId(null)
                              setShowAdd(false)
                            }}
                            onAddSub={null}
                            isSub
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* EDIT / ADD MODAL */}
      {(showAdd || editing) && canManage ? (
        <CategoryEditModal
          category={editing}
          parentOptions={topLevels.map((t) => ({ id: t.id, label: t.label }))}
          presetParentId={addUnderParentId}
          onClose={() => {
            setShowAdd(false)
            setEditing(null)
            setAddUnderParentId(null)
          }}
        />
      ) : null}
    </div>
  )
}

function CategoryRowDisplay({
  row,
  canManage,
  onEdit,
  onAddSub,
  isSub = false,
}: {
  row: CategoryRow
  canManage: boolean
  onEdit: () => void
  onAddSub: (() => void) | null
  isSub?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-3 text-sm ${
        row.is_active ? '' : 'opacity-60'
      }`}
    >
      <span className="font-mono text-xs text-muted w-8 shrink-0">
        {row.sort_order}
      </span>
      <span
        className={`font-display ${
          isSub ? 'text-sm' : 'text-base'
        } font-bold text-foreground`}
      >
        {row.label}
      </span>
      <span className="font-mono text-xs text-muted">({row.slug})</span>
      {row.requires_ffl ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
          <Warning size={10} weight="bold" />
          FFL
        </span>
      ) : null}
      {!row.is_active ? (
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted">
          INACTIVE
        </span>
      ) : null}
      <span className="ml-auto text-xs text-muted">icon: {row.icon}</span>
      {canManage ? (
        <>
          {onAddSub ? (
            <button
              type="button"
              onClick={onAddSub}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold text-muted hover:border-gold/40 hover:bg-gold/5 hover:text-gold"
            >
              <Plus size={10} weight="bold" />
              Add sub
            </button>
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-border bg-card p-1.5 text-muted hover:border-blue/40 hover:bg-blue/5 hover:text-blue"
            aria-label="Edit"
          >
            <PencilSimple size={14} weight="bold" />
          </button>
          {row.is_active ? (
            <DeactivateButton id={row.id} label={row.label} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function FirearmsToggle({
  initialValue,
  canEdit,
}: {
  initialValue: boolean
  canEdit: boolean
}) {
  const [state, formAction, pending] = useActionState(saveHasFirearmsAction, {})
  return (
    <form
      action={formAction}
      className="rounded-xl border border-border bg-card p-5"
    >
      <h2 className="font-display text-lg font-bold text-foreground">
        Firearms gate
      </h2>
      <p className="mt-1 text-xs text-muted">
        Federal FFL is required to pawn firearms. When OFF, the Firearms
        tile is hidden from /pawn/new even if the category exists.
        Default OFF.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="has_firearms"
            defaultChecked={initialValue}
            disabled={!canEdit}
            className="h-4 w-4 rounded border-border text-gold focus:ring-blue/10"
          />
          <span>This shop holds an FFL and accepts firearms</span>
        </label>
        <button
          type="submit"
          disabled={pending || !canEdit}
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          {pending ? '…' : 'Save'}
        </button>
      </div>
      {state.ok ? (
        <p className="mt-2 text-xs text-success">✓ Saved</p>
      ) : null}
      {state.error ? (
        <p className="mt-2 text-xs text-danger">{state.error}</p>
      ) : null}
    </form>
  )
}

function DeactivateButton({ id, label }: { id: string; label: string }) {
  const [pending, startTransition] = useTransition()

  function onClick() {
    if (!confirm(`Deactivate "${label}"?`)) return
    const fd = new FormData()
    fd.set('id', id)
    startTransition(async () => {
      await deactivateCategoryAction({}, fd)
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-md border border-border bg-card p-1.5 text-muted hover:border-danger/40 hover:bg-danger/5 hover:text-danger disabled:opacity-50"
      aria-label="Deactivate"
    >
      <Trash size={14} weight="bold" />
    </button>
  )
}

function CategoryEditModal({
  category,
  parentOptions,
  presetParentId,
  onClose,
}: {
  category: CategoryRow | null
  parentOptions: Array<{ id: string; label: string }>
  /** When non-null and we're in ADD mode, the parent dropdown pre-fills
   *  to this id (operator clicked "+ Add sub" on a top-level row). */
  presetParentId: string | null
  onClose: () => void
}) {
  const [state, formAction, pending] = useActionState<
    SaveCategoryState,
    FormData
  >(saveCategoryAction, {})

  if (state.ok) {
    onClose()
  }

  // For an EDITED row, default the parent dropdown to whatever the row
  // currently has. For an ADDED row under a specific parent, use
  // presetParentId. Otherwise top-level.
  const initialParentId =
    category?.parent_id ?? presetParentId ?? ''

  // Editing a top-level that already has subs underneath should NOT be
  // re-parented (would orphan the subs visually). Filter the parent
  // dropdown to exclude the row being edited (no self-parent) plus any
  // descendants. Only one level deep so descendants = subs of this id.
  const parentChoices = parentOptions.filter(
    (p) => !category || p.id !== category.id,
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg font-bold text-foreground">
          {category
            ? 'Edit category'
            : presetParentId
            ? 'Add sub-category'
            : 'Add top-level category'}
        </h3>
        <form action={formAction} className="mt-4 space-y-3">
          {category ? (
            <input type="hidden" name="id" value={category.id} />
          ) : null}

          <Field label="Parent (None = top-level)">
            <select
              name="parent_id"
              defaultValue={initialParentId}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            >
              <option value="">None — top-level</option>
              {parentChoices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Label" required>
            <input
              type="text"
              name="label"
              required
              defaultValue={category?.label ?? ''}
              maxLength={60}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
            {state.fieldErrors?.label ? (
              <p className="mt-1 text-xs text-danger">
                {state.fieldErrors.label}
              </p>
            ) : null}
          </Field>

          <Field label="Slug (machine name)" required>
            <input
              type="text"
              name="slug"
              required
              defaultValue={category?.slug ?? ''}
              pattern="[a-z0-9_]+"
              maxLength={40}
              placeholder="e.g. jewelry"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
            {state.fieldErrors?.slug ? (
              <p className="mt-1 text-xs text-danger">
                {state.fieldErrors.slug}
              </p>
            ) : null}
          </Field>

          <Field label="Icon" required>
            <select
              name="icon"
              defaultValue={category?.icon ?? 'Package'}
              required
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            >
              {SUPPORTED_ICONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {state.fieldErrors?.icon ? (
              <p className="mt-1 text-xs text-danger">
                {state.fieldErrors.icon}
              </p>
            ) : null}
          </Field>

          <Field label="Sort order">
            <input
              type="number"
              name="sort_order"
              min={0}
              max={9999}
              defaultValue={category?.sort_order ?? 100}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </Field>

          <label className="block">
            <span className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="requires_ffl"
                defaultChecked={category?.requires_ffl ?? false}
                className="h-4 w-4 rounded border-border text-gold focus:ring-blue/10"
              />
              <span>Requires FFL (federal firearms license)</span>
            </span>
            <p className="ml-6 text-xs text-muted">
              When checked, this tile is only shown if the tenant has FFL
              enabled above.
            </p>
          </label>

          <label className="block">
            <span className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={category?.is_active ?? true}
                className="h-4 w-4 rounded border-border text-gold focus:ring-blue/10"
              />
              <span>Active (show on /pawn/new)</span>
            </span>
          </label>

          {state.error ? (
            <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {state.error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-2 disabled:opacity-50"
            >
              {pending ? '…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  )
}
