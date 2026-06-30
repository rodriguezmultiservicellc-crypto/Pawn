# Handoff Brief — POS "New Sale" Redesign (Pawn module)

**Route:** `/pos/sales/new`
**Deployment:** `pawn-three.vercel.app`
**Stack:** Next.js 16 / React 19 / TS 5 / Tailwind v4 / Supabase (raw SQL)
**Reference mockup:** `pos-new-sale.html` (interactive — scan, steppers, discount toggle, tax chip, tender, live total all functional). Treat it as the visual + behavioral source of truth, not the code source.

---

## 1. Objective

Replace the current single-column stacked layout with a **two-pane layout**: a left **work surface** (item entry + line items) and a right **sticky checkout rail** (customer, money math, tender, charge). The cart and the running total/charge action must be visible simultaneously without scrolling at 1280×800 and up. Below the breakpoint, panes stack with the rail collapsing to a bottom-anchored summary.

The redesign is layout + interaction only. Do not change the underlying sale/inventory data model except where Section 6 calls out new fields — and confirm those against the existing schema before adding.

---

## 2. Layout & component tree

```
<NewSalePage>
├─ <PosTopBar>            back link · "New sale" · register indicator · cashier
├─ <SaleWorkSurface>      (left, flex column)
│   ├─ <ScanBar>          hero search/scan input
│   ├─ <QuickActions>     Add item · Add custom line · Clear
│   └─ <LineItemList>
│       └─ <LineItemRow>  name/sku · qty stepper · line total · remove
└─ <CheckoutRail>         (right, sticky)
    ├─ <CustomerCard>
    ├─ <OrderSummary>     subtotal · discount control · tax chip · total
    ├─ <TenderSelector>   cash · card · split
    ├─ <ChargeButton>     full-width, carries live total
    └─ <SecondaryActions> save as layaway · hold · add note
```

Grid: `1fr 380px`, 18px gap, on desktop. Single column under ~980px; rail moves below the work surface and the total + charge button pin to the bottom of the viewport.

---

## 3. Component specs

