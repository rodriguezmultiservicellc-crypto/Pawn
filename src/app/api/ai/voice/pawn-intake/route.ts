import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import type {
  CustomerInsert,
  InventoryCategory,
  Language,
  MetalType,
  TenantRole,
} from '@/types/database-aliases'

export const runtime = 'nodejs'

/**
 * Voice-driven pawn intake.
 *
 * Pipeline:
 *   1. Operator speech captured client-side as webm/opus (or mp4 on
 *      Safari) and POSTed here as multipart form-data.
 *   2. Whisper transcribes — language hint comes from the operator's
 *      i18n preference so an EN operator gets EN-biased decoding and
 *      vice versa.
 *   3. Claude Haiku extracts a strict JSON envelope: customer name +
 *      DOB, principal, one collateral row.
 *   4. Customer match-or-create: case-insensitive name match within
 *      the tenant (and DOB-narrowed when DOB was extracted). On miss,
 *      a fresh customers row is inserted with first_name/last_name/dob
 *      only — staff is told over TTS to verify ID details before
 *      submitting the loan.
 *
 * Cost per call (rough): Whisper ~$0.0015 + Haiku 4.5 ~$0.001 ≈ $0.003.
 *
 * Auth: requires authenticated user with a tenant role of
 * owner | manager | pawn_clerk | chain_admin (the same set that can
 * intake a pawn loan via the form). Module-gated on tenants.has_pawn.
 */

const ALLOWED_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'chain_admin',
  'manager',
  'pawn_clerk',
]

// 5MB cap. A 30-second webm/opus stream is ~250KB — anything bigger
// is almost certainly an attempt to abuse the upstream API call.
const MAX_AUDIO_BYTES = 5 * 1024 * 1024

const VALID_CATEGORIES: ReadonlyArray<InventoryCategory> = [
  'ring',
  'necklace',
  'bracelet',
  'earrings',
  'pendant',
  'chain',
  'watch',
  'coin',
  'bullion',
  'loose_stone',
  'electronics',
  'tool',
  'instrument',
  'other',
]

const VALID_METALS: ReadonlyArray<MetalType> = [
  'gold',
  'silver',
  'platinum',
  'palladium',
  'rose_gold',
  'white_gold',
  'tungsten',
  'titanium',
  'stainless_steel',
  'mixed',
  'none',
  'other',
]

const SYSTEM_PROMPT = `You extract pawn loan intake details from a transcribed
operator utterance. The transcript may be in English or Spanish.

Return ONLY a single valid JSON object — no markdown, no code fences,
no prose. Output schema:

{
  "customer": {
    "firstName": string | null,
    "lastName":  string | null,
    "dateOfBirth": string | null   // ISO YYYY-MM-DD, null if absent
  } | null,
  "principal": number | null,       // dollars, no $ sign
  "collateral": {
    "description":  string,         // human-readable, e.g. "wedding ring"
    "category":     "ring" | "necklace" | "bracelet" | "earrings" | "pendant" | "chain" | "watch" | "coin" | "bullion" | "loose_stone" | "electronics" | "tool" | "instrument" | "other",
    "metal_type":   "gold" | "silver" | "platinum" | "palladium" | "rose_gold" | "white_gold" | "tungsten" | "titanium" | "stainless_steel" | "mixed" | "none" | "other" | null,
    "karat":        string | null,  // "10K" | "14K" | "18K" | "22K" | "24K" — null if not mentioned or n/a
    "weight_grams": number | null,
    "est_value":    number | null
  } | null
}

Rules:
- Use null when a field isn't mentioned. Never guess.
- Convert spoken numbers to digits ("two hundred" -> 200, "doscientos" -> 200).
- Karat: "fourteen karat" / "14k" / "catorce quilates" -> "14K".
- White gold / rose gold each map to their own metal_type, NOT "gold".
- Map item words to the closest enum: "wedding ring"/"engagement ring"/"signet" -> "ring";
  "necklace"/"chain" -> use "chain" only when there are no pendants/charms; "rolex"/"watch" -> "watch";
  unknown -> "other".
- Dates: accept "January first 2000", "1/1/2000", "primero de enero del dos mil" -> "2000-01-01".
  Two-digit years should be interpreted as 19xx if > current 2-digit year else 20xx.
- If the customer is named without a last name, set lastName to null and DO NOT guess.
- If the entire utterance has no pawn content (e.g. greeting only), return
  {"customer": null, "principal": null, "collateral": null}.`

