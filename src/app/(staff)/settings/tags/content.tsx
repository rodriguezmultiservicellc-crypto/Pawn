'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import PrintTagsMenu from '@/components/labels/PrintTagsMenu'
import { encodeCost } from '@/lib/labels/cost-code'
import { layoutTag, type TagWarning } from '@/lib/labels/layout'
import { buildCollateralTag, buildInventoryTag, buildRepairTag, type TagContent } from '@/lib/labels/tag-content'
import {
  BUILTIN_TEMPLATES,
  FIELDS_BY_KIND,
  TAG_DPIS,
  templateKey,
  type TagKind,
  type TagTemplate,
  type TagTemplateInput,
} from '@/lib/labels/templates'
import { deleteTagTemplateAction, saveTagCostCodeAction, saveTagTemplateAction } from './actions'

export type TagSamples = Record<TagKind, Record<string, string> | null>

const KIND_ORDER: TagKind[] = ['inventory', 'collateral', 'repair']

/** A representative tag per kind, for the live "does it fit" check. */
function sampleContent(kind: TagKind, t: TagTemplate, costCodeWord: string | null): TagContent {
  if (kind === 'inventory') {
    return buildInventoryTag({
      item: {
        sku: 'INV-000123', sku_number: 123, list_price: 1250, metal: 'gold', karat: '14',
        weight_grams: 4.2, description: 'Cuban link chain 22 in', cost_basis: 610,
        stones: [{ count: 3, carat: 0.15, is_total_carat: false }],
      },
      fields: t.fields, payload: t.barcode_payload, costCodeWord, shopName: 'Sol Pawn',
    })
  }
  if (kind === 'collateral') {
    return buildCollateralTag({
      item: { ticket_number: 'PT-000123', position: 0, description: '10K ring with stone', metal_type: 'gold', karat: 10, weight_grams: 3.1, due_date: '2026-12-15' },
      fields: t.fields,
    })
  }
  return buildRepairTag({ item: { ticket_number: 'RT-000123', title: 'Size ring to 7', promised_date: '2026-12-15' }, fields: t.fields })
}

type Draft = { id: string | null; input: TagTemplateInput }

function toInput(t: TagTemplate): TagTemplateInput {
  return {
    name: t.name, kind: t.kind, width_in: t.width_in, height_in: t.height_in, layout: t.layout,
    gap_in: t.gap_in, dpi: t.dpi, barcode_payload: t.barcode_payload,
    fields: { ...t.fields }, is_default: t.is_default,
  }
}

