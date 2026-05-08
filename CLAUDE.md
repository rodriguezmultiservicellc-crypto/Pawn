# PAWN — PROJECT CONTEXT
# Version: 0.1 (skeleton) | Date: 2026-04-26
# Owner: Eddy Rodriguez | Rodriguez Multi Service LLC (operator)

> **Also read [AGENTS.md](AGENTS.md)** — Next.js 16 has breaking changes from
> earlier versions. Before writing any Next-touching code, check
> `node_modules/next/dist/docs/` for the current API. The proxy.ts /
> middleware.ts rename and `<form action={fn}>` encType behavior are two
> we already know about; there will be more.

---

## WHAT WE ARE BUILDING

A **multi-tenant SaaS for pawn / jewelry shops** with three product surfaces:

1. **Pawn loans** — collateral intake, redemption, extension, forfeiture.
   Feature-gated per tenant (`tenants.has_pawn`) so jewelry-only shops opt out.
2. **Repair / stone setting** — service tickets covering repair, stone setting,
   sizing, restringing, plating, engraving, custom work. ALL one module,
   differentiated by `service_type` enum. No separate stone-setting surface.
3. **Retail / POS** — sale, return, layaway, register close. Card-present via
   Stripe Terminal AND online via Stripe Payment Links.

This is NOT a single-shop app. Every shop is a tenant. Multi-store chains
(HQ + branches) are supported from day 1 — see Multi-Store Model below.

Sister apps: **Luna Azul** (port 3000, c:\...\LunaAzul Web Sass\) and
**Abacus** (port 3030, c:\...\Abacus\). Pawn lives at port **3060**.
Never kill node processes by image name — always by PID.

---

## OWNER CONTEXT

- **Operator**: Eddy Rodriguez (RMS).
- **First tenant**: TBD (RMS will be tenant #1 only if we run a pawn shop;
  otherwise tenant #1 is the first paying customer).
- **Roles within RMS**: same humans as Luna Azul / Abacus — Eddy (superadmin
  globally; owner where assigned), Jeniffer, Sara as needed.
- We address each other directly. Concise. No fluff.
- "We" are doing the work — both of us. Eddy isn't the only operator.

---

## CRITICAL RULES — READ BEFORE EVERY SESSION

1. **NEVER touch Supabase RLS policies without explicit confirmation.**
   Tenant + client isolation flows through RLS. A mistake leaks one shop's
   loan book / customer IDs to another. Show the policy first.

2. **NEVER hard-delete financial records.** Pawn tickets, repair tickets,
   sales, and inventory rows soft-delete via `deleted_at`. Once posted
   (`is_posted = TRUE`) a DB trigger rejects core-field UPDATE/DELETE —
   void with a reversing entry, never edit in place.

3. **NEVER deploy to production** without explicit "deploy" — local or
   staging branch only.

4. **NEVER commit service-role keys.** `.env.local` is gitignored. Audit
   every commit. Service role key NEVER lives in a `NEXT_PUBLIC_*` var.

5. **All Claude API calls go server-side.** Routes live in `app/api/ai/`.
   Never call Anthropic from a client component.

6. **Bilingual rule (EN + ES).** Every customer-facing email, SMS, and
   printable ticket renders in both languages. UI uses i18n. Hardcoded
   strings = bug.

7. **Staff approval gate.** AI-generated documents stay `is_client_visible
   = false` until staff approves. Never auto-publish.

8. **Tenant scoping is non-negotiable.** Every query against a tenant-
   scoped table resolves a tenant context via `getCtx()` or an explicit
   `tenantId` parameter. RLS provides defense in depth — app code STILL
   filters by `tenant_id`.

9. **Role location rules.**
   - `profiles.role` is `TEXT`, ONLY `'superadmin'` or NULL. Global only.
   - `user_tenants.role` is the per-tenant role enum. Per-tenant only.
   - Never check `profiles.role === 'owner'` — always false.
   - Use `getCtx().tenantRole` for per-tenant checks, `getCtx().globalRole`
     for the superadmin check.

10. **Every server action gates with `requireSuperAdmin()` or
    `requireRoleInTenant()`.** Both live in `lib/supabase/guards.ts`.
    Service-role clients bypass RLS — guard FIRST, admin-client SECOND.

11. **Money is `numeric(18,4)`.** Loan principal, interest, sale totals,
    refunds, deposits — all of it. Never float, never integer cents.
    Tax rates `numeric(6,4)`. Metal weights are `numeric(10,4)` grams.

12. **All file downloads via signed URLs (1h expiry).** Storage buckets
    are NEVER public. Customer ID scans, item photos, signatures, repair
    pickup signatures — all gated.

13. **Customer ID retention is regulated.** ID scans persist as long as
    the loan is active + jurisdiction-mandated retention period after
    redemption / forfeiture (FL = 2 years post-transaction). The DELETE
    button on a customer record is gated on no active loans + no
    retention-window holds.

14. **Pawn ticket immutability after print.** Once a pawn ticket has
    been printed and signed, the loan record's core fields (collateral
    description, principal, interest rate, due date, customer) freeze.
    Corrections require voiding the original and writing a new ticket.

