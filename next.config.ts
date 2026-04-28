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
  // Forward Vercel build-time git metadata to the client bundle so the
  // VersionFooter component can render commit message, author, branch,
  // and a wall-clock build time. VERCEL_GIT_COMMIT_SHA + VERCEL_ENV are
  // already auto-exposed with NEXT_PUBLIC_ prefix; the rest are not.
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE:
      process.env.VERCEL_GIT_COMMIT_MESSAGE || '',
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_AUTHOR_NAME:
      process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME || '',
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF:
      process.env.VERCEL_GIT_COMMIT_REF || '',
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
}

export default nextConfig
