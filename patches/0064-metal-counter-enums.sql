-- ───────────────────────────────────────────────────────────────────────────
-- 0064 — metal counter: payment_method += 'transfer', sale_kind += 'metal'
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0063 has already run.
--           Append-only — never edit prior migrations.
--
-- Why this is its own patch
--
--   scripts/apply-migration.mjs sends the whole file as ONE request, and
--   the Management API wraps it in a single transaction. Postgres refuses
--   to USE an enum value in the same transaction that ADDs it, so the two
--   ADD VALUEs land here and 0065 (which references neither in DDL but
--   whose app code does) follows. Same split as 0052/0053 and 0060/0061.
--
-- What changes (Sol Pawn brief, Phase 3 — two-way metal counter)
--
--   payment_method gains 'transfer' (bank / Zelle / wire). It joins cash /
--   card / check / other / store_credit on sale_payments.payment_method,
--   returns.refund_method, layaway_payments.payment_method and
--   loan_payments.payment_method. The generic POS add-payment schema
--   (src/lib/validations/pos.ts paymentMethodSchema) does NOT pick it up
--   automatically — the metal-sale action and the buy-outright payout are
--   the two paths that accept it.
--
--   sale_kind gains 'metal': a scrap / bullion sale rung up at the metal
--   counter (src/app/(staff)/buy/sell). It is a real `sales` row — it ties
--   to the open register session, carries sale_items + sale_payments and
--   therefore lands in the daily register and sales-summary reports — but
--   it NEVER writes a compliance_log row: selling metal is not a reportable
--   second-hand-goods acquisition.
--
-- Rollback
--
--   Postgres cannot drop a single enum value. Leave the unused values in
--   place rather than recreating the types on a live database.
-- ============================================================================

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'transfer';
ALTER TYPE sale_kind      ADD VALUE IF NOT EXISTS 'metal';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0064-metal-counter-enums.sql
-- ============================================================================
