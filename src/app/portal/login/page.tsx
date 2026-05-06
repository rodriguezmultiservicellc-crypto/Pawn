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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-navy px-4 py-12">
      <h1 className="font-display text-3xl font-bold text-white">Pawn</h1>
      <div className="w-full max-w-md rounded-2xl bg-card p-10 shadow-lg">
        <PortalLoginForm />
      </div>
    </div>
  )
}
