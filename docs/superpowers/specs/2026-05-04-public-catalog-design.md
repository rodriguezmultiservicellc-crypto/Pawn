# Public Catalog — Design

- **Date:** 2026-05-04
- **Phase:** 10 Path A, slice 2 (continuation of Session 19's `/s/<slug>` landing)
- **Owner:** Eddy Rodriguez (RMS)
- **Status:** Approved for implementation

## What we're building

A per-tenant public catalog at `/s/<slug>/catalog` (and `/s/<slug>/catalog/<sku>`) that lists available retail inventory items for any tenant who has opted in. Anonymous browse — no auth required. Bilingual EN+ES on the same surface as the existing landing page. Reachable via tenant subdomain (`acme.basedomain.com/catalog`) through the proxy rewrite shipped in Session 19.

## Decisions locked during brainstorming

| # | Decision | Pick |
|---|----------|------|
| 1 | Per-tenant gate flag | New `tenants.public_catalog_enabled` BOOLEAN DEFAULT FALSE in addition to existing `public_landing_enabled` + `has_retail` + `is_active` |
| 2 | Per-item visibility | Auto-publish all `status='available' AND list_price IS NOT NULL` with per-item opt-out via new `inventory_items.is_hidden_from_catalog` BOOLEAN DEFAULT FALSE |
| 3 | Page structure | List page **and** per-item detail page (`/s/<slug>/catalog/<sku>`). Each item gets its own URL with its own metadata for SMS/social sharing |
| 4 | Spot price treatment | None on the public surface. Standard product spec fields only (metal type, karat, weight). `lib/spot-prices/` stays internal to staff |
| 5a | Filtering | Category pills (auto-built from `inventory_category` enum, hides empty categories) + free-text search box only. No price range, no metal filter |
| 5b | Pagination | 24 per page, sorted `created_at DESC`. Server-rendered Prev / Page X of Y / Next. No infinite scroll |
| 5c | Item detail CTA | `tel:` + `mailto:` + portal-login link. No inquiry form (defers until per-tenant Resend onboarding) |
| Arch | RLS posture | Public-read SELECT policies on `inventory_items` + `inventory_item_photos` + `inventory_item_stones`, gated on the same three-AND-flag pattern Session 19 used. Anon SSR client reads rows; admin client mints 1h signed photo URLs only for paths the anon read returned |

---

## 1. Database

### 1.1 New columns

```sql
ALTER TABLE tenants
  ADD COLUMN public_catalog_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE inventory_items
  ADD COLUMN is_hidden_from_catalog BOOLEAN NOT NULL DEFAULT FALSE;
```

### 1.2 New RLS policies

All three are SELECT-only, granted to `anon` and `authenticated`. Defense-in-depth: each row must pass both the parent-tenant publish gate and the per-item visibility gate.

#### `inventory_items_public_catalog_select`

```sql
CREATE POLICY inventory_items_public_catalog_select ON inventory_items
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenants t
      WHERE t.id = inventory_items.tenant_id
        AND t.public_landing_enabled = TRUE
        AND t.public_catalog_enabled = TRUE
        AND t.has_retail = TRUE
        AND t.is_active = TRUE
    )
    AND inventory_items.status = 'available'
    AND inventory_items.is_hidden_from_catalog = FALSE
    AND inventory_items.list_price IS NOT NULL
    AND inventory_items.deleted_at IS NULL
  );
```

#### `inventory_item_photos_public_catalog_select`

```sql
CREATE POLICY inventory_item_photos_public_catalog_select ON inventory_item_photos
  FOR SELECT TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM inventory_items i
      JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = inventory_item_photos.item_id
        AND t.public_landing_enabled = TRUE
        AND t.public_catalog_enabled = TRUE
        AND t.has_retail = TRUE
        AND t.is_active = TRUE
        AND i.status = 'available'
        AND i.is_hidden_from_catalog = FALSE
        AND i.list_price IS NOT NULL
        AND i.deleted_at IS NULL
    )
  );
```

#### `inventory_item_stones_public_catalog_select`

Identical shape to the photos policy, joined through `inventory_items` on `item_id`.

### 1.3 New index

```sql
CREATE INDEX IF NOT EXISTS idx_inventory_public_catalog
  ON inventory_items(tenant_id, created_at DESC)
  WHERE status = 'available'
    AND is_hidden_from_catalog = FALSE
    AND list_price IS NOT NULL
    AND deleted_at IS NULL;
```

Partial index keeps the public list query cheap regardless of total inventory size.

### 1.4 Migration

- Single new patch file: `patches/0027-public-catalog.sql`
- Rollback documented in the patch (DROP POLICY x3, DROP INDEX, DROP COLUMN x2)
- No new extensions required (CITEXT already in 0026)

---

## 2. Data fetch layer

### 2.1 Extension to `src/lib/tenant-resolver.ts`

Two new exported functions sit alongside `fetchPublicTenant`:

```ts
export type PublicCatalogItem = {
  id: string
  sku: string
  description: string
  category: InventoryCategory
  brand: string | null
  model: string | null
  serial_number: string | null
  metal: MetalType | null
  karat: string | null
  weight_grams: number | null
  list_price: number              // never null — RLS filters that
  created_at: string
  // Detail variant only:
  photos?: PublicCatalogPhoto[]
  stones?: PublicCatalogStone[]
}

export type PublicCatalogPhoto = {
  id: string
  storage_path: string
  signed_url: string              // minted by admin client at fetch time
  position: number
  is_primary: boolean
  caption: string | null
}

export type PublicCatalogStone = {
  count: number
  stone_type: string | null
  cut: string | null
  carat: number | null
  is_total_carat: boolean
  color: string | null
  clarity: string | null
  position: number
}

export async function fetchPublicCatalog(args: {
  tenantId: string
  page: number          // 1-based
  pageSize: number      // 24
  category?: InventoryCategory
  q?: string
}): Promise<{
  items: PublicCatalogItem[]
  total: number
  hasMore: boolean
}>

export async function fetchPublicCatalogItem(args: {
  tenantId: string
  sku: string
}): Promise<PublicCatalogItem | null>
```

### 2.2 Public-safe column allowlist

```ts
const PUBLIC_CATALOG_COLUMNS =
  'id, sku, description, category, brand, model, serial_number, metal, karat, weight_grams, list_price, created_at'
```

**Excluded from any public surface** (defense-in-depth — even if RLS misbehaves, the SELECT list never asks for these):

`cost_basis, acquired_cost, sale_price, sold_at, source, source_loan_id, source_repair_id, source_vendor, staff_memo, notes, tags, location, hold_until, released_from_hold_at, created_by, updated_by, sku_number`

### 2.3 Search behavior

`q` matches against `description, brand, model, sku, serial_number` via `.or(... ilike ...)`. `%` and `_` escaped via a small `escapeIlikeLiteral()` helper. Trim to ≥2 chars before applying. Same shape as the staff inventory page.

### 2.4 Photo signed URLs

Server-side only:

1. Anon SSR client reads `inventory_item_photos` rows. RLS gate decides which paths come back.
2. Admin client (`createAdminClient()`) mints 1h signed URLs for those `storage_path` values via existing `getSignedUrl({ bucket: INVENTORY_PHOTOS_BUCKET, ... })` helper.
3. Anon read is the gate. Admin sign is post-gate. Two-stage isolation — admin client only ever sees paths the RLS already approved.

### 2.5 Cache revalidation

When staff edits, creates, or deletes an inventory item via existing actions in `src/app/(staff)/inventory/{[id]/actions, new/actions}.ts`, append:

```ts
revalidatePath(`/s/${tenantSlug}/catalog`)
revalidatePath(`/s/${tenantSlug}/catalog/${item.sku}`)
```

Also revalidate when toggling `is_hidden_from_catalog` (new field on the item edit form). And when toggling `tenants.public_catalog_enabled` from `/settings/general` (extends the `revalidatePath` block already there for `/s/<slug>` from Session 19).

The staff actions resolve `tenantSlug` from the existing tenant context (`ctx.tenant.public_slug`); skip the revalidate when the slug is null.

---

## 3. Routes + page structure

### 3.1 New file tree

```
src/app/(public)/s/[slug]/
├── catalog/
│   ├── page.tsx              ← list (server component)
│   ├── content.tsx           ← 'use client' grid + filters
│   ├── not-found.tsx         ← catalog flag FALSE or no retail
│   └── [sku]/
│       ├── page.tsx          ← detail (server component)
│       ├── content.tsx       ← 'use client' photo carousel + spec table
│       └── not-found.tsx     ← SKU not found / not public
```

The existing `(public)/layout.tsx` (Session 19) auto-applies — same `I18nProvider` with `persistRemote=false`, same Accept-Language detection.

### 3.2 List page — `/s/<slug>/catalog`

**Server component flow:**

1. Resolve tenant via `fetchPublicTenant(slug)`. If null OR `!has_retail`, call `notFound()`.
2. Check `tenant.public_catalog_enabled === true`. If false, `notFound()`.
3. Parse `?page=N&category=ring&q=foo` from `searchParams` (Promise-typed per Next 16).
4. Call `fetchPublicCatalog({ tenantId: tenant.id, page, pageSize: 24, category, q })`.
5. For each item, mint a signed URL for the primary photo only (parallel `Promise.all`).
6. Render `<CatalogListContent>` with the prepared rows.

**`generateMetadata`:**

- title: `{name} — Shop` (i18n key `catalog.metaTitle` with `{name}` placeholder)
- description: city-templated `metaDescription` with `{name}` + `{city}` fallback to `metaDescriptionFallback`
- openGraph: title + description + tenant `logo_url` if present

**Client `content.tsx`:**

- Sticky header — same logo + display name as landing, plus a `Back to home` link to `/s/<slug>`
- Filter row: category pills (auto-built from items present, hides empty categories) + search input (debounced 300ms, updates URL via `router.replace` so the page param resets to 1)
- Grid: 4 cols desktop / 3 tablet / 2 mobile. Each card: photo (square, object-cover, fallback to a category icon when no primary photo), brand+description (2-line clamp), price (large), category pill
- Pagination: server-rendered Prev / `Page X of Y` / Next links with updated `?page=`
- Empty state: `No items match` with a `Clear filters` link, or `No items available right now` when there are no filters and zero results

### 3.3 Detail page — `/s/<slug>/catalog/<sku>`

**Server component flow:**

1. Resolve tenant (same gate as list).
2. Fetch item via `fetchPublicCatalogItem({ tenantId, sku })`. If null, `notFound()`.
3. Mint signed URLs for ALL photos (not just primary).
4. Stones come back via the public-gated stones policy in the same call.
5. Render `<CatalogItemContent>`.

**`generateMetadata`:**

- title: `{description} — {name}`
- description: short spec line — for jewelry: `{karat} {metal_label} {category} · {weight}g · ${price}`, for watches: `{brand} {model} · ${price}`, fallback: `{description} · ${price}`
- openGraph: title + description + primary photo signed URL (1h TTL — fine since the page revalidates on any inventory mutation, regenerating fresh URLs)
- twitter card: `summary_large_image`

**Client `content.tsx`:**

- Photos: carousel (mobile swipe) + thumbnail strip (desktop). Click for fullscreen lightbox
- Right column: description (`<h1>`), brand+model line, price (large), category pill, SKU shown in mono small text
- Spec table — only render rows that have data:
  - Metal: `{metals[metal]}` (i18n)
  - Karat: raw `karat` string (`'14K'`, `'18K'`, `'925'`)
  - Weight: `{weight_grams}g` (also dwt if present, in parens)
  - Serial number: raw value (relevant for watches; jewelry items often won't have one)
  - Stones: rendered as a small `<table>` — count, type, cut, carat (with "total" badge if `is_total_carat`), color, clarity. Skip empty columns if all rows are empty for that field
- CTAs: tel: + mailto: + `Back to all items` link
- Footer matches landing page

### 3.4 Wiring the landing's existing CTA

`src/app/(public)/s/[slug]/content.tsx` currently has a `CTAPlaceholder` for `dict.ctas.shopInventory`. Replace it with a real `<Link href={`/s/${tenant.public_slug}/catalog`}>` when `tenant.has_retail && tenant.public_catalog_enabled`. Otherwise keep the placeholder — preserves "coming soon" affordance.

This requires `public_catalog_enabled` on the `PublicTenant` type and `PUBLIC_TENANT_COLUMNS` allowlist. One-line addition each.

### 3.5 Subdomain rewrite

Already handled by Session 19's proxy work — `acme.basedomain.com/catalog/<sku>` rewrites to `/s/acme/catalog/<sku>` automatically. No proxy changes needed.

### 3.6 Settings UI extension

`src/app/(staff)/settings/general/content.tsx` "Public landing page" fieldset gains a new checkbox: `Publish public catalog` (label key `settings.general.publicCatalogEnabled`, hint key `settings.general.publicCatalogHint`). Disabled when `has_retail = FALSE` with explanatory tooltip.

`actions.ts` Zod schema gains the new field, the combined update payload includes it, and the existing `revalidatePath` block extends to clear `/s/<slug>/catalog` when the flag flips.

`src/app/(staff)/inventory/[id]/content.tsx` (item edit) gains a new checkbox: `Hide from public catalog` (label key `inventory.hideFromCatalog`). Default unchecked. Edit action handles the column.

---

## 4. i18n keys

### 4.1 New `catalog.*` block

Added to both `src/lib/i18n/en.ts` and `src/lib/i18n/es.ts`. Single block, ~30 keys:

```ts
catalog: {
  // page meta
  metaTitle,                  // "{name} — Shop" / "{name} — Tienda"
  metaDescription,            // "Browse jewelry, watches, and more from {name} in {city}"
  metaDescriptionFallback,    // no-city version
  // header
  backToHome,
  shop,
  // filters
  filterAll,
  searchPlaceholder,
  clearFilters,
  // grid + states
  empty,                      // "No items match your filters"
  emptyAll,                   // "No items available right now"
  pageOf,                     // "Page {page} of {total}"
  prevPage,
  nextPage,
  // category labels (one per InventoryCategory enum value)
  categories: {
    ring, necklace, bracelet, earrings, pendant, chain,
    watch, coin, bullion, loose_stone, electronics,
    tool, instrument, other
  },
  // detail page spec rows
  specs: {
    metal, karat, weight, serialNumber, stones, sku
  },
  // metal labels (one per metal_type enum value)
  metals: {
    gold, silver, platinum, palladium, rose_gold,
    white_gold, tungsten, titanium, stainless_steel,
    mixed, none, other
  },
  // stones table headers
  stonesTable: {
    count, type, cut, carat, color, clarity, totalCarat
  },
  // detail CTAs
  inquireByPhone,
  inquireByEmail,
  backToAll,
}
```

### 4.2 New `settings.general.*` keys

Two keys for the new "Publish public catalog" checkbox + hint. Plus a new `inventory.hideFromCatalog` label for the item-edit checkbox.

### 4.3 i18n parity

EN + ES must land in the same commit at full key parity. Any pre-push hook (`.githooks/pre-push` if present) enforces this; otherwise enforced manually during implementation.

### 4.4 Tone

Same voice as landing: factual, terse, no marketing fluff. ES uses `usted` register. Pawn-specific terms: "joyería" (jewelry), "joya" (item), "tienda" (shop). Diamond grading letters (D / VVS1 / etc.) stay in original notation — international standards, not translated.

---

## 5. Testing

Pure-logic only, vitest run via `npm test`. Same scope policy as Session 13 onward.

### 5.1 New file: `src/lib/tenant-resolver.catalog.test.ts`

- **Public-safe column allowlist sanity** — assert `PUBLIC_CATALOG_COLUMNS` does not include any of the forbidden names: `cost_basis`, `acquired_cost`, `sale_price`, `sold_at`, `source`, `source_loan_id`, `source_repair_id`, `source_vendor`, `staff_memo`, `notes`, `tags`, `location`, `hold_until`, `released_from_hold_at`, `created_by`, `updated_by`. Locks the SELECT-list defense-in-depth so a future drive-by edit can't reintroduce a leak silently.
- **Search-string escape** — `escapeIlikeLiteral()` correctly escapes `%`, `_`, and backslash. Round-trip: input with all three special chars produces a pattern that matches only the literal input.
- **Pagination math** — `pageSize=24, total=50, page=2` → `hasMore=false`, items length 26, offset 24. Boundaries:
  - page=0 (or negative / NaN) normalizes silently to page=1
  - page beyond `Math.ceil(total/pageSize)` returns empty + `hasMore=false`
  - page=last-partial returns the right slice size

No Supabase-mock or React-render tests. RLS policy correctness verified by the operator smoke test below.

### 5.2 Verification before claiming done

- `npm run lint` clean
- `npm test` — current 327, expected ~340 after this slice
- `npm run build` green (covers typecheck + production bundle; project has no standalone typecheck script)

### 5.3 Operator smoke test (post-implementation)

1. In `/settings/general` (logged in as owner), enter a slug, tick `Publish landing page`, tick `Publish public catalog`, save.
2. Add ≥3 inventory items with `status='available'`, `list_price` set, ≥1 photo each. At least one in each of two categories.
3. Visit `/s/<slug>/catalog`. Confirm grid renders, category pills appear for the two used categories only.
4. Click an item — confirm detail page loads, photos carousel works, spec table only shows fields with data.
5. Toggle `is_hidden_from_catalog` on one item. Confirm it disappears from the list within a few seconds.
6. Toggle `tenants.public_catalog_enabled = FALSE`. Confirm `/s/<slug>/catalog` 404s and the landing's `Shop inventory` CTA reverts to placeholder.
7. Manually try `/s/<slug>/catalog/INV-NONEXISTENT` and confirm 404 doesn't confirm SKU existence (generic message).
8. Try a probe URL for a tenant whose catalog is OFF — same generic 404, no leak.

---

## 6. Out of scope (deferred)

Listed explicitly so they don't sneak in:

- **Inquiry / lead-capture form** — gates on per-tenant Resend onboarding (not done for first tenant)
- **Spot price ticker** on catalog header — pinned no by Question 4-B
- **Per-item dollar melt-value disclosure** — same
- **Filter UI for price range or metal type** — Question 5a-i: category + search only
- **Infinite scroll** — Question 5b-i: paginated
- **Sitemap.xml** — defer until SEO work formally lands; per-page metadata is enough for v1
- **Reserved / "hold for me"** flow — needs lead-capture infra
- **Public catalog analytics** — page-view counts, category drill-down. Defer
- **Featured items / hero carousel** — keep grid flat for v1
- **Recently viewed** in localStorage — not v1
- **Multi-currency** — first tenants are FL, all USD
- **Description-derived URL slugs** — using SKU directly is fine

---

## 7. Migration sequencing for the implementation session

Session-1 plan (single session, single PR, single push):

1. Write `patches/0027-public-catalog.sql` (columns + RLS policies + index + rollback)
2. Apply patch in operator's Supabase project, then run `npm run db:types`
3. Extend `tenant-resolver.ts` (types + `fetchPublicCatalog` + `fetchPublicCatalogItem` + `escapeIlikeLiteral`)
4. Add tests for the new module pieces; confirm they pass
5. Build catalog list page (RSC + client content + not-found)
6. Build catalog item detail page (RSC + client content + not-found)
7. Wire landing CTA + extend `(staff)/settings/general` for the new flag
8. Extend `(staff)/inventory/[id]` form for `is_hidden_from_catalog`
9. Add i18n keys (EN + ES at parity)
10. Update tenant `PublicTenant` type + `PUBLIC_TENANT_COLUMNS` to include `public_catalog_enabled`
11. `npm run lint && npm test && npm run build` green
12. Single commit, push, Vercel deploy
13. Operator runs smoke test; if green, slice ships
