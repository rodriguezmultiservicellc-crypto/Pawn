import type { BusinessProfile, ProfileFact } from './profile'

/** What to write into a PDF: values by the PDF's own field names. */
export type PdfFieldValues = {
  text: Record<string, string>
  /** Checkboxes to tick. */
  checks: string[]
  /** Dropdowns: the option to select. */
  choices: Record<string, string>
}

/** A choice the form asks that is not a fact about the business. Labels
 *  live in the dictionaries: agencyForms.forms.<form>.questions.<key>. */
export type FormQuestion = {
  key: string
  options: readonly string[]
  default: string
}

export type AgencyFormDef = {
  id: string
  /** PDF file in src/lib/agency-forms/templates/. */
  template: string
  /** Agency that issues it (proper name, not translated). */
  agency: string
  /** The form's own number / title as printed ("CBP Form 5106"). */
  code: string
  questions: readonly FormQuestion[]
  /** Profile facts the form cannot go without. */
  required: readonly ProfileFact[]
  fill(profile: BusinessProfile, answers: Record<string, string>): PdfFieldValues
}

/** A form's answers: saved ones where valid, else each question's default. */
export function answersFor(form: AgencyFormDef, saved: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const q of form.questions) {
    const v = saved?.[q.key]
    out[q.key] = v && q.options.includes(v) ? v : q.default
  }
  return out
}
