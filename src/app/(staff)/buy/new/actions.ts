'use server'

import { missingPledgorFields, pledgorIncompleteError } from '@/lib/customers/pledgor-record'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { buyOutrightSchema } from '@/lib/validations/buy-outright'
import { intakePhotoMime } from '@/lib/uploads/intake-photos'
import { confirmIntakePhotos } from '@/lib/uploads/intake-photos-server'
import { intakeGate } from '@/lib/compliance/ofac/screen'
import { isStoreCreditEnabled } from '@/lib/store-credit/events'
import { meltValueAtBuy, recordBuy } from '@/lib/buy/record'
import { PLEDGOR_SNAPSHOT_COLUMNS } from '@/lib/compliance/pledgor-snapshot'
import { addDaysIso, r4 } from '@/lib/pawn/math'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { checkStaleSpotGate } from '@/lib/spot-prices/stale-gate'
import { meltMetalFromItem } from '@/lib/spot-prices/melt'
import { splitTenders } from '@/lib/metal-counter/math'
import { isSolidMetal } from '@/lib/spot-prices/purity'

export type CreateBuyState = {
  error?: string
  fieldErrors?: Record<string, string>
  /** Echo of the most recent submission for form repopulation on error. */
  values?: Record<string, string>
}

/** The item rows of a buy. `photos` is the JSON list of each item's photo
 *  paths, already uploaded by the browser (lib/uploads/intake-photos). */
