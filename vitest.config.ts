import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Vitest config for pure-logic unit tests.
 *
 * Scope (v1):
 *   - `src/lib/**` — domain math, validations, state machines, formatters.
 *   - `src/types/**` — type aliases (just to typecheck imports).
 *
 * Out of scope for now: server-component / route-handler tests (would need
 * a Supabase mock surface) and React rendering tests (would need
 * @testing-library + jsdom). Add them when there's a regression worth
 * locking down — the current suite is the floor, not the ceiling.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
