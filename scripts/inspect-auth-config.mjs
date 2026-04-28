#!/usr/bin/env node
/**
 * Print the current Supabase Auth URL configuration so we can confirm
 * what site_url + uri_allow_list look like before patching them.
 *
 * Usage: node scripts/inspect-auth-config.mjs
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

const res = await fetch(
  `https://api.supabase.com/v1/projects/${projectId}/config/auth`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
)
const body = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}`, body)
  process.exit(1)
}

const cfg = JSON.parse(body)
console.log('site_url       :', cfg.site_url)
console.log('uri_allow_list :', cfg.uri_allow_list)
console.log('mailer_autoconfirm:', cfg.mailer_autoconfirm)
console.log('disable_signup :', cfg.disable_signup)
