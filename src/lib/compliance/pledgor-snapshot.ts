import type { Json } from '@/types/database'

/**
 * compliance_log.customer_snapshot — who the pledgor / seller was at the
 * moment of a pawn or a buy, frozen for the police (rule 15). One builder
 * for both, so the two can never snapshot different fields.
 */

/** The customer columns a buy or a pawn snapshots for the police. */
export const PLEDGOR_SNAPSHOT_COLUMNS =
  'id, first_name, last_name, middle_name, date_of_birth, phone, phone_alt, email, address1, address2, city, state, zip, country, id_type, id_number, id_state, id_expiry, height_inches, weight_lbs, sex, race, hair_color, eye_color, identifying_marks, place_of_employment, photo_url'

export type PledgorSnapshotSource = {
  id: string
  first_name: string
  last_name: string
  middle_name: string | null
  date_of_birth: string | null
  phone: string | null
  phone_alt: string | null
  email: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  id_type: string | null
  id_number: string | null
  id_state: string | null
  id_expiry: string | null
  height_inches: number | null
  weight_lbs: number | null
  sex: string | null
  race: string | null
  hair_color: string | null
  eye_color: string | null
  identifying_marks: string | null
  place_of_employment: string | null
  photo_url: string | null
}

/** compliance_log.customer_snapshot: who the seller / pledgor was, frozen. */
export function pledgorSnapshot(c: PledgorSnapshotSource, screeningId: string | null): Json {
  return {
    id: c.id,
    ofac_screening_id: screeningId,
    first_name: c.first_name,
    last_name: c.last_name,
    middle_name: c.middle_name,
    date_of_birth: c.date_of_birth,
    phone: c.phone,
    phone_alt: c.phone_alt,
    email: c.email,
    address1: c.address1,
    address2: c.address2,
    city: c.city,
    state: c.state,
    zip: c.zip,
    country: c.country,
    id_type: c.id_type,
    id_number: c.id_number,
    id_state: c.id_state,
    id_expiry: c.id_expiry,
    // FL pawn-statute physical description (patches/0004).
    height_inches: c.height_inches,
    weight_lbs: c.weight_lbs,
    sex: c.sex,
    race: c.race,
    hair_color: c.hair_color,
    eye_color: c.eye_color,
    identifying_marks: c.identifying_marks,
    place_of_employment: c.place_of_employment,
    photo_url: c.photo_url,
  }
}
