/**
 * Type-only sidecar for actions.ts. 'use server' modules can only export
 * async functions, so any types referenced from client components live
 * here instead.
 */

export type LayawayPayActionResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string }
