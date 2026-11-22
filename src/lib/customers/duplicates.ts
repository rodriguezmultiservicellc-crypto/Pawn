/**
 * Duplicate-customer detection. Pure: the caller loads the tenant's
 * customers and this buckets them. Same approach as Luna Azul's
 * /clients/duplicates, tuned to what a pawn shop record carries.
 *
 * Signals, strongest first:
 *   - id_number   same ID document number (letters/digits only). A
 *                 renewed Florida license can get a NEW number, so this
 *                 misses some duplicates, but a shared number is the
 *                 same document.
 *   - name_phone  same first + last name and a shared phone (either slot)
 *   - name_email  same first + last name and the same email
 *   - name_dob    same first + last name and the same date of birth
 *
 * A pair found by several signals is reported once, under the strongest.
 * Name alone is never enough: a shop with 3,000 customers has many
 * honest "Jose Rodriguez" records.
 */

export type DuplicateSignal = 'id_number' | 'name_phone' | 'name_email' | 'name_dob'

export type DuplicateCandidate = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  phone_alt: string | null
  email: string | null
  id_number: string | null
  date_of_birth: string | null
  created_at: string
}

export type DuplicateGroup = {
  signal: DuplicateSignal
  /** Oldest first, so the default "keep" is the original record. */
  customers: DuplicateCandidate[]
}

const SIGNAL_ORDER: DuplicateSignal[] = ['id_number', 'name_phone', 'name_email', 'name_dob']

export function normName(first: string | null, last: string | null): string {
  const s = `${first ?? ''} ${last ?? ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s
}

/** Last 10 digits; anything shorter than 7 digits is not a usable phone. */
export function normPhone(p: string | null): string {
  const d = (p ?? '').replace(/\D/g, '')
  if (d.length < 7) return ''
  return d.slice(-10)
}

export function normIdNumber(n: string | null): string {
  const s = (n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.length >= 5 ? s : ''
}

function normEmail(e: string | null): string {
  const s = (e ?? '').trim().toLowerCase()
  return s.includes('@') ? s : ''
}

function keysFor(c: DuplicateCandidate, signal: DuplicateSignal): string[] {
  const name = normName(c.first_name, c.last_name)
  switch (signal) {
    case 'id_number': {
      const k = normIdNumber(c.id_number)
      return k ? [k] : []
    }
    case 'name_phone': {
      if (!name) return []
      const phones = new Set([normPhone(c.phone), normPhone(c.phone_alt)].filter(Boolean))
      return [...phones].map((p) => `${name}|${p}`)
    }
    case 'name_email': {
      const e = normEmail(c.email)
      return name && e ? [`${name}|${e}`] : []
    }
    case 'name_dob':
      return name && c.date_of_birth ? [`${name}|${c.date_of_birth}`] : []
  }
}

/** Groups of 2+ customers that are probably the same person. */
export function findDuplicateGroups(customers: readonly DuplicateCandidate[]): DuplicateGroup[] {
  const seenPairs = new Set<string>()
  const groups: DuplicateGroup[] = []

  for (const signal of SIGNAL_ORDER) {
    const buckets = new Map<string, DuplicateCandidate[]>()
    for (const c of customers) {
      for (const k of keysFor(c, signal)) {
        const arr = buckets.get(k)
        if (arr) {
          if (!arr.some((x) => x.id === c.id)) arr.push(c)
        } else buckets.set(k, [c])
      }
    }
    for (const members of buckets.values()) {
      if (members.length < 2) continue
      // Skip a group whose every pair is already reported by a stronger signal.
      const pairs: string[] = []
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++)
          pairs.push([members[i]!.id, members[j]!.id].sort().join(':'))
      if (pairs.every((p) => seenPairs.has(p))) continue
      pairs.forEach((p) => seenPairs.add(p))
      groups.push({
        signal,
        customers: [...members].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      })
    }
  }

  return groups.sort(
    (a, b) =>
      SIGNAL_ORDER.indexOf(a.signal) - SIGNAL_ORDER.indexOf(b.signal) ||
      normName(a.customers[0]!.first_name, a.customers[0]!.last_name).localeCompare(
        normName(b.customers[0]!.first_name, b.customers[0]!.last_name),
      ),
  )
}
