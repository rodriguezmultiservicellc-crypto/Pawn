# Sol Pawn — Fixes + New Features Brief

Paste this into Claude Code from the root of the Sol Pawn repo.

---

You are working on **Sol Pawn**, our multi-tenant pawn + jewelry POS (production: https://pawn-three.vercel.app, current v0.7.0). Before changing anything, read the codebase to learn its stack, folder layout, data layer, migrations, i18n (EN/ES) and UI components. Follow the existing patterns. Do not add new frameworks or libraries unless a task can't be done without one; if you need one, say why first.

Work in the order below. After each phase, stop and give me a short summary: what changed, the migrations added, and how to test it. Every new screen must have both English and Spanish strings. Every money-moving or inventory-changing action must write to the audit log the same way existing actions do.

These features are inspired by another jeweler app we reviewed (JoyeroKit). Copy **ideas only**. Do not copy its code, text, branding or design.

---

## PHASE 0 — Bugs (do first)

### 0.1 Spot prices stopped updating
`/inventory/spot-prices` shows "Last fetched: 4/30/2026" (source: stooq). Every melt value and buy-outright payout is calculated from a 6-month-old price. Today 24K was about $125.56/g on another feed; Sol Pawn shows $148.52/g, so we are overpaying by about 18%.

- Find why the scheduled fetch stopped (cron not running, the stooq endpoint changed or is blocked, an API key expired, or the error is swallowed silently).
- Fix it, and add a **fallback provider** so one failing source doesn't freeze prices.
- Add a **stale-price guard**: if the newest price is older than 24 hours, show a red banner on Spot Prices, Buy Outright, New Pawn Ticket and the Loan Calculator, and require a manager to confirm before a buy or loan is issued from a stale price.
- Log every fetch, successful or failed, so we can see the history.
- Acceptance: the "Refresh now" button pulls a current price, the scheduled job runs on time, and the banner appears when you simulate a stale price.

### 0.2 18K multiplier label mismatch
On Spot Prices, the Gold 18K row shows a "×0.6000" badge, but its price ($111.39) is exactly 75% of 24K. Find out where the 0.6000 comes from (an old pay-rate override, a wrong purity constant, or a display bug). Fix it so the badge, the pay-rate override and the price used in melt calculations all agree. Check every karat and purity row for the same issue.

### 0.3 Developer text visible to staff
On **New pawn ticket** (`/pawn/new`):
- Remove the visible text "Default rate seeded by migration 0021. Edit at /settings/loan-rates."
- There is a rate option "24.96% — 111", which looks like test data. Show it to me before deleting it, in case it's in use.
- Search the whole app for other leftover dev/debug text shown in the UI and list what you find.

---

## PHASE 1 — Customer tracking link (repairs + custom work)

Customers keep calling to ask "is my piece ready?". Give each repair ticket a **public, read-only link** we can text or WhatsApp to the customer.

- Each repair ticket gets an unguessable public token. The URL must not contain the ticket number or customer ID.
- The public page shows:
  - store name and logo
  - ticket number and a description of the piece
  - a reference photo, if one is on file
  - the promised date
  - a **progress bar with named stages**
  - quoted total, payments made and balance due
  - the store phone number
- It must **never** show the customer's ID, address, other tickets or any internal notes.
- Stages are configurable per service type in Settings. Defaults:
  - **Repair/Sizing:** Received → Diagnosed/Quoted → Approved → In progress → Quality check → Ready for pickup → Picked up
  - **Custom piece:** Design → Design approved → Wax/3D print → Casting → Metal work → Stone setting → Finishing → Quality check → Ready for pickup → Delivered
- Moving a ticket to the next stage is one tap on the work-order board. Each stage has a % so the progress bar fills in.
- Add a "Copy link" button and a "Send by SMS" button on the ticket. SMS must reuse whatever `/settings/communications` already uses.
- Optional setting: automatically text the customer when the ticket reaches "Ready for pickup".
- Staff can revoke or regenerate a link.
- Acceptance: opening the link in a private window shows the correct stage and balance, with no login and no private data.

---

## PHASE 2 — Custom piece quoter (with live margin)

A quote builder for custom work: nameplates, rings, chains made to order. Later it will connect to our fiber-laser nameplate app.

Three steps: **The piece → The price → The payment.**

1. **The piece:** customer (pick an existing one or create new), category (ring, earrings, chain, bracelet, pendant, **nameplate**, grillz, other), description, size, reference photo.
2. **The price.** Each block can be skipped:
   - **Metal:** metal and karat × weight in grams, priced at **today's spot price** (the same source as Phase 0.1)
   - **Wax / 3D print:** flat cost
   - **Labor:** hours × rate, or a flat amount
   - **Stones and setting:** pick from inventory or enter by hand; quantity × cost, plus setting cost per stone
   - **Extra charges:** engraving, rush, packaging, shipping
3. **The payment:** deposit % (default set in Settings), balance due at pickup, payment method.

- A **sticky footer** stays visible on every step: `Total $X — you keep $Y — margin Z%`, recalculated live as fields change. Default margin is set in Settings; staff can override it per quote, but only down to a minimum margin a manager sets.
- Saving the quote freezes the metal price used, so the quote doesn't change when spot moves. Show "Priced at $___/g on [date]". Quotes expire after N days (set in Settings).
- An accepted quote turns into a repair/custom ticket with one tap (it then uses the Phase 1 stages and link). Recording the deposit goes through the existing POS payment flow.
- Quote PDF and public link: customer-facing, store branding, no cost breakdown unless the store turns that on in Settings.
- Hook for later: leave a clear way to fill **weight** from an outside source (the laser nameplate app) instead of typing it. Just the interface and a TODO; don't build the integration yet.

---

## PHASE 3 — Two-way metal counter (buy AND sell)

Right now Buy Outright only goes grams → payout, and only buys.

- On Buy Outright, for each item, staff can type **either grams or dollars** and the other fills in automatically, using that karat's pay-rate. Example: "Customer wants $300 for this 14K, how many grams is that?"
- Add a **Sell metal** mode: selling scrap or bullion to a customer or refiner at a configurable **sell rate** per karat (% over spot). This needs sell-rate settings next to the existing pay-rate overrides.
- Several karats in one transaction (already supported on buy; make sure sell supports it too). Show total grams and total dollars.
- Payment methods: cash, transfer, mixed.
- Buy transactions keep the existing 30-day hold and police-report row. Sell transactions must not create a police report but must hit the audit log and reports.

---

## PHASE 4 — Smaller items (one summary each when done)

### 4.1 Bench calculators page (`/tools` or similar)
Pure calculators, no database writes, except saving recent calculations per user:
- Ring size converter: US ↔ Mexico ↔ EU ↔ Japan ↔ inside diameter in mm
- Weight units: grams ↔ pennyweight (dwt) ↔ troy oz ↔ avoirdupois oz
- Alloy down: how much alloy to add to bring X grams of a higher karat down to a target karat
- Raise karat: how much fine gold to add to bring a lot up to a target karat
- Mix lots: combine several lots of different karats; show the resulting karat and fine-gold content
- Melt/payout quick calc using today's spot price and our pay-rates

Show the formulas in a small "how this is calculated" note so staff can check them. Write unit tests for every formula.

### 4.2 Inventory item fields
Add these to inventory items, with migrations, the edit form and filters:
- condition: New / Used / Restored / Vintage / Antique
- **coating:** None / Gold plated / Gold filled / Vermeil / PVD — also show this field on Buy Outright and New Pawn Ticket. When it's anything other than None, show a warning that it is **not solid gold** and leave it out of melt value.
- finish: polished, matte, brushed, hammered, diamond-cut, rhodium, etc.
- shelf location
- legacy code (the item's code in the old system)
- wholesale price, separate from retail
- **auto SKU** built from category + metal + sequence when the SKU is left blank
- "Suggest price" button: cost + target margin from Settings

### 4.3 Collections view (layaway, repair balances, overdue loans)
One screen listing everyone who owes us money, from all sources: pawn loans past due, layaway balances, unpaid repair balances.
- Aging buckets: On time / Slightly late (1–7 days) / Very late (8–30) / Urgent (30+). Make the day ranges configurable.
- KPIs: total owed, % overdue, average days to collect, % of promised payments kept, top 5 customers by balance owed.
- From each row: call, text, or record a payment through the existing flow.

### 4.4 Dashboard additions
- Live metals strip: gold, silver, platinum and palladium per gram, with % change and the time of the last update. Red if stale (ties to 0.1).
- "Today" card: repairs promised today, pickups ready, loans due today.
- Low-stock card, if inventory has quantity/reorder fields; skip it if not.

---

## Not now (backlog, don't build)
- AI gem identification from a photo → inventory
- AI product photos for eBay listings
- Expense tracking, P&L and cash flow (first check what `/reports` already covers and tell me)

## Ground rules
- Don't touch pawn interest math, Florida 30-day term logic, police-report output, or 1099 logic, except where a task above says to.
- Keep everything tenant-scoped like the existing tables. No cross-tenant reads, and the public tracking page must resolve the tenant from the token only.
- Don't deploy to production. Leave changes on a branch, with a migration list and a test checklist for each phase.