### ScanBar (hero)
- Single text input, autofocused on mount and **refocused after every add** so a barcode gun (keystrokes + Enter) works hands-free.
- **Enter** resolves the value: exact SKU/barcode match → add that item; otherwise run a name/partial lookup and, if exactly one hit, add it; multiple hits → open a results dropdown; zero hits → inline "No item found for '{q}'" (do not silently add anything — the mockup's fallback-add is demo-only).
- Placeholder: `Scan tag or search by SKU, item, or barcode…`

### QuickActions
- **Add item** → opens the same searchable item picker as ScanBar's multi-hit dropdown.
- **Add custom line** → name + price + `taxable` boolean (default true). Custom lines have no SKU and never touch inventory.
- **Clear** → confirm if cart non-empty.

### LineItemRow
- Shows item name, `SKU {sku}` (or "Custom line"), and unit price ("$X.XX ea").
- Qty stepper (− / value / +). Decrement to 0 removes the row. Stepper is keyboard-operable.
- Right-aligned line total = `unit_price × qty`.
- Remove (✕).
- **Serialized pawn units** (forfeited inventory, unique, stock = 1): lock qty at 1 and hide/disable the stepper; a second scan of the same serialized SKU is a no-op with a toast, not qty 2. **General merchandise**: qty editable up to available stock (Section 7).

### CustomerCard
- Default state: "Anonymous walk-in" + **Add** action.
- Add → search by name / phone / DL# (same lookup the old screen had). Selecting a customer attaches `customer_id` and flips the action to **Change**. Walk-in = `customer_id: null`.

### OrderSummary
- Rows: Subtotal · Discount · Tax · divider · **Total** (large).
- **Discount control:** `$` / `%` segmented toggle + numeric input. See Section 5 for capping.
- **Tax chip:** displays the effective rate as a percentage (e.g. `8.25%`), tap to edit. Default comes from register/tenant config (Section 8), not a hand-typed decimal. Never expose the raw `0.0825` fraction to the cashier.
- **Total** is the only number at display-size; everything else is secondary.

### TenderSelector
- Cash / Card / Split. Single-select. Selection drives what the charge step collects (Section 9). Defaults to Cash.

### ChargeButton
- Full-width gold, label = `Charge $X.XX` bound live to total.
- Disabled when cart is empty.
- Click → opens the payment step for the selected tender (Section 9). Charge does **not** itself write the sale; the payment step's confirmation does.

### SecondaryActions
- **Save as layaway** → persists the sale in layaway status (separate flow; deposit capture out of scope here — see open questions).
- **Hold sale** → parks the cart so the register is free, retrievable from the POS home. Confirm a "held sales" concept exists or is wanted.
- **Add note** → free-text note saved on the sale.

---

## 4. Visual tokens

- Navy `#0d1b2a`, Gold `#e8a020`, surface `#f4f6f9`, hairline `#e4e9f0`.
- Use the existing Tailwind v4 `@theme` tokens if the pawn app already defines them; only fall back to these hex values if it doesn't. Don't introduce a parallel color system.
- Prices/quantities use tabular numerals so columns don't jitter on recompute.

---

## 5. Calculation rules (get this exact — compute in integer cents)

Do all money math in integer cents and format for display only. Avoid float accumulation.

```
subtotal      = Σ (line.unit_price_cents × line.qty)

discount      = mode == 'amount'  ? discInput_cents
              : mode == 'percent' ? round(subtotal × pct / 100)
discount      = min(discount, subtotal)          // never negative total

taxable_base  = subtotal − discount
              // exclude any line where line.taxable == false from the base:
              // taxable_base = (taxable subtotal − discount) ; non-taxable lines pass through untaxed

tax           = round(taxable_base × tax_rate)    // tax applies AFTER discount
total         = taxable_base + tax + non_taxable_subtotal
```

- Rounding: round half up at the cents level, once, per the formula above.
- Decide and document whether an order-level discount is allocated across taxable vs non-taxable lines proportionally. Simplest defensible rule: apply discount to the taxable subtotal first. **Flag for Eddy** if mixed taxable/non-taxable carts are common.
- Recompute on every cart, qty, discount, or tax change. The mockup recomputes synchronously; keep it derived (no stale state).

---

## 6. Data & API contracts (confirm against existing schema first)

Map to the pawn module's existing `pos_sales` / `pos_sale_lines` (or equivalent) tables. Do not invent columns that already exist under different names. Logical shape the screen needs:

**Sale (draft → on charge):**
- `customer_id` (nullable)
- `register_id`, `cashier_id`
- `subtotal_cents`, `discount_cents`, `discount_mode`, `tax_rate`, `tax_cents`, `total_cents`
- `status` (`draft` / `completed` / `layaway` / `held`)
- `note`
- audit: `tax_rate_source` (`config` / `override`), and if overridden, who/when (Section 8)

**Sale line:**
- `inventory_item_id` (null for custom lines), `sku`, `description`, `unit_price_cents`, `qty`, `taxable`, `is_custom`

**Lookups needed:**
- Item by SKU/barcode (exact) and by name (partial) — scoped to in-stock pawn inventory for this tenant/store.
- Customer search by name / phone / DL#.

If any of these endpoints don't exist yet, list them back to me before building rather than assuming shapes.

---

## 7. Inventory rules

- Adding to cart does **not** decrement stock. Stock moves only on sale completion (the payment confirmation), inside the same transaction that writes the sale.
- Serialized/forfeited units: unique, qty capped at 1, double-scan is a no-op toast.
- General merchandise: block qty > available; show remaining when near the limit.
- On completion, guard against overselling (re-check availability inside the write transaction; fail the sale with a clear message if an item went out of stock mid-ring-up).

---

## 8. Tax source & audit

- Effective tax rate defaults from register/tenant config — pre-filled, not typed per sale.
- Inline edit is allowed but each override is recorded on the sale (`tax_rate_source = 'override'`, plus actor + timestamp) so it's auditable. Consistent with how we treat audit logging elsewhere.
- Confirm where the canonical rate lives (register row vs tenant settings) before wiring the default.

---

## 9. Tender / payment flow

- Selecting a tender sets what the charge step collects:
  - **Cash:** amount tendered → compute change due → confirm.
  - **Card:** hand off to the Clover hosted-iframe path (per-tenant OAuth v2, the integration we already specced). Charge opens that payment surface.
  - **Split:** its own panel — multiple tender lines that must sum to the total, with per-line type and amount, change due on the cash portion. **Spec separately**; for this pass, the Split button can open a stub/"coming soon" or be feature-flagged off.
- The sale is written on payment confirmation, not on Charge click.

---

## 10. Keyboard & accessibility

- ScanBar autofocus on load and after each successful add (critical for scanner throughput).
- Enter in ScanBar = resolve/add. Steppers reachable and operable by keyboard. Visible focus rings throughout.
- Charge reachable without leaving the keyboard. Respect reduced-motion. Hit targets ≥ 40px for counter use.

---

## 11. States & edge cases

- Empty cart: empty-state copy + disabled Charge.
- Scan miss: inline "No item found", cart unchanged.
- Discount ≥ subtotal: clamp to subtotal, total floors at the tax-exempt remainder (never negative).
- Customer search no results / network error: in-line message in the interface's voice, not a blocking alert.
- Item goes out of stock between add and completion: fail completion with a specific message naming the item.
- Offline/flaky network at the counter (PWA context): **open question** — decide whether drafts buffer locally or charge is simply blocked until reconnected.

---

## 12. Out of scope / decisions needed from Eddy

1. Split-tender panel flow (deferred — separate brief).
2. Layaway deposit capture on "Save as layaway."
3. "Hold sale" — confirm this concept is wanted and where held sales are retrieved.
4. Mixed taxable/non-taxable discount allocation rule (Section 5).
5. Offline behavior at the register (Section 11).
6. Per-line discounts (current design is order-level only) — confirm that's sufficient for pawn.

---

## 13. Acceptance criteria

- Cart and Total+Charge visible together, no scroll, at ≥1280×800.
- Barcode gun scan adds the item and returns focus to ScanBar with zero mouse use.
- Tax shows as an editable percentage; raw decimal fraction never surfaces.
- Discount $/% toggle produces correct, capped results; all math verified in integer cents with no float drift across a 10-item cart.
- Serialized units lock at qty 1; general merch respects available stock.
- Charge is disabled on empty cart and labeled with the live total.
- Stock decrements only on completion, inside the sale write transaction, with oversell guard.
- Responsive: panes stack and the total/charge pin to bottom under ~980px.
- Tenant/register tax default loads; overrides are recorded on the sale.

---

## 14. Verify gate

`npm run build` (pawn repo) must pass clean — no type errors, no lint failures — before this is considered done. Confirm whether the pawn module shares the Luna Azul build pipeline or has its own.
