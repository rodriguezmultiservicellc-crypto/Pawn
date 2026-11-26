import { parseHeightInches, type DLInfo } from '@/lib/dl-parser'

/** A license scan with no customer on file, carried to "Add customer". */
export type CustomerScan = { info: DLInfo; raw: string }

/** The customer fields a scanned license fills. A field the license left
 *  empty is absent, so it never overwrites what the clerk already typed. */
export type ScanFields = {
  first_name?: string
  middle_name?: string
  last_name?: string
  date_of_birth?: string
  sex?: string
  address1?: string
  city?: string
  state?: string
  zip?: string
  id_type: 'drivers_license'
  id_number?: string
  id_state?: string
  id_expiry?: string
  id_country: 'US'
  height_inches?: number
}

/**
 * Map a parsed AAMVA (PDF417) license onto customer fields — the ONE mapping
 * used by New customer and the quick New customer popup. The barcode is a
 * US/Canada driver-license format, so id_type is always drivers_license and
 * id_country US. AAMVA has one state: it is both the mailing state and the
 * issuing state. Best effort — the clerk checks it before saving.
 */
export function scanFields(info: DLInfo): ScanFields {
  const out: ScanFields = { id_type: 'drivers_license', id_country: 'US' }
  if (info.firstName) out.first_name = info.firstName
  if (info.middleName) out.middle_name = info.middleName
  if (info.lastName) out.last_name = info.lastName
  if (info.dob) out.date_of_birth = info.dob
  if (info.gender) out.sex = info.gender
  if (info.address) out.address1 = info.address
  if (info.city) out.city = info.city
  if (info.state) {
    out.state = info.state
    out.id_state = info.state
  }
  if (info.zip) out.zip = info.zip
  if (info.licenseNumber) out.id_number = info.licenseNumber
  if (info.expirationDate) out.id_expiry = info.expirationDate
  const inches = parseHeightInches(info.height)
  if (inches != null) out.height_inches = inches
  return out
}
