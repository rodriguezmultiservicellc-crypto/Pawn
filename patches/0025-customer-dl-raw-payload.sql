-- ───────────────────────────────────────────────────────────────────────────
-- 0025 — customers.dl_raw_payload (full AAMVA scan payload)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0024 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds `dl_raw_payload TEXT` to `customers`. Stores the full AAMVA
--   PDF417 string captured by the back-of-license scanner. The
--   parser (lib/dl-parser.ts) extracts structured fields (firstName,
--   lastName, licenseNumber, expiry, address, etc.) for the customer
--   row, but the raw payload is also retained for compliance audits
--   and re-parsing if the parser improves.
--
--   The form already passes `dl_raw_payload` as a hidden field on
--   /customers/new (since Session 13). Until this column landed, the
--   server action ignored it. After this migration applies + db:types
--   regenerates, the action writes it through.
--
-- Privacy / retention
--
--   The raw payload contains the same PII the parsed fields do
--   (DOB, address, license number) plus issuing-state-specific
--   internal codes. RLS on `customers` already locks the table to
--   tenant-staff; no additional policy needed. Retention follows the
--   same 2-year-post-transaction window as ID scans (FL pawn statute);
--   when the customer is hard-deleted, the raw payload goes with the
--   row.
--
-- Followups (NOT in this patch)
--
--   - Run `npm run db:types` after applying so src/types/database.ts
--     picks up the new column.
--   - The new/actions.ts customer-create flow reads the column from
--     FormData and writes it through.
--
-- Rollback
--
--   ALTER TABLE customers DROP COLUMN dl_raw_payload;
-- ============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS dl_raw_payload TEXT;

COMMENT ON COLUMN customers.dl_raw_payload IS
  'Full AAMVA PDF417 scan payload from the back of a US driver license. '
  'Captured by lib/dl-parser.ts via the DlScanner component. Parsed '
  'fields (name, license_number, id_expiry, address, etc.) populate '
  'their dedicated columns; this column retains the original payload '
  'for compliance audits and re-parsing. NULL when the customer was '
  'created without a scan (manual entry, passport, military ID, etc.).';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0025-customer-dl-raw-payload.sql
-- ============================================================================
