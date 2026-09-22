-- ===========================================================================
-- 0057 — NORMALIZE CUSTOMER PHYSICAL-DESCRIPTION VALUES  *** NOT APPLIED ***
-- ===========================================================================
-- STATUS: written 2026-09-22, deliberately NOT run. This UPDATEs customer
-- records that FL Stat. § 539.001 requires the shop to hold, so it needs an
-- explicit go-ahead. Apply with:
--     node scripts/apply-migration.mjs patches/0057-normalize-customer-description-values.sql
--
-- WHY IT EXISTS
-- The add/edit forms now use dropdowns whose values reproduce the vocabulary
-- already in the data (src/lib/customers/physical-description.ts). A handful of
-- imported rows carry casing variants of those same values. Nothing is broken —
-- the dropdown preserves any off-list value and preselects it, so no data is
-- lost and no edit blanks a field. But those rows show their raw value
-- ('BLACK') next to the canonical option ('Black'), which reads like two
-- different colors.
--
-- COUNTS OBSERVED 2026-09-22 (5,218 customers):
--     sex        'm'      1 row    -> 'M'
--     hair_color 'BLACK'  1 row    -> 'Black'
--     hair_color 'black'  1 row    -> 'Black'
--   Total: 3 rows. Everything else already matches a canonical option.
--
-- DELIBERATELY NOT INCLUDED: hair_color 'Auburn' (36 rows) vs 'Red Or Auburn'
-- (87 rows). Both are offered as separate dropdown options because merging them
-- is a judgement call about what the shop means, not a casing fix. If you want
-- them merged, say so and it becomes its own patch.
--
-- SAFETY: scoped by exact match, so re-running is a no-op. compliance_log is
-- unaffected — it snapshots at transaction time and is write-once, so past
-- police-report rows keep whatever they recorded.
-- ===========================================================================

BEGIN;

-- Show what is about to change (the RAISE lands in the query result/logs).
DO $$
DECLARE
  v_sex  INT;
  v_hair INT;
BEGIN
  SELECT COUNT(*) INTO v_sex  FROM customers WHERE sex = 'm';
  SELECT COUNT(*) INTO v_hair FROM customers WHERE hair_color IN ('BLACK', 'black');
  RAISE NOTICE '0057: normalizing % sex row(s) and % hair_color row(s)', v_sex, v_hair;
END $$;

UPDATE customers SET sex = 'M'
WHERE sex = 'm';

UPDATE customers SET hair_color = 'Black'
WHERE hair_color IN ('BLACK', 'black');

COMMIT;

-- Verify (expect zero rows):
--   SELECT id, sex, hair_color FROM customers
--   WHERE sex = 'm' OR hair_color IN ('BLACK','black');

-- ===========================================================================
-- END 0057-normalize-customer-description-values.sql
-- ===========================================================================
