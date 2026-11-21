/**
 * "Ledger" layout class strings, drawn with the LOCKED design tokens
 * (DESIGN-lunaazul.md): gold = primary action, blue = link / focus,
 * JetBrains Mono = money. Same values New sale's Cart.tsx uses locally.
 * Every control is at least 44px tall and shows a 3px blue focus outline.
 */

export const FOCUS =
  'focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue'

/** Small section / field label: 12px, 600, uppercase, 0.08em, muted. */
export const LABEL = 'text-xs font-semibold uppercase tracking-[0.08em] text-muted'

export const OUTLINE_BTN = `inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`

export const PRIMARY_BTN = `inline-flex items-center justify-center gap-2 rounded-md bg-gold px-4 font-bold text-navy transition-colors hover:bg-gold-2 disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`

/** 44px text input / select, 6px radius. */
export const INPUT = `block h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-blue ${FOCUS}`

/** Read-only input: subtle fill. */
export const INPUT_READONLY = `block h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-muted outline-none ${FOCUS}`
