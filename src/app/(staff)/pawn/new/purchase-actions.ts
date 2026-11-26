'use server'

import { purityForInventory } from '@/lib/spot-prices/purity'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { missingPledgorFields, pledgorIncompleteError } from '@/lib/customers/pledgor-record'
import { PLEDGOR_SNAPSHOT_COLUMNS } from '@/lib/compliance/pledgor-snapshot'
import { intakeGate } from '@/lib/compliance/ofac/screen'
import { meltValueAtBuy, recordBuy } from '@/lib/buy/record'
import { purchaseOnFormSchema } from '@/lib/validations/buy-outright'
import {
  hasUnconfirmedItems,
  ITEMS_UNCONFIRMED,
  readCollateralRows,
} from '@/lib/pawn/intake-form'
import { collateralSnapshot } from '@/lib/pawn/collateral-snapshot'
import { inventoryDetailsFromCollateral } from '@/lib/pawn/forfeit-inventory'
import { gemstoneText } from '@/lib/pawn/stones'
import { addDaysIso, r4 } from '@/lib/pawn/math'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { checkStaleSpotGate } from '@/lib/spot-prices/stale-gate'
import { isSolidMetal, meltMetalFromItem } from '@/lib/spot-prices/purity'
import { splitTenders } from '@/lib/metal-counter/math'
import { isStoreCreditEnabled } from '@/lib/store-credit/events'
import { confirmIntakePhotos } from '@/lib/uploads/intake-photos-server'
import { intakePhotoMime } from '@/lib/uploads/intake-photos'

export type CreatePurchaseState = {
  error?: string
  fieldErrors?: Record<string, string>
}

/**
 * A purchase written on the pawnbroker transaction form — the New pawn
 * ticket screen in Purchase mode (patches/0115, FL § 539.001(8)(a): "any
 * pawn or purchase transaction" goes on the form, marked as one or the
 * other). Eddy, 2026-11-25: with a Florida pawn license a buy is processed
 * like a pawn and marked as a purchase.
 *
 * Same intake as a pawn ticket: the customer's full record (rule 26), the
 * banned list + OFAC, the item popup with every field the form prints
 * (rules 27-29), photos already in storage (rule 28), the stale-spot guard.
 * Same outcome as Buy outright: each piece becomes an inventory item on the
 * buy hold (source 'bought'), and lib/buy/record writes the police row
 * (which numbers the buy, BT-######), the store credit, the payout rows and
 * the audit. The page it lands on prints the form, "Purchase" checked.
 */
