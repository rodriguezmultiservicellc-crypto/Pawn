-- ───────────────────────────────────────────────────────────────────────────
-- 0052 — payment_method += 'store_credit'
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0051 has already run.
--           Append-only — never edit prior migrations.
--
-- Why this is its own patch
--
--   scripts/apply-migration.mjs sends the whole file as ONE request, and
--   the Management API wraps it in a single transaction. Postgres refuses
--   to USE an enum value in the same transaction that ADDs it:
--
--     ERROR: unsafe use of new value "store_credit" of enum type payment_method
--
--   0053-store-credit.sql references 'store_credit' in a CHECK-equivalent
--   position (the redeem RPC inserts sale_payments with that literal), so
--   the ADD VALUE has to land and commit first. Same split as 0049/0050.
--
-- What changes
--
--   payment_method gains 'store_credit'. It joins cash / card / check /
--   other on sale_payments.payment_method, returns.refund_method,
--   layaway_payments.payment_method and loan_payments.payment_method.
--
--   NOTE: adding the value does NOT make every tender path accept it. The
--   app deliberately keeps 'store_credit' OUT of the generic add-payment
--   schema (src/lib/validations/pos.ts paymentMethodSchema) — a store
--   credit tender must go through store_credit_redeem_on_sale() so the
--   customer's balance is debited in the same transaction as the payment
--   row. Only refund_method (returns) and the buy-outright payout method
--   take it directly.
--
-- Rollback
--
--   Postgres cannot drop a single enum value. Reversing this means
--   recreating the type and rewriting every dependent column — do not
--   attempt on a live database; leave the unused value in place instead.
-- ============================================================================

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'store_credit';

-- Tell PostgREST to pick up the widened enum without a restart.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0052-payment-method-store-credit.sql
-- ============================================================================
