# Sol Pawn — build plan: tags, RFID, online store, feeds, wish list, commissions

Date: 2026-11-13. Status: approved by Eddy 2026-11-13 (all four open
decisions accepted as recommended). Phase 1 built (874e6fe, awaiting a real
printer/scanner test). Phase 2a built (patches/0075); live count not yet run.
Next: Phase 0.

This plan covers items 1, 2, 3, 4, 5 and 7 from the 2026-11-13 feature
discussion. Item 6 (gift cards) is left out on purpose. The item numbers are
kept as phase numbers so they match that conversation.

Each phase gets its own design spec and task plan under `docs/superpowers/`
when it is picked up, the same way the public catalog was built. This file is
the level above that: what each phase builds, what it reuses, what it must not
break, and how we know it is done.

---

## Order and dependencies

| Phase | What | Size | Needs first |
|---|---|---|---|
| 1 | Item tags with barcode | M | nothing |
| 2a | Count sessions (works with barcode alone) | M | Phase 1 |
| 2b | RFID encode and read | M | Phase 2a, hardware spike |
| 0 | Money prerequisites for online checkout | M | nothing (can run beside 1 and 2) |
| 3 | Online checkout on the existing catalog | L | Phase 0, Stripe setup (Progress item 454) |
| 4 | Product feeds (Google, Meta) | S | Phase 3 |
| 5 | Wish list and matching | M | nothing |
| 7 | Employee PIN sign-in and commissions | L | nothing, but the PIN part needs its own security spec |

Recommended sequence: 1, 2a, 0, 3, 4, 2b when hardware arrives, 5, 7.
Phase 5 is independent and can be pulled forward any time.

Sizes are relative to each other (S, M, L), not time estimates.

---

## Rules every phase follows

These come from CLAUDE.md and are repeated here because each one changes a
design choice below.

- **RLS (rule 1).** Every phase adds tables. Each new policy is shown to Eddy
  before it is applied. No existing policy is edited.
- **Public reads go through views** (decision from item 466). Anything the
  storefront or a feed reads is added to a `public_*` view, never an anon
  policy on a base table.
- **Money moves inside the database** (rule 19 and review section 2). Each
  new money movement is one Postgres function called by every path that can
  trigger it. Ledgers are append-only and written by triggers.
- **Money is `numeric(18,4)`**, rates `numeric(6,4)`.
- **Module flags in `settings`, off by default**, like `store_credit_enabled`.
  Turning a module off never hides an obligation that already exists.
- **Gating.** Pawn-only surfaces check `tenants.has_pawn`; store surfaces
  check `has_retail`.
- **Bilingual.** UI strings in `en.ts` and `es.ts`. Customer emails, texts
  and printed documents render in both languages.
- **Audit.** Every mutation writes `audit_log`.
- **Dates use the shop's timezone** (`tenants.timezone`), never UTC.
- **Storage stays private.** No public bucket, including for feed images.
- **Libraries.** One new dependency is expected (a barcode renderer, Phase 1).
  Anything else is flagged before it is added.
- **Migrations** continue from `0074`. `database.ts` is regenerated, never
  hand-edited.

---

## Phase 1 — Item tags with barcode

### What exists today
- Print routes cover loan, buy, repair, quote and sale. Nothing prints an
  inventory tag.
- Every inventory item already has a unique SKU (`INV-000001`), assigned by a
  database trigger. Tickets have `PT-`, `RT-`, `S-`, `L-`, `R-` numbers.
- Pledged items (`loan_collateral_items`) have no code of their own.
- The new-sale screen picks items from a loaded list. There is no scan field.

### What to build
1. **Label templates.** Table `label_templates` per tenant: name, tag stock
   (size and printable area), kind (`inventory`, `collateral`, `repair`),
   field layout, default flag. Seed three stocks: rat-tail jewelry tag,
   barbell tag, small rectangular label.
2. **One template, two renderers.** A pure function turns a template plus an
   item into (a) a PDF at exact label size through the existing
   `@react-pdf/renderer` pattern, and (b) ZPL text for Zebra-language
   printers. The PDF path works with any printer through its driver. The ZPL
   path is what Phase 2b extends to encode RFID, so it is built now, not
   later.
