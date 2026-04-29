-- ───────────────────────────────────────────────────────────────────────────
-- 0023 — Repair tech workflow (assignment + claim + tech_qa stage)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0007 / 0022.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   The repair workflow gains TWO new statuses to model the tech side:
--
--     assigned   — operator routed the ticket to a specific jeweler;
--                  tech hasn't claimed it yet. Lives between
--                  awaiting_approval and in_progress.
--
--     tech_qa    — tech finished hands-on work and is doing a final
--                  QA / cleaning pass before flipping to ready.
--
--   And TWO new timestamp columns on repair_tickets to capture when those
--   transitions happened (separate from the timer punches in
--   repair_time_logs):
--
--     assigned_at  — when the operator picked the tech.
--     claimed_at   — when the tech claimed the assigned ticket and
--                    started working.
--
--   Plus matching repair_event_type enum values so the timeline panel
--   has dedicated entries for each transition.
--
-- Backward compatibility
--
--   The existing path (awaiting_approval → in_progress directly) stays
--   legal so operators who bypass the tech-board can still write tickets
--   in one shot. New transitions are additive.
--
--   No data migration. existing in-flight tickets continue working under
--   the new state machine — assigned_at / claimed_at simply remain NULL.
--
-- Auto-timer behavior
--
--   The state machine wired in lib/repair/workflow.ts opens a
--   repair_time_logs row when transitioning INTO 'in_progress' (via
--   claim, parts_received, or QA-return), and stops the running timer
--   when transitioning OUT of 'in_progress' (to needs_parts, tech_qa,
--   ready, voided, abandoned). The unique partial index on
--   repair_time_logs (ticket_id, technician_id) WHERE stopped_at IS NULL
--   from migration 0007 already prevents duplicates.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Extend repair_status enum with the two new states. ALTER TYPE ADD
--    VALUE is idempotent in modern Postgres only via IF NOT EXISTS.

ALTER TYPE repair_status ADD VALUE IF NOT EXISTS 'assigned'
  BEFORE 'in_progress';
ALTER TYPE repair_status ADD VALUE IF NOT EXISTS 'tech_qa'
  AFTER 'needs_parts';

-- 2. Extend repair_event_type enum with new transition events.

ALTER TYPE repair_event_type ADD VALUE IF NOT EXISTS 'assigned_to_tech';
ALTER TYPE repair_event_type ADD VALUE IF NOT EXISTS 'claimed_by_tech';
ALTER TYPE repair_event_type ADD VALUE IF NOT EXISTS 'qa_started';
ALTER TYPE repair_event_type ADD VALUE IF NOT EXISTS 'qa_completed';
ALTER TYPE repair_event_type ADD VALUE IF NOT EXISTS 'qa_returned';

-- 3. Add assigned_at + claimed_at columns to repair_tickets.

ALTER TABLE repair_tickets
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL;
ALTER TABLE repair_tickets
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN repair_tickets.assigned_at IS
  'When the operator routed this ticket to the assigned tech. Null until '
  'the ticket has been assigned at least once.';
COMMENT ON COLUMN repair_tickets.claimed_at IS
  'When the tech first claimed an assigned ticket and the timer opened. '
  'Distinct from assigned_at by the tech-claim delay; null until claim.';

-- 4. Reload PostgREST schema cache so the API surface picks up the new
--    enum values + columns immediately (db:types regen reads from the
--    same metadata).
NOTIFY pgrst, 'reload schema';
