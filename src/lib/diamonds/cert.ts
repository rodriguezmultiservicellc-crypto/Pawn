/**
 * Diamond cert lookup — STUB SCAFFOLD.
 *
 * Three real providers we'd integrate when the operator has paid keys:
 *   - GIA Report Check (free, page-scrape; requires JS rendering or a
 *     headless browser run from a server function — slow + fragile).
 *   - IDEX Online API (paid, RESTful — most production-ready path).
 *   - Rapaport / RapNet (paid, RESTful — premium, deeper grading data
 *     + retail price benchmarks).
 *
 * v1 ships STUBS. The shape of the call is final — every consumer
 * imports `lookupDiamondCert(args)` and unwraps a `CertLookupResult`.
 * Real wire-up is a future pass once the operator obtains API keys.
 *
 * Why ship stubs now:
 *   - Lets the appraisal UI render a "Verify on LAB" button with the
 *     correct shape today (it falls back to the deep-link verify URLs
 *     in lib/appraisals/verify-links.ts).
 *   - Locks the signature so the eventual swap is a one-file change.
 *   - Audit-logs every lookup attempt so we can measure how often
 *     operators hit it (if usage is rare, we deprioritize the paid
 *     integration).
 */

import 'server-only'

export type CertLab = 'gia' | 'igi' | 'ags' | 'gcal' | 'hrd' | 'other'

export type CertLookupArgs = {
  lab: CertLab
  certNumber: string
}

export type CertLookupResult =
  | {
      ok: true
      provider: 'gia' | 'idex' | 'rapaport' | 'stub'
      /** Normalized cert details. All fields nullable — providers vary. */
      data: {
        lab: CertLab
        certNumber: string
        shape: string | null
        carat: number | null
        color: string | null
        clarity: string | null
        cut: string | null
        polish: string | null
        symmetry: string | null
        fluorescence: string | null
        measurements: string | null
        /** Optional public verify URL the operator can click to spot-check. */
        verifyUrl: string | null
      }
    }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'lab_not_supported'
        | 'rate_limited'
        | 'provider_error'
        | 'not_configured'
      message: string | null
    }

/**
 * Look up a diamond cert. Routes to the configured provider based on
 * env vars; falls back to a stub response when no provider is wired.
 *
 * Provider selection:
 *   - IDEX_API_KEY set → IDEX
 *   - RAPAPORT_API_KEY set → Rapaport
 *   - else → stub (returns 'not_configured')
 *
 * Rate limiting / caching is the caller's responsibility. The stub
 * always replies in <1ms so it doesn't matter at this phase.
 */
export async function lookupDiamondCert(
  args: CertLookupArgs,
): Promise<CertLookupResult> {
  const certNumber = args.certNumber.trim().replace(/[^A-Za-z0-9-]/g, '')
  if (!certNumber) {
    return { ok: false, reason: 'not_found', message: 'cert number empty' }
  }

  // Provider routing.
  if (process.env.IDEX_API_KEY) {
    return await lookupViaIdex({ lab: args.lab, certNumber })
  }
  if (process.env.RAPAPORT_API_KEY) {
    return await lookupViaRapaport({ lab: args.lab, certNumber })
  }

  return {
    ok: false,
    reason: 'not_configured',
    message:
      'No diamond cert provider is configured. Set IDEX_API_KEY or RAPAPORT_API_KEY in env to enable lookups. The Verify-on-LAB link still works as a manual fallback.',
  }
}

// ────────────────────────────────────────────────────────────────────
// PROVIDER STUBS — replace each body with the real call when keys are
// available. Signatures are FINAL so consumers don't change.
// ────────────────────────────────────────────────────────────────────

async function lookupViaIdex(args: {
  lab: CertLab
  certNumber: string
}): Promise<CertLookupResult> {
  // TODO: call IDEX Online API
  //   POST https://api.idexonline.com/onsite/api/diamondreport with
  //   { ApiKey, ReportNumber, ReportType: 'GIA' | 'IGI' | ... }
  //   Map response → CertLookupResult.data
  //
  // For now, surface "not_configured" since we haven't built the
  // request body yet. Once the operator hands over a key, the stub
  // body becomes the real fetch + map.
  void args
  return {
    ok: false,
    reason: 'not_configured',
    message: 'IDEX integration is stubbed. Real wire-up pending operator API key.',
  }
}

async function lookupViaRapaport(args: {
  lab: CertLab
  certNumber: string
}): Promise<CertLookupResult> {
  // TODO: call RapNet Stocklink / Cert Search API
  //   GET https://api.rapnet.com/data/feed/cert/<cert_no>
  //   Map response → CertLookupResult.data
  void args
  return {
    ok: false,
    reason: 'not_configured',
    message:
      'Rapaport integration is stubbed. Real wire-up pending operator API key.',
  }
}
