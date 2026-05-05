# Google Reviews Embed — Design

- **Date:** 2026-05-05
- **Phase:** 10 Path A, slice 4 (continuation of Session 19's `/s/<slug>` landing, slice 2's catalog, slice 3's loyalty/referrals)
- **Owner:** Eddy Rodriguez (RMS)
- **Status:** Approved for implementation

## What we're building

Per-tenant Google Reviews embed on the public landing page at `/s/<slug>`. Operators paste their Google Place ID into a new settings page; the public landing renders an aggregate rating + up to 3 recent reviews (filtered by an operator-tunable min-star floor). Reviews come from Google's Places API, cached in a DB table with on-demand fill (24h TTL). Bilingual EN+ES.

## Decisions locked during brainstorming

| # | Decision | Pick |
|---|----------|------|
| 1 | API key model | Hybrid — `GOOGLE_PLACES_API_KEY` env var as platform default; optional per-tenant override in `settings.google_places_api_key`. Resolves at the call site (per-tenant first, env fallback). |
| 2 | Review filtering | Min-star floor in `settings.google_reviews_min_star_floor` (1–5, default 4). Filter applied at render time over cached payload. No per-review hide list v1. |
| 3 | Cache strategy | DB table `tenant_google_reviews`, on-demand fill, 24h TTL. SWR on stale, fresh-fetch when row missing or place_id changed. No cron dependency. Cron warmer is a follow-up after Phase 0 punch list lands. |
| 4 | Public visibility | Silent fail-soft. Widget renders **iff** `place_id` set AND last fetch succeeded AND ≥1 review survives min-star filter. All errors surface only in `/settings`. |
| 5 | Settings UI placement | `/settings/integrations/google-reviews` (sub-page under existing integrations hub, eBay precedent). |
| 6 | Widget placement | Between About and CTAs on the public landing page. |
| 7 | Widget shape | Aggregate header + up-to-3 review cards (3-col desktop, 1-col mobile), Phosphor Star icons, 140-char excerpt, "Read on Google" per card, no reviewer photos v1. |
| 8 | Star icon color | Phosphor `Star` `weight="fill"`, `text-ink` filled / `text-hairline` empty. **Not** Warning Amber (semantic-only token; decorative use violates locked design system). Matches Airbnb's parent treatment. |

---

## 1. Database

### 1.1 New columns on `settings`

```sql
ALTER TABLE settings
  ADD COLUMN google_place_id TEXT,
  ADD COLUMN google_places_api_key TEXT,
  ADD COLUMN google_reviews_min_star_floor SMALLINT NOT NULL DEFAULT 4
    CHECK (google_reviews_min_star_floor BETWEEN 1 AND 5);
```

No `tenants.public_reviews_enabled` flag — implicit gate is `google_place_id IS NOT NULL` combined with the existing `tenants.public_landing_enabled`.

### 1.2 New cache table

```sql
CREATE TABLE tenant_google_reviews (
  tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  place_id            TEXT NOT NULL,            -- copied from settings at fetch time
  payload             JSONB NOT NULL,           -- raw Place Details response
  rating              NUMERIC(3,2),             -- denormalized aggregate
  total_review_count  INTEGER,                  -- denormalized
  fetched_at          TIMESTAMPTZ NOT NULL,
  last_error          TEXT,                     -- NULL on success
  last_error_at       TIMESTAMPTZ
);

CREATE INDEX idx_tenant_google_reviews_fetched_at
  ON tenant_google_reviews (fetched_at)
  WHERE last_error IS NULL;  -- for future cron warmer's "find stale" query
```

`place_id` denormalized so we can detect mismatch when an operator changes their place_id (force re-fetch even if TTL not expired). `last_error` lets `/settings` surface failure without a separate event log.

### 1.3 RLS

```sql
ALTER TABLE tenant_google_reviews ENABLE ROW LEVEL SECURITY;

-- Staff read: tenant scope via my_tenant_ids()
CREATE POLICY tenant_google_reviews_staff_select
  ON tenant_google_reviews FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT my_tenant_ids()));

-- No INSERT/UPDATE/DELETE policies — writes go through admin client only.
```

The public landing route reads `tenant_google_reviews` via the admin client (same pattern catalog uses for inventory item photos). No `anon` SELECT policy — keeps surface area minimal.

### 1.4 Audit

Settings mutations on the three new columns go through `audit_log` per project Rule 10. Pattern matches loyalty's settings actions. Cache table writes don't audit (high-frequency, low-value — `fetched_at` is the audit trail).

### 1.5 Migration file

`patches/0029-google-reviews.sql` — schema additions + RLS + index + rollback section.

---

## 2. Server library

New folder: `src/lib/google-reviews/`. Mirrors `src/lib/loyalty/` and `src/lib/spot-prices/`.

```text
src/lib/google-reviews/
  client.ts           // 'server-only' — fetch wrapper around Places API
  cache.ts            // 'server-only' — read-from-DB / write-to-DB / TTL check + public adapter
  filter.ts           // pure — apply min-star floor, sort by recency, cap at 3
  format.ts           // pure — relative time, star rendering, excerpt truncation
  types.ts            // shared types
  filter.test.ts      // vitest — pure filter math
  format.test.ts      // vitest — relative-time + truncation edge cases
```

### 2.1 `client.ts`

One exported function:

```ts
export async function fetchPlaceDetails(opts: {
  placeId: string
  apiKey: string
  language?: 'en' | 'es'  // optional, defaults to 'en' for cache stability
}): Promise<PlaceDetails | { error: string }>
```

Calls `https://maps.googleapis.com/maps/api/place/details/json` with `fields=rating,user_ratings_total,reviews,url,name,business_status`. **Never throws.** Returns either parsed payload or `{error}`. Caller decides what to do.

API key resolution lives at the call site, not in `client.ts` — keeps the client a pure HTTP wrapper.

### 2.2 `cache.ts`

```ts
// Returns cached payload, kicks off background refresh if stale.
// Never throws — failure surfaces as null + last_error in DB.
export async function getCachedReviews(tenantId: string): Promise<TenantReviewRow | null>

// Synchronous fetch + write. Used by getCachedReviews when no row exists,
// and by the future cron warmer.
export async function refreshReviews(tenantId: string): Promise<TenantReviewRow | null>

// Public-surface adapter — composes getCachedReviews + applyMinStarFloor +
// isWidgetRenderable. Returns the renderable data shape or null.
export async function loadPublicReviews(opts: {
  tenantId: string
  placeId: string | null
  minStarFloor: number
}): Promise<RenderableReviews | null>
```

Logic for `getCachedReviews`:

1. SELECT row from `tenant_google_reviews` where `tenant_id` matches.
2. If row exists AND `place_id` matches `settings.google_place_id` AND `fetched_at > now() - 24h` → return row (fresh, hot path).
3. If row exists but stale → return row immediately, fire-and-forget `void refreshReviews()` (stale-while-revalidate). Subsequent visitors see fresh.
4. If no row OR place_id mismatch → await `refreshReviews()`, return whatever it returns. First-visitor latency.

`refreshReviews` resolves the API key (`settings.google_places_api_key ?? process.env.GOOGLE_PLACES_API_KEY`), calls `fetchPlaceDetails`, then UPSERTs the row. On error, UPSERTs `last_error` + `last_error_at` **without overwriting** `payload` / `rating` / `total_review_count` / `fetched_at` — keeps the previous good payload serving.

### 2.3 `filter.ts`

```ts
export function applyMinStarFloor(
  reviews: GoogleReview[],
  floor: number,
): GoogleReview[]
// Filters to reviews where rating >= floor.
// Sorts by time DESC (most recent first).
// Caps at 3 visible.

export function isWidgetRenderable(opts: {
  fetchedAt: Date | null
  filteredReviews: GoogleReview[]
}): boolean
// Returns true iff fetchedAt set AND filteredReviews.length >= 1.
// Encodes the silent-fail-soft rule (Decision 4) in one place.
```

### 2.4 `format.ts`

- `formatRelativeTime(timestampSec, locale)` — wraps `Intl.RelativeTimeFormat` with day/week/month thresholds.
- `truncateExcerpt(text, maxChars=140)` — smart word-boundary cutoff, appends `…`.
- `starArray(rating)` — returns `[true, true, true, true, false]` for rating 4.

Tests cover:
- Relative time: just-now, minutes, hours, days, weeks, months boundary cases for both en + es locales.
- Truncation: text shorter than max, exactly at max, mid-word boundary, multi-paragraph input.
- Star array: 0, 1, 4.5 (rounds to 5 visual stars rendered), 5.

### 2.5 Public surface integration

`tenant-resolver.ts` gains two additional fields on `PublicTenant`:

- `google_place_id: string | null`
- `google_reviews_min_star_floor: number`

The per-tenant `google_places_api_key` is **not** added to `PublicTenant` — it stays server-only. `refreshReviews` reads it directly from `settings` via the admin client when it needs to call Places. Keeps the public type lean and avoids any risk of a future leak through `PublicTenant` serialization.

---

## 3. UI surfaces

### 3.1 `/settings/integrations/google-reviews` (admin)

Three-file pattern matching `/settings/loyalty`:

```text
src/app/(staff)/settings/integrations/google-reviews/
  page.tsx       // RSC, owner/chain_admin gate, fetches settings + cache row
  content.tsx    // 'use client', useActionState form + test-connection button
  actions.ts     // 'use server', requireRoleInTenant before admin client
```

**Page contents** (max-width 640px to match other settings pages):

- Status chip at top (Connected / Pending / Not configured / Failed).
- Form: `place_id` text input, `min_star_floor` select (1–5), `api_key` text input under collapsible "Advanced (optional)" section.
- Two buttons: "Test connection" (server action, immediate Places API call + UPSERT cache row, returns `{ok, error?}`) and "Save".
- Help text under each field.

**Status chip logic** (server-side at page render):

| Setting state | Cache row state | Chip |
|---------------|-----------------|------|
| `place_id IS NULL` | (any) | "Not configured" — gray |
| `place_id IS NOT NULL` | no row | "Pending — first sync runs on next visit" — gray |
| `place_id IS NOT NULL` | row, `last_error IS NULL` | "Connected · last sync Xh ago" — Success Green |
| `place_id IS NOT NULL` | row, `last_error IS NOT NULL` | "Last sync failed: {error}" — Error Red |

**Zod schema** in `lib/validations/google-reviews.ts`:

```ts
googleReviewsSettingsSchema = z.object({
  google_place_id: z
    .preprocess((v) => (v === '' ? null : v), z.string().trim().min(1).nullable()),
  google_reviews_min_star_floor: z.coerce.number().int().min(1).max(5),
  google_places_api_key: z
    .preprocess((v) => (v === '' ? null : v), z.string().trim().min(1).nullable()),
})
```

Empty-string → null preprocess matches loyalty pattern. No deeper place_id format check — the test-connection button is the actual validator.

**Audit** — write before/after for all three fields per Rule 10. Triggers `revalidatePath('/settings/integrations/google-reviews')`, `revalidatePath('/settings/integrations')`, and `revalidatePath('/s/<slug>')` so the public surface picks up the change.

### 3.2 `/settings/integrations` hub status card

Add a Google Reviews card next to the existing eBay card. Hub-level fetch already runs server-side; add a second status query. Card shows:

- Status text (Connected / Pending / Not configured / Failed).
- If connected: `4.7 ★ · 142 reviews`.
- "Manage" button → `/settings/integrations/google-reviews`.

### 3.3 Sidebar

No new sidebar entry. Existing "Integrations" entry under Settings already lands operators on `/settings/integrations`. Consistent with eBay.

### 3.4 Public landing widget

```text
src/components/public/GoogleReviewsWidget.tsx        // 'use client'
src/components/public/GoogleReviewsWidget.test.tsx   // vitest — render rules
```

Plugged into `src/app/(public)/s/[slug]/content.tsx` between the `{tenant.public_about ? ...}` block and the `{/* CTAs */}` section:

```tsx
{reviews ? <GoogleReviewsWidget data={reviews} /> : null}
```

`reviews` is threaded from `page.tsx` after a single helper call:

```ts
const reviews = await loadPublicReviews({
  tenantId: tenant.id,
  placeId: tenant.google_place_id,
  minStarFloor: tenant.google_reviews_min_star_floor,
})
```

**Widget structure:**

```
┌─ Reviews on Google ──────────────────────────────────┐
│  ★★★★★  4.7  ·  142 reviews                         │
│                                            [See all on Google ↗] │
│                                                       │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│  │ ★★★★★      │ │ ★★★★★      │ │ ★★★★★      │        │
│  │ Maria S.   │ │ John D.    │ │ Robert K.  │        │
│  │ 3 days ago │ │ 1 wk ago   │ │ 2 wks ago  │        │
│  │            │ │            │ │            │        │
│  │ Excerpt of │ │ Excerpt... │ │ Excerpt... │        │
│  │ review...  │ │            │ │            │        │
│  │            │ │            │ │            │        │
│  │ Read on    │ │ Read on    │ │ Read on    │        │
│  │ Google ↗   │ │ Google ↗   │ │ Google ↗   │        │
│  └────────────┘ └────────────┘ └────────────┘        │
└──────────────────────────────────────────────────────┘
```

- Card style mirrors existing landing-page `Card` (`rounded-lg border-hairline bg-canvas p-5`).
- Star icons: Phosphor `Star` `weight="fill"`, `text-ink` filled / `text-hairline` empty (Decision 8).
- Reviewer name as Google supplies it (no transformation). Reviewer photos skipped v1.
- Excerpt truncated to 140 chars via `truncateExcerpt`.
- Time = relative ("3 days ago") via `Intl.RelativeTimeFormat`, locale-aware on EN/ES toggle.
- "See all on Google" → Google's `url` field on the place response.
- "Read on Google" per card → individual review's `author_url` if present, falls back to place URL with deep-link to reviews tab.

**Render rule tests** (vitest):

- `data === null` → returns `null`, nothing rendered.
- `data.reviews.length === 0` (caller already filtered, edge case) → returns `null`.
- Reviewer name absent → renders "Anonymous" / "Anónimo".
- Excerpt absent → renders just the star/time row.
- Locale switch → relative time updates.

---

## 4. i18n

EN + ES, both must land in same commit per pre-push hook. ~28 keys total.

**Public landing — `landing.reviews.*`:**

- `title` — "Reviews on Google" / "Reseñas en Google"
- `aggregateLabel` — `"{rating} · {count} {countLabel}"` template
- `count.one` — "review" / "reseña"
- `count.other` — "reviews" / "reseñas"
- `seeAll` — "See all on Google" / "Ver todas en Google"
- `readFull` — "Read on Google" / "Leer en Google"
- `anonymous` — "Anonymous" / "Anónimo"

**Staff settings — `settings.googleReviews.*`:**

- `title`, `subtitle`
- `placeIdLabel`, `placeIdHelp`, `placeIdFindLink`
- `minStarLabel`, `minStarHelp`
- `advancedSection`, `apiKeyLabel`, `apiKeyHelp`
- `testConnection`, `testSuccess`, `testFailed`
- `save`, `saveSuccess`
- `status.connected`, `status.pending`, `status.notConfigured`, `status.failed`
- `lastSyncAgo` — `"last sync {time} ago"` / `"última sinc. hace {time}"`

**Integrations hub — `settings.integrations.googleReviewsCard.*`:**

- Same shape as the existing eBay card entry (`label`, `notConnected`, `connected`, `manage`).

---

## 5. Edge cases (resolved)

| Case | Behavior |
|------|----------|
| Operator changes `place_id` | Cache row's `place_id` mismatches → next visitor triggers fresh fetch. Stale row with old place_id never served (mismatch check in `getCachedReviews`). |
| Operator sets min-star floor higher mid-day | No re-fetch needed. Filter is render-time over cached payload. Next page render reflects new floor. |
| Operator disables landing page (`public_landing_enabled=FALSE`) | Public route 404s (existing slice 1 behavior). Cache row untouched. Re-enabling brings reviews back from cache. |
| Place_id is for a permanently-closed business | Google still returns it with `business_status='CLOSED_PERMANENTLY'`. We do not filter on this; we trust the operator. |
| Reviews fetched, all have rating < floor | Filter returns empty array → `isWidgetRenderable` false → silent hide. Aggregate not shown either. |
| Two visitors hit a stale row simultaneously | Both see stale data instantly; both fire SWR refresh. Race is benign (last write wins, both writes are identical Google response). No lock needed. |
| Places API returns 429 (rate limit) | `client.ts` returns `{error: 'rate_limited'}`. `cache.ts` writes `last_error='rate_limited'` + bumps `last_error_at` but **does not overwrite** the cached payload. Stale data keeps serving. |
| Tenant deleted | `ON DELETE CASCADE` cleans up `tenant_google_reviews` row. |
| Operator pastes a Place ID with surrounding whitespace | Zod `.trim()` handles. |
| Operator pastes a maps.google.com URL instead of a Place ID | Zod accepts any non-empty string. The "Test connection" button surfaces "place_id not found" from Google. Operator iterates with the test button. |
| Two tenants share the same place_id (chain branches mistakenly using HQ's listing) | Each tenant gets its own cache row. Both fetch independently. No cross-tenant leak. |

---

## 6. Out of scope (future slices)

- **Cron warmer** — pre-populate stale rows before TTL expires. Gates on Phase 0 punch list. New file `src/app/api/cron/refresh-google-reviews/route.ts`. Same auth pattern as the other 5 cron routes.
- **Reviewer photos** — `next/image` `remotePatterns` for `lh3.googleusercontent.com`. Skipped v1; the text-only widget reads fine without them.
- **Review-reply workflow** — Google's Places API doesn't expose write-side replies; would require Google Business Profile API + OAuth. Future feature, separate slice.
- **Per-review hide list** — `settings.google_reviews_hidden_ids TEXT[]` if min-star floor proves insufficient. Easy add later.
- **Non-Google review sources** (Yelp, Facebook). Same widget shape, different cache table. Defer until tenant feedback says it's needed.
- **HQ rollup of branch reviews** for chain tenants. Each branch already has its own `settings.google_place_id`; HQ rollup is a future report.
- **Per-tenant API quota guardrails** — hard cap to prevent a misconfigured cache from blowing the platform free tier. Mitigation today: code-review cache logic + Google Cloud billing alerts. Future hardening pass.

---

## 7. Risks / honest limits

- **Aggregate-vs-filtered mismatch is real.** Min-star=4 with several recent 3-star reviews shows "4.7 ★ — 142 reviews" while only the 4+ star reviews are visible. A skeptical visitor can verify on Google. Decision 2 framed this as transparent and operator-tunable.
- **Google ToS surface.** Required attribution + link-out to Google are baked into the widget. We must not edit review text, must show reviewer name as supplied, must include "Read on Google" CTA per review. The spec wires all three.
- **Cache stampede on first launch.** ~10 tenants today, no concern. If/when scale matters, the cron warmer changes this.
- **No quota guardrail v1.** Platform API key has no per-tenant rate cap. Mitigation: code review + billing alerts. Hardening pass deferred.

---

## 8. Plan checklist preview

The implementation plan (writing-plans skill output) will sequence approximately:

1. Migration `0029-google-reviews.sql` + apply + regenerate types.
2. `src/lib/google-reviews/{types,filter,format}.ts` + tests.
3. `src/lib/google-reviews/client.ts`.
4. `src/lib/google-reviews/cache.ts` (`getCachedReviews`, `refreshReviews`, `loadPublicReviews`).
5. `lib/validations/google-reviews.ts` Zod schema.
6. `/settings/integrations/google-reviews/{page,content,actions}.tsx`.
7. `/settings/integrations` hub status card additions.
8. `tenant-resolver.ts` PublicTenant additions.
9. `src/components/public/GoogleReviewsWidget.tsx` + tests.
10. `(public)/s/[slug]/page.tsx` + `content.tsx` widget integration.
11. i18n keys EN+ES.
12. Manual smoke + final type-check + build.

Each step verified locally (lint + tsc + tests where applicable) before moving to the next.
