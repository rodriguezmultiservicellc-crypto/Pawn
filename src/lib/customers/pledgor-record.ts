/**
 * What a customer's record must hold before they can pawn or sell.
 *
 * Fla. Stat. § 539.001(8)(b)3 and 5 put on the FRONT of every pawnbroker
 * transaction form "the name, address, home telephone number, place of
 * employment, date of birth, physical description, and right thumbprint of
 * the pledgor or seller" and "the type of identification accepted …,
 * including the issuing agency and the identification number". The physical
 * description is the one the ticket prints and the police report sends:
 * sex, race, height, weight, hair, eyes.
 *
 * Not required: middle name, business phone, email, and the identifying
 * marks box (the statute's "identifying marks" are the goods').
 *
 * An EXPIRED ID is refused (Eddy, 2026-11-25: "license is expired and it let
 * me continue to do the pawn"): `id_expiry` is "missing" when the record has
 * an expiry date before the shop's today. A record with no expiry date is not
 * refused for it — thousands of imported records have none.
 * The thumbprint and signature are taken on the paper ticket.
 *
 * Pure; the pawn and buy actions refuse the intake with the list, and the
 * intake screens show it as soon as the customer is picked.
 */

export const PLEDGOR_FIELDS = [
  'last_name',
  'first_name',
  'address',
  'phone',
  'place_of_employment',
  'date_of_birth',
  'sex',
  'race',
  'height_inches',
  'weight_lbs',
  'hair_color',
  'eye_color',
  'id_type',
  'id_number',
  'id_state',
  'id_expiry',
] as const

export type PledgorField = (typeof PLEDGOR_FIELDS)[number]

export type PledgorRecord = {
  last_name: string | null
  first_name: string | null
  address1: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  place_of_employment: string | null
  date_of_birth: string | null
  sex: string | null
  race: string | null
  height_inches: number | null
  weight_lbs: number | null
  hair_color: string | null
  eye_color: string | null
  id_type: string | null
  id_number: string | null
  id_state: string | null
  id_expiry: string | null
}

/** The columns to select for missingPledgorFields. */
export const PLEDGOR_COLUMNS =
  'last_name, first_name, address1, city, state, zip, phone, place_of_employment, date_of_birth, sex, race, height_inches, weight_lbs, hair_color, eye_color, id_type, id_number, id_state, id_expiry'

const filled = (v: string | null | undefined) => !!v && v.trim() !== ''

/**
 * The issuing agency is a state or an office ("FL", "Florida DHSMV",
 * "U.S. Department of State"), never a date or a number. A value with a
 * digit in it was typed into the wrong box.
 */
export function isIdAgency(v: string | null | undefined): boolean {
  return filled(v) && !/\d/.test(v!)
}

/** An ID with an expiry date before `today` (the shop's YYYY-MM-DD). */
export function isIdExpired(expiry: string | null | undefined, today: string): boolean {
  return filled(expiry) && expiry!.slice(0, 10) < today
}

/** The fields still missing, in the order the ticket prints them. `today`
 *  is the shop's date (todayInTimezone): an expired ID counts as missing. */
export function missingPledgorFields(c: PledgorRecord, today: string): PledgorField[] {
  const ok: Record<PledgorField, boolean> = {
    last_name: filled(c.last_name),
    first_name: filled(c.first_name),
    address: filled(c.address1) && filled(c.city) && filled(c.state) && filled(c.zip),
    phone: filled(c.phone),
    place_of_employment: filled(c.place_of_employment),
    date_of_birth: filled(c.date_of_birth),
    sex: filled(c.sex),
    race: filled(c.race),
    height_inches: (c.height_inches ?? 0) > 0,
    weight_lbs: (c.weight_lbs ?? 0) > 0,
    hair_color: filled(c.hair_color),
    eye_color: filled(c.eye_color),
    id_type: filled(c.id_type),
    id_number: filled(c.id_number),
    id_state: isIdAgency(c.id_state),
    id_expiry: !isIdExpired(c.id_expiry, today),
  }
  return PLEDGOR_FIELDS.filter((f) => !ok[f])
}

/** The customer columns a field is written in (address is four). */
export type PledgorColumn =
  | Exclude<PledgorField, 'address'>
  | 'address1'
  | 'city'
  | 'state'
  | 'zip'

export function pledgorColumnsFor(fields: readonly PledgorField[]): PledgorColumn[] {
  const cols = fields.flatMap((f): PledgorColumn[] =>
    f === 'address'
      ? ['address1', 'city', 'state', 'zip']
      : // An expired ID is replaced by the new one: number, expiry, agency.
        f === 'id_expiry'
        ? ['id_number', 'id_expiry', 'id_state']
        : [f],
  )
  return [...new Set(cols)]
}

/** The error an intake returns: `pledgor_incomplete:eye_color,race`. */
export const PLEDGOR_INCOMPLETE = 'pledgor_incomplete'

export function pledgorIncompleteError(missing: PledgorField[]): string {
  return `${PLEDGOR_INCOMPLETE}:${missing.join(',')}`
}

export function parsePledgorIncomplete(raw: string): PledgorField[] | null {
  if (!raw.startsWith(PLEDGOR_INCOMPLETE + ':')) return null
  const keys = raw.slice(PLEDGOR_INCOMPLETE.length + 1).split(',')
  return keys.filter((k): k is PledgorField => (PLEDGOR_FIELDS as readonly string[]).includes(k))
}
