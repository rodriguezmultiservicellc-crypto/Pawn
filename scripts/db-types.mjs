#!/usr/bin/env node
/**
 * Safe wrapper around `supabase gen types typescript`.
 *
 * Why this exists: a raw shell redirect (`supabase gen types > database.ts`)
 * truncates the destination file BEFORE the supabase CLI runs. If the CLI
 * fails for any reason (auth missing, network error, project ID wrong), the
 * destination is now empty AND the carefully hand-written aliases at the
 * bottom of database.ts are GONE. Abacus Session 15 lost an afternoon's
 * worth of types this way.
 *
 * This script:
 *   1. Spawns supabase gen types and captures stdout to memory.
 *   2. Validates: minimum size, contains `export type Database`.
 *   3. Writes to <target>.tmp.
 *   4. Atomically renames to <target>.
 *   5. Appends `export * from './database-aliases'` so hand-written aliases
 *      survive every regen.
 *
 * Usage:
 *   npm run db:types
 *
 * Required env (in .env.local OR shell):
 *   SUPABASE_PROJECT_ID  — the project ref (lives in the dashboard URL)
 *   SUPABASE_ACCESS_TOKEN — personal access token from
 *                            https://supabase.com/dashboard/account/tokens
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const target = resolve(projectRoot, 'src/types/database.ts')
const tmp = `${target}.tmp`
const envFile = resolve(projectRoot, '.env.local')

// Load .env.local manually (no dotenv dep).
function loadEnvFile() {
  if (!existsSync(envFile)) return
  const text = readFileSync(envFile, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (!m) continue
    const [, key, raw] = m
    if (process.env[key]) continue
    // Strip optional surrounding quotes
    const v = raw.replace(/^["']|["']$/g, '')
    process.env[key] = v
  }
}

loadEnvFile()

const projectId = process.env.SUPABASE_PROJECT_ID
const accessToken = process.env.SUPABASE_ACCESS_TOKEN

if (!projectId) {
  console.error(
    '[db:types] SUPABASE_PROJECT_ID missing. Add it to .env.local (the project ref from the Supabase dashboard URL).',
  )
  process.exit(2)
}
if (!accessToken) {
  console.error(
    '[db:types] SUPABASE_ACCESS_TOKEN missing. Generate one at https://supabase.com/dashboard/account/tokens and add to .env.local.',
  )
  process.exit(2)
}

console.log(`[db:types] generating types for project ${projectId}…`)

const result = spawnSync(
  'npx',
  ['supabase', 'gen', 'types', 'typescript', '--project-id', projectId],
  {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken },
    shell: true,
    maxBuffer: 50 * 1024 * 1024,
  },
)

if (result.error) {
  console.error('[db:types] spawn error:', result.error.message)
  process.exit(1)
}
if (result.status !== 0) {
  console.error('[db:types] supabase CLI exited with code', result.status)
  if (result.stderr) console.error(result.stderr.toString())
  process.exit(1)
}

const stdout = result.stdout?.toString() ?? ''

// Validate output before touching the destination.
if (stdout.length < 500) {
  console.error(
    `[db:types] output too short (${stdout.length} bytes) — refusing to write. Check your Supabase project + access token.`,
  )
  process.exit(1)
}
if (!stdout.includes('export type Database')) {
  console.error(
    "[db:types] output missing `export type Database` — refusing to write. Check your Supabase CLI version.",
  )
  process.exit(1)
}

const content = `${stdout.replace(/\s+$/, '')}\n\n// Hand-written aliases — re-exported so they survive every regen.\nexport * from './database-aliases'\n`

if (!existsSync(dirname(target))) {
  mkdirSync(dirname(target), { recursive: true })
}

writeFileSync(tmp, content, 'utf8')
renameSync(tmp, target) // atomic on POSIX, atomic-enough on Windows for our purposes

console.log(`[db:types] wrote ${target} (${content.length} bytes).`)