15. **Police-report data is its own surface.** Every pawn-loan and
    buy-outright transaction emits a row in a dedicated `compliance_log`
    table the moment it happens — not derived at report time. The
    police-report exporter reads from `compliance_log`, not from `loans`
    or `transactions`. Keeps reporting deterministic across edits.

16. **Pawn module gating.** Half the surface area is gated on
    `tenants.has_pawn`. Routes, sidebar entries, server actions — all
    check the flag. Jewelry-only / repair-only shops never see pawn UI.

17. **Dedicated cloud projects — never reuse Luna Azul or Abacus.** Pawn
    has its own GitHub repo, its own Supabase project (separate org URL,
    separate anon + service_role keys, separate DB), and its own Vercel
    project. Never push Pawn code to the LunaAzul or Abacus repos. Never
    point Pawn's `.env.local` at LunaAzul / Abacus credentials, even
    "just to test." The mailbox folder at
    `C:\ClaudeMemory\Sass Memory Coonection\` is shared across all three
    Claudes — that's the only shared resource. Cross-app data flows
    through documented integrations, not shared infrastructure.

---

## MULTI-STORE MODEL — DAY 1 BAKED IN

We're paying the design cost upfront. (Luna Azul deferred this and now has
unused columns sitting in prod.)

```text
tenants
  id                UUID PK
  parent_tenant_id  UUID NULL FK → tenants(id)   -- chain HQ for branches
  tenant_type       ENUM ('chain_hq','shop','standalone')
  has_pawn          BOOLEAN NOT NULL DEFAULT TRUE
  has_repair        BOOLEAN NOT NULL DEFAULT TRUE
  has_retail        BOOLEAN NOT NULL DEFAULT TRUE
  police_report_format  ENUM ('fl_leadsonline')  -- expandable; v1 ships FL only
  ...
