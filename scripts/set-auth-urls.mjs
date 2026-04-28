#!/usr/bin/env node
/**
 * One-shot: set Supabase Auth `site_url` + `uri_allow_list` to Pawn's
 * production + localhost (port 3060). Required for the portal-invite
 * magic-link flow — Supabase falls back to site_url when redirect_to
 * isn't in the allowlist.
 *
 * Usage: node scripts/set-auth-urls.mjs
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
if (!projectId || !accessToken) {
  console.error('SUPABASE_PROJECT_ID + SUPABASE_ACCESS_TOKEN required')
  process.exit(2)
}

const PROD_URL = 'https://pawn-three.vercel.app'
const DEV_URL = 'http://localhost:3060'

const body = {
  site_url: PROD_URL,
  uri_allow_list: `${PROD_URL}/**,${DEV_URL}/**`,
}

console.log('PATCH /v1/projects/' + projectId + '/config/auth')
console.log(JSON.stringify(body, null, 2))

const res = await fetch(
  `https://api.supabase.com/v1/projects/${projectId}/config/auth`,
  {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  },
)
const text = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}`, text)
  process.exit(1)
}
console.log(`HTTP ${res.status} OK`)
const cfg = JSON.parse(text)
console.log('site_url now       :', cfg.site_url)
console.log('uri_allow_list now :', cfg.uri_allow_list)
