# Design System — Luna Azul (ported to Pawn)

> **Status:** Source of truth for Pawn's visual system. Replaces the previous
> Airbnb-derived system (`DESIGN-airbnb.md`, archived). Adapted from the Luna
> Azul Web SaaS at `c:\Users\rodri\OneDrive\Documents\LunaAzul Web Sass\`.
> Don't override hex values, don't substitute fonts, don't introduce
> off-system accent colors without updating this doc first.

---

## 1. Visual Theme & Atmosphere

Luna Azul reads as a professional ops console — the look of a financial /
agency dashboard, not a retail marketplace. Three signature moves carry the
identity:

- **Navy chrome, light content.** A dark navy sidebar anchors the left
  edge of every staff page, with the rest of the surface on a near-white
  blue-gray canvas. The contrast separates "where am I" from "what am I
  looking at" without needing tabs or breadcrumbs.
- **Gold for action, blue for navigation.** Primary CTAs (submit,
  confirm, pay) use the warm gold accent. Active nav items in the dark
  sidebar also read in gold. Links and active form states use the
  cooler blue. Two distinct accents, never mixed in the same role.
- **Playfair titles, DM Sans body.** Serif Playfair Display reserved for
  page titles and high-hierarchy headings — gives the app a deliberate,
  professional posture. DM Sans (sans-serif) carries every other label,
  button, and paragraph.

The interaction language is restrained: cards lift 4px on hover with a
soft shadow, primary buttons lift 2px, transitions complete in 150ms.
Nothing bounces, nothing scales beyond a hair, nothing fades in over more
than a frame.

**Key Characteristics:**
- Navy `#0d1b2a` chrome (sidebar, app frame) + light `#f7f9fc` canvas
- Gold `#e8a020` for primary CTAs and active dark-sidebar items
- Blue `#1d6fa4` for links, active form fields, secondary interaction
- Playfair Display 700/900 for page titles, DM Sans 400/600/700 for body
- 12px card / button / input radius — one radius for almost everything
- Subtle hover lift (`-translate-y-1` on cards, `-translate-y-0.5` on
  primary buttons) + `shadow-lg` on lift, no shadow at rest
- Tailwind-aligned semantic colors (emerald-500, amber-500, red-500,
  blue-500) — no dusty saturation matching, no project extensions
- One body weight: 400. Labels: 600. Buttons: 700.
- Hairline `#dde6f0` (cool tone, slightly blue) — softer than pure gray

---

## 2. Color Palette & Roles

### Brand
- **Navy** (`#0d1b2a`): The primary brand color. Sidebar background, body
  text on light surfaces, app frame chrome, brand wordmark on light
  backgrounds. Anchors every page.
- **Navy 2** (`#1a2f45`): Slight lift from Navy — used for hovered nav
  items in some contexts and panel headers when an extra step of depth
  is needed.
- **Navy 3** (`#243b55`): Lighter navy variant — used for nested panel
  surfaces or non-active sidebar group containers.

### Accent
- **Gold** (`#e8a020`): Primary action color. Submit buttons, confirm
  buttons, "Reserve" / "Pay" / "Print" CTAs. Active sidebar nav item
  text + caret. Used sparingly enough that every gold pixel reads as
  "click here."
- **Gold 2** (`#f5b942`): Hover variant. Lighter, warmer. Applied on
  primary button `:hover` along with the lift transform.
- **Blue** (`#1d6fa4`): Action color #2 — links, active form-field
  borders (focus state), secondary action buttons, inline informational
  badges.
- **Blue 2** (`#2589c8`): Hover variant for the cooler blue. Used on
  link hover and secondary button hover.

### Surface & Background
- **Background** (`#f7f9fc`): The page canvas. A very light blue-gray,
  not pure white — gives white cards on top a subtle separation without
  needing a border or shadow.
- **Card** (`#ffffff`): Pure white. Every card, modal, dropdown, sticky
  panel, and form starts here.
- **Border** (`#dde6f0`): The 1px workhorse border color. Slightly cool
  to coordinate with the Background. Separates cards, list rows, form
  fields, panel sections.