```

Rules:
- A `chain_hq` tenant has no shop floor — it's the rollup container. Its
  user_tenants are the chain owner + chain managers. Children are queried
  via `parent_tenant_id`.
- A `shop` row has `parent_tenant_id IS NOT NULL` and represents one
  physical store. RLS isolates shops from siblings — chain HQ users get
  cross-shop access via a separate `chain_admin` role on the HQ row.
- A `standalone` row has `parent_tenant_id IS NULL` and is its own world.
  Same as Abacus's tenant model.
- Inventory transfers between sibling shops: dedicated `inventory_transfers`
  table with `from_tenant_id` + `to_tenant_id`, both children of the same
  HQ. Cross-chain transfers blocked at the trigger level.
- Reporting at HQ rolls up via `WHERE tenant_id IN (children of HQ)`.

---

## TECH STACK — LOCKED

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 16 (App Router) | TypeScript strict |
| Styling | Tailwind CSS v4 | `@theme` in globals.css, no config file |
| Components | shadcn/ui (token-overridden) | Tokens from DESIGN-airbnb.md |
| Database | Supabase PostgreSQL | RLS on every table |
| DB connection | Supavisor pooler (IPv4) | NOT direct DB host |
| Auth | Supabase Auth | Email/pw + magic link for portal users |
| Storage | Supabase Storage | Signed URLs only, never public |
| AI | Anthropic Claude API | Sonnet 4.6 (heavy) / Haiku 4.5 (parallel) |
| PDF | @react-pdf/renderer | Tickets, receipts, reports |
| Tables | TanStack Table v8 | Virtual scroll for large pawn books |
| Forms | React Hook Form + Zod | All financial forms |
| Charts | Recharts | KPIs |
| Icons | Phosphor Icons (React) | CLIENT COMPONENTS ONLY |
| Animation | Motion | Spring counters |
| Fonts | Inter (Cereal substitute) + JetBrains Mono | next/font; see DESIGN-airbnb.md §3 |
| i18n | Custom EN+ES context | Day 1 |
| SMS | Twilio | Per-tenant creds in `settings` |
| WhatsApp | Twilio WhatsApp Business | Same Twilio account, approved templates |
| Email | Resend | Per-tenant creds |
| Billing | Stripe Connect (per-tenant) | **Terminal AND Payment Links** |
| Hardware | Stripe Terminal (BBPOS, S700) | TBD, deferred to POS phase |

**Do NOT substitute libraries.** If something doesn't work, flag it.

---

## DESIGN SYSTEM — LOCKED

Visual identity is documented in [DESIGN-lunaazul.md](DESIGN-lunaazul.md)
at project root. That doc is the source of truth — never override hex
values, never substitute fonts, never introduce off-system accent colors.
CLAUDE.md just records the integration points; everything else lives there.

The system is adapted from the Luna Azul Web SaaS — navy chrome + light
canvas + gold (action) / blue (link). It replaces the previous Airbnb-
derived system. If you find references to `bg-rausch`, `text-ink`,
`bg-cloud`, `border-hairline`, `text-ash`, `text-charcoal`, `rounded-pill`,
or `shadow-elevation`, those are stale — see DESIGN-lunaazul.md §11 for
the find/replace map.

### Integration with our stack

- `src/lib/tokens.ts` exports the palette + radius + shadow scales as TS
  constants. `reportColors` (charcoal-on-paper for PDFs) is intentionally
  separate and stays.
- `globals.css` `@theme` block exposes the palette as Tailwind tokens
  (`--color-navy`, `--color-gold`, `--color-blue`, `--color-background`,
  `--color-card`, `--color-border`, `--color-foreground`,
  `--color-text-secondary`, `--color-muted`, `--color-success`,
  `--color-warning`, `--color-danger`, `--color-info`, etc.).
- **Fonts** — `next/font/google` loads three families:
  - **DM Sans** (`--font-dm-sans` / `font-sans`) — body / UI default,
    weight 400. Labels: 600. Buttons: 700.
  - **Playfair Display** (`--font-playfair` / `font-display`) — page
    titles + display headings only, weight 700/900. Never on body,
    never on buttons, never below 20px.
  - **JetBrains Mono** (`--font-jetbrains-mono` / `font-mono`) —
    tabular numerals (loan principal, ticket numbers, register
    totals, item SKUs).
- **Base font size:** `<html>` is `font-size: 17px` (one notch above
  browser default). Tailwind `text-base` = 17px, `text-sm` ≈ 14.875px.
- **Border radius scale:** 6 / 8 / 12 / 16 / 9999px. The workhorse is
  `rounded-xl` (12px) — used for cards, primary buttons, inputs, modals.
  Pick from the scale, never invent a value.
- **Shadow scale:** at-rest = none. Hover-lift = `shadow-lg`. Modals and
  dropdowns also use `shadow-lg`. There is no three-layer signature
  elevation — Luna Azul uses Tailwind's `shadow-lg` directly.

### Semantic colors — Tailwind-aligned

Status colors map to Tailwind's defaults:

- **Success** (`#22c55e` / Tailwind emerald-500) — active loans, paid
  invoices, redeemed pawn tickets, ready-for-pickup repair tickets,
  in-stock inventory.
