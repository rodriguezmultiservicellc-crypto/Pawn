'use client'

import { useState } from 'react'
import {
  X,
  Tag,
  GitCommit,
  Clock,
  User,
  GitBranch,
  Copy,
  Check,
} from '@phosphor-icons/react'
import { APP_NAME, APP_VERSION, VERSIONS } from '@/lib/app-version'

// NEXT_PUBLIC_* env vars are inlined at build time and safe to read from
// client components. On Vercel, VERCEL_GIT_COMMIT_SHA + VERCEL_ENV are
// auto-exposed; the rest are forwarded via next.config.ts. Locally
// everything is undefined and the footer gracefully shows "local".
const rawSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || ''
const shortSha = rawSha ? rawSha.slice(0, 7) : 'local'
const rawEnv = process.env.NEXT_PUBLIC_VERCEL_ENV || ''
const env =
  rawEnv === 'production' ? 'prod' :
  rawEnv === 'preview' ? 'preview' :
  rawEnv === 'development' ? 'dev' :
  'local'
const commitMessage = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE || ''
const commitAuthor = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_AUTHOR_NAME || ''
const commitBranch = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || ''
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || ''

const envColor =
  env === 'prod' ? 'text-emerald-600' :
  env === 'preview' ? 'text-amber-600' :
  'text-blue-600'

function relativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diffMs = Date.now() - then
  if (diffMs < 0) return 'just now'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.floor(day / 365)
  return `${yr}y ago`
}

function firstLine(s: string): string {
  return (s.split(/\r?\n/)[0] || '').trim()
}

export default function VersionFooter() {
  const [showHistory, setShowHistory] = useState(false)
  const [copied, setCopied] = useState(false)

  const buildAge = relativeTime(buildTime)

  function copySha() {
    if (!rawSha) return
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(rawSha).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <>
      <div className="flex items-center justify-center gap-2 py-2 border-t border-slate-200 text-[10px] text-slate-500 bg-slate-50/50">
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors"
          title={
            commitMessage
              ? `Latest deploy: ${firstLine(commitMessage)}\nClick for full deploy info + version history`
              : 'Click for version history'
          }
        >
          <Tag size={10} />
          <span className="font-semibold">{APP_NAME}</span>
          <span>v{APP_VERSION}</span>
          <span className="text-slate-300">·</span>
          <span className={`font-semibold uppercase tracking-wide ${envColor}`}>{env}</span>
          <span className="text-slate-300">·</span>
          <span className="font-mono">{shortSha}</span>
          {buildAge && (
            <>
              <span className="text-slate-300">·</span>
              <span>{buildAge}</span>
            </>
          )}
        </button>
      </div>

      {showHistory && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowHistory(false)}
          />
          <div className="relative bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Tag size={16} />
                Version & Deploy
              </h2>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="text-slate-500 hover:text-slate-900 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-5">
              {rawSha && (
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Latest deploy</h3>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                      env === 'prod'    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      env === 'preview' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                          'bg-blue-50 text-blue-700 border border-blue-200'
                    }`}>
                      {env}
                    </span>
                  </div>

                  {commitMessage && (
                    <p className="text-sm text-slate-900 font-medium leading-snug mb-3">
                      {firstLine(commitMessage)}
                    </p>
                  )}

                  <dl className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <GitCommit size={11} className="text-slate-500 shrink-0" />
                      <dt className="text-slate-500">Commit</dt>
                      <dd className="font-mono text-slate-900 ml-auto flex items-center gap-1.5">
                        <span>{shortSha}</span>
                        <button
                          type="button"
                          onClick={copySha}
                          title="Copy full SHA"
                          className="text-slate-500 hover:text-blue-600 transition-colors"
                        >
                          {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                        </button>
                      </dd>
                    </div>
                    {commitBranch && (
                      <div className="flex items-center gap-2">
                        <GitBranch size={11} className="text-slate-500 shrink-0" />
                        <dt className="text-slate-500">Branch</dt>
                        <dd className="font-mono text-slate-900 ml-auto">{commitBranch}</dd>
                      </div>
                    )}
                    {commitAuthor && (
                      <div className="flex items-center gap-2">
                        <User size={11} className="text-slate-500 shrink-0" />
                        <dt className="text-slate-500">Author</dt>
                        <dd className="text-slate-900 ml-auto">{commitAuthor}</dd>
                      </div>
                    )}
                    {buildTime && (
                      <div className="flex items-center gap-2">
                        <Clock size={11} className="text-slate-500 shrink-0" />
                        <dt className="text-slate-500">Built</dt>
                        <dd className="text-slate-900 ml-auto">
                          {buildAge && <span className="font-semibold">{buildAge}</span>}
                          <span className="text-slate-500 ml-1.5">
                            ({new Date(buildTime).toLocaleString()})
                          </span>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-3">Version history</h3>
                <div className="space-y-4">
                  {VERSIONS.map((entry, idx) => (
                    <div
                      key={entry.v}
                      className={`pb-4 ${idx < VERSIONS.length - 1 ? 'border-b border-slate-200' : ''}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-amber-50 text-amber-700 font-mono">
                          v{entry.v}
                        </span>
                        {idx === 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Current
                          </span>
                        )}
                        <span className="text-xs text-slate-500 ml-auto">{entry.date}</span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {entry.notes}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
