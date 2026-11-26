-- 0117 — Move a New pawn ticket to another device with a QR code (Eddy,
-- 2026-11-26: "the iPad scans the QR code, the transaction closes as is in
-- that computer and opens in the new machine").
--
-- The ticket travels as a loan draft (patches/0045): the computer saves it,
-- shows a QR code for /pawn/new?draft=<id>&handoff=<code>, and the device
-- that opens it CLAIMS the draft. The computer sees the claim and closes its
-- copy, so one ticket is never on two screens.
--
-- The code is one-time and short-lived (10 minutes, src/lib/pawn/draft-
-- handoff.ts). Only its SHA-256 is kept. It is not a login: the device that
-- scans it must be signed in as staff of this shop, and RLS on loan_drafts
-- (unchanged) decides what it can read.
--
-- New columns only. No policy is added or changed.

ALTER TABLE loan_drafts
  ADD COLUMN IF NOT EXISTS handoff_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS handoff_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_claimed_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN loan_drafts.handoff_token_hash IS
  'SHA-256 (hex) of the one-time code in the QR handoff link; NULL when no handoff is waiting.';
COMMENT ON COLUMN loan_drafts.handoff_claimed_at IS
  'When another device opened the draft through the QR code; the device that showed the code closes its copy.';

NOTIFY pgrst, 'reload schema';