- **Warning** (`#f59e0b` / Tailwind amber-500) — pending review,
  due-soon loan, repair waiting on parts, layaway falling behind,
  hold-period nearing expiration.
- **Danger** (`#ef4444` / Tailwind red-500) — form validation errors,
  destructive actions, banned customer flag, overdue loan past grace,
  abandoned repair.
- **Info** (`#3b82f6` / Tailwind blue-500) — informational badges,
  scheduled / queued status.

Use strictly semantically. Never decorative. Never for emphasis. Never
outside status communication. Action color is Gold (CTA) or Blue (link
/ focus) — not Success / Warning / Danger / Info.

### Motion budget

Four signature behaviors. CSS-only — no Framer Motion, no Motion
library:

1. **Card hover lift:** `hover:-translate-y-1` + `hover:shadow-lg` over
   `transition-all` (~150ms).
2. **Primary button hover lift:** `hover:-translate-y-0.5` +
   `hover:shadow-lg` + `hover:bg-gold-2`.
3. **Sidebar collapse:** `transition-[width] duration-150` between
   `w-52` and `w-16`. Persisted in localStorage.
4. **Sidebar group accordion:** chevron rotation via
   `transition-transform`.

No spring counters, no fade-ins on route transitions, no skeleton
pulses, no scale-up beyond `hover:scale-[1.01]` (and avoid even that).

### Iconography

**Phosphor Icons** (deviation from Luna Azul, which uses Lucide). Already
imported in 30+ files; visual difference at 16–20px is small enough that
Phosphor stays. Phosphor's weight variants (Regular / Bold / Fill /
Duotone) are useful for state expression.

- Sidebar parent items: 18px. Sidebar child items: 16px.
- Card icon (in tinted icon box): 18–20px. Inline button icon: 14–16px.
- Default `text-foreground` on light, `text-white/65` on dark sidebar,
  `text-gold` on active sidebar item.
- Phosphor is client-only: `'use client'` components or pass as
  `ReactNode` from a server component.

### Photography — workhorse, not brochure

- **Inventory items** — top-light, neutral seamless background, 4:3 or
  1:1. Multi-angle carousel inside the detail panel. Card thumbnails at
  `rounded-xl` (the same Card shell used everywhere).
- **Customer ID scans** — never rendered at hero scale, never shown in
  any browse surface. Locked behind admin-only signed URLs.
- **Repair before / in-progress / after** — 1:1 thumbnails in a
  carousel inside the ticket detail. `border-border` dividers between
  angles.
- **No stock photography. No marketing imagery.** The system is an ops
  console.

---

## USER ROLES

### Global role (`profiles.role`)
| Role | Access |
|------|--------|
| superadmin | Platform operator. `/admin/*`. Auto-member of every tenant they create. |
| (NULL) | Regular user. Per-tenant access via `user_tenants`. |

### Per-tenant role (`user_tenants.role` — `tenant_role` enum)
| Role | Access |
|------|--------|
| owner | Everything within the tenant. Settings, team, billing, delete. |
| chain_admin | HQ-only role. Read+write across child tenants. No team management on children. |
| manager | Full ops in one shop. No team / billing. |
| pawn_clerk | Pawn intake/redeem/extend, retail sale, customer mgmt. No reports beyond daily register. |
| repair_tech | Repair-ticket workflow (intake → work order → pickup). No financial admin. |
| appraiser | Read-only on pawn intake. Can quote / counter. No write to ledger. |
| client | Customer portal — own active loans, repair tickets, payoff link. |

A single auth user can hold different roles in different tenants
(e.g. chain owner = `chain_admin` at HQ + `owner` at standalone shop).

