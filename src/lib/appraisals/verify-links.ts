/**
 * Verification deep-link builders for appraised items.
 *
 * No paid APIs, no scraping. The product surface is "click to verify on
 * the lab/marketplace's own site, then type the matching values back
 * into our form". Building real API integrations (Rapaport / IDEX /
 * Watchcharts pro / ALPS) is documented as a future enhancement when
 * tenant volume justifies the licensing fees.
 *
 * Pure module — safe to import from client + server.
 */

export type CertLab = 'gia' | 'igi' | 'ags' | 'gemological' | 'other'

export function normalizeCertLab(input: string | null | undefined): CertLab {
  if (!input) return 'other'
  const s = input.trim().toLowerCase()
  if (s === 'gia' || s.includes('gemological institute of america')) return 'gia'
  if (s === 'igi' || s.includes('international gemological')) return 'igi'
  if (s === 'ags' || s.includes('american gem society')) return 'ags'
  if (s.includes('gemological')) return 'gemological'
  return 'other'
}

/**
 * Build a deep-link to the lab's report-check page with the report
 * number prefilled when supported. Returns null when we don't have a
 * known builder for that lab.
 */
export function buildCertVerifyUrl(args: {
  lab: string | null | undefined
  number: string | null | undefined
}): { url: string; label: string } | null {
  const lab = normalizeCertLab(args.lab)
  const num = (args.number ?? '').trim()
  if (!num) return null

  switch (lab) {
    case 'gia':
      // GIA Report Check: https://www.gia.edu/report-check
      // The form accepts ?reportno=NNNNNNNNNN as a query param and
      // pre-fills the lookup. Operator clicks "Get a Report" and the
      // report renders. We treat this as a "verify and copy fields back"
      // helper rather than a programmatic lookup.
      return {
        url: `https://www.gia.edu/report-check-landing?reportno=${encodeURIComponent(
          num,
        )}`,
        label: 'Verify on GIA',
      }
    case 'igi':
      // IGI report check.
      return {
        url: `https://www.igi.org/reports/verify-your-report?r=${encodeURIComponent(
          num,
        )}`,
        label: 'Verify on IGI',
      }
    case 'ags':
      // AGS Laboratories merged with GIA in 2022; cert numbers issued
      // before the merger still work via a redirect at AGS's old domain.
      return {
        url: `https://agsl.com/?reportno=${encodeURIComponent(num)}`,
        label: 'Verify on AGS',
      }
    default:
      return null
  }
}

/**
 * Watch model lookup — deep-link to Chrono24's search page. Real
 * marketplace data (sold prices, listing volume) would require an API
 * relationship; this is the v1 helper.
 */
export function buildWatchSearchUrl(args: {
  brand?: string | null
  model?: string | null
  serial?: string | null
}): { url: string; label: string } | null {
  const brand = (args.brand ?? '').trim()
  const model = (args.model ?? '').trim()
  if (!brand && !model) return null
  const q = [brand, model].filter(Boolean).join(' ')
  return {
    url: `https://www.chrono24.com/search/index.htm?query=${encodeURIComponent(
      q,
    )}`,
    label: 'Search Chrono24',
  }
}
