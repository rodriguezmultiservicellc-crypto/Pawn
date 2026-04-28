'use client'

import { ArrowSquareOut, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { buildCertVerifyUrl } from '@/lib/appraisals/verify-links'

export type StoneRow = {
  uid: string
  position: number
  count: string
  type: string
  cut: string
  est_carat: string
  color: string
  clarity: string
  certified: boolean
  cert_lab: string
  cert_number: string
  notes: string
}

export function newStoneRow(position: number): StoneRow {
  return {
    uid:
      typeof crypto !== 'undefined'
        ? crypto.randomUUID()
        : `s${Math.random()}`,
    position,
    count: '1',
    type: '',
    cut: '',
    est_carat: '',
    color: '',
    clarity: '',
    certified: false,
    cert_lab: '',
    cert_number: '',
    notes: '',
  }
}

export default function StoneEditor({
  index,
  row,
  onChange,
  onRemove,
}: {
  index: number
  row: StoneRow
  onChange: (patch: Partial<StoneRow>) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-lg border border-hairline bg-cloud/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full border border-hairline bg-canvas px-2 py-0.5 text-[11px] font-mono text-ink">
          {t.appraisal.new_.stonePosition} {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-md border border-error/30 bg-error/5 px-2 py-1 text-xs font-medium text-error hover:bg-error/10"
        >
          <Trash size={12} weight="bold" />
          {t.appraisal.new_.removeStone}
        </button>
      </div>
      <input
        type="hidden"
        name={`stone_${index}_position`}
        value={row.position}
      />
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
        <Input
          name={`stone_${index}_count`}
          label={t.appraisal.new_.stoneCount}
          value={row.count}
          onChange={(v) => onChange({ count: v })}
          type="number"
          step="1"
        />
        <Input
          name={`stone_${index}_type`}
          label={t.appraisal.new_.stoneType}
          value={row.type}
          onChange={(v) => onChange({ type: v })}
          span={2}
        />
        <Input
          name={`stone_${index}_cut`}
          label={t.appraisal.new_.stoneCut}
          value={row.cut}
          onChange={(v) => onChange({ cut: v })}
        />
        <Input
          name={`stone_${index}_est_carat`}
          label={t.appraisal.new_.stoneCarat}
          value={row.est_carat}
          onChange={(v) => onChange({ est_carat: v })}
          type="number"
          step="0.001"
          span={2}
        />
        <Input
          name={`stone_${index}_color`}
          label={t.appraisal.new_.stoneColor}
          value={row.color}
          onChange={(v) => onChange({ color: v })}
        />
        <Input
          name={`stone_${index}_clarity`}
          label={t.appraisal.new_.stoneClarity}
          value={row.clarity}
          onChange={(v) => onChange({ clarity: v })}
        />
        <label className="md:col-span-2 flex items-center gap-2 pt-4">
          <input
            type="checkbox"
            name={`stone_${index}_certified`}
            checked={row.certified}
            onChange={(e) => onChange({ certified: e.target.checked })}
            className="h-4 w-4 rounded border-hairline text-ink focus:ring-ink/20"
          />
          <span className="text-xs font-medium text-ink">
            {t.appraisal.new_.stoneCertified}
          </span>
        </label>
        <Input
          name={`stone_${index}_cert_lab`}
          label={t.appraisal.new_.stoneCertLab}
          value={row.cert_lab}
          onChange={(v) => onChange({ cert_lab: v })}
        />
        <CertNumberWithVerify
          index={index}
          label={t.appraisal.new_.stoneCertNumber}
          number={row.cert_number}
          lab={row.cert_lab}
          onChange={(v) => onChange({ cert_number: v })}
        />
        <label className="md:col-span-6 block space-y-1">
          <span className="text-xs font-medium text-ink">
            {t.appraisal.new_.stoneNotes}
          </span>
          <input
            type="text"
            name={`stone_${index}_notes`}
            value={row.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
        </label>
      </div>
    </div>
  )
}

function CertNumberWithVerify({
  index,
  label,
  number,
  lab,
  onChange,
}: {
  index: number
  label: string
  number: string
  lab: string
  onChange: (v: string) => void
}) {
  const verify = buildCertVerifyUrl({ lab, number })
  return (
    <label className="block space-y-1 md:col-span-2">
      <span className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink">{label}</span>
        {verify ? (
          <a
            href={verify.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-medium text-rausch hover:underline"
            title="Opens the lab's report-check page in a new tab"
          >
            {verify.label}
            <ArrowSquareOut size={10} weight="bold" />
          </a>
        ) : null}
      </span>
      <input
        type="text"
        name={`stone_${index}_cert_number`}
        value={number}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
      />
    </label>
  )
}

function Input({
  name,
  label,
  value,
  onChange,
  type = 'text',
  step,
  span = 1,
}: {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  step?: string
  span?: number
}) {
  const colSpan =
    span === 2 ? 'md:col-span-2' : span === 3 ? 'md:col-span-3' : ''
  return (
    <label className={`block space-y-1 ${colSpan}`}>
      <span className="text-xs font-medium text-ink">{label}</span>
      <input
        type={type}
        step={step}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
      />
    </label>
  )
}
