# Handoff Brief — "New Pawn Ticket" Redesign (Pawn module)

**Route:** `/pawn/loans/new` (current "New pawn ticket" screen)
**Deployment:** `pawn-three.vercel.app`
**Stack:** Next.js 16 / React 19 / TS 5 / Tailwind v4 / Supabase (raw SQL)
**Reference mockup:** `new-pawn-ticket.html` (interactive — category tiles, dynamic item fields, history filter + re-pawn, financing-type toggle, live principal/collateral/redemption math all functional). Visual + behavioral source of truth, not the code source.
**Pairs with:** the POS new-sale redesign — shares the navy/gold language and the sticky right-hand summary rail. Keep them visually consistent.

---

## 1. Objective

Rework the pawn-ticket intake into the same **two-pane layout** as the POS: a left **work surface** (voice, customer, collateral) and a right **sticky summary rail** that holds all loan terms and the money math. The current single tall column with a separate "Loan terms" section is gone — terms now live only in the rail, eliminating the duplication between the form and the summary.

Layout + interaction redesign. Don't change the pawn data model except where Section 8 calls out additions; confirm those against the existing schema first.

---

## 2. Layout & component tree

```
<NewPawnTicketPage>
├─ <PawnTopBar>          brand · tenant chip · admin/console · user
├─ <TicketSubBar>        "New pawn ticket" · back to pawn loans
├─ <TicketWorkSurface>   (left)
│   ├─ <VoiceCapture>    "Hold to talk" dictation hero
│   ├─ <CustomerSection> on-file requirement + selected customer / create new
│   └─ <CollateralSection>
│       ├─ <PawnHistoryPanel>   category filter chips + re-pawn rows
│       ├─ <CategoryPicker>     5 tiles (kept) → sets item workflow
│       ├─ <DynamicItemEditor>  per-category fields + add
│       └─ <CollateralList>     added items
│   └─ <SignatureNotes>   upload signed ticket + notes
└─ <LoanSummaryRail>     (right, sticky)
    ├─ <FinancingType>   Pawn loan / Buy outright (top, above summary)
    ├─ <CustomerChip>
    ├─ <PrincipalField>  large input + live Collateral-value / LTV box
    ├─ <Terms>           rate · term · issue → due (auto)
    ├─ <Redemption>      computed payoff figure
    └─ <Actions>         Issue pawn loan · Save as draft
```

Grid: `1fr 360px`, 18px gap. Single column under ~980px; rail moves below and stays usable.

---

## 3. Removed / relocated

- **"Loan terms" section deleted** from the left column. Principal, interest rate, term, and issue date are now inputs **inside the rail**. There is exactly one place to enter and read terms.
- Remove the dev-leak helper text ("Default rate seeded by migration 0021. Edit at /settings/loan-rates"). Replace with plain "Manage rates in Settings → Loan rates."

---

## 4. Component specs

### VoiceCapture ("Hold to talk")
- Preserve the existing feature. Press-and-hold dictation; on release, parse speech into **customer name + loan amount + item description** and pre-fill those fields. The parsing/STT pipeline is its own concern — this redesign only needs to keep the control as a hero affordance at the top of the work surface and route parsed values into the same state the manual fields write to.

### CustomerSection
- Keep the "must be on file with valid ID before issuing" requirement as a visible rule.
- Selected customer shows name + phone with a clear (✕); **Create new customer** opens the new-customer flow. `customer_id` is required to issue (Section 9).

### FinancingType (rail, top)
- Segmented control: **Pawn loan** (default) / **Buy outright**.
- **Pawn loan:** shows rate, term, due date, and the redemption figure.
- **Buy outright:** hides rate/term/due/interest; relabels "Principal financed" → "Purchase price"; rail title → "Purchase summary"; hero figure → "Cash paid to customer" = the price; primary button → "Complete purchase". This is a purchase, not a loan — no collateral redemption, item becomes shop inventory immediately.
- Confirm whether **layaway** and/or **trade-in** belong here as additional types (Section 12).

