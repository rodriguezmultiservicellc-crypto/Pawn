import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  PROFILE_COLUMNS,
  normalizeOfficers,
  profileFromTenant,
  type BusinessProfile,
} from './profile'

/**
 * The shop's business profile: the saved row, or — nothing saved yet — what
 * Pawn knows from the tenant. Read with the caller's client: RLS lets only
 * the owner (patches/0110) see the row; the caller guards first.
 */
export async function loadBusinessProfile(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ profile: BusinessProfile; saved: boolean }> {
  const [{ data: row, error }, { data: tenant }] = await Promise.all([
    supabase.from('tenant_business_profile').select(PROFILE_COLUMNS).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('tenants').select('name, address, city, state, zip, phone, email').eq('id', tenantId).maybeSingle(),
  ])
  if (error) throw new Error(`business_profile_load_failed: ${error.message}`)
  if (row) {
    return {
      saved: true,
      profile: {
        ...(row as unknown as BusinessProfile),
        officers: normalizeOfficers(row.officers),
        form_answers:
          row.form_answers && typeof row.form_answers === 'object' && !Array.isArray(row.form_answers)
            ? (row.form_answers as BusinessProfile['form_answers'])
            : {},
      },
    }
  }
  return {
    saved: false,
    profile: profileFromTenant(
      tenant ?? { name: '', address: null, city: null, state: null, zip: null, phone: null, email: null },
    ),
  }
}
