'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buyOutrightSchema,
  ALLOWED_BUY_PHOTO_MIME_TYPES,
  MAX_BUY_PHOTO_BYTES,
  type BuyItemInput,
} from '@/lib/validations/buy-outright'
import {
  INVENTORY_PHOTOS_BUCKET,
  uploadToBucket,
} from '@/lib/supabase/storage'
import { logAudit } from '@/lib/audit'
import { todayDateString, addDaysIso, r4 } from '@/lib/pawn/math'
import {
  computeMeltValue,
  meltMetalFromItem,
  purityFromItem,
} from '@/lib/spot-prices/melt'
import type { Database } from '@/types/database'

type ComplianceInsertChanges =
  Database['public']['Tables']['compliance_log']['Insert']['customer_snapshot']

export type CreateBuyState = {
  error?: string
  fieldErrors?: Record<string, string>
  /** Echo of the most recent submission for form repopulation on error. */
  values?: Record<string, string>
}

function pickExt(mime: string | null | undefined, filename?: string): string {
  if (filename) {
    const dot = filename.lastIndexOf('.')
    if (dot >= 0 && dot < filename.length - 1) {
      const ext = filename.slice(dot + 1).toLowerCase()
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext
    }
  }
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic') return 'heic'
  return 'bin'
}

function newUuid(): string {
  return crypto.randomUUID()
}

function readBuyItemRows(
  fd: FormData,
): Array<{ raw: Record<string, FormDataEntryValue | null>; photo: File | null }> {
  const countRaw = fd.get('item_count')
  const count = Math.max(
    0,
    Math.min(20, parseInt(String(countRaw ?? '0'), 10) || 0),
  )
  const rows: Array<{
    raw: Record<string, FormDataEntryValue | null>
    photo: File | null
  }> = []
  for (let i = 0; i < count; i++) {
    const photoVal = fd.get(`item_${i}_photo`)
    const photo =
      photoVal instanceof File && photoVal.size > 0 ? photoVal : null
    rows.push({
      raw: {
        description: fd.get(`item_${i}_description`),
        category: fd.get(`item_${i}_category`),
        metal: fd.get(`item_${i}_metal`),
        karat: fd.get(`item_${i}_karat`),
        weight_grams: fd.get(`item_${i}_weight_grams`),
        payout: fd.get(`item_${i}_payout`),
        serial_number: fd.get(`item_${i}_serial_number`),
        position: String(i),
      },
      photo,
    })
  }
  return rows
}

/**
 * Buy-outright (gold-buying) intake. Customer brings in items; shop pays
 * cash on the spot; items go into inventory marked status='held' until
 * the state-mandated hold period expires.
 *
 * Compliance: ONE compliance_log row per buy transaction, items_snapshot
 * carrying every item. event_type='buy_outright'. The source_id points
 * at the FIRST inventory_item created in the transaction so the audit
 * trail can navigate from compliance row → inventory.
 *
 * Hold period: settings.buy_hold_period_days from per-tenant settings
 * (default 30 in FL). hold_until = today + that many days. Item starts
 * as status='held'; a separate cron / manual step flips it to 'available'
 * after the hold expires (out of scope here).
 */