3. **Barcode payload** is the SKU. The collateral payload is the ticket
   number plus item position (`PT-000123-2`). Symbology is Code 128, with a
   2D code (DataMatrix) as an option for the smallest tags.
4. **Tag fields**: SKU, price, metal and karat, weight in grams, short
   description, stone summary. Optional coded cost, using a per-tenant letter
   code so the cost is on the tag but not readable by customers.
5. **Where it prints from**: item detail, bulk from the inventory list, and a
   prompt after the three moments an item becomes stock (new item saved,
   forfeiture, buy hold released). New column `inventory_items.tag_printed_at`
   gives the list a "needs tag" filter.
6. **Collateral and repair labels** from the pawn ticket and repair ticket
   pages, same route, different template kind.
7. **Scanning.** A barcode scanner types like a keyboard. Add an exact-match
   scan field to: new sale (adds the line), inventory list (opens the item),
   transfers (ticks the item off).
8. **Settings → Tags**: choose stock, edit the field layout, test print.

### Must not break
- Tags never print `cost_basis` in clear, consignor names, or anything about a
  pledgor.
- A collateral label carries the ticket number only, no customer name.

### New dependency
- A barcode renderer for the PDF path (candidate: `bwip-js`). ZPL draws its
  own barcodes and needs none.

### Open risk
- A ten-character SKU in Code 128 may be too wide to scan on a rat-tail tag.
  Print one and scan it before building the template editor. Fallback: encode
  the numeric `sku_number` only.

### Done when
- A tag printed from production scans into the new-sale screen and adds the
  right item.
- Bulk print of 50 items produces 50 tags in list order.
- The same item renders the same content in PDF and ZPL (unit test on the
  pure renderer).

---

## Phase 2 — Counts and RFID

Split in two so the counting workflow ships and earns its keep on barcode
before any RFID hardware is bought.

### Phase 2a — Count sessions (barcode or RFID)

#### What exists today
- No count, stock-take or audit tables.
- `inventory_items.location` (case, safe, vault, display, workshop, offsite,
  transfer) and free-text `shelf_location`.
- `inventory_transfers` and `inventory_transfer_items`.

#### What to build
1. **Tables**
   - `count_sessions`: tenant, kind (`inventory`, `vault`), scope (location,
     shelf, category), status, who started and closed it, totals.
   - `count_expected`: the snapshot of what should be there, taken when the
     session starts.
   - `count_reads`: each code seen, first-seen time, read count.
   - `count_exceptions`: one row per problem, with a resolution and who
     resolved it.
2. **One intake endpoint**, `POST /api/counts/{id}/reads`, that accepts a
   batch of codes. The scan page feeds it from a keyboard-style scanner now.
   An RFID reader or a companion app feeds the same endpoint later. The
   server does not care where reads come from.
3. **Vault audit (pawn shops).** Expected set is the collateral of every loan
   that is active, extended or partially paid. A missing pledged item is the
   most serious exception in the system: it alerts managers and cannot be
   closed without a note.
4. **Case count.** Expected set is available items in a location. Run at open
   and close.
5. **Exceptions the close screen reports**
   - Missing: expected, not seen.
   - Unexpected: seen, not expected (wrong location, or already sold or
     redeemed and still on the premises).
   - Held item in a sales location: a buy-hold item sitting in a case.
   - Sold during the count: reported separately so it is not counted missing.
6. **Transfers by scan**: scanning ships and receives the items on a
   transfer, and flags anything not on it.
7. **Reports**: count history and shrinkage per shop, rolled up at chain HQ.

#### Done when
- A vault audit on the live tenant lists every active loan's collateral and
  closes clean after all are scanned.
- Removing one item from the scan produces exactly one "missing" exception.

### Phase 2b — RFID

#### Hardware spike first (no code until this is answered)
Buy one RFID tag printer, one reader and a sample roll of jewelry RFID tags,
then answer in writing:
1. Does the printer encode the tag while printing it, driven by ZPL?
2. Can the reader deliver reads to a browser page with no install (keyboard
   mode), and how fast is that for a 300-item case?
