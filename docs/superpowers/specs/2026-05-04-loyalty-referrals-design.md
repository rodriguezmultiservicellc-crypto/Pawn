# Loyalty + Referrals — Design

- **Date:** 2026-05-04
- **Phase:** 10 Path A, slice 3 (continuation of Session 19's tenant landing + Session 20's public catalog)
- **Owner:** Eddy Rodriguez (RMS)
- **Status:** Approved for implementation

## What we're building

A per-tenant customer-loyalty + referral system. Customers earn points on retail sales and loan interest paid; can redeem points at point-of-sale as a dollar discount; can refer friends via a 6-char code and earn a flat bonus when their referred friend first transacts. Customer-portal surface shows balance, earn rules, share code, and activity log. Per-tenant opt-in with configurable earn / redemption / referral rates.

## Decisions locked during brainstorming

| # | Decision | Pick |
|---|----------|------|
| 1 | Earning model | Points wallet (denormalized balance + events log). Conversion to dollar discount at redemption, not stored credit |
| 2 | Earning events | Retail sales + loan interest paid. Repair tickets and layaway payments deferred |
| 3 | Referral attribution | On referred customer's first qualifying transaction (sale or loan redemption). Single attribution event |
| 4 | Redemption flow | Cashier-driven on the open sale. Points → discount applied to existing `sales.discount_amount`. No new tender type |
| 5a | Gate + config location | All in `settings` table. `loyalty_enabled` flag + 4 numeric config columns |
| 5b | Earning scope | Forward-only — no historical backfill |
| 5c | Manual adjustments | Yes, manager+ only, with required reason. Audit-logged |
| Arch | Balance maintenance | Materialized `customers.loyalty_points_balance` column + AFTER INSERT trigger on `loyalty_events` |
| Arch | Referral code shape | 6-char A-Z + digits 2-9 (no I/O/0/1). Per-tenant unique. Random generation, no friendly slugs |
| Arch | Idempotency | UNIQUE index on `(customer_id, source_kind, source_id, kind)` for the auto-credit kinds; manual + redeem events not idempotent-keyed |

---

## 1. Database

### 1.1 New columns on `customers`

```sql
ALTER TABLE customers
  ADD COLUMN loyalty_points_balance INTEGER NOT NULL DEFAULT 0
    CHECK (loyalty_points_balance >= 0),
  ADD COLUMN referral_code TEXT,
  ADD COLUMN referred_by_customer_id UUID
    REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN referral_credited BOOLEAN NOT NULL DEFAULT FALSE;
```

`referral_credited` flips TRUE the first time a referrer's bonus is awarded for this referred customer; prevents double-credit on subsequent qualifying transactions.

`CHECK (loyalty_points_balance >= 0)` is the safety net — if the trigger or app code ever tries to take a balance below zero, the constraint blocks it and the parent transaction rolls back.

### 1.2 New columns on `settings`

```sql
ALTER TABLE settings
  ADD COLUMN loyalty_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN loyalty_earn_rate_retail NUMERIC(8,4) NOT NULL DEFAULT 1,
  ADD COLUMN loyalty_earn_rate_loan_interest NUMERIC(8,4) NOT NULL DEFAULT 1,
  ADD COLUMN loyalty_redemption_rate NUMERIC(8,4) NOT NULL DEFAULT 100,
  ADD COLUMN loyalty_referral_bonus INTEGER NOT NULL DEFAULT 500;
```

- `loyalty_earn_rate_retail` — points awarded per $1 of sale subtotal
- `loyalty_earn_rate_loan_interest` — points awarded per $1 of interest paid
- `loyalty_redemption_rate` — points required per $1 of discount (default 100 → "1 point = $0.01")
- `loyalty_referral_bonus` — flat points awarded to referrer on referred customer's first qualifying transaction

### 1.3 New table `loyalty_events`

