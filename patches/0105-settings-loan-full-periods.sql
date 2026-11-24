-- 0105 — Each shop chooses after how many months its pawn charge is prorated.
--
-- patches/0100 put the LAW's answer on the jurisdiction: Florida lets a
-- pawnbroker collect the first two 30-day periods in full and only then run
-- the charge by the day (Fla. Stat. § 539.001(11)(c)). That is a ceiling, not
-- an order: a shop may charge less. Eddy's Jewelers charges the first month
-- flat and prorates from there.
--
--   settings.loan_full_periods   how many periods, counted from the date of
--                                the pawn, THIS shop charges in full before
--                                the charge runs by the day.
--                                NULL = as many as its jurisdiction allows.
--
-- The effective value is never above jurisdictions.charge_full_periods: the
-- app takes the smaller of the two wherever it figures a payoff
-- (lib/jurisdictions/rules.effectiveRules -> chargeModelOf), so a value
-- stored here can never make a shop charge more than its state allows.
-- Where the state allows at least one full period the first one always
-- stays full — the ticket prints "you will not be entitled to a refund of
-- part of the finance charge" (patches/0102), and that has to stay true.
--
-- Added with no default: every shop keeps charging exactly as it did. No RLS
-- policy is touched (settings is already owner-write).

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS loan_full_periods INTEGER
    CHECK (loan_full_periods IS NULL OR loan_full_periods BETWEEN 0 AND 24);

COMMENT ON COLUMN settings.loan_full_periods IS
  'Periods from the date of the pawn this shop charges in full before the pawn service charge runs by the day. NULL = the jurisdiction''s maximum (jurisdictions.charge_full_periods). Never effective above that maximum.';