function readBuyItemRows(
  fd: FormData,
): Array<{ raw: Record<string, FormDataEntryValue | null>; photos: FormDataEntryValue | null }> {
  const countRaw = fd.get('item_count')
  const count = Math.max(
    0,
    Math.min(20, parseInt(String(countRaw ?? '0'), 10) || 0),
  )
  const rows: Array<{
    raw: Record<string, FormDataEntryValue | null>
    photos: FormDataEntryValue | null
  }> = []
  for (let i = 0; i < count; i++) {
    rows.push({
      raw: {
        description: fd.get(`item_${i}_description`),
        category: fd.get(`item_${i}_category`),
        metal: fd.get(`item_${i}_metal`),
        karat: fd.get(`item_${i}_karat`),
        weight_grams: fd.get(`item_${i}_weight_grams`),
        coating: fd.get(`item_${i}_coating`),
        payout: fd.get(`item_${i}_payout`),
        serial_number: fd.get(`item_${i}_serial_number`),
        position: String(i),
      },
      photos: fd.get(`item_${i}_photos`),
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
 * Hold period: GREATEST(settings.buy_hold_period_days, statutory hold)
 * via loadTenantRules (patches/0048). hold_until = shop-local today +
 * that many days. Item starts as status='held'; the release-buy-holds
 * cron flips it to 'available' after the hold expires, and a DB trigger
 * refuses any earlier release.
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
  const echoKeys = [
    'customer_id',
    'payment_method',
    'paid_cash',
    'paid_transfer',
    'notes',
    'item_count',
  ]
  const echo: Record<string, string> = {}
  for (const k of echoKeys) {
    const v = formData.get(k)
    echo[k] = typeof v === 'string' ? v : ''
  }

  const itemRows = readBuyItemRows(formData)

  const parsed = buyOutrightSchema.safeParse({
    customer_id: formData.get('customer_id'),
    payment_method: formData.get('payment_method'),
    paid_cash: formData.get('paid_cash'),
    paid_transfer: formData.get('paid_transfer'),
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

  // Each item's photos are already in storage (uploaded by the browser):
  // check every list is this shop's and every file is there BEFORE anything
  // is written.
  const photoLists: string[][] = []
  for (const row of itemRows) {
    const confirmed = await confirmIntakePhotos(row.photos, tenantId)
    if (!confirmed.ok) return { error: 'photos_missing', values: echo }
    photoLists.push(confirmed.paths)
  }

  // How the seller is paid. 'mixed' = cash + transfer whose parts must add
  // up to the total payout to the cent (brief Phase 3). Resolved before any
  // write so a bad split leaves nothing behind. The buy has no tender
  // ledger of its own — the tenders are recorded on the audit row.
  const tenderSplit = splitTenders({
    method: v.payment_method === 'store_credit' ? 'store_credit' : v.payment_method,
    total: v.items.reduce((s, it) => s + r4(it.payout), 0),
    cash: v.paid_cash,
    transfer: v.paid_transfer,
  })
  if (!tenderSplit.ok) return { error: tenderSplit.error, values: echo }

  // Stale spot-price guard (24h rule): a buy that prices precious metal
  // off a stale feed needs a manager's confirmation. Checked before any
  // write so a refused buy leaves nothing behind.
  const staleGate = await checkStaleSpotGate({
    formData,
    tenantRole: ctx.tenantRole,
    involvesMetal: v.items.some(
      (it) => meltMetalFromItem(it.metal) != null && isSolidMetal(it.coating),
    ),
  })
  if (!staleGate.ok) return { error: staleGate.error, values: echo }

  // Customer must belong to this tenant.
  const { data: customer } = await supabase
    .from('customers')
    .select(PLEDGOR_SNAPSHOT_COLUMNS)
    .eq('id', v.customer_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) return { error: 'customer_not_found', values: echo }

  // FL 539.001(8)(b): the form must carry the seller's full record.
  const missing = missingPledgorFields(customer)
  if (missing.length > 0) return { error: pledgorIncompleteError(missing), values: echo }

  // Paying the seller in store credit needs the module on. Checked before
  // anything is written — a purchase recorded as "paid in store credit"
  // with no credit issued is a seller who walked out with nothing.
  if (v.payment_method === 'store_credit') {
    if (!(await isStoreCreditEnabled(createAdminClient(), tenantId))) {
      return { error: 'store_credit_disabled', values: echo }
    }
  }

  // Banned list + OFAC SDN screening (patches/0051).
  const gate = await intakeGate({
    admin: createAdminClient(),
    tenantId,
    customerId: v.customer_id,
    context: 'buy_intake',
    userId,
  })
  if (!gate.ok) return { error: gate.code, values: echo }

  // Hold period = GREATEST(tenant setting, statutory hold) — patches/0048.
  // Dates are the shop's local calendar day.
  const rules = await loadTenantRules(createAdminClient(), tenantId)
  const buyHoldDays = rules.buyHoldDays

  const acquiredAt = todayInTimezone(rules.timezone)
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
    coating: string
    payout: number
    melt_value_at_buy: number | null
    /** The main photo (for the police snapshot); every photo is an
     *  inventory_item_photos row. */
    photo_path: string | null
    photo_paths: string[]
    serial_number: string | null
    category: string
    position: number
  }

  const inserted: InsertedItem[] = []

  for (let i = 0; i < v.items.length; i++) {
    const item = v.items[i]
    const photos = photoLists[i] ?? []

    // Insert the inventory_items row first to obtain the id its photos
    // point at.
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
        coating: item.coating,
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

    // Record every photo on inventory_item_photos (main first) so the
    // item's photos panel sees them.
    if (photos.length > 0) {
      const { error: photoErr } = await supabase.from('inventory_item_photos').insert(
        photos.map((path, position) => ({
          tenant_id: tenantId,
          item_id: invRow.id,
          storage_path: path,
          mime_type: intakePhotoMime(path),
          position,
          is_primary: position === 0,
          caption: null,
          created_by: userId,
        })),
      )
      if (photoErr) console.error('[buy.create] photo rows failed', photoErr.message)
    }
    const photoPath = photos[0] ?? null

    // Best-effort melt value at acquisition time (police snapshot +
    // analytics). A coated piece has none.
    const meltAtBuy = await meltValueAtBuy({
      tenantId,
      metal: item.metal,
      karat: item.karat,
      coating: item.coating,
      weightGrams: item.weight_grams,
    })

    inserted.push({
      id: invRow.id,
      sku: invRow.sku,
      description: item.description,
      metal: item.metal,
      karat: item.karat,
      weight_grams: item.weight_grams,
      coating: item.coating,
      payout: acquiredCost,
      melt_value_at_buy: meltAtBuy,
      photo_path: photoPath,
      photo_paths: photos,
      serial_number: item.serial_number,
      category: item.category,
      position: i,
    })
  }

  if (inserted.length === 0) {
    return { error: 'no_items_inserted', values: echo }
  }

  const totalPayout = r4(inserted.reduce((s, it) => s + it.payout, 0))

  // The police row, the store credit, the payout rows, the audit row —
  // lib/buy/record (shared with a purchase on the transaction form).
  const recorded = await recordBuy({
    supabase,
    tenantId,
    userId,
    customer,
    screeningId: gate.screeningId,
    items: inserted.map((it) => ({
      id: it.id,
      sku: it.sku,
      weight_grams: it.weight_grams,
      snapshot: {
        inventory_item_id: it.id,
        sku: it.sku,
        description: it.description,
        category: it.category,
        metal_type: it.metal,
        karat: it.karat,
        weight_grams: it.weight_grams,
        coating: it.coating,
        payout: it.payout,
        melt_value_at_buy: it.melt_value_at_buy,
        serial_number: it.serial_number,
        photo_path: it.photo_path,
        photo_paths: it.photo_paths,
        position: it.position,
      },
    })),
    totalPayout,
    paymentMethod: v.payment_method,
    tenders: tenderSplit.tenders,
    notes: v.notes,
    holdUntil,
    staleSpotAck: staleGate.acknowledged
      ? {
          confirmed_by: userId,
          spot_fetched_at: staleGate.freshness.newestFetchedAt,
          spot_age_hours: staleGate.freshness.ageHours,
        }
      : null,
    flow: 'buy_outright',
  })
  if (!recorded.ok) return { error: recorded.error, values: echo }
  if (v.payment_method === 'store_credit') revalidatePath(`/customers/${v.customer_id}`)

  revalidatePath('/inventory')
  revalidatePath('/buy')
  redirect(`/buy/${inserted[0].id}?print=1`)
}

// No non-function exports here, not even `export type { … }` — Turbopack's
// 'use server' transform turns that re-export into a runtime reference
// ("BuyItemInput is not defined") the moment any action in this file runs.
// Types live in lib/validations/buy-outright.