```sql
CREATE TABLE loyalty_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN (
    'earn_sale',
    'earn_loan_interest',
    'earn_referral_bonus',
    'redeem_pos',
    'adjust_manual'
  )),
  points_delta  INTEGER NOT NULL,    -- positive=earn, negative=redeem/adjust-down
  source_kind   TEXT,                -- 'sale' | 'loan_event' | 'referral' | 'manual' | NULL
  source_id     UUID,                -- not FK'd; lets the row outlive its source
  reason        TEXT,                -- required for adjust_manual
  performed_by  UUID REFERENCES auth.users(id),  -- nullable for trigger-driven events
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loyalty_events_customer_created
  ON loyalty_events (customer_id, created_at DESC);
CREATE INDEX idx_loyalty_events_tenant
  ON loyalty_events (tenant_id);
```

### 1.4 Idempotency index

```sql
CREATE UNIQUE INDEX loyalty_events_idempotency
  ON loyalty_events (customer_id, source_kind, source_id, kind)
  WHERE source_kind IS NOT NULL
    AND source_id IS NOT NULL
    AND kind IN ('earn_sale','earn_loan_interest','earn_referral_bonus');
```

Partial unique on the auto-credit kinds only. Manual adjustments and redemptions can run multiple times against the same source (e.g., undo + retry redemption on the same open sale) without colliding.

### 1.5 Referral-code uniqueness

```sql
CREATE UNIQUE INDEX customers_referral_code_unique
  ON customers (tenant_id, referral_code)
  WHERE referral_code IS NOT NULL;
```

Per-tenant uniqueness. Multiple tenants can each have a customer with code `XF4P9Q` — they're scoped per shop.

### 1.6 Balance-maintenance trigger

```sql
CREATE OR REPLACE FUNCTION loyalty_events_apply_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE customers
     SET loyalty_points_balance = loyalty_points_balance + NEW.points_delta,
         updated_at = NOW()
   WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_loyalty_events_apply_balance
  AFTER INSERT ON loyalty_events
  FOR EACH ROW EXECUTE FUNCTION loyalty_events_apply_balance();
```

`SECURITY DEFINER` + locked `search_path` per the project's Session 9 rule for trigger-driven mutations on tenant-scoped tables.

### 1.7 RLS

