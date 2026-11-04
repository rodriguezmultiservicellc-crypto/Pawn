import path from 'node:path'
import type { NextConfig } from 'next'

/**
 * Pin Turbopack's workspace root to this directory. Without this, Next 16
 * walks up looking for a lockfile and finds C:\Users\rodri\package-lock.json
 * (the docx skill's install) — that becomes the inferred root and breaks
 * pathing. Same fix Abacus shipped in their Session 13.
 */
/**
 * Font files for every PDF route. lib/pdf/fonts.ts reads the @fontsource
 * woff files from node_modules with fs at RUNTIME (not an import), so
 * Next's file tracer never saw them and Vercel's serverless bundle shipped
 * without them: every PDF route 500'd in production with "render failed"
 * (ENOENT on the font) while working locally. Found 2026-11-03 when the
 * first custom-quote PDF was printed on pawn-three.vercel.app — it had
 * been true of the buy / loan / sale / appraisal / report PDFs too.
 */
const PDF_FONT_FILES = [
  './node_modules/@fontsource/inter/files/inter-latin-500-normal.woff',
  './node_modules/@fontsource/inter/files/inter-latin-700-normal.woff',
  './node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff',
  './node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff',
]

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Route globs → files traced into those functions (picomatch on the
  // route path; values relative to the project root). Every route that
  // calls registerPdfFonts() lives under one of these three prefixes.
  outputFileTracingIncludes: {
    '/api/print/**': PDF_FONT_FILES,
    '/api/appraisals/**': PDF_FONT_FILES,
    '/api/reports/**': PDF_FONT_FILES,
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
