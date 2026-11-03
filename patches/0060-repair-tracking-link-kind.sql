-- ───────────────────────────────────────────────────────────────────────────
-- 0060 — message_kind: 'repair_tracking_link'
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0059.
--           Append-only — never edit prior migrations.
--
-- Postgres refuses to USE a new enum value inside the transaction that
-- adds it, so the value lands here on its own and 0061 (which seeds
-- templates of this kind) runs as a separate apply. Same split as
-- 0049 → 0050 and 0052 → 0053.
--
-- 'repair_tracking_link' is the "Send by SMS" message on a repair ticket:
-- the public, read-only tracking page link (brief Phase 1).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'repair_tracking_link';
