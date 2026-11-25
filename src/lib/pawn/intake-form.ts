/**
 * Shared parsing for the /pawn/new intake form's FormData. Used by both the
 * regulated createLoanAction (which finalizes a loan) and the loan-draft
 * save action (which stages a partial intake). Keeping the collateral-row
 * reader in one place means the draft payload and the real insert read the
 * exact same `collateral_<n>_*` field names.
 *
 * This is a plain (non-'use server') module so its sync helpers can be
 * imported by multiple server-action files.
 */

/** One collateral row's raw FormData values. */
export type CollateralRawRow = {
  raw: Record<string, FormDataEntryValue | null>
}

/**
 * Parse `collateral_<n>_<field>` entries out of FormData. `photos` is the
 * JSON list of the item's photo paths (already uploaded by the browser —
 * lib/uploads/intake-photos); the caller checks it before recording it, and
 * a draft keeps it as it came.
 */
export function readCollateralRows(fd: FormData): CollateralRawRow[] {
  const countRaw = fd.get('collateral_count')
  const count = Math.max(0, Math.min(50, parseInt(String(countRaw ?? '0'), 10) || 0))
  const rows: CollateralRawRow[] = []
  for (let i = 0; i < count; i++) {
    rows.push({
      raw: {
        photos: fd.get(`collateral_${i}_photos`),
        description: fd.get(`collateral_${i}_description`),
        category: fd.get(`collateral_${i}_category`),
        metal_type: fd.get(`collateral_${i}_metal_type`),
        karat: fd.get(`collateral_${i}_karat`),
        weight_grams: fd.get(`collateral_${i}_weight_grams`),
        coating: fd.get(`collateral_${i}_coating`),
        jewelry_size: fd.get(`collateral_${i}_jewelry_size`),
        color: fd.get(`collateral_${i}_color`),
        // The popup sends the stones as JSON + a notes line (patches/0106);
        // gemstone_description only still comes from a tab left open on the
        // older form.
        gemstone_description: fd.get(`collateral_${i}_gemstone_description`),
        stones: fd.get(`collateral_${i}_stones`),
        gemstone_notes: fd.get(`collateral_${i}_gemstone_notes`),
        jewelry_gender: fd.get(`collateral_${i}_jewelry_gender`),
        jewelry_style: fd.get(`collateral_${i}_jewelry_style`),
        jewelry_brand: fd.get(`collateral_${i}_jewelry_brand`),
        jewelry_model: fd.get(`collateral_${i}_jewelry_model`),
        jewelry_serial: fd.get(`collateral_${i}_jewelry_serial`),
        unique_marks: fd.get(`collateral_${i}_unique_marks`),
        est_value: fd.get(`collateral_${i}_est_value`),
        pawn_category_slug: fd.get(`collateral_${i}_pawn_category`),
        pawn_subcategory_slug: fd.get(`collateral_${i}_pawn_subcategory`),
        firearm_make: fd.get(`collateral_${i}_firearm_make`),
        firearm_model: fd.get(`collateral_${i}_firearm_model`),
        firearm_caliber: fd.get(`collateral_${i}_firearm_caliber`),
        firearm_serial_number: fd.get(`collateral_${i}_firearm_serial_number`),
        firearm_type: fd.get(`collateral_${i}_firearm_type`),
        firearm_barrel_length_inches: fd.get(
          `collateral_${i}_firearm_barrel_length_inches`,
        ),
        firearm_action_type: fd.get(`collateral_${i}_firearm_action_type`),
        firearm_capacity: fd.get(`collateral_${i}_firearm_capacity`),
        firearm_finish: fd.get(`collateral_${i}_firearm_finish`),
        firearm_number_of_barrels: fd.get(
          `collateral_${i}_firearm_number_of_barrels`,
        ),
        electronic_brand: fd.get(`collateral_${i}_electronic_brand`),
        electronic_model: fd.get(`collateral_${i}_electronic_model`),
        electronic_serial: fd.get(`collateral_${i}_electronic_serial`),
        tool_brand: fd.get(`collateral_${i}_tool_brand`),
        tool_model: fd.get(`collateral_${i}_tool_model`),
        tool_serial: fd.get(`collateral_${i}_tool_serial`),
        general_brand: fd.get(`collateral_${i}_general_brand`),
        general_model: fd.get(`collateral_${i}_general_model`),
        general_serial: fd.get(`collateral_${i}_general_serial`),
        item_size: fd.get(`collateral_${i}_item_size`),
        position: String(i),
      },
    })
  }
  return rows
}

// ── Draft payload (JSONB stored in loan_drafts.payload) ─────────────────────

export type DraftCollateralRow = Record<string, string>

export type LoanDraftPayload = {
  principal: string
  interest_rate_monthly: string
  min_monthly_charge: string
  term_days: string
  issue_date: string
  due_date: string
  rate_id: string
  notes: string
  collateral: DraftCollateralRow[]
}

/** Build the JSONB draft payload from a /pawn/new submission. Each item's
 *  photos are kept as their paths (`photos`): they are already in storage,
 *  and the page shows them again when the draft is resumed. */
export function buildDraftPayload(fd: FormData): LoanDraftPayload {
  const g = (k: string) => String(fd.get(k) ?? '')
  const collateral = readCollateralRows(fd).map(({ raw }) => {
    const out: DraftCollateralRow = {}
    for (const [k, v] of Object.entries(raw)) out[k] = v == null ? '' : String(v)
    return out
  })
  return {
    principal: g('principal'),
    interest_rate_monthly: g('interest_rate_monthly'),
    min_monthly_charge: g('min_monthly_charge'),
    term_days: g('term_days'),
    issue_date: g('issue_date'),
    due_date: g('due_date'),
    rate_id: g('rate_id'),
    notes: g('notes'),
    collateral,
  }
}

/** Defensively coerce a stored JSONB payload back into LoanDraftPayload. */
export function parseDraftPayload(raw: unknown): LoanDraftPayload {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  const collateral = Array.isArray(o.collateral)
    ? (o.collateral as unknown[]).map((row) => {
        const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
        const out: DraftCollateralRow = {}
        for (const [k, v] of Object.entries(r)) {
          out[k] = typeof v === 'string' ? v : v == null ? '' : String(v)
        }
        return out
      })
    : []
  return {
    principal: s('principal'),
    interest_rate_monthly: s('interest_rate_monthly'),
    min_monthly_charge: s('min_monthly_charge'),
    term_days: s('term_days'),
    issue_date: s('issue_date'),
    due_date: s('due_date'),
    rate_id: s('rate_id'),
    notes: s('notes'),
    collateral,
  }
}
