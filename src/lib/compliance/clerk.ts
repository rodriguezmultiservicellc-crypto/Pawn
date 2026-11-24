import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * The clerk's initials as the police upload carries them (<clerk>ER</clerk>
 * in the LeadsOnline file): first letter of the first and last name, else of
 * the email's local part. Pure.
 */
export function clerkInitials(fullName: string | null | undefined, email?: string | null): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter((w) => /\p{L}/u.test(w))
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  const local = (email ?? '').split('@')[0].replace(/[^\p{L}]/gu, '')
  return local.slice(0, 2).toUpperCase()
}

/** Initials of the user writing an intake, from their profile. '' when unknown. */
export async function loadClerkInitials(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data } = await supabase.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  return clerkInitials(data?.full_name, data?.email)
}
