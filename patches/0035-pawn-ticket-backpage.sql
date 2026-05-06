-- ───────────────────────────────────────────────────────────────────────────
-- 0035 — Pawn ticket backpage policy text
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0034 has already run.
--           Append-only — never edit prior migrations.
--
-- Adds a per-tenant override for the pawn ticket reverse-side legal
-- disclosure / policy block. The pawn ticket is a legal document; the
-- backpage carries the Florida Ch. 539 standard disclosure (forfeiture
-- terms, service charge breakdown, ID requirements, false-ID felony
-- language, lost-ticket procedure, etc.).
--
-- Default behaviour: when this column is NULL, the PDF renderer falls
-- back to the FL Ch. 539 standard text shipped in
-- src/lib/pdf/pawn-ticket-backpage-default.ts. Operators in other
-- jurisdictions, or who want to amend the FL text, write the full
-- replacement string here.
--
-- English only. Per operator: the form is a legal document and must
-- print in English regardless of customer language preference. This is
-- a deliberate exception to CLAUDE.md Rule 6 — the front of the ticket
-- still renders bilingually; only this back-side legal disclosure does
-- not.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS pawn_ticket_backpage TEXT NULL;

COMMENT ON COLUMN public.settings.pawn_ticket_backpage IS
  'Override text for the pawn ticket reverse-side legal/policy block. '
  'NULL = use the FL Ch. 539 default shipped with the renderer. '
  'English only — the ticket is a legal document.';

-- Refresh PostgREST schema cache so /api routes can see the new column
-- without a Supabase API restart.
NOTIFY pgrst, 'reload schema';