3. If keyboard mode is too slow or unreliable, what does the vendor SDK need
   (Android, iOS, Windows)?
4. Read range and stray reads: does a count in one case pick up the case next
   to it?

I have not verified any specific printer or reader model. The spike is where
those claims get checked.

#### What to build after the spike
1. **Table `rfid_tags`**: tenant, tag ID (unique), what it is attached to
   (inventory item or collateral item), status (`active`, `retired`, `lost`),
   who encoded it and when.
2. **Tag ID scheme.** A private opaque ID. No customer, loan or price data is
   written to the chip, because anyone with a reader can read it.
3. **Encode on print**: the Phase 1 ZPL renderer gains the RFID write
   command, and the tag ID is stored in `rfid_tags` in the same action.
4. **Lifecycle**
   - Sold or redeemed: tag retired.
   - Forfeited: the collateral's tag is re-pointed to the new inventory item,
     so nothing is retagged.
   - A retired tag seen in a count is an "unexpected" exception.
5. **Reads resolve to items** in the Phase 2a endpoint, so every count,
   transfer and sale screen that takes a barcode takes a tag too.
6. **Companion app only if the spike says keyboard mode is not enough.** It
   would do one job: send read batches to the endpoint.
7. **Flag**: `settings.rfid_enabled`.

#### Done when
- A tag printed and encoded in one pass is found by a count session.
- A 300-item case count finishes without typing, and the result matches a
  barcode count of the same case.

---

## Phase 0 — Money prerequisites for online checkout

Online checkout is a third way to complete a sale, after the counter and the
card webhook. These review findings must be closed first, or the store
inherits them.

| Review # | Problem | Why the store needs it fixed |
|---|---|---|
| 13 | Two registers can sell the same item; `paid_total` is read, added to and written back | The website is now a second register that never sleeps |
| 12 | A layaway paid off online leaves the sale open | Same webhook the store will use |
| 11 | The webhook posts payments to closed loans | Same webhook |
| 16 | Amounts are not rounded to cents | Stripe charges in cents; totals must match exactly |
| 10 | Reports cut days at UTC | Online orders arrive at all hours |

Build: `sale_complete()` and `sale_add_payment()` as Postgres functions with
row locks, called by the staff action and the webhook. This is review
section 2, done for sales first.

Also required, and Eddy's to do: `STRIPE_WEBHOOK_SECRET` and the Stripe keys in
Vercel, and the Stripe Connect smoke test (Progress item 454).

---

## Phase 3 — Online checkout (the store builder)

### What exists today
- Public shop page at `/s/<slug>` with subdomain rewrite, a language toggle
  and Google Reviews.
- Browse-only catalog at `/s/<slug>/catalog` and `/catalog/<sku>`, reading
  `public_catalog_items`. An item shows only if it is available, priced, not
  hidden, and the shop has turned the catalog on.
- Stripe Connect per tenant. `createCheckoutSession` exists and is used for
  loan payoff and layaway payments.
- Photos are served by signed URLs that expire after one hour.
- Sales tax is typed by the clerk on each sale. There is no shop default.
- `status='held'` already has two meanings: a buy hold (`hold_until` set) and
  a layaway (`hold_until` null). The buy-hold release job depends on that
  difference.

### What to build

**Ordering**
1. **Cart** in the browser. Every piece is one of a kind, so quantity is
   always one.
2. **Tables** `online_orders` and `online_order_items`: order number,
   contact, pickup or ship, address, totals, status, Stripe session, link to
   the sale, expiry, public token for the order status page.
3. **Reserve at "Pay", in the database.** `online_order_reserve()` locks the
   items, confirms each is still in the public catalog view, and marks them
   reserved with a new column `inventory_items.reserved_order_id`. It must
   not reuse the buy-hold or layaway meaning of `held`.
4. **Reservation expires** with the Stripe session. The expiry webhook and a
   sweep job both release the items.
5. **Payment** through the existing Checkout Session path on the shop's
   connected account, with a new `stripe_payment_links.source_kind` of
   `online_order`.
