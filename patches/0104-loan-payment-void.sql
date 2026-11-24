-- 0104 — Voiding ONE payment on a pawn ticket.
--
-- Until now the only void was the whole ticket. A payment taken on the wrong
-- ticket, for the wrong amount, or by mistake had no undo.
--
-- A payment is never edited or deleted (CLAUDE.md rule 2). Voiding it writes
-- a REVERSAL: a second 'payment' row with the same money, negative, pointing
-- at the one it undoes.
--
--   loan_events.reverses_event_id   the payment this row voids (NULL on
--                                   every ordinary event)
--
-- Both rows stay in the log forever, each on the day it happened: reports
-- that add up money by date see +80.00 the day it was taken and -80.00 the
-- day it was voided. What the customer OWES ignores both — for the payoff a
-- voided payment never happened (lib/pawn/math.liveEvents).
--
--   loan_events.previous_due_date   on an event that moves the due date, the
--                                   date it moved FROM — so a void can put it
--                                   back exactly. NULL on older rows (the app
--                                   then reads the chain of earlier moves).
--
-- The database refuses a reversal that is not an exact one (trigger below):
--   - of a payment of the SAME loan and shop,
--   - that is not itself a reversal and was not voided already (unique index),
--   - that was not imported from the old system (rule 22: those were
--     reported by the old system when they happened),
--   - that was not paid online (a card charged through Stripe is refunded in
--     Stripe, not by a row here),
--   - with exactly the negated amount / principal / interest / fees.
-- And reverses_event_id can never be changed afterwards.
--
-- Both columns are added without a default: no row is rewritten and no
-- trigger fires on the 84,000 imported events. No RLS policy is touched —
-- who may void (owner / manager) is checked by the server action, like free
-- time (0101).

ALTER TABLE loan_events
  ADD COLUMN IF NOT EXISTS reverses_event_id UUID REFERENCES loan_events(id),
  ADD COLUMN IF NOT EXISTS previous_due_date DATE;

COMMENT ON COLUMN loan_events.reverses_event_id IS
  'Set on the row that VOIDS a payment: the payment it undoes. The row carries that payment''s money negated. For the payoff both rows are ignored (lib/pawn/math.liveEvents); for reports by date both count, each on its own day.';
COMMENT ON COLUMN loan_events.previous_due_date IS
  'On an event that moves the due date (new_due_date): the due date before it. NULL on rows written before patches/0104.';

-- A payment is voided once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_events_reverses
  ON loan_events (reverses_event_id)
  WHERE reverses_event_id IS NOT NULL;

-- Negative money only on a reversal (any column) or, as before (0103), as
-- interest given back against principal paid in the same event.
ALTER TABLE loan_events DROP CONSTRAINT IF EXISTS loan_events_split_signs;
ALTER TABLE loan_events ADD CONSTRAINT loan_events_split_signs CHECK (
  reverses_event_id IS NOT NULL
  OR (
    principal_paid >= 0
    AND fees_paid >= 0
    AND (interest_paid >= 0 OR principal_paid + interest_paid >= 0)
  )
);

CREATE OR REPLACE FUNCTION loan_events_check_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  o loan_events%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.reverses_event_id IS DISTINCT FROM OLD.reverses_event_id THEN
      RAISE EXCEPTION 'payment_void_immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.reverses_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO o FROM loan_events WHERE id = NEW.reverses_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_void_not_found' USING ERRCODE = 'check_violation';
  END IF;
  IF o.loan_id <> NEW.loan_id OR o.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'payment_void_other_loan' USING ERRCODE = 'check_violation';
  END IF;
  IF o.event_type <> 'payment' OR NEW.event_type <> 'payment' THEN
    RAISE EXCEPTION 'payment_void_not_a_payment' USING ERRCODE = 'check_violation';
  END IF;
  IF o.reverses_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'payment_void_of_a_void' USING ERRCODE = 'check_violation';
  END IF;
  IF o.legacy_ref IS NOT NULL THEN
    RAISE EXCEPTION 'payment_void_imported' USING ERRCODE = 'check_violation';
  END IF;
  IF o.stripe_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'payment_void_online' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.principal_paid <> -o.principal_paid
     OR NEW.interest_paid <> -o.interest_paid
     OR NEW.fees_paid <> -o.fees_paid
     OR COALESCE(NEW.amount, 0) <> -COALESCE(o.amount, 0) THEN
    RAISE EXCEPTION 'payment_void_not_exact' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loan_events_check_reversal ON loan_events;
CREATE TRIGGER trg_loan_events_check_reversal
BEFORE INSERT OR UPDATE OF reverses_event_id ON loan_events
FOR EACH ROW EXECUTE FUNCTION loan_events_check_reversal();
