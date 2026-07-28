/**
 * Built-in source presets. A preset is a fixed column mapping plus any
 * source-specific quirks (e.g. xPawn's Warning flag and Test/Test dummy row),
 * so those sources import in one click with no manual mapping. Unknown vendors
 * (Bravo & others) use the Generic source with auto-guess + manual override.
 */

import type { ImportSourceId, Mapping } from './catalog'

export type ImportPreset = {
  mapping: Mapping
  /** Header whose truthy value adds a WARNING banner to notes. */
  warningHeader?: string
  /** Drop the vendor's canned dummy row. */
  skipTest?: boolean
}

const XPAWN: ImportPreset = {
  warningHeader: 'Warning',
  skipTest: true,
  mapping: {
    first_name: 'First Name',
    last_name: 'Last Name',
    middle_name: 'Middle Name',
    suffix: 'Suffix',
    date_of_birth: 'DOB',
    phone: 'Residence Phone',
    phone_alt: 'Business Phone',
    email: 'EMailAddress',
    address1: 'Street',
    address2: 'Address2',
    city: 'City',
    state: 'State',
    zip: 'Zip Code',
    id_type: 'ID Type',
    id_number: 'ID No',
    id_state: 'IDIssueState',
    id_country: 'IDIssueCountry',
    id_expiry: 'ID1 Expiry',
    height: 'Height',
    weight: 'Weight',
    sex: 'Sex',
    hair_color: 'Hair',
    eye_color: 'Eyes',
    race: 'Race',
    identifying_marks: 'Marks',
    place_of_employment: 'Employer Name',
    notes: 'Notes',
    legacy_ref: 'Key No',
  },
}

export function getPreset(source: ImportSourceId): ImportPreset | null {
  return source === 'xpawn' ? XPAWN : null
}