### Text
- **Foreground** (`#0d1b2a` — same hex as Navy): Headings, body
  paragraphs, navigation labels, prices. Carries ~85% of all text on a
  page.
- **Text Secondary** (`#3d5166`): One step muted. Subtitle copy under a
  page title, secondary labels, "edited 2 hours ago" metadata.
- **Muted** (`#7a90a8`): Tertiary metadata, placeholder text, disabled
  states, footer links.

### Sidebar (Dark Surface)
The sidebar runs against the rest of the system — dark surface, light
text. These tokens only apply inside the navy column.
- **Sidebar BG** (`#0d1b2a`): Same as Navy.
- **Sidebar Text Idle** (`rgba(255,255,255,0.65)`): Muted white for
  inactive nav items.
- **Sidebar Text Hover** (`rgba(255,255,255,1.00)`): Full white on hover.
- **Sidebar Active BG** (`rgba(255,255,255,0.10)`): 10% white overlay.
- **Sidebar Active Text** (`#e8a020` — Gold): Active nav item text +
  icon glow gold.

### Semantic
- **Success** (`#22c55e`): In-stock inventory, paid invoices, redeemed
  pawn tickets, ready-for-pickup repair tickets, active loan in good
  standing. Pair with `bg-green-50 / border-green-200 / text-green-700`
  for filled-pill treatments.
- **Warning** (`#f59e0b`): Pending review, due-soon loan, repair waiting
  on parts, layaway falling behind, hold-period nearing expiration.
  Pair with amber-50 / amber-200 / amber-700.
- **Danger** (`#ef4444`): Form validation errors, destructive-action
  warnings, banned customer flag, overdue loan past grace, abandoned
  repair. Pair with red-50 / red-200 / red-600.
- **Info** (`#3b82f6`): Informational badges, instructional callouts,
  "scheduled" / "queued" status. Pair with blue-50 / blue-200 / blue-600.

### Strict semantic use
The four semantic colors (Success / Warning / Danger / Info) are used
*only* for status communication. Never as decorative accents, never for
emphasis, never to make a button feel friendlier. Action color is Gold
or Blue. Status color is the four above.

### What we removed from the previous system
- The Rausch coral-pink (`#ff385c`) and the Rausch → magenta gradient.
- The Plus Magenta (`#92174d`) and Luxe Purple (`#460479`) tier colors.
- The dusty saturation-matched success/warning extensions
  (`#2D7A4E` / `#B7791F`) — replaced with the brighter Tailwind-default
  emerald and amber. The "saturation match to error red" rationale
  doesn't apply once Rausch leaves.
- Translucent Black for disabled material labels — disabled states use
  `opacity-50` + `cursor-not-allowed` instead.

### Brand gradient — none
The previous system had a coral → magenta gradient sweep for the
wordmark and search button. Luna Azul has no equivalent. The "Pawn"
wordmark renders solid:
- On dark surfaces (auth pages, sidebar header): `#ffffff`
- On light surfaces (staff topbar): `#0d1b2a` (Navy)

If a moment of brand expression is needed in the future, build it from
gold + navy, not by reintroducing a gradient.

---

## 3. Typography

### Font Stack

Two display families plus mono for tabular numerals.

- **Body / UI: DM Sans** — Google Font. Weights loaded: 400, 500, 600,
  700. The 400 is the default (every paragraph, every label, every
  nav item). 600 for form labels and emphasis. 700 reserved for primary
  buttons. 500 is used for medium-emphasis nav items.
- **Display / Headings: Playfair Display** — Google Font. Weights:
  700, 900. Used on page titles, hero numbers (KPI values on the
  dashboard if we want display rendering), brand wordmark on auth.
  Never on body paragraphs, never on buttons, never below 20px.
- **Tabular: JetBrains Mono** — Google Font. Weights: 400, 500, 600.
  Used for ticket numbers, loan principal columns, register totals,
  timestamps, item SKUs. Anything where digits must align in a column.

Inter (the previous body font) is fully retired.

### Base size

`<html>` is `font-size: 17px`. This is one notch above the browser
default 16px and gives every label a touch more presence at scale.
Tailwind's `text-sm` becomes ~14.875px and `text-base` becomes 17px.

