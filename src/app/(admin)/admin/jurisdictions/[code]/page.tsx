import { notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/supabase/guards'
import JurisdictionForm, { type JurisdictionFormInitial } from './form'

type Params = Promise<{ code: string }>

/** /admin/jurisdictions/[code] — edit one rule set; `new` creates one. */
export default async function JurisdictionEditPage(props: { params: Params }) {
  const { code } = await props.params
  const { admin } = await requireSuperAdmin()

  if (code === 'new') return <JurisdictionForm initial={null} />

  const { data: row } = await admin
    .from('jurisdictions')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  if (!row) notFound()

  const initial: JurisdictionFormInitial = {
    code: row.code,
    country: row.country as 'US' | 'CA',
    region: row.region,
    name: row.name,
    statute: row.statute ?? '',
    default_timezone: row.default_timezone,
    rate_cap_percent:
      row.rate_cap_monthly == null
        ? ''
        : String(Number((Number(row.rate_cap_monthly) * 100).toFixed(4))),
    period_days: String(row.period_days),
    min_charge_cap: row.min_charge_cap == null ? '' : String(row.min_charge_cap),
    min_term_days: row.min_term_days == null ? '' : String(row.min_term_days),
    max_term_days: row.max_term_days == null ? '' : String(row.max_term_days),
    grace_days: String(row.grace_days),
    grace_rolls_to_business_day: row.grace_rolls_to_business_day,
    buy_hold_days: String(row.buy_hold_days),
    repair_abandon_days:
      row.repair_abandon_days == null ? '' : String(row.repair_abandon_days),
    record_retention_years:
      row.record_retention_years == null ? '' : String(row.record_retention_years),
    police_reporting_required: row.police_reporting_required,
    rate_tiers_json: row.rate_tiers == null ? '' : JSON.stringify(row.rate_tiers, null, 2),
    ticket_notices_json: JSON.stringify(row.ticket_notices ?? [], null, 2),
    ticket_backpage: row.ticket_backpage ?? '',
    notes: row.notes ?? '',
    verified_on: row.verified_on ?? '',
    verified_source: row.verified_source ?? '',
    is_active: row.is_active,
  }

  return <JurisdictionForm initial={initial} />
}
