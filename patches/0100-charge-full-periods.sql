-- 0100 — How a pawn service charge accrues: full periods first, then by the day
--
-- Until now Pawn accrued the charge by the day from the day of the pawn. That
-- is not how the shop's paper ticket reads, nor what the Florida statute lets
-- a pawnbroker collect:
--
--   Fla. Stat. § 539.001(11)(c) (2026): pledged goods redeemed within 30 days
--   after the date of the pawn — the amount in (11)(a), i.e. ONE full period's
--   charge. Redeemed more than 30 days after — TWICE that amount. More than 60
--   days after — charges continue to accrue from and after the 60th day at the
--   daily rate of (11)(b): one-thirtieth of the original period's charge.
--
-- So in Florida the first TWO periods are charged in full the moment each
-- starts, and only after them does the charge run by the day. The count of
-- full periods is a statutory value: it lives here, never in app code
-- (CLAUDE.md rule 18).
--
--   charge_full_periods = 0  → by the day from the first day (no rule on file;
--                              what every loan did before this patch)
--   charge_full_periods = 2  → Florida
--
-- App side: src/lib/pawn/math.ts interestAccrued() takes the tenant's
-- ChargeModel (charge_full_periods + period_days). No SQL computes a payoff.
--
-- No policy is touched. No loan row is touched (rule 22: never bulk-touch
-- imported loans) — the model is read from the tenant's jurisdiction when a
-- payoff is figured.

ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS charge_full_periods INTEGER NOT NULL DEFAULT 0
    CHECK (charge_full_periods BETWEEN 0 AND 24);

COMMENT ON COLUMN jurisdictions.charge_full_periods IS
  'Periods, counted from the date of the pawn, whose service charge is owed in full once the period starts. After them the charge accrues by the day at 1/period_days of a period''s charge. 0 = by the day from the first day. FL = 2 (§ 539.001(11)(c)).';

UPDATE jurisdictions
   SET charge_full_periods = 2,
       verified_on = DATE '2026-11-23',
       notes = COALESCE(notes, '') || ' Charge accrual (11)(c): redeemed within 30 days = one full period''s charge; after 30 days = twice; after day 60 it accrues daily at 1/30 of the period charge (verified 2026-11-23, 2026 Florida Statutes).'
 WHERE code = 'US-FL'
   AND charge_full_periods <> 2;

SELECT code, period_days, charge_full_periods, verified_on FROM jurisdictions ORDER BY code;