### Hierarchy

| Role | Size | Weight | Family | Notes |
|------|------|--------|--------|-------|
| Page Title | 30px / `text-3xl` | 700 | Playfair | Dashboard headline, route landing pages |
| Section Heading | 24px / `text-2xl` | 700 | Playfair | "Recent Customers", "Active Loans" |
| Subsection Heading | 20px / `text-xl` | 600 | DM Sans | Form section, panel headers |
| KPI Value | 30px / `text-3xl` | 700 | Playfair (or DM Sans — pick consistently) | Stat-card big number |
| Card Title | 17px / `text-base` | 600 | DM Sans | Inside a card row |
| Body | 17px / `text-base` | 400 | DM Sans | Paragraphs, default label |
| Small | 14.875px / `text-sm` | 400 | DM Sans | Metadata, footer copy |
| Form Label | 14.875px / `text-sm` | 600 | DM Sans | Above input, color `text-secondary` |
| Button (Primary) | 14.875px / `text-sm` | 700 | DM Sans | Gold CTA |
| Button (Secondary) | 12.75px / `text-xs` | 600 | DM Sans | Topbar buttons, inline actions |
| Tabular | varies | 400–600 | JetBrains Mono | Money, IDs, timestamps |

### Letter-spacing

DM Sans is used at default tracking — no negative tracking on display
sizes (the previous system needed `-0.01em` to compensate for Inter
mimicking Cereal; Playfair handles its own display proportions).

### What we removed
- `font-weight: 500` as the body default. DM Sans body is 400.
- The `-0.01em` global heading tracking rule.
- The "no 400-regular" Airbnb constraint.

---

## 4. Iconography

**Icon family: Phosphor Icons (React).** This is a deliberate deviation
from Luna Azul, which uses Lucide. Pawn already imports Phosphor in 30+
files; the visual difference at 16–20px stroke weight is small enough
that Phosphor stays. Phosphor's weight variants (`Regular`, `Bold`,
`Fill`, `Duotone`) are also useful for state expression.

- **Default weight:** `Regular`
- **Active / pressed weight:** `Bold` or `Fill`
- **Disabled:** `Regular` at `opacity-40`
- **Sizes:**
  - Sidebar parent items: 18px
  - Sidebar child items: 16px
  - Card icon (in colored icon box): 18–20px
  - Inline button icon: 14–16px
  - Topbar buttons: 14–16px
- **Colors:**
  - Default: `text-foreground` (Navy) on light, `text-white/65` on dark
  - Active sidebar: `text-gold`
  - Inside colored icon boxes (dashboard module cards): `text-white`
    against the tinted bg

**Important:** Phosphor icons are client-only. Import them only in
`'use client'` components or pass them as `ReactNode` from a server
component.

---

## 5. Layout & Grid

### Page wrapper
- No global max-width container. Routes set their own constraints.
- Default horizontal padding: `px-6` (24px) on staff pages.
- Default vertical padding: `py-6`.
- Vertical rhythm between sections: `space-y-6` (24px gap).

### Two-column staff layout (sidebar + main)
```
┌────────┬─────────────────────────────────────────┐
│        │  Topbar (h-16, white, border-b)          │
│ Side   ├─────────────────────────────────────────┤
│ bar    │                                           │
│ w-52   │  <main> px-6 py-6                         │
│ navy   │                                           │
│        │                                           │
└────────┴─────────────────────────────────────────┘
```
- Sidebar: `w-52` (208px) expanded, `w-16` (64px) collapsed.
- Topbar: `h-16` (64px).
- Main: `flex-1 overflow-x-auto` — pages can scroll horizontally inside
  if needed without overflowing the shell.

### Dashboard grid
- Stat cards: `grid grid-cols-2 gap-4 lg:grid-cols-4`.
- Module-gated cards (pawn / repair / retail): `grid grid-cols-1 gap-4
  md:grid-cols-3` rendered only when the tenant flag is true.
- Recent lists (Recent Customers / Recent Inventory): `grid grid-cols-1
  gap-4 md:grid-cols-2`.