type ExtractedJson = {
  customer: {
    firstName: string | null
    lastName: string | null
    dateOfBirth: string | null
  } | null
  principal: number | null
  collateral: {
    description: string
    category: string
    metal_type: string | null
    karat: string | null
    weight_grams: number | null
    est_value: number | null
  } | null
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export async function POST(req: NextRequest) {
  // Confirm both API keys are configured before doing the multipart
  // parse — failing fast saves the operator a 30-second mic recording
  // that would only error at the upstream call. Differentiated error
  // messages so the operator knows exactly which env var to set.
  const openaiKey = process.env.OPENAI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!openaiKey && !anthropicKey) {
    return bad(
      503,
      'Voice intake not configured: OPENAI_API_KEY and ANTHROPIC_API_KEY both missing at runtime. Set them and redeploy.',
    )
  }
  if (!openaiKey) {
    return bad(
      503,
      'Voice intake not configured: OPENAI_API_KEY missing at runtime. Set it in env and redeploy.',
    )
  }
  if (!anthropicKey) {
    return bad(
      503,
      'Voice intake not configured: ANTHROPIC_API_KEY missing at runtime. Set it in env and redeploy.',
    )
  }

  const ctx = await getCtx()
  if (!ctx) return bad(401, 'Not signed in.')
  if (!ctx.tenantId) return bad(403, 'No active tenant.')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) return bad(403, 'Pawn module is disabled for this tenant.')

  // Role gate. Inline because requireRoleInTenant() does redirect()
  // (server-action style) which doesn't translate to JSON 4xx.
  const directMembership = await ctx.supabase
    .from('user_tenants')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', ctx.tenantId)
    .eq('is_active', true)
    .maybeSingle()
  let resolvedRole = directMembership.data?.role as TenantRole | undefined
  if (!resolvedRole || !ALLOWED_ROLES.includes(resolvedRole)) {
    // Chain-admin fallback: a chain_admin at the parent tenant counts
    // for every child shop.
    const { data: t } = await ctx.supabase
      .from('tenants')
      .select('parent_tenant_id')
      .eq('id', ctx.tenantId)
      .maybeSingle()
    if (t?.parent_tenant_id) {
      const { data: ca } = await ctx.supabase
        .from('user_tenants')
        .select('role')
        .eq('user_id', ctx.userId)
        .eq('tenant_id', t.parent_tenant_id)
        .eq('role', 'chain_admin')
        .eq('is_active', true)
        .maybeSingle()
      if (ca?.role === 'chain_admin') {
        resolvedRole = 'chain_admin'
      }
    }
  }
  if (!resolvedRole || !ALLOWED_ROLES.includes(resolvedRole)) {
    return bad(403, 'Insufficient role for pawn intake.')
  }

  // Multipart parse.
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return bad(400, 'Invalid multipart body.')
  }
  const audio = formData.get('audio')
  const langField = formData.get('language')
  const languageHint: Language = langField === 'es' ? 'es' : 'en'
  // FormDataEntryValue is File | string | null in Next's runtime — File
  // satisfies Blob, so the instanceof Blob check is enough to narrow.
  if (!(audio instanceof Blob)) return bad(400, 'Missing audio.')
  if (audio.size === 0) return bad(400, 'Empty audio.')
  if (audio.size > MAX_AUDIO_BYTES) return bad(413, 'Audio too large.')

  // Wrap into a File so the OpenAI SDK has a name/type to send. When
  // the entry already arrived as a File (the common path), reuse it.
  const audioFile: File =
    typeof File !== 'undefined' && audio instanceof File
      ? audio
      : new File([audio], 'pawn-intake.webm', {
          type: (audio as Blob).type || 'audio/webm',
        })

  // Whisper.
  const openai = new OpenAI({ apiKey: openaiKey })
  let transcript: string
  try {
    const result = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: languageHint,
      prompt:
        languageHint === 'es'
          ? 'préstamo de empeño, nombre del cliente, fecha de nacimiento, oro, quilates, gramos, dólares'
          : 'pawn loan, customer name, date of birth, gold, karat, grams, dollars',
    })
    transcript = result.text.trim()
  } catch (e) {
    console.error('[voice/pawn-intake] whisper failed', e)
    return bad(502, 'Transcription failed.')
  }
  if (!transcript) return bad(422, 'Empty transcription.')

  // Claude (Haiku 4.5 — narrow structured extraction, optimized for
  // latency since the operator is waiting on the form to fill).
  const anthropic = new Anthropic({ apiKey: anthropicKey })
  let extracted: ExtractedJson
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: transcript }],
    })
    const text = msg.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*|\s*```$/g, '')
    extracted = JSON.parse(text) as ExtractedJson
  } catch (e) {
    console.error('[voice/pawn-intake] claude/json failed', e)
    return bad(502, 'Extraction failed.')
  }

  // Normalize collateral enums — Claude is well-behaved but JSON.parse
  // doesn't validate the enum constraints, and we don't want a stray
  // value reaching the form's <select>. Anything off-list collapses to
  // safe defaults so the operator can correct after fill.
  const collateral = extracted.collateral
    ? {
        description: (extracted.collateral.description ?? '').trim(),
        category: (VALID_CATEGORIES as ReadonlyArray<string>).includes(
          extracted.collateral.category,
        )
          ? (extracted.collateral.category as InventoryCategory)
          : ('other' as InventoryCategory),
        metal_type:
          extracted.collateral.metal_type &&
          (VALID_METALS as ReadonlyArray<string>).includes(
            extracted.collateral.metal_type,
          )
            ? (extracted.collateral.metal_type as MetalType)
            : '',
        karat: extracted.collateral.karat?.toString().trim() ?? '',
        weight_grams:
          extracted.collateral.weight_grams != null
            ? extracted.collateral.weight_grams.toString()
            : '',
        est_value:
          extracted.collateral.est_value != null
            ? extracted.collateral.est_value.toString()
            : '0',
      }
    : null

  // Customer match-or-create.
  let resolvedCustomer: {
    id: string
    label: string
    name: string
    isNew: boolean
  } | null = null

  if (extracted.customer?.firstName && extracted.customer?.lastName) {
    const firstName = extracted.customer.firstName.trim()
    const lastName = extracted.customer.lastName.trim()
    const dob =
      extracted.customer.dateOfBirth &&
      ISO_DATE_RE.test(extracted.customer.dateOfBirth)
        ? extracted.customer.dateOfBirth
        : null

    // Search existing — case-insensitive exact match on first+last
    // (ilike without wildcards). DOB narrows when present. RLS on
    // customers already scopes to the current tenant, but we filter
    // explicitly for defense in depth.
    let query = ctx.supabase
      .from('customers')
      .select('id, first_name, last_name, phone')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('is_banned', false)
      .ilike('first_name', firstName)
      .ilike('last_name', lastName)
      .order('created_at', { ascending: false })
      .limit(1)
    if (dob) query = query.eq('date_of_birth', dob)

    const { data: matches } = await query
    const match = matches?.[0]

    if (match) {
      resolvedCustomer = {
        id: match.id,
        label: `${match.last_name}, ${match.first_name}${match.phone ? ` · ${match.phone}` : ''}`,
        name: `${match.first_name} ${match.last_name}`,
        isNew: false,
      }
    } else {
      // Create. Service-role client because RLS INSERT on customers is
      // staff-scoped and we already verified role above.
      const admin = createAdminClient()
      const insert: CustomerInsert = {
        tenant_id: ctx.tenantId,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dob,
        country: 'US',
        id_country: 'US',
        comm_preference: 'sms',
        language: languageHint,
        marketing_opt_in: false,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      }
      const { data: created, error: createErr } = await admin
        .from('customers')
        .insert(insert)
        .select('id, first_name, last_name')
        .single()
      if (createErr || !created) {
        console.error('[voice/pawn-intake] customer create failed', createErr)
        return bad(500, 'Failed to create customer.')
      }
      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'create',
        tableName: 'customers',
        recordId: created.id,
        changes: {
          first_name: created.first_name,
          last_name: created.last_name,
          date_of_birth: dob,
          source: 'voice_intake',
        },
      })
      resolvedCustomer = {
        id: created.id,
        label: `${created.last_name}, ${created.first_name}`,
        name: `${created.first_name} ${created.last_name}`,
        isNew: true,
      }
    }
  }

  return NextResponse.json({
    transcript,
    data: {
      customer: resolvedCustomer,
      principal: extracted.principal,
      collateral,
    },
  })
}