export async function createPurchaseAction(
  _prev: CreatePurchaseState,
  formData: FormData,
): Promise<CreatePurchaseState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

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

  const collateralRaw = readCollateralRows(formData)
  // An item filled by voice must be checked by the clerk first.
  if (hasUnconfirmedItems(collateralRaw)) return { error: ITEMS_UNCONFIRMED }
  const parsed = purchaseOnFormSchema.safeParse({
    customer_id: formData.get('customer_id'),
    payment_method: formData.get('payment_method'),
    paid_cash: formData.get('paid_cash'),
    paid_transfer: formData.get('paid_transfer'),
    notes: formData.get('notes'),
    collateral: collateralRaw.map((r) => ({ ...r.raw, photo_path: null })),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }
  const v = parsed.data

  // Every photo is this shop's and is in storage BEFORE anything is written.
  const photoLists: string[][] = []
  for (const row of collateralRaw) {
    const confirmed = await confirmIntakePhotos(row.raw.photos, tenantId, 'inventory-photos')
    if (!confirmed.ok) return { error: 'photos_missing' }
    photoLists.push(confirmed.paths)
  }

  // Each item's Amount is what it is bought for; the seller gets the sum.
  const totalPayout = r4(v.collateral.reduce((s, it) => s + r4(it.est_value), 0))
  const tenderSplit = splitTenders({
    method: v.payment_method,
    total: totalPayout,
    cash: v.paid_cash,
    transfer: v.paid_transfer,
  })
  if (!tenderSplit.ok) return { error: tenderSplit.error }

  const staleGate = await checkStaleSpotGate({
    formData,
    tenantRole: ctx.tenantRole,
    involvesMetal: v.collateral.some(
      (c) => meltMetalFromItem(c.metal_type) != null && isSolidMetal(c.coating),
    ),
  })
  if (!staleGate.ok) return { error: staleGate.error }

  const { data: customer } = await supabase
    .from('customers')
    .select(PLEDGOR_SNAPSHOT_COLUMNS)
    .eq('id', v.customer_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return { error: 'customer_not_found' }

  // FL 539.001(8)(b)3: the form carries the seller's full record.
  // An expired ID counts as missing, on the shop's date.
  const missing = missingPledgorFields(
    customer,
    todayInTimezone((await loadTenantRules(createAdminClient(), tenantId)).timezone),
  )
  if (missing.length > 0) return { error: pledgorIncompleteError(missing) }

  if (v.payment_method === 'store_credit') {
    if (!(await isStoreCreditEnabled(createAdminClient(), tenantId))) {
      return { error: 'store_credit_disabled' }
    }
  }

  const gate = await intakeGate({
    admin: createAdminClient(),
    tenantId,
    customerId: v.customer_id,
    context: 'buy_intake',
    userId,
  })
  if (!gate.ok) return { error: gate.code }

  // The buy hold: GREATEST(tenant setting, statutory hold), shop-local days.
  const rules = await loadTenantRules(createAdminClient(), tenantId)
  const acquiredAt = todayInTimezone(rules.timezone)
  const holdUntil = rules.buyHoldDays > 0 ? addDaysIso(acquiredAt, rules.buyHoldDays) : null

  const written: Array<{
    id: string
    sku: string
    weight_grams: number | null
    snapshot: Record<string, unknown>
  }> = []
  const withdraw = async () => {
    if (written.length === 0) return
    await supabase
      .from('inventory_items')
      .update({ deleted_at: new Date().toISOString(), updated_by: userId })
      .in('id', written.map((w) => w.id))
      .eq('tenant_id', tenantId)
  }

  for (let i = 0; i < v.collateral.length; i++) {
    const raw = v.collateral[i]
    // The line the form prints for the stones: the boxes plus the notes
    // (patches/0106), as a pawn ticket composes it.
    const gemstones = gemstoneText(raw.stones, raw.gemstone_notes)
    const item = {
      ...raw,
      gemstone_description: gemstones !== '' ? gemstones : raw.gemstone_description,
    }
    const photos = photoLists[i] ?? []
    const details = inventoryDetailsFromCollateral(item)
    const cost = r4(item.est_value)

    const { data: inv, error: invErr } = await supabase
      .from('inventory_items')
      .insert({
        tenant_id: tenantId,
        sku: '',
        sku_number: 0,
        description: item.description,
        category: item.category,
        metal: item.metal_type ?? null,
        // As inventory keeps it: "14K", "925".
        karat: purityForInventory(item.metal_type, item.karat),
        weight_grams: item.weight_grams,
        jewelry_size: item.jewelry_size,
        coating: details.coating,
        brand: details.brand,
        model: details.model,
        serial_number: details.serial_number,
        cost_basis: cost,
        acquired_cost: cost,
        list_price: null,
        source: 'bought',
        acquired_at: acquiredAt,
        hold_until: holdUntil,
        location: 'safe',
        status: 'held',
        notes: details.stoneNotes ? `Stones: ${details.stoneNotes}` : null,
        created_by: userId,
        updated_by: userId,
      })
      .select('id, sku')
      .single()
    if (invErr || !inv) {
      await withdraw()
      return { error: `inventory_insert_failed_row_${i + 1}: ${invErr?.message ?? 'unknown'}` }
    }

    if (details.stones.length > 0) {
      const { error: stoneErr } = await supabase.from('inventory_item_stones').insert(
        details.stones.map((st) => ({
          tenant_id: tenantId,
          item_id: inv.id,
          position: st.position,
          count: st.count,
          stone_type: st.stone_type,
          carat: st.carat,
          is_total_carat: true,
          color: st.color,
          cut: st.cut,
          clarity: st.clarity,
        })),
      )
      if (stoneErr) console.error('[purchase.create] stones insert failed', stoneErr.message)
    }

    if (photos.length > 0) {
      const { error: photoErr } = await supabase.from('inventory_item_photos').insert(
        photos.map((path, position) => ({
          tenant_id: tenantId,
          item_id: inv.id,
          storage_path: path,
          mime_type: intakePhotoMime(path),
          position,
          is_primary: position === 0,
          caption: null,
          created_by: userId,
        })),
      )
      if (photoErr) console.error('[purchase.create] photo rows failed', photoErr.message)
    }

    const meltAtBuy = await meltValueAtBuy({
      tenantId,
      metal: item.metal_type ?? null,
      karat: item.karat,
      coating: item.coating,
      weightGrams: item.weight_grams,
    })

    const [mainPhoto = null, ...extraPhotos] = photos
    written.push({
      id: inv.id,
      sku: inv.sku,
      weight_grams: item.weight_grams,
      snapshot: {
        ...collateralSnapshot(item),
        inventory_item_id: inv.id,
        sku: inv.sku,
        // The police upload's item_amount for a buy, and the form's Amount.
        payout: cost,
        melt_value_at_buy: meltAtBuy,
        serial_number: details.serial_number,
        photo_path: mainPhoto,
        extra_photo_paths: extraPhotos,
        photo_paths: photos,
        position: i,
      },
    })
  }

  const recorded = await recordBuy({
    supabase,
    tenantId,
    userId,
    customer,
    screeningId: gate.screeningId,
    items: written,
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
    flow: 'purchase_form',
  })
  if (!recorded.ok) return { error: recorded.error }
  if (v.payment_method === 'store_credit') revalidatePath(`/customers/${v.customer_id}`)

  revalidatePath('/inventory')
  revalidatePath('/buy')
  // ?print=1: the page asks to print the form at once — the seller signs it
  // before leaving the counter.
  redirect(`/buy/${written[0].id}?print=1`)
}
