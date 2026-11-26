-- 0116 — An appraisal's purity follows the metal, like every other item
-- (CLAUDE.md rule 31; Eddy, 2026-11-25: "do the same on the calculator and
-- appraisals").
--
-- appraisals.karat was NUMERIC(4,2): 99.99 at most, so a sterling (925) or
-- platinum (950) piece could not be saved. It becomes NUMERIC(4,1), the same
-- as loan_collateral_items.karat: gold in karats (1-24), silver / platinum /
-- palladium in parts per thousand (100-999.9). The range per metal is checked
-- by the app (src/lib/spot-prices/purity.ts), as for loan collateral.
--
-- Live data at the time of writing: 0 appraisals, no view depends on the
-- column. Widening never loses a value; a karat with two decimals (none
-- exist) would round to one.

ALTER TABLE appraisals
  ALTER COLUMN karat TYPE NUMERIC(4,1);

COMMENT ON COLUMN appraisals.karat IS
  'Purity: karats for gold (14 = 14K), parts per thousand for silver / platinum / palladium (925, 950). Rules in src/lib/spot-prices/purity.ts.';