### Form layout
- Single column or `grid grid-cols-2 gap-4` for paired short fields.
- `space-y-5` between field rows.
- Submit button row: `mt-6`.

### Breakpoints
| Token | Width | Use case |
|-------|-------|----------|
| `sm` | 640px | Phone landscape / small tablet |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop |
| `xl` | 1280px | Desktop XL |
| `2xl` | 1536px | Ultra-wide |

These are Tailwind's defaults — we drop the previous system's custom
1128/1440/1760 breakpoints, since Luna Azul's design tracks Tailwind
directly.

---

## 6. Components

### Card
The system's workhorse container.
- Background: `bg-card` (`#ffffff`)
- Border: `border border-border` (1px, `#dde6f0`)
- Radius: `rounded-xl` (12px)
- Padding: `p-5` for content cards, `p-4` for compact module tiles
- Shadow at rest: none
- Shadow on hover: `hover:shadow-lg` (Tailwind's standard)
- Lift on hover: `hover:-translate-y-1` (4px up)
- Transition: `transition-all` (~150ms ease)

### Stat Card (dashboard)
- Layout: label (uppercase `text-xs text-muted`) → value (`text-3xl
  font-bold text-foreground` or Playfair) → optional sub-text
  (`text-sm text-text-secondary`)
- Icon: optional, top-right corner, `w-9 h-9 rounded-lg` colored box

### Module Card (dashboard, gated by tenant flag)
- Same shell as Card.
- Internal: colored icon box (left) + title (`text-sm font-semibold
  text-foreground`) + subtitle (`text-xs text-muted mt-0.5`)
- Hover: card lift + `group-hover:text-blue` on the title

### Primary Button (Gold CTA)
```
className="bg-gold text-navy font-bold text-sm rounded-xl
  px-5 py-3 transition-all
  hover:bg-gold-2 hover:-translate-y-0.5 hover:shadow-lg
  disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
```
- Gold background, navy text, weight 700.
- Padding scales with button size: `py-2 px-4` (sm), `py-3 px-5` (md),
  `py-3.5 px-6` (lg, full-width).
- Radius: `rounded-xl` (12px).
- Hover: lighter gold + 2px lift + shadow.
- Disabled: half opacity, no lift.

### Secondary Button (outline)
```
className="border border-border bg-card text-muted font-semibold text-xs
  rounded-lg px-3 py-1.5 transition-all
  hover:text-foreground hover:bg-background"
```
- White background, muted text, hairline border.
- Smaller radius (`rounded-lg`, 8px) and tighter padding to read as
  secondary.
- Hover: text darkens, bg goes very-light.

### Destructive / Danger Button
Same shape as Secondary, but hover applies danger color:
```
hover:text-danger hover:bg-red-50
```
Used for logout, delete confirmations, void-loan actions.

### Ghost / Sidebar Nav Item (dark surface)
```
// Inactive
className="rounded-lg px-3 py-2.5 text-sm font-medium
  text-white/65 hover:text-white hover:bg-white/5 transition-colors"

// Active
className="rounded-lg px-3 py-2.5 text-sm font-medium
  text-gold bg-white/10"
```
No border, no shadow. Color + bg overlay carry the state.

### Input (form field)
```
className="w-full px-4 py-3 bg-background border-2 border-border
  rounded-xl text-sm text-foreground outline-none transition-colors
  focus:border-blue"
```
- 2px border (heavier than the Card's 1px — inputs are interactive).
- Background `#f7f9fc` (matches page canvas), so inputs read as
  "embedded" rather than floating.
- Focus state: border color shifts to Blue. **No ring.** No glow.

### Form Label
```
className="block text-sm font-semibold text-text-secondary mb-1.5"
```
Above the input, never to the side. 600 weight, secondary text color.

### Validation / Status Pill
- Error: `bg-red-50 border border-red-200 text-red-600 text-sm
  rounded-lg p-3`
- Warning: `bg-amber-50 border border-amber-200 text-amber-700 ...`
- Success: `bg-green-50 border border-green-200 text-green-700 ...`
- Info: `bg-blue-50 border border-blue-200 text-blue-700 ...`

### Topbar
- Height: `h-16` (64px)
- Background: `bg-card border-b border-border`
- Contents (left → right): brand wordmark · separator · tenant switcher
  · spacer · admin badge (superadmin only) · language toggle · user
  name · logout button
- Each interactive control uses the Secondary Button shape.

### Tenant Switcher
- Looks like a Secondary Button at rest.
- Includes a Phosphor `Buildings` icon, 14px, to the left of the text.
- Opens a dropdown with `shadow-lg rounded-xl` panel.

### Modal / Sticky Panel
- `bg-card rounded-xl shadow-lg`
- Backdrop: `bg-black/40` (semi-transparent black)
- Padding: `p-6` for default, `p-8` for hero modals (auth, onboarding)
- Width: `max-w-md` (448px) for auth-style cards, `max-w-2xl` for
  forms, `max-w-4xl` for wide tables

### Auth Card (login, magic-link, set-password, forgot-password)
- Page background: `bg-navy` (full-bleed dark surface)
- Card: `bg-card rounded-2xl p-10 shadow-lg max-w-md`
- Header: white "Pawn" wordmark in Playfair, centered, above the card
- Form: standard Input + Form Label + Primary Button (gold)
- Body links (forgot password, signup): `text-blue` hover `text-blue-2`

---

## 7. Motion & Interaction

The motion system is intentionally narrow — CSS-only, no
JavaScript animation library, four signature behaviors:

1. **Card lift on hover** — `hover:-translate-y-1` + `hover:shadow-lg`
   over `transition-all` (~150ms). The signature interaction.
2. **Primary button lift on hover** — `hover:-translate-y-0.5` +
   `hover:shadow-lg` + color shift to gold-2.
3. **Sidebar collapse** — width transition `transition-[width]
   duration-150` between `w-52` and `w-16`. Persisted in localStorage.
4. **Sidebar group accordion** — chevron rotation via
   `transition-transform`, body height via Tailwind's
   `data-[state=open]` patterns.

### What we don't do
- No spring counters / numeric tweens. KPI values render their final
  number on first paint.
- No fade-in on page transitions. Next.js handles route changes.
- No skeleton loaders that pulse — use a stationary `bg-background`
  block of the right shape and let the data render in place.
- No bounce, no scale-up beyond `hover:scale-[1.01]` (and avoid even
  that — the lift is enough).

### Focus rings
The previous system had a 2px ink focus ring. Luna Azul uses **border
color shift** instead — focus is communicated by the input border
turning Blue, no ring. For non-input focusable elements (buttons,
links), use Tailwind's default `focus-visible:outline-2
focus-visible:outline-blue` to keep keyboard accessibility intact.

### Transitions
- Default duration: 150ms (`transition-all` Tailwind default)
- Easing: `ease` (Tailwind default)
- Avoid: 200ms+ transitions on UI controls (feels sluggish at scale)

---

## 8. Photography & Imagery

The Luna Azul system is sparse on photography — it's an ops tool, not a
showcase. Pawn inherits the same posture:

- **Inventory items** — top-light, neutral seamless background, 4:3 or
  1:1 depending on aspect needs. Multi-angle carousel inside the
  detail panel. Card thumbnails at `rounded-xl` with the same Card
  shell as everything else (no special listing-card radius).
- **Customer ID scans** — never rendered at hero scale, never shown in
  any browse surface. Locked behind admin-only signed URLs. Photo
  treatment applies only inside the customer-detail panel.
- **Repair "before / in-progress / after" trail** — 1:1 thumbnails in
  a carousel within the ticket detail. Hairline-Border dividers between
  angles. Same Card shell.
- **No stock photography.** No marketing imagery. The system is a
  workhorse.

---

## 9. Print Reports

Print PDF tokens (loan tickets, repair tickets, receipts, daily
register) are **kept separate** from the screen UI tokens. They live in
`src/lib/tokens.ts → reportColors`:

```ts
{
  body: '#3f3f3f',     // Charcoal — high contrast on paper
  muted: '#808080',    // Footer / disclaimer
  divider: '#dddddd',  // Hairline
  ink: '#222222',      // Headings, totals
}
```

Don't migrate these to the screen palette. Paper printing has different
contrast budgets than monitor rendering — Charcoal on white reads
better on a 600dpi laser print than Navy does, and the ticket layouts
are tuned to those values. PDF templates also use JetBrains Mono for
all numeric columns.

---

## 10. Tailwind Token Map

Reference for what's available as Tailwind utilities after the
migration:

| Tailwind class | Resolves to | Notes |
|---|---|---|
| `bg-navy`, `text-navy` | `#0d1b2a` | Same as `text-foreground` |
| `bg-navy-2` / `bg-navy-3` | `#1a2f45` / `#243b55` | Panel depth |
| `bg-gold` / `text-gold` | `#e8a020` | Primary action |
| `bg-gold-2` | `#f5b942` | Hover variant |
| `bg-blue` / `text-blue` | `#1d6fa4` | Action #2 / focus |
| `bg-blue-2` | `#2589c8` | Hover variant |
| `bg-background` | `#f7f9fc` | Page canvas |
| `bg-card` | `#ffffff` | Card surface |
| `border-border` | `#dde6f0` | Hairline |
| `text-foreground` | `#0d1b2a` | Default text |
| `text-text-secondary` | `#3d5166` | One step muted |
| `text-muted` | `#7a90a8` | Tertiary |
| `text-success`, `bg-success` | `#22c55e` | Status only |
| `text-warning`, `bg-warning` | `#f59e0b` | Status only |
| `text-danger`, `bg-danger` | `#ef4444` | Status only |
| `text-info`, `bg-info` | `#3b82f6` | Status only |
| `rounded-md` / `rounded-lg` / `rounded-xl` | 6 / 8 / 12 px | One radius scale |
| `shadow-lg` | Tailwind default | The hover shadow |
| `font-sans` | DM Sans | Default |
| `font-display` | Playfair Display | Page titles |
| `font-mono` | JetBrains Mono | Tabular numerals |

---

## 11. Migration notes (transitional)

The migration from the Airbnb token set replaces almost every Tailwind
class that referenced a brand color. A non-exhaustive find/replace map:

| Old | New |
|---|---|
| `bg-rausch`, `text-rausch` | `bg-gold`, `text-gold` |
| `bg-rausch-deep`, `hover:bg-rausch-deep` | `bg-gold-2`, `hover:bg-gold-2` |
| `bg-cloud` | `bg-background` |
| `border-hairline` | `border-border` |
| `text-ink` | `text-foreground` (or `text-navy`) |
| `text-charcoal` | `text-text-secondary` |
| `text-ash` | `text-muted` |
| `text-mute` | `text-muted` |
| `text-stone` | `text-muted` |
| `bg-canvas` | `bg-card` |
| `text-error`, `bg-error` | `text-danger`, `bg-danger` |
| `text-success` (dusty) | `text-success` (Tailwind emerald — same name, different hex) |
| `text-warning` (dusty) | `text-warning` (Tailwind amber — same name, different hex) |
| `rounded-pill` | `rounded-xl` (12px) — pill scale removed |
| `shadow-elevation` | `shadow-lg` |
| `font-medium` (was 500 default body) | (drop — body is 400 now) |

Some renames keep the same Tailwind class name but change the hex
(success/warning) — those don't need template edits, just a token
rebuild. The Tailwind classes that actually need template edits are the
brand colors (rausch → gold/blue) and the `cloud` / `hairline` / `ink`
/ `ash` / `mute` / `stone` neutrals.

---

## 12. Deviations from Luna Azul

We diverge from the source design in two places:

1. **Phosphor over Lucide.** Pawn keeps Phosphor Icons. Lucide is the
   icon family in Luna Azul; Phosphor is what every Pawn component
   already imports, and the visual difference at our standard sizes is
   small. Migrating 30+ files for a marginal change isn't worth the
   risk.
2. **JetBrains Mono retained.** Luna Azul doesn't use a mono family.
   Pawn does — pawn ticket numbers, money columns, register totals,
   item SKUs all benefit from tabular alignment that DM Sans can't
   provide. JetBrains Mono is loaded alongside DM Sans + Playfair.

Anything else that drifts from Luna Azul should be documented here when
it happens.
