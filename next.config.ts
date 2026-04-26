import path from 'node:path'
import type { NextConfig } from 'next'

/**
 * Pin Turbopack's workspace root to this directory. Without this, Next 16
 * walks up looking for a lockfile and finds C:\Users\rodri\package-lock.json
 * (the docx skill's install) — that becomes the inferred root and breaks
 * pathing. Same fix Abacus shipped in their Session 13.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
}

export default nextConfig
