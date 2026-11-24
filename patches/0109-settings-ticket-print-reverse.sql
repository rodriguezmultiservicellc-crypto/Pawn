-- 0109 — Whether the pawn ticket prints its back side.
--
-- Some shops print tickets on blank paper: the reverse (the terms, settings.
-- pawn_ticket_backpage or the jurisdiction's ticket_backpage) must print
-- behind BOTH the customer copy and the store copy. Others use paper with
-- the back already printed: printing it again would print over it.
--
--   settings.pawn_ticket_print_reverse  TRUE  = print the back side behind
--                                               each copy (blank paper)
--                                       FALSE = never print it (pre-printed)
--
-- Default TRUE keeps what every shop prints today. No RLS policy is touched:
-- the setting is written by saveTicketBackpageAction (owner / manager) with
-- the service-role client after its guard, like pawn_ticket_backpage.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS pawn_ticket_print_reverse BOOLEAN NOT NULL DEFAULT TRUE;
