import PortalLoginForm from './form'

/**
 * Customer portal sign-in. Magic-link only — portal users never set a
 * password (they were onboarded via /portal/claim/<token> which created
 * their auth.users row without one). Distinct from /login (staff sign-in)
 * so customers see customer-friendly copy and don't get pulled into
 * the staff-side flows (forgot-password, set-password, etc.).
 */
export default function PortalLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-8"
        style={{
          boxShadow:
            'rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0',
        }}
      >
        <div className="mb-6 text-center">
          <h1
            className="font-display bg-clip-text text-2xl font-bold text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(90deg, #ff385c 0%, #e00b41 50%, #92174d 100%)',
            }}
          >
            Pawn
          </h1>
        </div>
        <PortalLoginForm />
      </div>
    </div>
  )
}
