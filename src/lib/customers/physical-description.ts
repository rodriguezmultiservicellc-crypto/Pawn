/**
 * Pledgor physical-description vocabularies (FL Stat. § 539.001 requires a
 * physical description of the person pawning; the LeadsOnline police-report
 * export reads the same fields).
 *
 * WHY THESE EXACT STRINGS: `customers.sex / hair_color / eye_color / race` are
 * plain TEXT and were free-text until now, so 5,218 rows imported from xPawn
 * already carry a vocabulary — Title-case English words ('Black', 'Red Or
 * Auburn', 'Hispanic'), NOT NCIC three-letter codes. The option VALUES below
 * reproduce that vocabulary verbatim, casing included, so the dropdowns select
 * the data that is already there. Switching to NCIC codes would split the
 * column into two vocabularies and force every future reader — starting with
 * the police-report exporter — to understand both.
 *
 * The VALUE is what lands in the database and is therefore language-neutral.
 * The `key` names an i18n entry so staff see "Castaño" in Spanish while the
 * stored value stays 'Brown'. Never translate the value.
 *
 * Adding a value here is safe. CHANGING one orphans existing rows — they will
 * still display (see descriptionOptions) but they stop matching the canonical
 * option, so migrate the column in the same patch if you ever do.
 */

export type DescriptionOption = {
  /** Stored verbatim in the customers column. Language-neutral. */
  readonly value: string
  /** Slug into t.customers.<field>Options for the visible label. */
  readonly key: string
}

export const SEX_OPTIONS = [
  { value: 'M', key: 'male' },
  { value: 'F', key: 'female' },
  { value: 'X', key: 'other' },
  { value: 'U', key: 'unknown' },
] as const satisfies readonly DescriptionOption[]

export const HAIR_COLOR_OPTIONS = [
  { value: 'Black', key: 'black' },
  { value: 'Brown', key: 'brown' },
  { value: 'Blonde', key: 'blonde' },
  { value: 'Grey', key: 'grey' },
  { value: 'White', key: 'white' },
  { value: 'Bald', key: 'bald' },
  // Both spellings are live in the imported data (87 rows vs 36). Kept as
  // separate options so neither set of rows shows as an off-list value.
  { value: 'Red Or Auburn', key: 'redAuburn' },
  { value: 'Auburn', key: 'auburn' },
  { value: 'Sandy', key: 'sandy' },
  { value: 'Blue', key: 'blue' },
  { value: 'Green', key: 'green' },
  { value: 'Orange', key: 'orange' },
  { value: 'Purple', key: 'purple' },
  { value: 'Pink', key: 'pink' },
  { value: 'Unknown', key: 'unknown' },
] as const satisfies readonly DescriptionOption[]

export const EYE_COLOR_OPTIONS = [
  { value: 'Brown', key: 'brown' },
  { value: 'Black', key: 'black' },
  { value: 'Blue', key: 'blue' },
  { value: 'Green', key: 'green' },
  { value: 'Hazel', key: 'hazel' },
  { value: 'Grey', key: 'grey' },
  { value: 'Maroon', key: 'maroon' },
  { value: 'Multicolor', key: 'multicolor' },
  { value: 'Other', key: 'other' },
  { value: 'Unknown', key: 'unknown' },
] as const satisfies readonly DescriptionOption[]

export const RACE_OPTIONS = [
  { value: 'Hispanic', key: 'hispanic' },
  { value: 'White', key: 'white' },
  { value: 'Black', key: 'black' },
  { value: 'Asian', key: 'asian' },
  { value: 'Native American', key: 'nativeAmerican' },
  { value: 'Pacific Islander', key: 'pacificIslander' },
  { value: 'Other', key: 'other' },
  { value: 'Unknown', key: 'unknown' },
] as const satisfies readonly DescriptionOption[]

/**
 * Build <Select> options for one description field.
 *
 * `current` is the value already on the record. If it is not one of the
 * canonical options — a casing variant like 'BLACK', or anything a future
 * import brings in — it is appended as its own option and preselected, so
 * editing an unrelated field (a phone number) can never silently blank a
 * regulated description field. Blank stays available: these are all optional.
 */
export function descriptionOptions(
  options: readonly DescriptionOption[],
  labels: Record<string, string>,
  current: string | null | undefined,
): Array<{ value: string; label: string }> {
  const built = [
    { value: '', label: '—' },
    ...options.map((o) => ({ value: o.value, label: labels[o.key] ?? o.value })),
  ]

  const trimmed = current?.trim()
  if (trimmed && !options.some((o) => o.value === trimmed)) {
    built.push({ value: trimmed, label: trimmed })
  }

  return built
}
