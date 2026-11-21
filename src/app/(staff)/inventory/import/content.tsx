'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, UploadSimple, WarningCircle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { categoryLabel, metalLabel } from '@/lib/inventory/labels'
import type { LightspeedReport, LightspeedSample } from '@/lib/imports/lightspeed'

type ErrorCode = keyof ReturnType<typeof useI18n>['t']['inventoryImport']['errors']

function money(n: number | null): string {
  return n == null ? '—' : `$${n.toFixed(2)}`
}

export default function InventoryImportContent() {
  const { t } = useI18n()
  const ti = t.inventoryImport

  const [file, setFile] = useState<File | null>(null)
  const [outlets, setOutlets] = useState<string[]>([])
  const [outlet, setOutlet] = useState('')
  const [report, setReport] = useState<LightspeedReport | null>(null)
  const [samples, setSamples] = useState<LightspeedSample[]>([])
  const [busy, setBusy] = useState<false | 'preview' | 'commit'>(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ inserted: number } | null>(null)

  function errorText(code: unknown, inserted?: number): string {
    const key = typeof code === 'string' && code in ti.errors ? (code as ErrorCode) : 'failed'
    const msg = ti.errors[key]
    return msg.replace('{n}', String(inserted ?? 0))
  }

  async function run(mode: 'preview' | 'commit') {
    if (!file) return
    setBusy(mode)
    setError(null)
    const fd = new FormData()
    fd.set('mode', mode)
    fd.set('file', file)
    if (outlet) fd.set('outlet', outlet)
    try {
      const res = await fetch('/api/imports/inventory', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        if (Array.isArray(json.outlets)) setOutlets(json.outlets)
        setError(errorText(json.error, json.inserted))
        if (mode === 'commit') setReport(null)
      } else if (mode === 'commit') {
        setDone({ inserted: json.inserted })
      } else {
        setOutlets(json.outlets)
        setOutlet(json.outlet)
        setReport(json.report)
        setSamples(json.samples)
      }
    } catch {
      setError(ti.errors.failed)
    }
    setBusy(false)
  }

  function reset() {
    setFile(null); setOutlets([]); setOutlet(''); setReport(null)
    setSamples([]); setError(null); setDone(null)
  }

  const previewed = report !== null && !done

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/inventory" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft size={14} weight="bold" />
          {ti.back}
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">{ti.title}</h1>
        <p className="text-sm text-muted">{ti.subtitle}</p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{ti.step1}</h2>
        <p className="mt-1 text-xs text-muted">{ti.howTo}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:border-gold">
            <UploadSimple size={16} weight="bold" />
            {file ? file.name : ti.chooseFile}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setOutlets([]); setOutlet(''); setReport(null); setDone(null); setError(null)
              }}
            />
          </label>
          {outlets.length > 1 ? (
            <label className="inline-flex items-center gap-2 text-sm">
              <span className="font-medium text-foreground">{ti.outlet}</span>
              <select
                value={outlet}
                onChange={(e) => { setOutlet(e.target.value); setReport(null) }}
                className="rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-blue"
              >
                <option value="">{ti.pickOutlet}</option>
                {outlets.map((o) => (
                  <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            disabled={!file || busy !== false || (outlets.length > 1 && !outlet)}
            onClick={() => run('preview')}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy === 'preview' ? ti.previewing : ti.preview}
          </button>
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {done ? (
        <div className="rounded-xl border border-success/30 bg-success/5 p-5 text-center">
          <CheckCircle size={32} weight="fill" className="mx-auto text-success" />
          <p className="mt-2 text-lg font-bold text-foreground">{ti.doneTitle}</p>
          <p className="text-sm text-muted">{ti.insertedMsg.replace('{n}', done.inserted.toLocaleString())}</p>
          <p className="mt-1 text-xs text-muted">{ti.tagsHint}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/inventory" className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-navy hover:bg-gold-2">
              {ti.viewInventory}
            </Link>
            <button type="button" onClick={reset} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-background">
              {ti.importAnother}
            </button>
          </div>
        </div>
      ) : null}

      {previewed && report ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{ti.step2}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={ti.rRows} value={report.totalRows} />
            <Stat label={ti.rProducts} value={report.productsImported} />
            <Stat label={ti.rToInsert} value={report.toInsert} accent />
            <Stat label={ti.rExisting} value={report.skippedExisting} />
            <Stat label={ti.rNoStock} value={report.skippedNoStock} />
            <Stat label={ti.rService} value={report.skippedService} />
            <Stat label={ti.rNoWeight} value={report.noWeight} />
            <Stat label={ti.rNoPrice} value={report.noPrice} />
          </div>

          <ul className="mt-3 space-y-1 text-xs text-muted">
            <li>{ti.noteUnits}</li>
            <li>{ti.noteSku}</li>
            <li>{ti.noteRerun}</li>
          </ul>
          {report.skippedInvalid > 0 || report.skippedInactive > 0 || report.cappedRows > 0 ? (
            <ul className="mt-2 space-y-1">
              {report.skippedInvalid > 0 ? (
                <Warn text={ti.wInvalid.replace('{n}', String(report.skippedInvalid))} />
              ) : null}
              {report.skippedInactive > 0 ? (
                <Warn text={ti.wInactive.replace('{n}', String(report.skippedInactive))} />
              ) : null}
              {report.cappedRows > 0 ? (
                <Warn text={ti.wCapped.replace('{n}', String(report.cappedRows))} />
              ) : null}
            </ul>
          ) : null}

          {samples.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-background text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{ti.cDescription}</th>
                    <th className="px-3 py-2 font-medium">{ti.cCategory}</th>
                    <th className="px-3 py-2 font-medium">{ti.cMetal}</th>
                    <th className="px-3 py-2 text-right font-medium">{ti.cGrams}</th>
                    <th className="px-3 py-2 text-right font-medium">{ti.cCost}</th>
                    <th className="px-3 py-2 text-right font-medium">{ti.cPrice}</th>
                    <th className="px-3 py-2 font-medium">{ti.cLegacy}</th>
                    <th className="px-3 py-2 text-right font-medium">{ti.cUnits}</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5 font-medium text-foreground">{s.description}</td>
                      <td className="px-3 py-1.5 text-muted">{categoryLabel(s.category, t)}</td>
                      <td className="px-3 py-1.5 text-muted">
                        {[s.karat, s.metal ? metalLabel(s.metal, t) : null].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted">{s.weight_grams ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted">{money(s.cost_basis)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-foreground">{money(s.list_price)}</td>
                      <td className="px-3 py-1.5 font-mono text-muted">{s.legacy_code ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-foreground">{s.units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <button
            type="button"
            disabled={report.toInsert === 0 || busy !== false}
            onClick={() => run('commit')}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-gold-2 to-gold text-base font-extrabold text-[#3a2600] shadow-md transition-all hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle size={18} weight="bold" />
            {busy === 'commit' ? ti.importing : ti.importBtn.replace('{n}', report.toInsert.toLocaleString())}
          </button>
        </section>
      ) : null}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2.5">
      <div className={`font-mono text-xl font-extrabold tabular-nums ${accent ? 'text-gold' : 'text-foreground'}`}>
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[11px] font-medium text-muted">{label}</div>
    </div>
  )
}

function Warn({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-xs text-warning">
      <WarningCircle size={14} weight="bold" className="mt-0.5 shrink-0" />
      {text}
    </li>
  )
}
