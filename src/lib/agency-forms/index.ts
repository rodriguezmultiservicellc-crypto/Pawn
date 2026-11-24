/**
 * Government forms Pawn can fill from the shop's business profile.
 * Adding a form: drop the blank PDF in templates/, write its mapping
 * (field names by position, like cbp-5106.ts), list it here, and add its
 * words under agencyForms.forms.<id> in both dictionaries.
 */

import { cbp5106 } from './cbp-5106'
import type { AgencyFormDef } from './types'

export const AGENCY_FORMS: readonly AgencyFormDef[] = [cbp5106]

export function agencyForm(id: string): AgencyFormDef | null {
  return AGENCY_FORMS.find((f) => f.id === id) ?? null
}
