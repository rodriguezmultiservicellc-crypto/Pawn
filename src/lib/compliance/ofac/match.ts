/**
 * OFAC SDN screening — pure parsing + scoring (patches/0051).
 *
 * Flow: the DB returns trigram candidates for a customer name
 * (ofac_candidates RPC, fast GIN index); this module scores each candidate
 * precisely and decides whether it is a POTENTIAL match. A potential match
 * is an alert for human review, never an identity determination.
 *
 * Scoring is token-set based (order-independent, since the SDN list stores
 * "LAST, First Middle"): every customer first/last-name token must find an
 * SDN token with Jaro-Winkler ≥ TOKEN_MIN, and the average of those best
 * scores must reach MATCH_THRESHOLD. Middle names are optional on either
 * side. Name particles (de, la, al, bin…) and honorifics are ignored.
 *
 * DOB: when the SDN entry lists birth years and the customer's DOB year is
 * more than one year from all of them, the candidate is kept for the audit
 * trail but flagged dob_conflict and does not block.
 */

export const MATCH_THRESHOLD = 0.9
export const TOKEN_MIN = 0.85

const PARTICLES = new Set([
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'DA', 'DAS', 'DO', 'DOS',
  'VAN', 'VON', 'DER', 'DEN', 'AL', 'EL', 'BIN', 'BEN', 'IBN', 'BINT',
  'DR', 'MR', 'MRS', 'MS', 'SIR',
])

/** Uppercase ASCII tokens, diacritics stripped, particles removed. */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !PARTICLES.has(t))
}

