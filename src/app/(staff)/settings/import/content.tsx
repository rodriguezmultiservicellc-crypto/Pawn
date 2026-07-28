'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  UploadSimple,
  ArrowLeft,
  CheckCircle,
  WarningCircle,
  Table,
  FileCsv,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  IMPORT_SOURCES,
  TARGET_FIELDS,
  type ImportReport,
  type ImportSampleRow,
  type ImportSourceId,
  type Mapping,
} from '@/lib/imports/catalog'

export default function ImportContent() {
  const { t, lang } = useI18n()
  const ti = t.imports

  const [source, setSource] = useState<ImportSourceId | null>(null)
  const [vendorLabel, setVendorLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Mapping>({})
  const [report, setReport] = useState<ImportReport | null>(null)
  const [samples, setSamples] = useState<ImportSampleRow[]>([])
  const [busy, setBusy] = useState<false | 'preview' | 'commit'>(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ inserted: number } | null>(null)

  const isGeneric = source === 'generic'
  const previewed = report !== null && !done

  async function run(mode: 'preview' | 'commit') {
    if (!source || !file) return
    setBusy(mode)
    setError(null)
    const fd = new FormData()
    fd.set('source', source)
    fd.set('mode', mode)
    fd.set('file', file)
    if (isGeneric) {
      fd.set('mapping', JSON.stringify(mapping))
      if (vendorLabel.trim()) fd.set('vendor_label', vendorLabel.trim())
    }
    try {
      const res = await fetch('/api/imports/customers', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || ti.failed)
        setBusy(false)
        return
      }
      if (mode === 'commit') {
        setDone({ inserted: json.inserted })
        setReport(json.report)
      } else {
        setHeaders(json.headers)
        setMapping(json.mapping)
        setReport(json.report)
        setSamples(json.samples)
      }
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  function reset() {
    setFile(null); setHeaders([]); setMapping({}); setReport(null)
    setSamples([]); setError(null); setDone(null)
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {ti.backToSettings}
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
          {ti.title}
        </h1>
        <p className="text-sm text-muted">{ti.subtitle}</p>
      </div>

      {/* Step 1 — source */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{ti.step1}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {IMPORT_SOURCES.map((s) => {
            const on = source === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSource(s.id); reset() }}
                className={`rounded-xl border-[1.5px] p-4 text-left transition-all hover:-translate-y-0.5 ${
                  on ? 'border-gold bg-gold/[0.06] shadow-sm' : 'border-border bg-card hover:border-gold'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileCsv size={20} weight="regular" className={on ? 'text-gold' : 'text-muted'} />
                  <span className="font-bold text-foreground">{s.label}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {s.id === 'xpawn' ? ti.xpawnDesc : ti.genericDesc}
                </p>
              </button>
            )
          })}
        </div>

        {isGeneric ? (
          <label className="mt-3 block space-y-1">
            <span className="text-xs font-medium text-foreground">{ti.vendorLabel}</span>
            <input
              type="text"
              value={vendorLabel}
              onChange={(e) => setVendorLabel(e.target.value)}
              placeholder={ti.vendorPlaceholder}
              className="block w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-blue"
            />
          </label>
        ) : null}
      </section>

      {/* Step 2 — file + preview */}
      {source ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{ti.step2}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:border-gold">
              <UploadSimple size={16} weight="bold" />
              {file ? file.name : ti.chooseFile}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setDone(null); setError(null) }}
              />
            </label>
            <button
              type="button"
              disabled={!file || busy !== false}
              onClick={() => run('preview')}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {busy === 'preview' ? ti.previewing : ti.preview}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Done */}
      {done ? (
        <div className="rounded-xl border border-success/30 bg-success/5 p-5 text-center">
          <CheckCircle size={32} weight="fill" className="mx-auto text-success" />
          <p className="mt-2 text-lg font-bold text-foreground">
            {ti.doneTitle}
          </p>
          <p className="text-sm text-muted">
            {ti.insertedMsg.replace('{n}', String(done.inserted))}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/customers" className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-navy hover:bg-gold-2">
              {ti.viewCustomers}
            </Link>
            <button type="button" onClick={reset} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-background">
              {ti.importAnother}
            </button>
          </div>
        </div>
      ) : null}

      {/* Mapping editor (generic only, after first preview) */}
      {previewed && isGeneric && headers.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Table size={16} weight="regular" />
            {ti.mappingTitle}
          </h2>
          <p className="mt-1 text-xs text-muted">{ti.mappingHelp}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {TARGET_FIELDS.map((f) => (
              <label key={f.field} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-xs font-medium text-foreground">
                  {lang === 'es' ? f.es : f.en}
                </span>
                <select
                  value={mapping[f.field] ?? ''}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.field]: e.target.value || undefined }))
                  }
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-blue"
                >
                  <option value="">{ti.skip}</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy !== false}
            onClick={() => run('preview')}
            className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-background disabled:opacity-50"
          >
            {busy === 'preview' ? ti.previewing : ti.updatePreview}
          </button>
        </section>
      ) : null}

      {/* Report + samples + commit */}
      {previewed && report ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{ti.reportTitle}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label={ti.rParsed} value={report.totalRows} />
            <Stat label={ti.rToInsert} value={report.toInsert} accent />
            <Stat label={ti.rNoName} value={report.skippedNoName} />
            <Stat label={ti.rDup} value={report.skippedDup} />
            <Stat label={ti.rExisting} value={report.skippedExisting} />
            <Stat label={ti.rDob} value={report.dobUnparseable} />
          </div>

          {report.warnings.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {report.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-warning">
                  <WarningCircle size={14} weight="bold" className="mt-0.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          ) : null}

          {samples.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-background text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{ti.cName}</th>
                    <th className="px-3 py-2 font-medium">{ti.cDob}</th>
                    <th className="px-3 py-2 font-medium">{ti.cPhone}</th>
                    <th className="px-3 py-2 font-medium">{ti.cIdType}</th>
                    <th className="px-3 py-2 font-medium">{ti.cCity}</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5 font-medium text-foreground">{s.name}</td>
                      <td className="px-3 py-1.5 text-muted">{s.dob ?? '—'}</td>
                      <td className="px-3 py-1.5 text-muted">{s.phone ?? '—'}</td>
                      <td className="px-3 py-1.5 text-muted">{s.id_type ?? '—'}</td>
                      <td className="px-3 py-1.5 text-muted">
                        {[s.city, s.state].filter(Boolean).join(', ') || '—'}
                      </td>
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
            {busy === 'commit'
              ? ti.importing
              : ti.importBtn.replace('{n}', String(report.toInsert))}
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