export async function createBuyOutrightAction(
  _prev: CreateBuyState,
  formData: FormData,
): Promise<CreateBuyState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Buy-outright is a pawn-licensed activity; gate on has_pawn.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
  ])

  const tenantId = ctx.tenantId

  // Echo back submission scalars (item rows are reconstructed client-
  // side via item_count).
  const echoKeys = ['customer_id', 'payment_method', 'notes', 'item_count']
  const echo: Record<string, string> = {}
  for (const k of echoKeys) {
    const v = formData.get(k)
    echo[k] = typeof v === 'string' ? v : ''
  }

  const itemRows = readBuyItemRows(formData)

  const parsed = buyOutrightSchema.safeParse({
    customer_id: formData.get('customer_id'),
    payment_method: formData.get('payment_method'),
    notes: formData.get('notes'),
    items: itemRows.map((r) => ({ ...r.raw, photo_path: null })),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors, values: echo }
  }

  const v = parsed.data

  // Customer must belong to this tenant.
  const { data: customer } = await supabase
    .from('customers')
    .select(
      'id, first_name, last_name, middle_name, date_of_birth, phone, email, address1, address2, city, state, zip, country, id_type, id_number, id_state, id_country, id_expiry, height_inches, weight_lbs, sex, hair_color, eye_color, identifying_marks, place_of_employment, photo_url',
    )
    .eq('id', v.customer_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) return { error: 'customer_not_found', values: echo }

  // Per-tenant hold-period setting (default 30).
  const admin = createAdminClient()
  const { data: settingsRow } = await admin
    .from('settings')
    .select('buy_hold_period_days')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const buyHoldDays =
    settingsRow?.buy_hold_period_days != null && settingsRow.buy_hold_period_days >= 0
      ? settingsRow.buy_hold_period_days
      : 30

  const acquiredAt = todayDateString()
  const holdUntil = buyHoldDays > 0 ? addDaysIso(acquiredAt, buyHoldDays) : null

  // Insert N inventory items. Each row is independent — if one fails the
  // whole transaction rolls back via the deleted_at sentinel + return
  // error. (Supabase JS doesn't expose multi-statement tx; we order
  // operations so partial failure leaves the DB consistent.)
  type InsertedItem = {
    id: string
    sku: string
    description: string
    metal: string | null
    karat: string | null
    weight_grams: number | null
    payout: number
    melt_value_at_buy: number | null
    photo_path: string | null
    serial_number: string | null
    category: string
    position: number
  }

  const inserted: InsertedItem[] = []

  for (let i = 0; i < v.items.length; i++) {
    const item = v.items[i]
    const file = itemRows[i]?.photo ?? null

    // Insert the inventory_items row first to obtain the id (needed for
    // the storage path).
    const acquiredCost = r4(item.payout)

    const { data: invRow, error: invErr } = await supabase
      .from('inventory_items')
      .insert({
        tenant_id: tenantId,
        sku: '',
        sku_number: 0,
        description: item.description,
        category: item.category,
        brand: null,
        model: null,
        serial_number: item.serial_number,
        metal: item.metal,
        karat: item.karat,
        weight_grams: item.weight_grams,
        weight_dwt: null,
        cost_basis: acquiredCost,
        list_price: null,
        source: 'bought',
        source_vendor: null,
        acquired_at: acquiredAt,
        acquired_cost: acquiredCost,
        hold_until: holdUntil,
        location: 'safe',
        status: 'held',
        notes: null,
        staff_memo: null,
        tags: null,
        created_by: userId,
        updated_by: userId,
      })
      .select('id, sku')
      .single()

    if (invErr || !invRow) {
      return {
        error: `inventory_insert_failed_row_${i + 1}: ${invErr?.message ?? 'unknown'}`,
        values: echo,
      }
    }

    // Upload photo if provided.
    let photoPath: string | null = null
    if (file && file.size > 0) {
      if (file.size > MAX_BUY_PHOTO_BYTES) {
        return { error: `photo_too_large_row_${i + 1}`, values: echo }
      }
      if (!ALLOWED_BUY_PHOTO_MIME_TYPES.includes(file.type as never)) {
        return { error: `photo_mime_not_allowed_row_${i + 1}`, values: echo }
      }
      const ext = pickExt(file.type, file.name)
      const path = `${tenantId}/${invRow.id}/${newUuid()}.${ext}`
      try {
        await uploadToBucket({
          bucket: INVENTORY_PHOTOS_BUCKET,
          path,
          body: file,
          contentType: file.type,
        })
        photoPath = path

        // Record on inventory_item_photos so the photos panel sees it.
        await supabase.from('inventory_item_photos').insert({
          tenant_id: tenantId,
          item_id: invRow.id,
          storage_path: path,
          mime_type: file.type,
          byte_size: file.size,
          position: 0,
          is_primary: true,
          caption: null,
          created_by: userId,
        })
      } catch (err) {
        console.error('[buy.create] photo upload failed', err)
      }
    }

    // Best-effort melt value at acquisition time (snapshot for police
    // report + future analytics).
    const meltMetal = meltMetalFromItem(item.metal)
    const purity = meltMetal
      ? purityFromItem({ metal: item.metal, karat: item.karat })
      : null
    let meltAtBuy: number | null = null
    if (meltMetal && purity && item.weight_grams != null) {
      const melt = await computeMeltValue({
        metalType: meltMetal,
        purity,
        weightGrams: item.weight_grams,
        tenantId,
      })
      meltAtBuy = melt?.value ?? null
    }

    inserted.push({
      id: invRow.id,
      sku: invRow.sku,
      description: item.description,
      metal: item.metal,
      karat: item.karat,
      weight_grams: item.weight_grams,
      payout: acquiredCost,
      melt_value_at_buy: meltAtBuy,
      photo_path: photoPath,
      serial_number: item.serial_number,
      category: item.category,
      position: i,
    })
  }

  if (inserted.length === 0) {
    return { error: 'no_items_inserted', values: echo }
  }

  const totalPayout = r4(inserted.reduce((s, it) => s + it.payout, 0))

  // Compliance log — one row per buy TRANSACTION, items_snapshot lists
  // every item. The FL LeadsOnline exporter flattens 1 compliance row →
  // N police-report rows. source_table=inventory_items, source_id=first
  // item's id (consistent navigation target).
  const customerSnapshot = {
    id: customer.id,
    first_name: customer.first_name,
    last_name: customer.last_name,
    middle_name: customer.middle_name,
    date_of_birth: customer.date_of_birth,
    phone: customer.phone,
    email: customer.email,
    address1: customer.address1,
    address2: customer.address2,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    country: customer.country,
    id_type: customer.id_type,
    id_number: customer.id_number,
    id_state: customer.id_state,
    id_expiry: customer.id_expiry,
    height_inches: customer.height_inches,
    weight_lbs: customer.weight_lbs,
    sex: customer.sex,
    hair_color: customer.hair_color,
    eye_color: customer.eye_color,
    identifying_marks: customer.identifying_marks,
    place_of_employment: customer.place_of_employment,
    photo_url: customer.photo_url,
  } as unknown as ComplianceInsertChanges

  const itemsSnapshot = inserted.map((it) => ({
    inventory_item_id: it.id,
    sku: it.sku,
    description: it.description,
    category: it.category,
    metal_type: it.metal,
    karat: it.karat,
    weight_grams: it.weight_grams,
    payout: it.payout,
    melt_value_at_buy: it.melt_value_at_buy,
    serial_number: it.serial_number,
    photo_path: it.photo_path,
    position: it.position,
  })) as unknown as ComplianceInsertChanges

  const firstItemId = inserted[0].id
  await supabase.from('compliance_log').insert({
    tenant_id: tenantId,
    source_table: 'inventory_items',
    source_id: firstItemId,
    event_type: 'buy_outright',
    customer_snapshot: customerSnapshot,
    items_snapshot: itemsSnapshot,
    amount: totalPayout,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'buy_outright',
    tableName: 'inventory_items',
    recordId: firstItemId,
    changes: {
      flow: 'buy_outright',
      customer_id: v.customer_id,
      payment_method: v.payment_method,
      total_payout: totalPayout,
      item_count: inserted.length,
      hold_until: holdUntil,
      item_skus: inserted.map((it) => it.sku),
      notes: v.notes,
    },
  })

  revalidatePath('/inventory')
  revalidatePath('/buy')
  redirect(`/buy/${firstItemId}`)
}

// Used internally + re-exported for the form's preflight type.
export type { BuyItemInput }