6. **On payment**, one function `online_order_paid()` creates the sale, its
   lines and its payment, and completes it through `sale_complete()` from
   Phase 0. That is what makes consignment accrual, loyalty points and
   inventory status behave exactly as they do at the counter.
7. **New column `sales.channel`** (`counter`, `online`). Online sales stay
   out of the cash drawer and show as their own line on the daily register.

**Fulfilment**
8. **Staff queue** at `/pos/online-orders`: paid, picking, ready or shipped,
   completed. New-order alert on the dashboard and by text or email to the
   shop.
9. **Pickup**: ID check and signature at handover, reusing the repair pickup
   pattern.
10. **Shipping**: flat rate, free over an amount, signature required over an
    amount. Staff type the tracking number; label purchase is not in this
    phase.
11. **Messages**: order confirmation, ready for pickup, shipped. Three new
    `message_kind` values with EN and ES templates.
12. **Returns** go through the existing return flow against the original
    sale.

**Store builder**
13. **Shop settings**: default sales tax rate, shipping rules, return and
    shipping policy pages (card processors and Google both require them).
14. **Branding**: logo, hero image, accent colour, which sections show.
15. **Custom domain**: `tenants.custom_domain` with verification, and the
    proxy resolves the host to the tenant.
16. **Search engines**: per-shop sitemap, product structured data, share
    images.
17. **Customer record**: guest checkout, matched to an existing customer by
    email or phone, otherwise a new customer row in that tenant.

### Must not break
- Pledged collateral and held items can never be bought. The reserve function
  re-checks the public view; the page is not trusted.
- The consignment floor price trigger applies to online lines too.
- A banned customer matched by email or phone cannot check out.
- An item listed on eBay and sold online must end its eBay listing, and the
  reverse. I did not find where a counter sale ends an eBay listing today, so
  this is checked first.
- Sold items must leave the catalog at once; the view already does this.

### Decisions (approved by Eddy 2026-11-13)
1. **Tax when shipping out of state.** Version one charges the shop's rate
   for pickup and same-state shipping, nothing elsewhere, and tells each shop
   to ask their accountant about other states.
2. **Fraud limit.** Online card payments on jewelry attract stolen cards, and
   with Stripe Express a chargeback the shop cannot cover falls on RMS. Each
   shop has a maximum order amount for online card payment; above it the
   page offers "contact the store".

### Done when
- Two browsers try to buy the same ring: one pays, the other is told it is
  gone, and no second charge exists.
- An abandoned checkout releases the item within the expiry window.
- A paid online order for a consigned item accrues the consignor's payable.
- The daily register shows the online sale outside the cash count.

### Later, not in this phase
- Online layaway with a down payment.
- Buying shipping labels inside the app.
- Financing at checkout.

---

## Phase 4 — Product feeds

### What to build
1. **Feed URL per shop** at `/s/<slug>/feeds/products.xml`, in the format
   Google Merchant Center fetches on a schedule. Meta's catalog accepts the
   same file.
2. **Stable image URLs without a public bucket.** A route
   `/s/<slug>/img/<photo-id>` confirms the photo belongs to an item in the
   public view and serves it. The bucket stays private and the URL does not
   expire.
3. **Field mapping**: title, description, link, image, price, availability,
   condition (from `inventory_items.condition`), brand, category. Items are
   one of a kind, so they are declared as having no manufacturer barcode.
4. **Sold pages stay up.** A product page for a recently sold SKU shows
   "sold" with similar pieces. Feeds refresh daily, and a dead link gets a
   shop penalised.
5. **Settings**: turn the feed on, copy the URL, short setup instructions.

### Done when
- Google Merchant Center accepts the live tenant's feed with no item errors.
- An item sold at the counter is gone from the next feed fetch and its old
  link shows the sold page.

---

## Phase 5 — Wish list and matching

### What to build
1. **Table `customer_wants`**: customer, what they want (category, metal,
   karat, price range, size, stone notes, keywords), status, expiry, how to
   contact them.
2. **Table `customer_want_matches`**: want, item, status (`new`,
   `dismissed`, `notified`, `sold`).
3. **Matching runs when an item becomes available**: new stock saved, buy
   hold released, forfeiture, return restocked. Rule-based in a database
   function: category, metal, karat, price range, keywords.
