/**
 * Placeholder home page. The proxy will redirect this route by role
 * (superadmin → /admin/tenants, staff → /dashboard, client → /portal,
 * unauth → /login) once role gating is wired in. Until then, this lives
 * here so `npm run dev` shows that tokens + fonts compile cleanly.
 */
export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-canvas text-ink p-8">
      <div className="max-w-md text-center space-y-6">
        <h1 className="text-3xl font-bold">Pawn</h1>
        <p className="text-ash">
          Multi-tenant pawn / jewelry / repair / retail SaaS. Phase 0
          skeleton — auth and role gating not yet wired.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            className="bg-rausch text-canvas px-6 py-3 rounded-md font-medium"
          >
            Primary action
          </button>
          <button
            type="button"
            className="border border-hairline text-ink px-6 py-3 rounded-md font-medium"
          >
            Secondary
          </button>
        </div>
      </div>
    </div>
  )
}
