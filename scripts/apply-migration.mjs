#!/usr/bin/env node
/**
 * Apply a SQL migration file to the linked Supabase project via the
 * Management API (https://api.supabase.com/v1/projects/{ref}/database/query).
 *
 * Usage:
 *   node scripts/apply-migration.mjs patches/0005-pawn-loans.sql
 *
 * Required env (read from .env.local same as db-types.mjs):
 *   SUPABASE_PROJECT_ID
 *   SUPABASE_ACCESS_TOKEN
 *
 * Mirrors the SQL Editor UX — the whole file is sent as one request and
 * runs in a single transaction (Supabase wraps it). If any statement
 * fails, the whole patch rolls back. Output (rows or error) is printed.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const envFile = resolve(projectRoot, '.env.local')

function loadEnvFile() {
  if (!existsSync(envFile)) return
  const text = readFileSync(envFile, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (!m) continue
    const [, key, raw] = m
    if (process.env[key]) continue
    process.env[key] = raw.replace(/^["']|["']$/g, '')
  }
}

loadEnvFile()

const projectId = process.env.SUPABASE_PROJECT_ID
const accessToken = process.env.SUPABASE_ACCESS_TOKEN

if (!projectId) {
  console.error('[apply-migration] SUPABASE_PROJECT_ID missing in .env.local')
  process.exit(2)
}
if (!accessToken) {
  console.error('[apply-migration] SUPABASE_ACCESS_TOKEN missing in .env.local')
  process.exit(2)
}

const argPath = process.argv[2]
if (!argPath) {
  console.error('[apply-migration] usage: node scripts/apply-migration.mjs <path-to-sql>')
  process.exit(2)
}

const sqlPath = resolve(projectRoot, argPath)
if (!existsSync(sqlPath)) {
  console.error(`[apply-migration] not found: ${sqlPath}`)
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
console.log(`[apply-migration] applying ${argPath} (${sql.length} bytes) to project ${projectId}…`)

const res = await fetch(
  `https://api.supabase.com/v1/projects/${projectId}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  },
)

const body = await res.text()
if (!res.ok) {
  console.error(`[apply-migration] HTTP ${res.status} ${res.statusText}`)
  console.error(body)
  process.exit(1)
}

console.log(`[apply-migration] HTTP ${res.status} OK`)
try {
  const parsed = JSON.parse(body)
  if (Array.isArray(parsed) && parsed.length === 0) {
    console.log('[apply-migration] (no result rows — DDL applied successfully)')
  } else {
    console.log(JSON.stringify(parsed, null, 2))
  }
} catch {
  console.log(body)
}