export default function TagsSettingsContent({
  templates,
  costCodeWord,
  canEdit,
  kinds,
  samples,
}: {
  templates: TagTemplate[]
  costCodeWord: string | null
  canEdit: boolean
  kinds: Record<TagKind, boolean>
  samples: TagSamples
}) {
  const { t } = useI18n()
  const ts = t.tags.settings
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const errorText = (code: string) => (ts.errors as Record<string, string>)[code] ?? ts.errors.saveFailed
  const kindLabel: Record<TagKind, string> = {
    inventory: ts.kindInventory,
    collateral: ts.kindCollateral,
    repair: ts.kindRepair,
  }

  function save() {
    if (!draft) return
    start(async () => {
      const r = await saveTagTemplateAction(draft.id, draft.input)
      if (r.ok) {
        setDraft(null)
        setMsg({ ok: true, text: ts.saved })
        router.refresh()
      } else setMsg({ ok: false, text: errorText(r.error) })
    })
  }

  function remove(tpl: TagTemplate) {
    if (!tpl.id || !window.confirm(ts.deleteConfirm.replace('{name}', tpl.name))) return
    start(async () => {
      const r = await deleteTagTemplateAction(tpl.id!)
      setMsg(r.ok ? { ok: true, text: ts.deleted } : { ok: false, text: errorText(r.error) })
      if (r.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={14} weight="bold" />
        {t.nav.settings}
      </Link>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">{ts.title}</h1>
        <p className="mt-1 text-sm text-muted">{ts.subtitle}</p>
      </div>

      {!canEdit ? (
        <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted">{ts.ownerOnly}</div>
      ) : null}
      {msg ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${msg.ok ? 'border-success/30 bg-success/5 text-foreground' : 'border-danger/30 bg-danger/5 text-danger'}`}>
          {msg.text}
        </div>
      ) : null}

      <p className="text-sm text-muted">{ts.builtinNote}</p>

      {KIND_ORDER.filter((k) => kinds[k]).map((kind) => {
        const saved = templates.filter((x) => x.kind === kind)
        const builtins = BUILTIN_TEMPLATES.filter((x) => x.kind === kind)
        const effectiveDefault = saved.find((x) => x.is_default) ?? saved[0] ?? builtins.find((b) => b.is_default) ?? builtins[0]
        return (
          <section key={kind} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">{kindLabel[kind]}</h2>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setDraft({ id: null, input: { ...toInput(builtins[0]), name: '', is_default: saved.length === 0 } })}
                  className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-background"
                >
                  {ts.newTemplate}
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-border">
              {[...saved, ...builtins].map((tpl) => {
                const isDefault = templateKey(tpl) === templateKey(effectiveDefault)
                const warnings = layoutTag(tpl, sampleContent(kind, tpl, costCodeWord)).warnings
                const sample = samples[kind]
                return (
                  <li key={templateKey(tpl)} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">
                        {tpl.name}
                        {isDefault ? <span className="ml-2 text-xs font-normal text-muted">· {t.tags.templateDefault}</span> : null}
                        {tpl.id === null ? <span className="ml-2 text-xs font-normal text-muted">· {t.tags.templateBuiltin}</span> : null}
                      </div>
                      <div className="font-mono text-xs text-muted">
                        {ts.size.replace('{w}', String(tpl.width_in)).replace('{h}', String(tpl.height_in))} ·{' '}
                        {tpl.layout === 'split' ? ts.layoutSplit : ts.layoutSingle} · {tpl.dpi} dpi
                      </div>
                      <WarningList warnings={warnings} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {sample ? (
                        <PrintTagsMenu
                          kind={kind}
                          target={{ ...sample, test: '1' }}
                          choices={[{ key: templateKey(tpl), name: tpl.name, isDefault: true, builtin: tpl.id === null }]}
                          label={ts.testPrint}
                          compact
                        />
                      ) : (
                        <span className="text-xs text-muted">{ts.testPrintNone}</span>
                      )}
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft(
                              tpl.id
                                ? { id: tpl.id, input: toInput(tpl) }
                                : { id: null, input: { ...toInput(tpl), is_default: saved.length === 0 } },
                            )
                          }
                          className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-background"
                        >
                          {tpl.id ? ts.edit : ts.customize}
                        </button>
                      ) : null}
                      {canEdit && tpl.id ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(tpl)}
                          className="rounded-md border border-danger/30 bg-card px-2 py-1 text-xs text-danger hover:bg-danger/5"
                        >
                          {ts.delete}
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
            {draft && draft.input.kind === kind ? (
              <TemplateEditor
                draft={draft}
                onChange={setDraft}
                onCancel={() => setDraft(null)}
                onSave={save}
                pending={pending}
                costCodeWord={costCodeWord}
              />
            ) : null}
          </section>
        )
      })}

      {kinds.inventory ? <CostCodeCard initial={costCodeWord} canEdit={canEdit} /> : null}
    </div>
  )
}

function WarningList({ warnings }: { warnings: TagWarning[] }) {
  const { t } = useI18n()
  if (warnings.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {warnings.map((w) => (
        <li key={w} className="flex items-start gap-1 text-xs text-warning">
          <Warning size={12} weight="bold" className="mt-0.5 shrink-0" />
          {t.tags.settings.warnings[w]}
        </li>
      ))}
    </ul>
  )
}

const inputCls =
  'mt-1 block w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10'
const labelCls = 'block text-sm font-semibold text-foreground'

function TemplateEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  pending,
  costCodeWord,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  onCancel: () => void
  onSave: () => void
  pending: boolean
  costCodeWord: string | null
}) {
  const { t } = useI18n()
  const ts = t.tags.settings
  const v = draft.input
  const set = (patch: Partial<TagTemplateInput>) => onChange({ ...draft, input: { ...v, ...patch } })

  const warnings = useMemo(() => {
    const tpl: TagTemplate = { ...v, id: null }
    if (v.layout === 'split' && v.width_in - v.gap_in < 0.5) return null
    try {
      return layoutTag(tpl, sampleContent(v.kind, tpl, costCodeWord)).warnings
    } catch {
      return null
    }
  }, [v, costCodeWord])

  const num = (s: string) => (s === '' ? 0 : Number(s))

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-gold/40 bg-background p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelCls}>
          {ts.name}
          <input className={inputCls} value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className={labelCls}>
          {ts.layout}
          <select className={inputCls} value={v.layout} onChange={(e) => set({ layout: e.target.value as TagTemplateInput['layout'] })}>
            <option value="single">{ts.layoutSingle}</option>
            <option value="split">{ts.layoutSplit}</option>
          </select>
        </label>
        <label className={labelCls}>
          {ts.width}
          <input className={inputCls} type="number" step="0.01" min="0.5" max="6" value={v.width_in} onChange={(e) => set({ width_in: num(e.target.value) })} />
        </label>
        <label className={labelCls}>
          {ts.height}
          <input className={inputCls} type="number" step="0.01" min="0.25" max="6" value={v.height_in} onChange={(e) => set({ height_in: num(e.target.value) })} />
        </label>
        {v.layout === 'split' ? (
          <label className={labelCls}>
            {ts.gap}
            <input className={inputCls} type="number" step="0.01" min="0" max="3" value={v.gap_in} onChange={(e) => set({ gap_in: num(e.target.value) })} />
            <span className="mt-1 block text-xs font-normal text-muted">{ts.gapHelp}</span>
          </label>
        ) : null}
        <label className={labelCls}>
          {ts.dpi}
          <select className={inputCls} value={v.dpi} onChange={(e) => set({ dpi: Number(e.target.value) as TagTemplateInput['dpi'] })}>
            {TAG_DPIS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        {v.kind === 'inventory' ? (
          <label className={labelCls}>
            {ts.payload}
            <select className={inputCls} value={v.barcode_payload} onChange={(e) => set({ barcode_payload: e.target.value as TagTemplateInput['barcode_payload'] })}>
              <option value="number">{ts.payloadNumber}</option>
              <option value="code">{ts.payloadCode}</option>
            </select>
          </label>
        ) : null}
      </div>

      <fieldset>
        <legend className={labelCls}>{ts.fieldsTitle}</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {FIELDS_BY_KIND[v.kind].map((f) => (
            <label key={f} className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-gold"
                checked={v.fields[f] === true}
                onChange={(e) => set({ fields: { ...v.fields, [f]: e.target.checked } })}
              />
              {ts.fields[f]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="inline-flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="h-4 w-4 accent-gold" checked={v.is_default} onChange={(e) => set({ is_default: e.target.checked })} />
        {ts.isDefault}
      </label>

      {warnings === null ? (
        <p className="text-xs text-danger">{ts.errors.tag_wings_too_small}</p>
      ) : (
        <WarningList warnings={warnings} />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !v.name.trim() || warnings === null}
          onClick={onSave}
          className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
        >
          {ts.save}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background">
          {ts.cancel}
        </button>
      </div>
    </div>
  )
}

function CostCodeCard({ initial, canEdit }: { initial: string | null; canEdit: boolean }) {
  const { t } = useI18n()
  const ts = t.tags.settings
  const router = useRouter()
  const [word, setWord] = useState(initial ?? '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const example = encodeCost(1250, word)

  function submit(value: string) {
    start(async () => {
      const r = await saveTagCostCodeAction(value)
      if (r.ok) {
        setMsg({ ok: true, text: ts.costCodeSaved })
        if (value === '') setWord('')
        router.refresh()
      } else setMsg({ ok: false, text: (ts.errors as Record<string, string>)[r.error] ?? ts.errors.saveFailed })
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold text-foreground">{ts.costCodeTitle}</h2>
      <p className="mt-1 text-sm text-muted">{ts.costCodeHelp}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className={labelCls}>
          {ts.costCodeLabel}
          <input
            className={`${inputCls} font-mono uppercase tracking-widest`}
            value={word}
            maxLength={10}
            disabled={!canEdit}
            onChange={(e) => setWord(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          />
        </label>
        {canEdit ? (
          <>
            <button
              type="button"
              disabled={pending || word.length !== 10}
              onClick={() => submit(word)}
              className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
            >
              {ts.costCodeSave}
            </button>
            {initial ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => submit('')}
                className="rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                {ts.costCodeClear}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {example ? <p className="mt-2 text-sm text-foreground">{ts.costCodeExample.replace('{code}', example)}</p> : null}
      {msg ? <p className={`mt-2 text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p> : null}
    </section>
  )
}
