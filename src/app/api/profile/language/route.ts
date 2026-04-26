import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isLanguage } from '@/lib/i18n/config'

/**
 * Persist the user's preferred language to profiles.language. Called by
 * I18nProvider's setLang on every toggle. Authenticated users only —
 * silent 401 on unauth.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { language?: string }
    | null

  if (!body || !isLanguage(body.language)) {
    return NextResponse.json({ error: 'invalid_language' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('profiles')
    .update({ language: body.language })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
