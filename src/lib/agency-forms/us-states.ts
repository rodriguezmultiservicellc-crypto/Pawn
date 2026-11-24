/**
 * US states (+ DC) by postal code. Agency PDFs often offer the full name in
 * a dropdown (CBP 5106 "State/Province"); the profile keeps the two-letter
 * code. Proper names, the same in English and Spanish.
 */
export const US_STATES: ReadonlyArray<readonly [code: string, name: string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]

const BY_CODE = new Map(US_STATES)

/** FL -> Florida; '' for an unknown code. */
export function stateName(code: string | null | undefined): string {
  return (code && BY_CODE.get(code.toUpperCase())) || ''
}

/** "Fl", "fl", "Florida" -> FL; null when it is not a US state. */
export function stateCode(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  if (!s) return null
  const up = s.toUpperCase()
  if (BY_CODE.has(up)) return up
  return US_STATES.find(([, name]) => name.toLowerCase() === s.toLowerCase())?.[0] ?? null
}