**Enforcement layers (all three required):**
1. **RLS** — every tenant-scoped policy joins through `user_tenants`.
   Helpers: `my_tenant_ids()`, `my_role_in_tenant()`, `my_is_staff()`,
   `my_chain_tenant_ids()` (children of any HQ I'm chain_admin at).
2. **Proxy middleware** (`src/proxy.ts`) — role-based route gating.
3. **Server-action guards** — `requireSuperAdmin()` /
   `requireRoleInTenant()` / `requirePermission()` at the top of every
   server action.

---

## DOMAIN MODULES

### 1. Customers
- Name, phone, email, address, photo
- ID type (DL / passport / state ID), number, expiry, issuing state
- ID scan (Storage, signed URL only)
- Signature on file (Storage)
- Banned-list flag with reason + set-by
- Communication preference (email / sms / whatsapp)
- Language (en / es)
- Multi-tenant scoped — a customer at shop A is NOT visible at shop B,
  even within the same chain. (HQ rollup queries the union.)

### 2. Inventory
- Item ID, description, category (ring / chain / watch / coin / etc.)
- Metal type, karat, weight (g + dwt)
- Stones (sub-table: count, type, cut, est_carat, color, clarity)
- Cost basis (acquisition cost), list price, sale price (after discount)
- Photos (Storage, multi-image)
- Location (case / safe / vault / display)
- Source enum: `pawn_forfeit | bought | consigned | new_stock | repair_excess`
- Status enum: `available | held | sold | scrapped | transferred`
- For forfeitures: `source_loan_id` FK back to the original pawn loan

### 3. Pawn loans (gated on `has_pawn`)
- Customer (FK), collateral items (M:N to inventory-style item snapshots
  — pawned items live in a separate `pawn_collateral_items` table, NOT
  `inventory`, until forfeiture)
- Principal, interest rate (per-state legal cap), term (days), due date
- Status: `active | extended | partial_paid | redeemed | forfeited | voided`
- Payment history (sub-table — every interest payment, partial principal,
  full redemption)
- Ticket number (auto-incremented per tenant, padded)
- Ticket print state (printed/unprinted) — printing locks core fields
- Customer signature (capture device or paper-scan upload)

### 4. Loan operations
- **Extension**: writes a new `loan_events` row, updates due date,
  optionally collects interest now or rolls into next term
- **Partial payment**: principal + interest split, recalculates balance
- **Redemption**: full payoff, releases collateral, item NEVER hits
  `inventory` table (because it was never ours to sell)
- **Forfeiture**: triggered manually after due-date + grace window;
  collateral items copy into `inventory` with `source='pawn_forfeit'`
  and `source_loan_id` set; loan status flips to `forfeited`

### 5. Buy outright
- Same intake form as pawn collateral (item description, photo,
  customer ID required)
- Item lands directly in `inventory` with `source='bought'`
- Hold period configurable per state (FL = 30 days for jewelry as of
  this writing — check current statute before going live in any state)
- During hold period, item is `status='held'`, NOT sellable
- Hold expiry trigger flips status to `available`

### 6. Repair tickets
- Customer (FK), item description (free-text + photos — NOT inventory,
  customer's item)
- `service_type` enum: `repair | stone_setting | sizing | restring |
  plating | engraving | custom`
- Work needed (free-text), quote, deposit collected, due date promised
- Stones (sub-table — for stone setting: customer-supplied or shop-
  supplied, mounting type, position, size)
- Technician assigned (FK to `user_tenants`)
- Status: `intake | quoted | in_progress | needs_parts | ready | picked_up | abandoned`
- Photos: intake (before), in-progress (with technician notes), final (after)
- Parts used (sub-table → links to `inventory` for shop-supplied stock)
- Time logs (sub-table — start/stop, technician)
- Pickup: final balance, customer signature, pickup-by name + ID check
- Abandoned items: jurisdiction-specific abandon period (FL = 90 days
  after promised pickup); abandoned items convert to inventory with
  `source='abandoned_repair'` and a notice trail

### 7. Retail / POS
- Sale: line items (inventory FK or non-inventory free-text), tax,
  discount, payment (cash / card via Stripe Terminal / split)
- Return: original-sale FK required, restock to inventory
- Layaway: deposit + payment schedule, item status flips to `held`,
  customer can pay over time, default cancellation policy per tenant
- Register close: end-of-day cash count, card batch reconciliation,
  variance flag

### 8. Customer portal (`/portal`)
- Active pawn loans with due dates, payment history, payoff balance
- Pay-by-link via Stripe Payment Link (per loan, real-time balance)
- Repair tickets — status, photos when ready, ready-for-pickup notice
- Layaway balances + pay-by-link
- Communication preferences

### 9. Communications
- Twilio SMS, Twilio WhatsApp (approved templates), Resend email
- Triggers:
  - Pawn maturity reminder (T-7, T-1, day-of, T+1, T+7)
  - Repair ready-for-pickup
  - Layaway payment reminder
  - Hold-period expiration (internal alert, not customer-facing)
- All bilingual, customer's `language` preference picks which one sends

### 10. Reporting + compliance
- Daily register (cash, card, totals, variance)
- Pawn aging (active loans by days-to-due)
- Redemptions / forfeitures / interest income
- Inventory turn (days from acquisition → sale, by source)
- Police-report export (FL LeadsOnline format v1)
- Chain-level rollup at HQ tenants
- Audit log per tenant

---

## DATABASE — CORE TABLES (skeleton only; full DDL ships in patches/)

```text
tenants                 (multi-tenant root + chain support + module gates)
profiles                (extends auth.users, global role only)
user_tenants            (per-tenant role + permissions)
settings                (per-tenant: Twilio/Resend/Stripe Connect)
tenant_billing_settings (1:1 with tenants — Stripe Connect tokens)
audit_log               (immutable mutation history)
compliance_log          (police-report source of truth — write-once)

customers
customer_documents      (ID scan, signature)

inventory_items
inventory_item_photos
inventory_item_stones
inventory_transfers     (between sibling shops in a chain)

loans                   (pawn — gated on has_pawn)
loan_collateral_items   (frozen-at-intake item snapshots)
loan_events             (extension, payment, redemption, forfeiture)
loan_payments

repair_tickets
repair_ticket_items     (parts used FK → inventory)
repair_ticket_stones    (stone-setting jobs)
repair_ticket_events    (status transitions)
repair_ticket_photos
repair_time_logs

sales
sale_items
sale_payments
returns
layaways
layaway_payments
register_sessions       (open/close + cash count)

message_templates
message_log
```

Every scoped table: `tenant_id` (NOT NULL FK), `created_at`, `updated_at`,
`deleted_at`. Mutations route through audit_log. Tickets/loans/sales freeze
on `is_posted = TRUE` via trigger.

---

## FOLDER STRUCTURE (target)

```text
pawn/
├── src/
│   ├── app/
│   │   ├── (auth)/login, magic-link, set-password, forgot-password
│   │   ├── (admin)/admin/tenants, /admin/billing
│   │   ├── (staff)/
│   │   │   ├── dashboard
│   │   │   ├── customers
│   │   │   ├── inventory
│   │   │   ├── pawn        (gated — sidebar entry hidden if !has_pawn)
│   │   │   ├── repair
│   │   │   ├── pos
│   │   │   ├── reports
│   │   │   ├── compliance
│   │   │   ├── team
│   │   │   └── settings
│   │   ├── (portal)/
│   │   │   ├── portal/loans
│   │   │   ├── portal/repairs
│   │   │   └── portal/layaways
│   │   └── api/
│   │       ├── stripe/{connect,webhook,terminal}
│   │       ├── ai/...
│   │       ├── compliance/police-report/[format]
│   │       └── ...
│   ├── components/
│   │   ├── ui/                shadcn customized
│   │   ├── layout/            Sidebar, TopBar, TenantSwitcher, etc.
│   │   ├── pawn/              ticket forms, payment dialog
│   │   ├── repair/            intake, work-order board, pickup dialog
│   │   ├── pos/               cart, payment, terminal binding
│   │   └── ...
│   ├── lib/
│   │   ├── tokens.ts          locked design tokens
│   │   ├── supabase/{client,server,admin,middleware,ctx,guards}.ts
│   │   ├── i18n/{config,en,es,context,use-lang}.ts
│   │   ├── ai/prompts.ts
│   │   ├── pdf/               TicketPDF, RepairTicketPDF, ReceiptPDF
│   │   ├── compliance/
│   │   │   └── police-report/
│   │   │       ├── index.ts                  format dispatcher
│   │   │       └── formats/fl-leadsonline.ts FL exporter
│   │   ├── pawn/              loan math (interest, payoff, extension)
│   │   ├── repair/            workflow state machine
│   │   ├── stripe/{client,terminal,payment-link}.ts
│   │   ├── twilio/{sms,whatsapp}.ts
│   │   ├── email/send.ts
│   │   └── validations/       Zod schemas
│   └── types/database.ts      Supabase-generated, NEVER hand-edited via `>`
├── patches/                   numbered SQL migrations
├── scripts/
│   ├── db-types.mjs           safe wrapper (write→tmp→atomic rename)
│   ├── seed.ts
│   └── audit-data-integrity.py  read-only diagnostic (carry from LunaAzul)
├── .githooks/pre-push         i18n drift + as-any drift watchdogs
├── dev-watchdog.mjs           cloned from Abacus, retargeted to :3060
├── proxy.ts                   role-based routing
├── next.config.ts             turbopack.root pinned to __dirname
├── package.json
├── .env.local                 GITIGNORED
├── CLAUDE.md                  this file
├── AGENTS.md                  Next.js 16 framework-level agent rules (stub)
├── DESIGN-airbnb.md           visual identity source of truth
└── Progress.txt               session log
```

---

## I18N — DAY 1

Every user-facing string flows through the i18n system. Every printable
ticket renders in BOTH languages on the same page (split layout) OR picks
based on customer's `language` preference, depending on document type.

- `lib/i18n/{config,en,es,context,use-lang}.ts` — same shape as Luna Azul.
- Pre-push hook: i18n drift check. New keys must land in BOTH `en.ts`
  and `es.ts` or the push fails.
- Print pages (pawn ticket, repair ticket, receipt, layaway agreement)
  always render bilingual on the same physical page.

---

## STRIPE — BOTH SURFACES

### Connect (per-tenant)
Same OAuth flow as Abacus (`/api/stripe/connect/start` → Stripe →
`/api/stripe/connect/callback`). Saves account ID + tokens to
`tenant_billing_settings`. Auto-provisions the webhook endpoint at
callback time. Both surfaces (Terminal + Payment Links) work off the
same connected account.

### Stripe Terminal (card-present, in-store)
- POS pairs to a physical reader (BBPOS WisePOS E or similar)
- Server creates a `PaymentIntent` with `payment_method_types: ['card_present']`
- Reader collects → captures → webhook fires `payment_intent.succeeded`
- Webhook posts the sale to `sales` + `sale_payments` rows

### Stripe Payment Links (online, customer portal)
- Customer portal renders a "Pay payoff balance" button per active loan
- Clicking generates a Checkout Session with `client_reference_id =
  loan_id` and `metadata.tenant_id`
- On success, webhook posts a `loan_payments` row + recalculates balance;
  if `loan_payments.SUM = principal+interest`, status flips to `redeemed`

Both flows share the same per-tenant webhook endpoint.

---

## COMPLIANCE — POLICE-REPORT EXPORT

- Source of truth: `compliance_log` table (write-once on intake).
- Exporter dispatcher at `lib/compliance/police-report/index.ts` reads
  `tenants.police_report_format` and routes to the right format module.
- v1 ships **`fl-leadsonline.ts`** ONLY. New states = new file under
  `formats/`, new enum value, no fork.
- Output: file format the agency expects (CSV / fixed-width / API call —
  varies by jurisdiction). FL LeadsOnline = upload format documented at
  https://leadsonline.com/ — confirm exact spec before going live.
- ID retention rules: `lib/compliance/retention.ts` — minimum hold per
  format. FL = 2 years post-redemption / forfeiture. Customer DELETE
  blocked while any loan + any retention window is active.

---

## AUDIT LOG

Every mutation gets a row. Same shape as Abacus:

```text
audit_log
  user_id, tenant_id, customer_id?, action, table_name, record_id,
  changes JSONB, ip_address, created_at
```

Logged: every loan event, repair-ticket transition, sale, return,
inventory transfer, customer-record edit, compliance export run.
NEVER deletable.

---

## ENV VARS

```text
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server-only

# Database (Supavisor pooler URL)
DATABASE_URL=                     # postgres.<ref>@aws-1-us-east-1.pooler.supabase.com:6543

# Anthropic
ANTHROPIC_API_KEY=

# OpenAI (Whisper transcription for /api/ai/voice/pawn-intake)
OPENAI_API_KEY=

# Stripe (platform-level)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Resend (platform-level fallback only — per-tenant creds in settings)
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3060
NEXT_PUBLIC_BASE_DOMAIN=          # for tenant-subdomain landing pages later

# Cron
CRON_SECRET=                      # for /api/cron/* endpoints
```

Twilio creds + per-tenant Resend creds + Stripe Connect tokens live in
the DB (`settings` + `tenant_billing_settings`), not env. Per-tenant
config without redeploys.

---

## BUILD PHASES

### Phase 0 — Foundation skeleton (CURRENT)
- Next 16 scaffold (TS strict, Tailwind v4, src dir, App Router, Turbopack)
- dev-watchdog.mjs → port 3060, 4GB heap, 25-min cycle
- Supabase project + initial schema (tenants, user_tenants, profiles,
  settings, tenant_billing_settings, audit_log) + RLS + helper functions
  + tenant provisioning RPC
- `getCtx()`, guards, proxy
- i18n EN+ES skeleton
- Auth pages (login, magic-link, set-password, forgot-password)
- Three layouts: (admin), (staff), (portal) with role gating
- Tenant provisioning UI at `/admin/tenants` + license-key onboarding
- Vercel project linked, env imported, first deploy green
- Pre-push hooks (i18n drift, as-any drift) installed
- Progress.txt + CLAUDE.md committed

### Phase 1 — Customers + Inventory
Data spine. Customer CRUD with ID capture. Inventory item CRUD with
photos to Storage. Stone sub-records. NO pawn / repair / sale yet.

### Phase 2 — Pawn loans (gated on `has_pawn`)
Intake → active → redeem / extend / forfeit. Ticket print. Payment
history. Forfeit-to-inventory hook. Customer-portal loan view.

### Phase 3 — Repair / stone setting
Intake → work order board → pickup. Service-type enum drives variants.
Photo trail. Technician time logs.

### Phase 4 — Retail / POS
Sale, return, layaway, register close. Stripe Terminal binding.
Card-present payment flow.

### Phase 5 — Customer portal (full)
Loans + payoff link, repair status, layaway balance, pay-by-link.
Realtime updates on ticket status.

### Phase 6 — Communications
Twilio SMS + WhatsApp + Resend wired per-tenant. Maturity reminders,
repair-ready notifications, layaway reminders. Bilingual.

### Phase 7 — Reporting + compliance
Daily register, pawn aging, FL LeadsOnline exporter, inventory turn,
chain rollup at HQ tenants.

### Phase 8 — Polish
Mobile, audit viewer, real Stripe smoke test, dark mode (if Claude
Design palette includes one).

---

## QUICK REFERENCE — COMMANDS

```bash
npm run dev          # dev-watchdog → :3060
npm run dev:raw      # raw next dev :3060 (escape hatch)
npm run build        # production build
npm run start        # next start :3060
npm run lint
npm run db:types     # safe wrapper — write→tmp→atomic rename
npm run seed
```

---

## HANDOFF — see Progress.txt

Every session ends with a Progress.txt update. Start every session by
reading the RESUME HERE block in Progress.txt.