4. **Staff decide, then the customer hears.** Matches land in a staff queue.
   "Notify customer" sends a bilingual message with the catalog link. Nothing
   sends on its own.
5. **Where a want is added**: the customer page, the new-sale screen
   ("couldn't find it?"), the portal, and a "Looking for something?" form on
   the public shop page that staff review before it becomes a want.
6. **Dashboard tile**: wants with new matches.
7. **Turn a want into a custom quote** when the answer is "we'll make it".
   Deposits stay inside the existing quote flow.

### Must not break
- Pledged collateral is never matched or offered. It is the customer's
  property until forfeiture.
- A bought item still in its hold can be shown to staff as "available on
  <date>" but not offered for sale.
- Customers with contact preference "none" are not messaged.

### Done when
- A want for "14k rope chain under $800" produces a match the moment a
  matching chain's buy hold is released.
- Dismissing a match does not bring it back on the next run.

---

## Phase 7 — Employee PIN sign-in and commissions

### What exists today
- Every staff member is a real Supabase user with a role in `user_tenants`.
- `sales.created_by` and `sale_payments.performed_by` record who acted. There
  is no salesperson field and no commission data.
- On a shared counter computer, whoever is logged in gets the credit and the
  blame.

### Part A — PIN sign-in

This changes how people log in, so it gets its own security spec and Eddy's
sign-off before any code.

Recommended design:
1. **A manager registers the device** as a counter. That sets a signed,
   revocable device cookie.
2. **Each employee sets a PIN**, stored hashed on `user_tenants`.
3. **PIN pad on a registered device.** The server checks device and PIN, then
   signs that employee in as themselves with a real session. The sign-in link
   is minted and used on the server and never shown, in line with the item
   466 decision that a sign-in link is a login.
4. **Because the session is the employee's own**, RLS, guards and the audit
   log work unchanged. No new role and no guard changes.
5. **Auto-lock** back to the PIN pad after a short idle time, and a "switch
   user" button.
6. **Limits**: lockout after five wrong PINs, device registration expires and
   can be revoked, and PIN sign-in is not offered to owners.

### Part B — Commissions

1. **Salesperson on the sale**: `sales.salesperson_id`, defaulting to whoever
   is signed in, changeable by a manager until the sale completes.
2. **`commission_plans`**: basis (sale total or gross profit), rate, which
   sale kinds count, category overrides, effective dates. Assigned per
   employee.
3. **`commission_events`**: an append-only ledger written by triggers when a
   sale completes, is returned or is voided. Same pattern as
   `consignment_payables`: reversals are new rows and are capped at what has
   not already been reversed.
4. **`commission_periods`**: close a pay period, lock it, export for payroll.
   A return after the period closed carries forward as a negative.
5. **Who sees what**: employees see their own; managers and owners see
   everyone's.
6. **Reports**: by employee and by period.

### Decisions (approved by Eddy 2026-11-13)
1. **Default basis is sale total**, not gross profit: gross profit depends on
   cost basis, and review finding 14 says forfeited items enter stock at
   estimated value, which would distort it.
2. **Layaways earn commission when the layaway completes**, not as payments
   come in.

### Done when
- Two clerks sell on the same computer in the same hour, and each sale, audit
  row and commission belongs to the right person.
- Five wrong PINs lock that employee out on that device.
- A returned sale produces a reversing commission row and the closed period's
  total does not change.

### Not in this phase
- Time clock and payroll. The app calculates commission; payroll pays it.

---

## What I checked and what I did not

Checked in the code on 2026-11-13: the print routes, SKU and ticket number
triggers, the public catalog views and their filters, how photos are signed,
the Stripe checkout helper and webhook source kinds, where sales tax comes
from, the two meanings of `held`, the guard functions, and the table and
column lists in `database.ts`.

Not checked:
- Any RFID printer, reader or tag. Phase 2b's spike exists for this.
- Whether a ten-character Code 128 scans on a rat-tail tag.
- Whether a counter sale ends an active eBay listing today.
- Google Merchant Center's current feed and policy requirements.
- Sales tax obligations for shipping to other states.
