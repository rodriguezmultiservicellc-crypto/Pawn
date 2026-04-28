/**
 * Home route. The proxy redirects "/" by role before this component ever
 * renders (superadmin → /admin/tenants, staff → /dashboard, client →
 * /portal, unauth → /login). This file exists so the route resolves
 * during the brief window before the proxy runs and as a fallback if
 * the matcher is ever changed.
 */
export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-canvas text-ink p-8">
      <div className="max-w-md text-center space-y-6">
        <h1 className="text-3xl font-bold">Pawn</h1>
        <p className="text-ash">
          Multi-tenant pawn / jewelry / repair / retail SaaS.
        </p>
      </div>
    </div>
  )
}
