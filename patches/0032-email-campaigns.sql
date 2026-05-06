-- ───────────────────────────────────────────────────────────────────────────
-- 0032 — email campaigns (Phase 10 Path A — engine backbone)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0031 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds operator-authored bulk-email campaign infrastructure. Distinct
--   from the existing transactional pipeline (message_templates +
--   message_log + cron reminders): campaigns are one-shot blasts to a
--   tenant-defined customer segment, with bounce/complaint handling and
--   a one-click unsubscribe surface.
--
--   New ENUMs:
--     email_campaign_status       draft | scheduled | sending | sent
--                                 | canceled
--     email_campaign_recipient_status
--                                 queued | sent | delivered | bounced
--                                 | complained | failed | skipped
--
--   New TABLES:
--     email_campaigns           one row per campaign (operator-authored)
--     email_campaign_recipients one row per (campaign × customer) target
--
--   New COLUMNS on customers:
--     email_unsubscribe_token   UUID UNIQUE — lazy-generated on first send
--                               so the public /unsubscribe page can map a
--                               click back to (tenant_id, customer_id)
--                               without exposing internal IDs.
--
--   New ENUM VALUE on message_kind:
--     'email_campaign'          flags message_log rows belonging to a
--                               campaign blast (transactional templates
--                               cover the existing kinds).
--
-- Why a separate recipients table (not just message_log)
--
--   Recipient state extends past message_log's transactional surface:
--   bounced / complained / unsubscribed-after-send drive different
--   downstream actions (auto-suppress on hard bounce, mark
--   marketing_opt_in=false on complaint). Keeping the campaign-specific
--   state out of message_log lets the audit ledger stay write-once on
--   transactional fields and avoids a status-enum extension that would
--   ripple through every existing reader.
--
-- Why one campaign row per tenant (not a chain-rollup model)
--
--   Campaigns are tenant-local: an HQ chain operator emails through
--   each child tenant's Resend creds, segment, and customer base
--   separately. Cross-tenant campaign rollup is a phase-10-B problem.
--
-- Segmentation snapshot
--
--   When a campaign moves draft → scheduled, the segment gets resolved
--   to a static list of customer_ids snapshotted into
--   email_campaign_recipients. After that, edits to customer.tags /
--   marketing_opt_in / email do NOT change the recipient list. This
--   matches expected campaign semantics: the audience is locked when
--   you schedule.
--
-- RLS
--
--   email_campaigns        staff SELECT, owner+chain_admin+manager
--                          INSERT/UPDATE via my_is_staff() + role check
--                          at the app layer (server action gates).
--                          Writes go through admin client.
--   email_campaign_recipients
--                          staff SELECT only. Writes are admin-client.
--   No public/anon policy — the /unsubscribe public route uses the
--   admin client to read by token then writes to customers, NOT to
--   email_campaign_recipients.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── ENUM extensions ──────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'email_campaign';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_campaign_status AS ENUM (
    'draft',         -- operator authoring; not yet locked
    'scheduled',     -- locked: recipients snapshotted, awaiting cron
    'sending',       -- cron picked it up; in-flight
    'sent',          -- cron finished; check recipients table for outcome
    'canceled'       -- operator canceled before send (only valid pre-sending)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_campaign_recipient_status AS ENUM (
    'queued',        -- recipient row inserted, send not yet attempted
    'sent',          -- Resend accepted the email
    'delivered',     -- Resend webhook confirmed delivery
    'bounced',       -- hard or soft bounce per Resend webhook
    'complained',    -- spam complaint per Resend webhook
    'failed',        -- non-bounce send error (creds, API outage, etc.)
    'skipped'        -- dispatcher skipped at send time (e.g.,
                     -- marketing_opt_in flipped between snapshot and send)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── customers: unsubscribe token ─────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_unsubscribe_token UUID UNIQUE;

COMMENT ON COLUMN customers.email_unsubscribe_token IS
  'UUID generated on first marketing send. Used by /unsubscribe to map a token to (tenant, customer) without exposing internal IDs in URLs.';

-- ── email_campaigns ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_campaigns (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name                     TEXT NOT NULL,                  -- internal label, e.g. "May newsletter"
  subject                  TEXT NOT NULL,                  -- email subject line; supports {{var}}
  body_html                TEXT NOT NULL,                  -- rich body; supports {{var}}
  body_text                TEXT NOT NULL,                  -- plaintext fallback; supports {{var}}

  -- Segment criteria (resolved + snapshotted to recipients on schedule).
  segment_language         TEXT
    CHECK (segment_language IS NULL OR segment_language IN ('en','es')),
  segment_tags             TEXT[] NOT NULL DEFAULT '{}',   -- empty = no tag filter (any/all customers match)
  segment_marketing_opt_in_only
                           BOOLEAN NOT NULL DEFAULT TRUE,

  status                   email_campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at             TIMESTAMPTZ,                    -- NULL while draft
  sent_at                  TIMESTAMPTZ,                    -- set when cron finishes

  -- Materialized aggregates for the campaign list view (cron updates).
  recipient_count          INTEGER NOT NULL DEFAULT 0,
  delivered_count          INTEGER NOT NULL DEFAULT 0,
  bounced_count            INTEGER NOT NULL DEFAULT 0,
  complained_count         INTEGER NOT NULL DEFAULT 0,
  failed_count             INTEGER NOT NULL DEFAULT 0,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),

  CHECK (
    -- A scheduled campaign needs a scheduled_at.
    (status <> 'scheduled' OR scheduled_at IS NOT NULL)
    AND
    -- A sent campaign needs both scheduled_at and sent_at.
    (status <> 'sent' OR (scheduled_at IS NOT NULL AND sent_at IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_tenant_status
  ON email_campaigns(tenant_id, status, scheduled_at)
  WHERE deleted_at IS NULL;

-- Cron picks up campaigns where status = 'scheduled' AND scheduled_at <= NOW().
-- The partial index keeps that scan tiny.
CREATE INDEX IF NOT EXISTS idx_email_campaigns_due
  ON email_campaigns(scheduled_at)
  WHERE status = 'scheduled' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_email_campaigns_updated_at ON email_campaigns;
CREATE TRIGGER trg_email_campaigns_updated_at
  BEFORE UPDATE ON email_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── email_campaign_recipients ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id              UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id              UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Snapshot at schedule time — survives later mutations on the customer.
  email                    TEXT NOT NULL,
  language                 TEXT NOT NULL CHECK (language IN ('en','es')),

  status                   email_campaign_recipient_status NOT NULL DEFAULT 'queued',

  -- Provider linkage.
  message_log_id           UUID REFERENCES message_log(id) ON DELETE SET NULL,
  resend_message_id        TEXT,                           -- mirrors message_log.provider_id

  -- Outcome timestamps (set as webhook events arrive).
  sent_at                  TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  bounced_at               TIMESTAMPTZ,
  bounce_reason            TEXT,
  complained_at            TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  failure_reason           TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Recipient is unique per (campaign, customer) — prevents double-queue.
  UNIQUE (campaign_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_ecr_campaign
  ON email_campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_ecr_tenant_customer
  ON email_campaign_recipients(tenant_id, customer_id);
-- Resend webhook lookup path — provider_id → recipient row.
CREATE INDEX IF NOT EXISTS idx_ecr_resend_id
  ON email_campaign_recipients(resend_message_id)
  WHERE resend_message_id IS NOT NULL;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────

ALTER TABLE email_campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_campaigns_staff_read ON email_campaigns;
CREATE POLICY email_campaigns_staff_read ON email_campaigns FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS email_campaign_recipients_staff_read ON email_campaign_recipients;
CREATE POLICY email_campaign_recipients_staff_read ON email_campaign_recipients FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- All writes via admin (service-role) client — gated at the app layer
-- by requireRoleInTenant(...) in the campaign server actions and by
-- CRON_SECRET on the dispatch + webhook routes. No INSERT/UPDATE/DELETE
-- policies for authenticated users.

COMMIT;

-- Tell PostgREST to pick up the new types/columns/tables/policies.
NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual; only safe before any campaign has shipped recipients)
-- ───────────────────────────────────────────────────────────────────────────
--
-- BEGIN;
--   DROP TABLE IF EXISTS email_campaign_recipients;
--   DROP TABLE IF EXISTS email_campaigns;
--   DROP TYPE  IF EXISTS email_campaign_recipient_status;
--   DROP TYPE  IF EXISTS email_campaign_status;
--   ALTER TABLE customers DROP COLUMN IF EXISTS email_unsubscribe_token;
--   -- message_kind enum value 'email_campaign' cannot be removed from
--   -- an enum without rebuilding the enum; leave it in place.
-- COMMIT;

-- ============================================================================
-- END 0032-email-campaigns.sql
-- ============================================================================
