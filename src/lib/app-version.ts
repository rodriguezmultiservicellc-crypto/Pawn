// Bump APP_VERSION when shipping a noteworthy release. Prepend an entry
// to VERSIONS with a one-line summary — this is what shows in the footer
// history modal.

export const APP_NAME = 'Pawn'
export const APP_VERSION = '0.7.0'

export interface VersionEntry {
  v: string
  date: string
  notes: string
}

export const VERSIONS: VersionEntry[] = [
  {
    v: '0.7.0',
    date: '2026-04-28',
    notes:
      'Save bug fixed (selects rejecting "" + React 19 form-reset wipe). Path B migrations applied (spot prices, appraisals, eBay).',
  },
  {
    v: '0.6.0',
    date: '2026-04-28',
    notes:
      'Phase 9 Path A SaaS billing schema + admin /admin/billing console. Sidebar collapse with phone auto-collapse. Migrations 0009/0010/0011 applied.',
  },
  {
    v: '0.5.0',
    date: '2026-04-27',
    notes:
      'Phases 5/6/7 merged: customer portal, per-tenant comms (Twilio + Resend), reporting + FL LeadsOnline draft. Vibrant-dark dashboard ported.',
  },
  {
    v: '0.4.0',
    date: '2026-04-27',
    notes: 'Phase 4 retail/POS + Phase 3 repair tickets + bilingual print PDFs + DL scanner.',
  },
  {
    v: '0.3.0',
    date: '2026-04-27',
    notes: 'Phase 2 pawn loans + inventory transfers UI + audit log viewer.',
  },
  {
    v: '0.2.0',
    date: '2026-04-26',
    notes: 'Phase 1 customers + inventory CRUD with audit logging.',
  },
  {
    v: '0.1.0',
    date: '2026-04-26',
    notes: 'Foundation skeleton: tenants, profiles, RLS, auth, i18n, design tokens.',
  },
]
