/**
 * Design tokens — locked. See DESIGN-airbnb.md at project root for the full
 * system, component specs, and rationale. Don't override hex values, don't
 * substitute fonts, don't introduce off-system accent colors.
 *
 * Two extensions over the Airbnb-extracted palette:
 *   - successGreen / successDeep (#2D7A4E / #1F5535)
 *   - warningAmber / warningDeep (#B7791F / #8C5A14)
 * Saturation matched to Error Red's #c13515. Strictly semantic — never
 * decorative, never for emphasis, never outside status communication.
 */

export const colors = {
  // Brand
  rausch: '#ff385c',
  rauschDeep: '#e00b41',
  plusMagenta: '#92174d',
  luxePurple: '#460479',

  // Surface
  canvas: '#ffffff',
  cloud: '#f7f7f7',
  hairline: '#dddddd',

  // Text
  ink: '#222222',
  charcoal: '#3f3f3f',
  ash: '#6a6a6a',
  mute: '#929292',
  stone: '#c1c1c1',

  // Semantic — from Airbnb
  error: '#c13515',
  errorDeep: '#b32505',
  infoLink: '#428bff',

  // Semantic — project extensions (financial state)
  success: '#2D7A4E',
  successDeep: '#1F5535',
  warning: '#B7791F',
  warningDeep: '#8C5A14',

  // Misc
  translucentBlack: 'rgba(0, 0, 0, 0.24)',
} as const

export type ColorToken = keyof typeof colors

/** The Rausch → magenta sweep — only used on the wordmark and the branded
 *  search button. Never as a full surface. */
export const brandGradient =
  'linear-gradient(90deg, #ff385c 0%, #e00b41 50%, #92174d 100%)'

/** Border radius scale. Pick from this set, never invent a value. */
export const radius = {
  sm: '4px', // chips, inline tags
  md: '8px', // text buttons, dropdowns
  lg: '14px', // listing/inventory card photography, generic containers
  xl: '20px', // pill buttons, large images, booking-panel-style cards
  pill: '32px', // search bar pill, extra-large containers
  full: '9999px', // every circular icon button + every avatar
} as const

/** Shadow scale. Three levels.
 *  - level 0: no shadow (default for cards on canvas — listing cards, body)
 *  - level 1: active/pressed icon button lift
 *  - level 2: signature three-layer elevation (sticky panels, modals, dropdowns)
 *
 *  The level-2 shadow is intentionally three stacked low-opacity shadows.
 *  Don't collapse to a single drop shadow — the multi-layer anti-aliasing
 *  is the visual signature.
 */
export const shadows = {
  none: 'none',
  pressedIcon: 'rgba(0, 0, 0, 0.08) 0 4px 12px',
  elevation:
    'rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0',
  focusRing: '0 0 0 2px #222222',
  whiteSeparatorRing: 'rgb(255, 255, 255) 0 0 0 4px',
} as const

/** Responsive breakpoints (pixel widths). Mirrors DESIGN-airbnb.md §8 with
 *  the most useful subset for our staff + portal surfaces. Tailwind v4
 *  reads these via the @theme block in globals.css. */
export const breakpoints = {
  sm: '550px', // small tablet / phone landscape
  md: '800px', // tablet
  lg: '1128px', // desktop
  xl: '1440px', // desktop XL
  '2xl': '1760px', // ultra-wide
} as const

/** Report tokens — for printable PDFs (loan tickets, repair tickets,
 *  receipts, daily register). Charcoal body for high-contrast on paper.
 *  These are intentionally separate from the UI tokens above. */
export const reportColors = {
  body: '#3f3f3f', // Charcoal
  muted: '#808080', // Footer / disclaimer
  divider: '#dddddd', // Hairline Gray
  ink: '#222222', // Headings, totals
} as const