### PrincipalField + Collateral-value (rail)
- Principal is the **largest input** in the rail.
- Beside it, a live **Collateral value** box = sum of every added item's value. Updates on every add/remove.
- **Loan-to-value feedback** (the point of the pairing):
  - principal ≤ collateral value → "covered" state, show ratio (e.g. "67% of value").
  - principal > collateral value → "over value" warning state.
  - See Section 12 for an optional hard LTV ceiling instead of the 100% line.

### Terms (rail)
- Interest rate: select sourced from the loan-rates config (don't hardcode the three demo options). Default = the tenant/shop default rate.
- Term (days): numeric, default from config (30).
- Issue date editable; **Due date auto = issue + term**, read-only.

### Redemption (rail)
- For Pawn loan: the payoff figure at due date (Section 7). For Buy: the cash-out figure.

### PawnHistoryPanel (collateral, customer-scoped)
- Lists items this customer has pawned before, most-recent first.
- **Filter chips:** All + one per category present in the customer's history. Active chip highlighted.
- Each row: category tag, item description, last-pawned date, prior loan amount, status.
- **Re-pawn:** redeemed (and otherwise eligible) items get **+ Add** → drops the item into the collateral list tagged as a re-pawn, no category/field re-entry.
- **Forfeited items are not re-pawnable** — they're shop inventory now, not the customer's property. Show "Now shop inventory" instead of Add. Also exclude/lock items currently held on another open loan (Section 12).
- Source: the customer's prior `pawn_loans` + their collateral, filtered by eligible status.

### CategoryPicker (kept)
- The five tiles stay (Jewelry / Electronics / Firearms / Tools / General) with sub-counts. Selecting one sets the workflow and reveals the matching field set. Active tile in gold.

### DynamicItemEditor
- Field set depends on the selected category. At minimum:
  - **Jewelry:** metal/karat, weight (g), gemstones, description, appraised value, loan value.
  - **Electronics:** type, make/model, serial/IMEI, condition, description, est. value.
  - **Firearms:** make, model, caliber, serial #, type + **compliance notice** (serial capture, state reporting, mandatory hold before resale, ID verification, firearm log).
  - **Tools:** brand, model, condition, description, est. value.
  - **General:** description, condition, est. value.
- Pull the real per-category subcategory/attribute schema from the pawn config rather than the mockup's hardcoded lists.
- **Add item** appends to the collateral list with its value; that value feeds the Collateral-value box.

### CollateralList
- Added items show category tag, description, est. value, remove. Re-pawned items flagged as such.

### SignatureNotes
- Upload a scan/photo of the signed ticket. Free-text notes saved on the loan.

---

## 5. Visual tokens

- Navy `#0d1b2a`, Gold `#e8a020`, surface `#f4f6f9`, hairline `#e4e9f0`. Use the existing Tailwind v4 `@theme` tokens if defined; otherwise these. Tabular numerals on all money/quantity values. Match the POS rail exactly.

---

## 6. Calculation rules (compute in integer cents)

```
collateral_value = Σ item.value           // shown next to principal; drives LTV state
ltv_pct          = principal / collateral_value      // when collateral_value > 0
ltv_state        = principal == 0 || collateral_value == 0 ? neutral
                 : principal > collateral_value       ? over
                 : ok                                  // (or compare to ceiling — Section 12)

// Pawn loan redemption
months    = term_days / 30
interest  = round(principal × monthly_rate × months)
redemption = principal + interest          // payoff at due date

// Buy outright
cash_out  = purchase_price                 // no interest/term/redemption
```

- All money math in integer cents; format for display only.
- **Interest method is a decision** — this uses simple interest at maturity. For the initial 30-day term, simple and compounding are identical; they diverge only once a loan extends past one period. Confirm whether the figure should reflect compounding on extension (Section 12).
- Due date = issue date + term_days.

---

## 7. Data & API contracts (confirm against existing schema first)

Map to the pawn module's existing tables — don't invent columns that already exist.

**Pawn loan (created on issue / draft):**
- `customer_id` (required), `register_id`/`store_id`, `clerk_id`
- `financing_type` (`pawn` / `buy` [/ `layaway` / `trade` if added])
- `principal_cents`, `monthly_rate`, `term_days`, `issue_date`, `due_date`
- `redemption_cents` (snapshot at issue), `collateral_value_cents` (snapshot)
- `status` (`draft` / `active` / `redeemed` / `forfeited` / …)
- `signature_url`, `note`

**Collateral item:**
- `loan_id`, `category`, `subcategory`, category-specific attributes (metal/weight/serial/caliber/etc.), `description`, `value_cents`, `is_repawn`, `source_loan_id` (when added from history)

**Lookups needed:**
- Customer search (name / phone / DL#).
- Loan-rate options + default (the config behind the rate select).
- **Pawn history for a customer:** prior loans + collateral, filtered to re-pawn-eligible status, most-recent first, with the category needed for the filter chips.

If any of these don't exist yet, list them back before building rather than assuming shapes.

---

## 8. Compliance & status rules

- **Firearms:** serial capture mandatory; surface the reporting/hold notice; ensure the firearm log requirement is enforced before issue.
- **Forfeited collateral = shop inventory.** Not re-pawnable, not the customer's to pledge again. Enforce in the history panel and server-side.
- **On-file customer with valid ID** required before a loan can be issued.
- Florida pawn term/rate/hold constraints (FS 539.001) come from config/statute — confirm the canonical source for default rate, minimum term, and grace before wiring defaults.

---

## 9. States & edge cases

- Issue/Complete disabled until: customer selected **and** principal/price > 0 **and** ≥ 1 collateral item.
- Over-value: principal > collateral value → warning state (don't necessarily block, unless an LTV ceiling is set — Section 12).
- Empty history / filtered-empty: show a clear in-panel message, not a blank space.
- Firearm without serial: block add.
- Buy mode: rate/term/due/redemption hidden and not persisted.
- Save as draft: persists with `status = draft`, no validation gate beyond a customer.

---

## 10. Keyboard & accessibility

- Logical tab order: voice → customer → history/category → item fields → rail (financing type → principal → rate → term → issue → issue button).
- Visible focus rings; category tiles and filter chips operable by keyboard; hit targets ≥ 40px. Respect reduced motion.

---

## 11. Acceptance criteria

- Loan terms appear only in the rail; the old left-hand "Loan terms" section no longer exists.
- Financing type switches the rail between loan and purchase modes correctly (labels, hidden fields, button, hero figure).
- Principal is the prominent rail input; Collateral-value box sums added items live and color-codes principal-vs-value with the ratio shown.
- History panel filters by category and re-pawns a redeemed item in one tap; forfeited/held items are not re-pawnable.
- Category tiles drive the correct per-category field set; firearms enforce serial + show the compliance notice.
- Redemption / due date compute correctly; all money math in integer cents with no float drift.
- Dev-leak helper text removed; rate options come from config.
- Responsive to mobile; rail usable below ~980px.

---

## 12. Decisions needed from Eddy

1. **Interest method** — simple at maturity (current) vs compounding once a loan extends past the term.
2. **LTV ceiling** — keep the warning at 100% of collateral value, or set a hard max (e.g. block above 60% of appraised value).
3. **Re-pawn prefill value** — prior loan amount (current), prior appraised value, or blank to force fresh appraisal (metal prices move).
4. **Exclude currently-held items** from history (items live on another open loan shouldn't be re-pawnable until redeemed).
5. **Financing types** — is Pawn / Buy enough, or add layaway / trade-in (layaway would swap redemption for a deposit + payment schedule)?
6. **Voice dictation** — confirm the STT/parse pipeline behind "Hold to talk" is in scope here or tracked separately.

---

## 13. Verify gate

`npm run build` (pawn repo) passes clean — no type errors, no lint failures — before done. Confirm whether the pawn module shares the Luna Azul build pipeline or has its own.
