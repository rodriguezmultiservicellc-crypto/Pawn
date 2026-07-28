/**
 * Client-safe catalog for the customer importer: the target-field list (with
 * bilingual labels, for the manual-mapping dropdowns) and the source list.
 * Pure data — no functions — so both the UI and the server engine can import
 * it without pulling server-only code into the client bundle.
 */

export type TargetField =
  | 'first_name'
  | 'last_name'
  | 'middle_name'
  | 'suffix'
  | 'date_of_birth'
  | 'phone'
  | 'phone_alt'
  | 'email'
  | 'address1'
  | 'address2'
  | 'city'
  | 'state'
  | 'zip'
  | 'country'
  | 'id_type'
  | 'id_number'
  | 'id_state'
  | 'id_country'
  | 'id_expiry'
  | 'height'
  | 'weight'
  | 'sex'
  | 'hair_color'
  | 'eye_color'
  | 'race'
  | 'identifying_marks'
  | 'place_of_employment'
  | 'notes'
  | 'legacy_ref'

export type Mapping = Partial<Record<TargetField, string>>

export type TargetFieldDef = {
  field: TargetField
  en: string
  es: string
  /** Header-name keywords used to auto-guess the mapping. */
  hints: string[]
}

/** Order here is the order shown in the mapping editor. */
export const TARGET_FIELDS: readonly TargetFieldDef[] = [
  { field: 'first_name', en: 'First name', es: 'Nombre', hints: ['first name', 'firstname', 'fname', 'first', 'given'] },
  { field: 'last_name', en: 'Last name', es: 'Apellido', hints: ['last name', 'lastname', 'lname', 'last', 'surname'] },
  { field: 'middle_name', en: 'Middle name', es: 'Segundo nombre', hints: ['middle name', 'middle', 'mname', 'mi'] },
  { field: 'suffix', en: 'Suffix', es: 'Sufijo', hints: ['suffix'] },
  { field: 'date_of_birth', en: 'Date of birth', es: 'Fecha de nacimiento', hints: ['dob', 'date of birth', 'birth', 'birthdate', 'birthday'] },
  { field: 'phone', en: 'Phone', es: 'Teléfono', hints: ['residence phone', 'home phone', 'cell', 'mobile', 'phone', 'telephone', 'phone1'] },
  { field: 'phone_alt', en: 'Alt phone', es: 'Teléfono alt.', hints: ['business phone', 'work phone', 'phone2', 'alt phone', 'other phone'] },
  { field: 'email', en: 'Email', es: 'Correo', hints: ['email', 'e-mail', 'emailaddress', 'mail'] },
  { field: 'address1', en: 'Address', es: 'Dirección', hints: ['street', 'address1', 'address 1', 'address', 'addr'] },
  { field: 'address2', en: 'Address 2', es: 'Dirección 2', hints: ['address2', 'address 2', 'apt', 'unit', 'suite'] },
  { field: 'city', en: 'City', es: 'Ciudad', hints: ['city', 'town'] },
  { field: 'state', en: 'State', es: 'Estado', hints: ['state', 'province'] },
  { field: 'zip', en: 'ZIP', es: 'Código postal', hints: ['zip', 'zip code', 'postal', 'postcode'] },
  { field: 'country', en: 'Country', es: 'País', hints: ['country'] },
  { field: 'id_type', en: 'ID type', es: 'Tipo de ID', hints: ['id type', 'idtype', 'id kind'] },
  { field: 'id_number', en: 'ID number', es: 'Número de ID', hints: ['id no', 'id number', 'idno', 'license', 'dl no', 'dl number', 'drivers license'] },
  { field: 'id_state', en: 'ID state', es: 'Estado del ID', hints: ['idissuestate', 'id state', 'issue state', 'idstate'] },
  { field: 'id_country', en: 'ID country', es: 'País del ID', hints: ['idissuecountry', 'id country', 'issue country'] },
  { field: 'id_expiry', en: 'ID expiry', es: 'Vencimiento del ID', hints: ['id1 expiry', 'id expiry', 'expiry', 'expiration', 'exp'] },
  { field: 'height', en: 'Height', es: 'Estatura', hints: ['height', 'hgt', 'ht'] },
  { field: 'weight', en: 'Weight', es: 'Peso', hints: ['weight', 'wgt', 'wt'] },
  { field: 'sex', en: 'Sex', es: 'Sexo', hints: ['sex', 'gender'] },
  { field: 'hair_color', en: 'Hair color', es: 'Color de cabello', hints: ['hair', 'hair color'] },
  { field: 'eye_color', en: 'Eye color', es: 'Color de ojos', hints: ['eyes', 'eye', 'eye color'] },
  { field: 'race', en: 'Race', es: 'Raza', hints: ['race', 'ethnicity'] },
  { field: 'identifying_marks', en: 'Identifying marks', es: 'Marcas distintivas', hints: ['marks', 'scars', 'tattoos', 'identifying'] },
  { field: 'place_of_employment', en: 'Employer', es: 'Empleador', hints: ['employer name', 'employer', 'workplace', 'company', 'place of employment'] },
  { field: 'notes', en: 'Notes', es: 'Notas', hints: ['notes', 'note', 'comments', 'memo'] },
  { field: 'legacy_ref', en: 'Source ID (dedupe key)', es: 'ID de origen (clave)', hints: ['key no', 'customer id', 'cust id', 'id', 'account', 'acct', 'number', 'previous no'] },
]

export type ImportSourceId = 'xpawn' | 'generic'

export type ImportSourceDef = {
  id: ImportSourceId
  label: string
  /** true → fixed built-in mapping; the UI hides the mapping editor. */
  preset: boolean
}

export const IMPORT_SOURCES: readonly ImportSourceDef[] = [
  { id: 'xpawn', label: 'xPawn', preset: true },
  { id: 'generic', label: 'Generic CSV (Bravo & others)', preset: false },
]

export type ImportReport = {
  totalRows: number
  toInsert: number
  skippedNoName: number
  skippedDup: number
  skippedExisting: number
  dobUnparseable: number
  warnings: string[]
}

export type ImportSampleRow = {
  name: string
  dob: string | null
  phone: string | null
  id_type: string | null
  city: string | null
  state: string | null
  legacy_ref: string | null
}
