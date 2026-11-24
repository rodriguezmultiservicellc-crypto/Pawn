-- 0112 — Several pawn tickets paid in one visit.
--
-- A customer with more than one ticket pays them together at the counter:
-- one payment method, one total, one receipt. Each ticket still gets its
-- OWN payment event with its own split (interest / principal / fees, rule
-- 18) and its own due-date move. What was missing is the link between them:
--
--   loan_events.payment_group_id   the same UUID on every payment event of
--                                  one "Pay together"; NULL on a payment
--                                  taken by itself.
--
-- The combined receipt is read by this id, so it can be printed again later
-- from any of the tickets. A payment in a group is still voided on its own
-- (rule 23): the group is a receipt, not a transaction.
--
-- No RLS policy is touched (the column is read and written under the
-- existing loan_events policies).

ALTER TABLE loan_events
  ADD COLUMN IF NOT EXISTS payment_group_id UUID;

COMMENT ON COLUMN loan_events.payment_group_id IS
  'Same UUID on every payment of one multi-ticket payment (Pay together); NULL for a payment taken alone. Read by the combined receipt.';

CREATE INDEX IF NOT EXISTS idx_loan_events_payment_group
  ON loan_events (tenant_id, payment_group_id)
  WHERE payment_group_id IS NOT NULL;
