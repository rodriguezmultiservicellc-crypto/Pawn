-- 0126 — message_kind 'pawn_tracking_link' (Eddy, 2026-11-27).
-- Its own patch: a new enum value cannot be used in the transaction that
-- adds it, and 0127 seeds templates of this kind.

ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'pawn_tracking_link';
