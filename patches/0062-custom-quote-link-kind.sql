-- ───────────────────────────────────────────────────────────────────────────
-- 0062 — message_kind: 'custom_quote_link'
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0061.
--           Append-only — never edit prior migrations.
--
-- Own apply because Postgres refuses to USE a new enum value inside the
-- transaction that adds it; 0063 seeds templates of this kind. Same split
-- as 0049/0050, 0052/0053, 0060/0061.
--
-- 'custom_quote_link' is the "Send by SMS" message on a custom-piece quote:
-- the customer's public, read-only quote page (brief Phase 2).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'custom_quote_link';
