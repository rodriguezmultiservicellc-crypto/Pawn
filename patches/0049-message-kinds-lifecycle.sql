-- ============================================================================
-- PAWN — NEW MESSAGE KINDS (final notice + customer lifecycle)
-- File:    patches/0049-message-kinds-lifecycle.sql
-- Date:    2026-09-18
-- Purpose: Add the message_kind enum values used by the comms automations
--          in 0050. Split into its own patch because Postgres refuses to use
--          a freshly added enum value inside the same transaction, and
--          apply-migration runs a file as one transaction.
--
-- Apply to: existing project AFTER 0048. Append-only. Apply 0050 next.
-- After apply: run `npm run db:types`.
-- ============================================================================

ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'loan_final_notice';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'birthday_greeting';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'dormant_winback';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'forfeiture_winback';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'redemption_thankyou';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0049-message-kinds-lifecycle.sql
-- ============================================================================
