'use client'

import { useI18n } from '@/lib/i18n/context'
import {
  isPurityInput,
  purityChoicesFor,
  purityFromWords,
  purityScaleOf,
} from '@/lib/spot-prices/purity'
import { ChoiceOrOther } from './ChoiceOrOther'

/**
 * Karat / Purity, following the metal: gold picks a karat (10-24K), silver,
 * platinum and palladium a purity in parts per thousand (925 Sterling, 950),
 * and a base metal (steel, tungsten…) has none, so the field is not shown.
 * "Other…" takes any purity the metal can have; one it cannot (28K, 925 on
 * gold, 14 on silver) shows an error and stops the form that checks
 * :invalid before it closes.
 *
 * The value is kept as the clerk has it ("14", "14K", "925"); what is
 * submitted under `name` is the plain number ("14", "925"). The server
 * checks it again — lib/spot-prices/purity is the one set of rules. Used by
 * the pawn ticket item popup, Buy outright and the inventory item form.
 */
export function PurityField({
  metal,
  value,
  onChange,
  name,
  className,
  labelClassName,
}: {
  metal: string | null | undefined
  value: string
  onChange: (value: string) => void
  name?: string
  className?: string
  labelClassName?: string
}) {
  const { t } = useI18n()
  const w = t.pawn.new_
  const scale = purityScaleOf(metal)
  if (!scale) return name ? <input type="hidden" name={name} value="" /> : null

  const notes: Record<string, string> =
    metal === 'silver' ? { '925': w.puritySterling, '999': w.purityFine, '900': w.purityCoin } : {}
  const choices = purityChoicesFor(metal).map((v) => ({
    value: v,
    label: scale === 'karat' ? `${v}K` : notes[v] ? `${v} · ${notes[v]}` : v,
  }))
  const ok = isPurityInput(metal, value)

  return (
    <>
      <ChoiceOrOther
        className={className}
        labelClassName={labelClassName}
        label={scale === 'karat' ? w.itemKarat : w.itemPurity}
        value={value}
        onChange={onChange}
        choices={choices}
        otherLabel={w.itemChoiceOther}
        otherPlaceholder={scale === 'karat' ? w.purityOtherKarat : w.purityOtherFineness}
        otherInputMode="decimal"
        error={ok ? null : scale === 'karat' ? w.purityBadKarat : w.purityBadFineness}
      />
      {name ? (
        <input type="hidden" name={name} value={purityFromWords(metal, value) || value.trim()} />
      ) : null}
    </>
  )
}
