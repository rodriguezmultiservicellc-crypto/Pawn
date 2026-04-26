// Dev-server watchdog. Caps heap, restarts on crash, and cycles proactively
// every N minutes to contain the Next 16 Turbopack memory leak.
//
// Cloned from the Abacus watchdog (C:\Users\rodri\OneDrive\Documents\Abacus\
// dev-watchdog.mjs) which was itself adapted from Luna Azul. Pawn runs on
// port 3060 — Luna Azul owns 3000, Abacus owns 3030. Do NOT change the port
// here without coordinating across the three apps.
//
// The Windows-specific fixes are non-negotiable:
//   - taskkill /T /F to walk the cmd.exe → node tree (SIGTERM to a shell:true
//     spawn doesn't propagate on Windows; the node grandchild lingers and
//     holds the port)
//   - waitForPortFree before binding so EADDRINUSE doesn't crash the respawn
//     loop after a proactive cycle
//
// Tunables via env:
//   DEV_HEAP_MB=4096        — max heap per dev process
//   DEV_CYCLE_MINUTES=25    — proactive restart interval (must beat the leak)
//   DEV_RESPAWN_DELAY_MS=2000
//   DEV_PORT=3060           — override the dev port
//
// Run with: node dev-watchdog.mjs

import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

const HEAP_MB = Number(process.env.DEV_HEAP_MB || 4096)
const CYCLE_MS = Number(process.env.DEV_CYCLE_MINUTES || 25) * 60 * 1000
const RESPAWN_DELAY_MS = Number(process.env.DEV_RESPAWN_DELAY_MS || 2000)
const DEV_PORT = String(process.env.DEV_PORT || 3060)
const IS_WIN = process.platform === 'win32'
const PORT_FREE_TIMEOUT_MS = 20000

let child = null
let cycleTimer = null
let stopping = false
let cycleCount = 0
let lastStartTs = 0
let fastFailCount = 0

// If the child dies faster than MIN_UPTIME_MS we consider it a failed start
// and back off. Prevents tight crash loops (e.g. another dev server already
// holding port 3060) from hammering the machine.
const MIN_UPTIME_MS = 10000
const MAX_FAST_FAILS = 3

function log(msg) {
  const ts = new Date().toLocaleTimeString()
  process.stdout.write(`\n[watchdog ${ts}] ${msg}\n`)
}

// Windows shell:true spawn gives us the cmd.exe PID, not Next's node PID.
// SIGTERM to cmd.exe does NOT propagate, so next dev lingers on the port.
// taskkill /T /F walks the child tree and kills node too.
function killChildTree(ch) {
  if (!ch || ch.killed) return
  if (IS_WIN && ch.pid) {
    try {
      spawnSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {}
  } else {
    try { ch.kill('SIGTERM') } catch {}
  }
}

// Probe the port. Returns true when nothing is listening.
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(Number(port), '0.0.0.0')
  })
}

async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function startChild() {
  // Always confirm the port is free before binding. Prevents EADDRINUSE when
  // a previous child hasn't fully released the socket yet (common on Windows
  // after a proactive SIGTERM cycle).
  const free = await waitForPortFree(DEV_PORT, PORT_FREE_TIMEOUT_MS)
  if (!free) {
    log(`port :${DEV_PORT} still held after ${PORT_FREE_TIMEOUT_MS}ms — aborting. Kill whatever is listening (taskkill /F /PID <pid>) and rerun npm run dev.`)
    process.exit(1)
  }

  cycleCount += 1
  lastStartTs = Date.now()
  log(`starting next dev on :${DEV_PORT} (cycle #${cycleCount}, heap=${HEAP_MB}MB, cycle=${CYCLE_MS / 60000}min)`)

  child = spawn('next', ['dev', '-p', DEV_PORT], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}`,
    },
  })

  child.on('exit', (code, signal) => {
    if (cycleTimer) {
      clearTimeout(cycleTimer)
      cycleTimer = null
    }
    if (stopping) return

    const uptime = Date.now() - lastStartTs
    const reason = signal ? `signal ${signal}` : `code ${code}`

    if (uptime < MIN_UPTIME_MS) {
      fastFailCount += 1
      if (fastFailCount >= MAX_FAST_FAILS) {
        log(`dev exited (${reason}) after ${uptime}ms — ${fastFailCount} fast failures in a row. Bailing out. Fix the underlying error (port conflict, syntax error, etc.) then run npm run dev again.`)
        process.exit(1)
      }
      const backoff = Math.min(30000, RESPAWN_DELAY_MS * Math.pow(3, fastFailCount))
      log(`dev exited (${reason}) after ${uptime}ms — likely startup error. Backing off ${backoff}ms (${fastFailCount}/${MAX_FAST_FAILS}).`)
      setTimeout(() => { startChild().catch((e) => { log(`startChild failed: ${e?.message ?? e}`); process.exit(1) }) }, backoff)
      return
    }

    fastFailCount = 0
    log(`dev exited (${reason}) after ${Math.round(uptime / 1000)}s; respawning in ${RESPAWN_DELAY_MS}ms`)
    setTimeout(() => { startChild().catch((e) => { log(`startChild failed: ${e?.message ?? e}`); process.exit(1) }) }, RESPAWN_DELAY_MS)
  })

  // Proactive restart before the leak gets bad. Tree-kill so Next actually
  // dies on Windows (SIGTERM to a shell:true cmd wrapper is a no-op for
  // the node grandchild).
  cycleTimer = setTimeout(() => {
    if (!child) return
    log(`proactive restart — ${CYCLE_MS / 60000}min cycle elapsed`)
    killChildTree(child)
  }, CYCLE_MS)
}

function shutdown() {
  if (stopping) return
  stopping = true
  log('shutdown requested; stopping dev server')
  if (cycleTimer) clearTimeout(cycleTimer)
  if (child) {
    killChildTree(child)
    setTimeout(() => process.exit(0), 3000)
  } else {
    process.exit(0)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGBREAK', shutdown)

startChild().catch((e) => { log(`startChild failed: ${e?.message ?? e}`); process.exit(1) })