- `loyalty_events`: staff SELECT/INSERT in their tenant via existing `my_tenant_ids()` helper. Mirrors the `audit_log` pattern. No public-read in v1.
- New columns on `customers` and `settings` inherit existing tenant-scoped policies — no policy changes needed.
- Customer portal sees their own loyalty events via the existing portal policy on `customers` (auth.user has a `client` row in `user_tenants` matching the customer's tenant).

### 1.8 Migration

- Single new patch: `patches/0028-loyalty-referrals.sql`
- Documented rollback (DROP POLICY x N, DROP TRIGGER, DROP FUNCTION, DROP INDEX x M, DROP TABLE loyalty_events, DROP COLUMN x N from settings + customers)
- No backfill — `loyalty_points_balance` defaults to 0 for existing customers (Question 5b)

---

## 2. Integration hooks

All earning hooks gate on `settings.loyalty_enabled = TRUE`. Off → no-op.

### 2.1 `completeSaleAction` (`src/app/(staff)/pos/sales/[id]/actions.ts`)

After the existing `sales.status='completed'` update:

```ts
if (settings.loyalty_enabled && sale.customer_id) {
  await recordEarnSale({
    admin, tenantId, customerId: sale.customer_id,
    saleId: sale.id, subtotal: sale.subtotal,
    rate: settings.loyalty_earn_rate_retail,
  })
  await maybeCreditReferral({
    admin, tenantId, customerId: sale.customer_id,
    bonusPoints: settings.loyalty_referral_bonus,
  })
}
```

`subtotal` (not `total`) so points don't pay on tax. Anonymous walk-in sales (`customer_id IS NULL`) earn nothing.

### 2.2 `redeemLoanAction` and partial-payment actions (`src/app/(staff)/pawn/[id]/actions.ts`)

After the `loan_events` insert that records `interest_paid > 0`:

```ts
if (settings.loyalty_enabled && loan.customer_id && interest_paid > 0) {
  await recordEarnLoanInterest({
    admin, tenantId, customerId: loan.customer_id,
    loanEventId: insertedLoanEvent.id,
    interestPaid: interest_paid,
    rate: settings.loyalty_earn_rate_loan_interest,
  })
  await maybeCreditReferral({
    admin, tenantId, customerId: loan.customer_id,
    bonusPoints: settings.loyalty_referral_bonus,
  })
}
```

Idempotency keys on `loan_event_id`, so partial payments each earn correctly without double-crediting.

### 2.3 `maybeCreditReferral` helper

Central referral logic:

```ts
async function maybeCreditReferral(args) {
  const customer = await args.admin.from('customers')
    .select('referred_by_customer_id, referral_credited')
    .eq('id', args.customerId).maybeSingle()
  if (!customer?.referred_by_customer_id || customer.referral_credited) return

  await args.admin.from('loyalty_events').insert({
    tenant_id: args.tenantId,
    customer_id: customer.referred_by_customer_id,
    kind: 'earn_referral_bonus',
    points_delta: args.bonusPoints,
    source_kind: 'referral',
    source_id: args.customerId,
  })
  await args.admin.from('customers')
    .update({ referral_credited: true })
    .eq('id', args.customerId)
}
```

The unique-index on `(customer_id, source_kind, source_id, kind)` blocks duplicate inserts even if the flag flip races with a second action call. `referral_credited` is the optimistic short-circuit; the index is the durable guarantee.

### 2.4 `redeemPointsOnSaleAction` (NEW in `src/app/(staff)/pos/sales/[id]/actions.ts`)

Staff-driven on the open sale screen.

```ts
// formData: sale_id, points_to_redeem
// 1. Validate sale is 'open' AND has customer_id
// 2. Resolve current balance via SELECT customers.loyalty_points_balance
// 3. Validate balance >= points_to_redeem
// 4. Convert: discount = points / settings.loyalty_redemption_rate (rounded to 2dp)
// 5. Cap discount at sale.subtotal - sale.discount (no negative totals,
//    no exceeding what's left to discount)
// 6. UPDATE sales SET discount = discount + new_discount,
//                     total = subtotal - discount + tax
// 7. INSERT loyalty_events kind='redeem_pos', points_delta = -points_to_redeem,
//    source_kind='sale', source_id=sale.id, performed_by=userId
// 8. Trigger fires → balance decreases atomically
// 9. Audit-log the action
```

The `CHECK (loyalty_points_balance >= 0)` constraint is the safety net if app validation misses something — the trigger update fails, the entire transaction rolls back, the redemption fails cleanly with no half-state.

### 2.5 `undoRedemptionAction` (NEW)

Available while sale is still `open`.

```ts
// formData: loyalty_event_id (must be kind='redeem_pos' on this sale)
// 1. Resolve sale + event, ensure sale.status='open'
// 2. Compute discount that this event applied (points / rate)
// 3. UPDATE sales SET discount = discount - this_amount, total recomputed
// 4. DELETE loyalty_events row
//    (trigger doesn't fire on DELETE — handle balance via app code:
//     UPDATE customers SET loyalty_points_balance = balance - points_delta
//     since points_delta is negative, balance goes back up)
//    Alternatively: insert a compensating loyalty_events row with
//    points_delta = +abs(original) and kind='adjust_manual' reason='undo_redemption'.
//    DECISION: insert compensating row, never delete events.
//    Keeps the audit trail intact and the balance trigger-driven.
// 5. Audit-log
```

**Decision locked**: never delete `loyalty_events` rows. Undo writes a compensating `adjust_manual` row with `reason='undo_redemption'` and a positive delta. Audit trail stays complete; balance maintenance stays trigger-driven.

### 2.6 `adjustLoyaltyPointsAction` (NEW in `src/app/(staff)/customers/[id]/actions.ts`)

```ts
// formData: customer_id, delta (signed integer), reason (>=3 chars, required)
// requireRoleInTenant(['owner','chain_admin','manager']) — manager+
// INSERT loyalty_events kind='adjust_manual', points_delta=delta, reason,
//   performed_by=userId, source_kind=null, source_id=null.
// Trigger updates balance. CHECK constraint blocks adjustments
// that would take balance negative — surfaces as a server-action error
// with a friendly message.
// Audit-log.
```

### 2.7 `ensureReferralCode` helper

Lazy generation. Called when:
- Customer detail page renders the loyalty panel (staff)
- Customer portal renders `/portal/loyalty`
- Operator clicks "Reset code"

```ts
async function ensureReferralCode(admin, tenantId, customerId): Promise<string> {
  const existing = await admin.from('customers')
    .select('referral_code').eq('id', customerId).single()
  if (existing.referral_code) return existing.referral_code

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode(Math.random)
    const { error } = await admin.from('customers')
      .update({ referral_code: code })
      .eq('id', customerId)
    if (!error) return code
    // UNIQUE collision → retry
  }
  throw new Error('referral_code_generation_failed_after_5_attempts')
}
```

Idempotent — returns the existing code if one is set. Generator (`generateReferralCode`) is pure and tested in isolation.

### 2.8 `applyReferredByCode` (NEW helper, used in `/customers/new` action)

Optional `referred_by_code` field on the customer-create form. If present, the action looks up the referrer by code:

```ts
if (formData.referred_by_code) {
  const code = formData.referred_by_code.trim().toUpperCase()
  const referrer = await admin.from('customers')
    .select('id').eq('tenant_id', tenantId).eq('referral_code', code)
    .maybeSingle()
  if (referrer) {
    await admin.from('customers')
      .update({ referred_by_customer_id: referrer.id })
      .eq('id', newCustomerId)
  }
  // Silent no-op if code doesn't match — staff can correct later via
  // the customer detail page if needed. Don't block customer creation.
}
```

---

## 3. Staff UX

### 3.1 `/customers/[id]` loyalty panel

New panel rendered in the customer detail page.

**When `settings.loyalty_enabled = TRUE`:**

- **Big number**: `{loyalty_points_balance}` points
- **Subtitle**: "≈ ${balance / redemption_rate} in store credit"
- **Referral code row**: 6-char code in mono + Copy button + Reset button (manager+, generates a new code, invalidates the old one for any future signups; existing referrals already credited stay)
- **Last 5 events**: kind label, points delta, date — with a "View all" link
- **Adjust points button** (manager+) → modal with `delta` signed integer + `reason` textarea (≥3 chars) → calls `adjustLoyaltyPointsAction`

**When `settings.loyalty_enabled = FALSE`:**

Single muted line: "Loyalty disabled for this shop. Enable in /settings/loyalty." No balance, no buttons.

**When customer `is_banned = TRUE`:**

Panel still shows balance but disables Adjust + Reset buttons.

### 3.2 `/pos/sales/[id]` redemption block

Below the totals block on the open-sale page.

**Visible only when:**
- `settings.loyalty_enabled = TRUE`
- `sale.customer_id IS NOT NULL`
- `sale.status = 'open'`
- Customer's `loyalty_points_balance > 0`

**Render:**
- "{customer_first_name} has {balance} points (≈ ${balance / rate})"
- Number input "Redeem ___ points" (max=balance, step=1)
- Inline preview "→ ${preview} discount applied"
- "Apply redemption" button → `redeemPointsOnSaleAction`

**After successful redemption:**
- Confirmation row "Redeemed {points} for ${discount}"
- "Undo" button → `undoRedemptionAction` (only available while sale still `open`)

Multiple redemptions on one sale are supported — each is a separate `loyalty_events` row keyed only by `(customer_id, source_kind='sale', source_id=sale.id, kind='redeem_pos')` which is **not** in the idempotency partial index, so duplicates are allowed.

### 3.3 `/settings/loyalty` (NEW)

Owner / chain_admin only. Single form.

**Fields:**
- Enable loyalty for this shop (checkbox)
- Earn rate — retail sales: points per $1 of subtotal (default 1)
- Earn rate — loan interest: points per $1 of interest paid (default 1)
- Redemption rate: points per $1 of discount (default 100 → "1 point = $0.01")
- Referral bonus: flat points to referrer on referred customer's first qualifying transaction (default 500)

When `loyalty_enabled` is OFF, the four numeric inputs render disabled with a muted hint "Enable loyalty above to configure rates."

`revalidatePath` on save: `/settings`, `/settings/loyalty`, `/customers` (list page), and `/portal/loyalty` (the portal page renders depend on the flag). Customer detail pages aren't individually revalidated — Next will fetch fresh on next request since they're dynamic by default; the cost of stale staff-side detail-page renders for a few seconds after a flag flip is acceptable.

### 3.4 Sidebar nav

New nav item under the Settings group: **Loyalty**. Links to `/settings/loyalty`. Icon: `Trophy` from Phosphor (client component only per project rules).

### 3.5 `/customers/new` form addition

New optional field "Referred by code" with a 6-char text input + helper text "Customer was referred by another customer? Enter their code (optional)." Action wires through `applyReferredByCode`.

---

## 4. Customer portal UX

### 4.1 `/portal/loyalty` (NEW)

Sits alongside `/portal/loans`, `/portal/repairs`, `/portal/layaways`, `/portal/account`.

**Render only when** `settings.loyalty_enabled = TRUE` for the customer's tenant. Otherwise the nav item is hidden and direct navigation 404s.

**Page structure:**

**Hero block:**
- Big number `{balance}` points
- Subtitle "≈ ${balance / redemption_rate} in store credit at {tenant_dba}"
- Tagline copy "Earn points on every retail purchase and loan redemption. Redeem next time you visit."

**Earn rules card:**
- "How you earn:" lines pulled from `settings`:
  - "{earn_rate_retail} pt per $1 on retail purchases"
  - "{earn_rate_loan_interest} pt per $1 on loan interest paid"
  - "{referral_bonus} pts when a friend you refer makes their first purchase or loan redemption"
- "How you redeem:" "Show this code at checkout next time. Your cashier can apply your points as a discount."

**Refer-a-friend card:**
- Customer's referral code in mono: `XF4P9Q`
- Copy button (writes to clipboard)
- Pre-built share text: "Hi! Use my code XF4P9Q at {tenant_name} so we both get points: {tenant_landing_url}"
- Three share buttons: SMS (mobile native share or `sms:?body=`), WhatsApp (`https://wa.me/?text=`), Email (mailto with prefilled body)
- "{count} friends have used your code so far" — pulls from `customers WHERE referred_by_customer_id = me`

**Activity log:**
- Last 20 loyalty events (date, kind label from i18n, +/- delta, optional source description)
- No "View all" link in v1 — the inline 20 covers expected use; full paginated history at `/portal/loyalty/history` is deferred (see §7)

### 4.2 Bilingual

New `loyalty.*` block in `en.ts`/`es.ts`, ~25 keys. Customer-facing labels for:
- hero subtitle, point count formatting
- earn rule lines (with placeholders for rates)
- refer-a-friend card copy + share messages
- activity event kind labels (5 kinds + their formatted lines)
- empty states

### 4.3 Self-service portal signup

Out of scope for v1. Portal is gated on existing customer status — to use it, the customer must already have a record (created by staff at first transaction) and a claimed portal invite. Anonymous "sign up to start earning" requires a magic-link onboarding flow that doesn't exist.

### 4.4 Public landing CTA

No new public-facing CTA in v1. The `/s/<slug>` landing keeps its existing CTAs. A "Refer a friend" or "Sign up for rewards" public CTA could land later but adds onboarding flow we're not building.

---

## 5. i18n

### 5.1 New `loyalty.*` block (EN + ES at parity)

Customer-facing portal labels. ~25 keys:

```ts
loyalty: {
  // hero
  title,                      // "Loyalty"
  yourPoints,                 // "Your points"
  storeCreditEquiv,           // "≈ ${value} in store credit at {tenant}"
  heroSubtitle,               // "Earn points on every retail purchase and loan redemption. Redeem next time you visit."

  // earn rules
  howYouEarn,                 // "How you earn"
  earnRetail,                 // "{rate} pt per $1 on retail purchases"
  earnLoanInterest,           // "{rate} pt per $1 on loan interest paid"
  earnReferral,               // "{bonus} pts when a friend you refer makes their first purchase or loan redemption"
  howYouRedeem,               // "How you redeem"
  redemptionInstructions,     // "Show this code at checkout next time. Your cashier can apply your points as a discount."

  // refer-a-friend
  referAFriend,               // "Refer a friend"
  yourCode,                   // "Your code"
  copyCode,                   // "Copy"
  copied,                     // "Copied!"
  shareTextTemplate,          // "Hi! Use my code {code} at {tenant} so we both get points: {url}"
  shareSms,                   // "SMS"
  shareWhatsapp,              // "WhatsApp"
  shareEmail,                 // "Email"
  friendsReferred,            // "{count} friends have used your code so far"
  friendsReferredZero,        // "Share your code to start earning referrals"

  // activity log
  activity,                   // "Activity"
  emptyActivity,              // "No activity yet. Earn your first points on your next visit!"
  viewHistory,                // "View all activity"

  // event kind labels
  kinds: {
    earn_sale,                // "Retail purchase"
    earn_loan_interest,       // "Loan interest"
    earn_referral_bonus,      // "Referral bonus"
    redeem_pos,               // "Redeemed at checkout"
    adjust_manual,            // "Adjustment"
  },
}
```

### 5.2 Staff-form labels stay hardcoded English

Per Sessions 19-20 pattern. `/settings/loyalty` form, customer-detail loyalty panel, POS redemption block, and adjust modal use English literals. Staff form i18n is a separate sweep.

---

## 6. Testing

Pure-logic only (vitest run via `npm test`), same scope policy as Session 13 onward.

### 6.1 New file: `src/lib/loyalty/math.test.ts`

**Module under test**: `src/lib/loyalty/math.ts`. Pure functions only — no DB, no Supabase, no React.

**Module exports:**

```ts
export function computeRetailEarn(subtotal: number, rate: number): number
export function computeLoanInterestEarn(interest: number, rate: number): number
export function computeRedemptionDiscount(args: {
  points: number
  rate: number          // pts per $1
  saleSubtotal: number
  alreadyDiscounted: number
}): { discount: number; pointsConsumed: number }
export function generateReferralCode(rng: () => number): string
export function canApplyAdjustment(currentBalance: number, delta: number): boolean
export function isValidReferralCode(code: string): boolean
```

**Tests (~18):**

- **`computeRetailEarn`** (4 tests): floor on fractional points (5.7 → 5); zero on $0 sale; zero on negative subtotal (defensive); non-integer rates (1.5 pts/$1 → 30 pts on $20)
- **`computeLoanInterestEarn`** (3 tests): same shape; zero on $0 interest; integer floor
- **`computeRedemptionDiscount`** (5 tests): standard rate (100 pts = $1); cap when discount exceeds remaining-to-discount ($30 sale + $5 already discounted, asks for $50 discount → returns $25 + adjusts pointsConsumed); zero points → zero discount + zero consumed; very high rate (1 pt = $1); fractional discount rounds to 2dp
- **`generateReferralCode`** (3 tests): 6 chars; only A-Z + digits 2-9 (no I/O/0/1); deterministic given seeded RNG
- **`canApplyAdjustment`** (2 tests): blocks delta that would take balance below zero; allows delta that exactly hits zero
- **`isValidReferralCode`** (1 test): accepts valid 6-char codes, rejects strings with bad chars, wrong length, lowercase

### 6.2 Verification before claiming done

- `npm run lint` clean
- `npm test` — current 342, expected ~360 after this slice
- `npm run build` green (covers typecheck + production bundle)

### 6.3 Operator smoke test (post-implementation)

1. `/settings/loyalty` (owner) — tick **Enable loyalty**, save. Customer detail page now shows a loyalty panel with 0 points.
2. Create a $100 retail sale for a customer, complete it. Customer balance jumps to 100 points.
3. Visit `/portal/loyalty` as the customer (after staff issues a portal invite + customer claims) — confirm balance + earn rules + share code render.
4. Adjust points manually (+50 with reason "birthday gift"). Balance = 150, event log shows the adjustment with reason.
5. Open a new $20 sale for the same customer. Apply 1000 points (= $10). `sale.discount` jumps to $10, `sale.total` drops by $10, balance drops to 50.
6. Click "Undo" — balance restored to 150 (compensating event row inserted), `sale.discount` back to 0.
7. Create another customer with `referred_by` code matching first customer's `referral_code`. Complete a sale for them. First customer's balance jumps by `loyalty_referral_bonus` (500 → 650).
8. Complete a SECOND sale for the referred customer. First customer's balance does NOT double-credit (referral_credited flag held).
9. Toggle `loyalty_enabled = FALSE` in `/settings/loyalty`. Portal `/loyalty` 404s, customer detail panel hides, no new earning events fire on subsequent transactions. Existing balances persist (just not displayed).

---

## 7. Out of scope (deferred)

Listed explicitly so they don't sneak in:

- **Reward catalog / tiered rewards** — fixed-cost rewards table ("$5 off costs 500 pts"). Phase 11+ if tenants want curated programs.
- **Self-service portal signup** — anonymous customers signing up via portal to start earning. Requires magic-link onboarding flow that doesn't exist.
- **Cross-shop loyalty rollup** for chains — each shop's loyalty stays separate.
- **Point expiration** (e.g., points expire 12 months after issue).
- **Tier bonuses** (silver/gold/platinum customers earn at multipliers).
- **Birthday auto-reward** cron.
- **Referral leaderboard** in the portal.
- **Earning on repair tickets and layaway payments** — pinned no by Question 2.
- **Earning on loan-events that aren't payment/redemption** (e.g., extension fees would be revenue but defer).
- **Auto-apply max points** on every sale — pinned no by Question 4.
- **Public-facing "join our rewards" CTA** on the landing page — pinned no.
- **Marketing campaign auto-emails** ("you have N points expiring soon!") — gates on per-tenant Resend onboarding.
- **`/portal/loyalty/history` full paginated page** — inline 20 events on the main loyalty page is enough for v1; defer the dedicated history route until users ask.

---

## 8. Migration sequencing for the implementation session

Single-PR slice, single-session, single-commit-via-`/progress`:

1. Write `patches/0028-loyalty-referrals.sql` (columns + table + indexes + trigger + RLS + rollback)
2. Operator applies patch in Supabase, then runs `npm run db:types`
3. Add `src/lib/loyalty/math.ts` + `src/lib/loyalty/math.test.ts` (TDD)
4. Add `src/lib/loyalty/events.ts` (helpers: `recordEarnSale`, `recordEarnLoanInterest`, `maybeCreditReferral`, `recordRedemption`, `recordUndoRedemption`, `recordManualAdjust`, `ensureReferralCode`, `applyReferredByCode`)
5. Hook `completeSaleAction` + `redeemLoanAction` (and any partial-payment action that records `interest_paid > 0`) into the helpers, gated on `settings.loyalty_enabled`
6. Build `/settings/loyalty` page + form + action
7. Build `/customers/[id]` loyalty panel + Adjust modal + adjustLoyaltyPointsAction
8. Build POS sale loyalty redemption block + `redeemPointsOnSaleAction` + Undo
9. Build `/portal/loyalty` page (hero + earn rules + share + activity)
10. Add "Referred by code" field to `/customers/new` form + action wiring
11. Add `loyalty.*` i18n block (EN+ES at parity)
12. Sidebar nav entry under Settings group
13. `npm run lint && npm test && npm run build` green
14. Operator runs smoke test (§6.3)
15. End-of-session `/progress` — single commit + push, Vercel auto-deploys
