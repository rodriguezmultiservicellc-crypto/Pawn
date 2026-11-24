-- 0101 — Interest a manager chose not to charge ("free time" on a pawn ticket)
--
-- Eddy (2026-11-23): "the manager can give free months or days", and the
-- interest for that time is NOT charged.
--
-- A manager gives a customer free time on a ticket: the due date moves and
-- the charge for those days is forgiven. Forgiven interest is not interest
-- collected, so it gets its own column instead of riding in interest_paid —
-- every report that adds up interest_paid as income (loan activity, the
-- cross-shop rollup, "interest earned") stays true without a filter.
--
--   loan_events.interest_waived   what was forgiven by THIS event; 0 on every
--                                 other row. Written on an 'extension' event
--                                 together with new_due_date.
--
-- A payoff counts it against the accrued charge exactly like interest paid:
--   interest outstanding = accrued − SUM(interest_paid) − SUM(interest_waived)
-- (src/lib/pawn/math.ts appliedPayments / payoffBalance). The column is a
-- REQUIRED field of the events every payoff surface passes, so none can
-- charge a customer interest that was forgiven.
--
-- Adding a column with a constant default rewrites no row and fires no
-- trigger: the 84,000 imported events are not touched (rule 22). No policy is
-- touched — staff write loan_events under the existing policy; the server
-- action that writes a waiver is gated to owner / manager / chain_admin.

ALTER TABLE loan_events
  ADD COLUMN IF NOT EXISTS interest_waived NUMERIC(18,4) NOT NULL DEFAULT 0
    CHECK (interest_waived >= 0);

COMMENT ON COLUMN loan_events.interest_waived IS
  'Interest forgiven by this event (a manager''s free time). Counts against the accrued charge like interest_paid, but is NOT income. 0 on every other event.';

SELECT count(*) AS events, COALESCE(SUM(interest_waived), 0) AS waived FROM loan_events;