/** Order-independent normalized form stored in ofac_sdn_names.name_norm. */
export function normalizeForIndex(raw: string): string {
  return [...new Set(nameTokens(raw))].sort().join(' ')
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatch = new Array<boolean>(a.length).fill(false)
  const bMatch = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(i + range + 1, b.length)
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue
      aMatch[i] = bMatch[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue
    while (!bMatch[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const m = matches
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3
  let prefix = 0
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

function bestTokenScore(token: string, candidates: string[]): number {
  let best = 0
  for (const c of candidates) {
    const s = jaroWinkler(token, c)
    if (s > best) best = s
    if (best === 1) break
  }
  return best
}

export type ScreenedPerson = {
  firstName: string
  middleName?: string | null
  lastName: string
  /** ISO date or null. */
  dob?: string | null
}

/**
 * Name similarity 0..1 between a customer and one SDN name:
 *   0.7 × customer coverage (avg best Jaro-Winkler of the customer's first +
 *         last tokens; each must reach TOKEN_MIN or the score is 0)
 * + 0.3 × SDN coverage (share of the SDN name's tokens matched by any of the
 *         customer's tokens, middle name included).
 * The SDN term keeps a common two-token name ("Jose Garcia") from flagging
 * every sanctioned person whose four-token name merely contains it, while a
 * name covering two of three SDN tokens ("Joaquin Guzman" vs "GUZMAN LOERA,
 * Joaquin") still reaches the threshold.
 */
export function scoreName(person: ScreenedPerson, sdnName: string): number {
  const entry = nameTokens(sdnName)
  const first = nameTokens(person.firstName)
  const last = nameTokens(person.lastName)
  if (entry.length === 0 || first.length === 0 || last.length === 0) return 0
  const required = [...first, ...last]
  let sum = 0
  for (const tok of required) {
    const s = bestTokenScore(tok, entry)
    if (s < TOKEN_MIN) return 0
    sum += s
  }
  // Required tokens must also cover at least as many distinct SDN tokens as
  // there are customer tokens — "JOSE JOSE" can't match "JOSE RAMIREZ".
  const used = new Set(required.map((tok) => entry.findIndex((e) => jaroWinkler(tok, e) >= TOKEN_MIN)))
  if (used.size < Math.min(required.length, entry.length)) return 0

  const all = [...required, ...nameTokens(person.middleName)]
  const covered = entry.filter((e) => bestTokenScore(e, all) >= TOKEN_MIN).length
  // 4dp so 0.7×1 + 0.3×(2/3) lands on 0.9, not 0.8999999999999999.
  return Math.round((0.7 * (sum / required.length) + 0.3 * (covered / entry.length)) * 10000) / 10000
}

/** Birth years mentioned in an SDN remarks field ("DOB 10 Dec 1948", "DOB 1960 to 1962", "circa 1970"). */
export function dobYears(remarks: string | null | undefined): number[] {
  if (!remarks) return []
  const years = new Set<number>()
  const re = /DOB([^;]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(remarks))) {
    const segment = m[1]
    const range = /(\d{4})\s*to\s*(\d{4})/i.exec(segment)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      for (let y = from; y <= to && y - from <= 20; y++) years.add(y)
    }
    for (const y of segment.match(/\b(19|20)\d{2}\b/g) ?? []) years.add(Number(y))
  }
  return [...years].sort((a, b) => a - b)
}

export function dobConflicts(customerDob: string | null | undefined, years: number[]): boolean {
  if (!customerDob || years.length === 0) return false
  const y = Number(customerDob.slice(0, 4))
  if (!Number.isFinite(y)) return false
  return !years.some((sy) => Math.abs(sy - y) <= 1)
}

export type SdnCandidate = {
  ent_num: number
  name: string
  is_alias: boolean
  programs: string | null
  remarks: string | null
}

export type OfacMatch = {
  ent_num: number
  name: string
  is_alias: boolean
  programs: string | null
  score: number
  dob_years: number[]
  dob_conflict: boolean
}

export type OfacEvaluation = {
  result: 'clear' | 'potential_match'
  /** Every candidate at/above threshold, strongest first (incl. DOB conflicts). */
  matches: OfacMatch[]
  topScore: number
}

export function evaluateCandidates(
  person: ScreenedPerson,
  candidates: ReadonlyArray<SdnCandidate>,
): OfacEvaluation {
  const byEnt = new Map<number, OfacMatch>()
  for (const c of candidates) {
    const score = scoreName(person, c.name)
    if (score < MATCH_THRESHOLD) continue
    const years = dobYears(c.remarks)
    const match: OfacMatch = {
      ent_num: c.ent_num,
      name: c.name,
      is_alias: c.is_alias,
      programs: c.programs,
      score,
      dob_years: years,
      dob_conflict: dobConflicts(person.dob, years),
    }
    const prev = byEnt.get(c.ent_num)
    if (!prev || match.score > prev.score) byEnt.set(c.ent_num, match)
  }
  const matches = [...byEnt.values()].sort((a, b) => b.score - a.score)
  const blocking = matches.filter((m) => !m.dob_conflict)
  return {
    result: blocking.length > 0 ? 'potential_match' : 'clear',
    matches,
    topScore: matches[0]?.score ?? 0,
  }
}

// ── Feed parsing ───────────────────────────────────────────────────────────

export type SdnNameRow = {
  ent_num: number
  name: string
  name_norm: string
  is_alias: boolean
  programs: string | null
  remarks: string | null
}

const nullish = (v: string | undefined) => {
  const t = (v ?? '').trim()
  return t === '' || t === '-0-' ? null : t
}

/**
 * Individuals from SDN.CSV + their aliases from ALT.CSV (both headerless,
 * pre-split into grids). Non-individual entries (vessels, entities,
 * aircraft) are dropped — customers are people.
 */
export function parseSdnFeed(
  sdnGrid: ReadonlyArray<ReadonlyArray<string>>,
  altGrid: ReadonlyArray<ReadonlyArray<string>>,
): SdnNameRow[] {
  const individuals = new Map<number, { programs: string | null; remarks: string | null }>()
  const out: SdnNameRow[] = []
  for (const r of sdnGrid) {
    const ent = Number(nullish(r[0]))
    const name = nullish(r[1])
    if (!Number.isFinite(ent) || !name) continue
    if ((nullish(r[2]) ?? '').toLowerCase() !== 'individual') continue
    const programs = nullish(r[3])
    const remarks = nullish(r[11])?.slice(0, 2000) ?? null
    individuals.set(ent, { programs, remarks })
    const norm = normalizeForIndex(name)
    if (norm) out.push({ ent_num: ent, name, name_norm: norm, is_alias: false, programs, remarks })
  }
  for (const r of altGrid) {
    const ent = Number(nullish(r[0]))
    const alt = nullish(r[3])
    const meta = individuals.get(ent)
    if (!meta || !alt) continue
    const norm = normalizeForIndex(alt)
    if (norm) out.push({ ent_num: ent, name: alt, name_norm: norm, is_alias: true, ...meta })
  }
  return out
}
