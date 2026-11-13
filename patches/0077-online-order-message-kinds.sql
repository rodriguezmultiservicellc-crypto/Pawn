-- ───────────────────────────────────────────────────────────────────────────
-- 0077 — message kinds for online orders (PLAN-2026-11-13 Phase 3)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0076, and BEFORE 0078 (which
-- seeds templates using these values — a new enum value cannot be used in
-- the same transaction that adds it).
--
-- Rollback: enum values cannot be dropped; unused values are harmless.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'online_order_confirmed';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'online_order_ready';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'online_order_shipped';
