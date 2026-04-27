// Phase 5: /portal/page.tsx now redirects to /portal/loans, so this client
// content component is no longer used. Kept as a no-op export so the file
// path doesn't disappear on rename — safe to delete in a future cleanup.
export default function PortalContent() {
  return null
}
