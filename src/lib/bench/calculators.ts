/**
 * The six bench calculators (brief Phase 4.1). Lives here — not in the
 * /tools server-actions file — because a 'use server' module may export
 * async functions ONLY; Next.js throws "A "use server" file can only export
 * async functions, found object" the moment an action is invoked when a
 * plain constant is exported beside them.
 */
export const CALCULATORS = [
  'ring_size',
  'weight',
  'alloy_down',
  'raise_karat',
  'mix_lots',
  'melt',
] as const

export type CalculatorKind = (typeof CALCULATORS)[number]
