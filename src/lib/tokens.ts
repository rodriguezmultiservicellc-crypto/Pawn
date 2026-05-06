/**
 * Design tokens — locked. See DESIGN-lunaazul.md at project root for the
 * full system, component specs, and rationale. Don't override hex values,
 * don't substitute fonts, don't introduce off-system accent colors.
 *
 * The system: navy chrome + light canvas + gold (action) / blue (link).
 * Status colors are Tailwind defaults (emerald-500 / amber-500 / red-500
 * / blue-500). Don't reintroduce the dusty saturation-matched extensions
 * from the previous Airbnb-derived system.
 */

export const colors = {
  // Brand
  navy: '#0d1b2a', // primary chrome, body text on light, sidebar bg
  navy2: '#1a2f45', // hovered nav row / panel header lift
  navy3: '#243b55', // nested panel surface

  // Accent
  gold: '#e8a020', // primary CTA, active sidebar item text
  gold2: '#f5b942', // primary button hover variant
  blue: '#1d6fa4', // links, focused form fields
  blue2: '#2589c8', // blue hover variant

  // Surface
  background: '#f7f9fc', // page canvas (light blue-gray)
  card: '#ffffff', // card / modal / panel surface
  border: '#dde6f0', // 1px workhorse border

  // Text
  foreground: '#0d1b2a', // default text — same hex as navy by design
  textSecondary: '#3d5166', // one step muted
  muted: '#7a90a8', // tertiary metadata, placeholder

  // Sidebar (dark surface) — see DESIGN-lunaazul.md §6
  sidebarText: 'rgba(255, 255, 255, 0.65)', // idle nav item
  sidebarHoverBg: 'rgba(255, 255, 255, 0.05)', // hover bg overlay
  sidebarActiveBg: 'rgba(255, 255, 255, 0.10)', // active bg overlay

  // Semantic — Tailwind-aligned, status-only
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
} as const

export type ColorToken = keyof typeof colors

/** Border radius scale. One radius for almost everything (12px). */
export const radius = {
  sm: '6px', // chips, small badges
  md: '8px', // secondary buttons, dropdown rows
  lg: '8px', // alias kept for transition; same as md
  xl: '12px', // cards, primary buttons, inputs, modals — the workhorse
  '2xl': '16px', // auth card, oversized hero panels
  full: '9999px', // pills + circular icon buttons + avatars
} as const

/** Shadow scale.
 *  - none: default for cards at rest
 *  - sm: subtle lift for hovered secondary surfaces
 *  - lg: the hover shadow used everywhere (cards lift, buttons lift)
 *  - modal: standalone modal/dropdown panel
 */
export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  modal:
    '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 8px 16px -8px rgba(0, 0, 0, 0.15)',
} as const

/** Responsive breakpoints — Tailwind defaults. Luna Azul tracks Tailwind
 *  rather than carrying custom breakpoints. */
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const

/** Report tokens — for printable PDFs (loan tickets, repair tickets,
 *  receipts, daily register). Charcoal body for high-contrast on paper.
 *  Intentionally separate from the UI tokens above — paper printing has
 *  different contrast budgets than monitor rendering. Don't migrate these
 *  to the navy/gold palette. */
export const reportColors = {
  body: '#3f3f3f', // Charcoal
  muted: '#808080', // Footer / disclaimer
  divider: '#dddddd', // Hairline gray
  ink: '#222222', // Headings, totals
} as const
