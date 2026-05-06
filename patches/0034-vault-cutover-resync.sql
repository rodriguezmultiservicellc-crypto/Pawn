-- ───────────────────────────────────────────────────────────────────────────
-- 0034 — vault cutover resync (recovery migration)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0029 has already run.
--           Append-only — never edit prior migrations.
--
-- Why this migration exists
--
--   Production was discovered (Session 26, 2026-05-06) to be in a
--   half-applied state across migrations 0030–0033. The exact subset
--   that landed is unknown — column additions are mostly missing,
--   pre-existing plaintext secret columns are dropped, some new
--   tables exist and some don't.
--
--   Rather than try to reconcile what landed where, this migration is
--   a complete IDEMPOTENT SUPERSET of 0030 + 0031 + 0032 + 0033 and the
--   intended 0034 plaintext-column drop. Re-applying 0030–0033 is also
--   safe after this — every statement here uses IF NOT EXISTS,
--   CREATE OR REPLACE, or DROP-then-CREATE.
--
-- Result
--
--   - All tables, columns, indexes, triggers, RLS policies, enum values,
--     and RPCs that the codebase expects exist.
--   - Vault is the sole secret store. The pre-existing plaintext secret
--     columns are dropped where still present.
--   - PostgREST schema cache is reloaded via NOTIFY at the end so
--     /api/* routes can see the new tables/RPCs without redeploy.
--
-- What this migration does NOT do
--
--   - Does not back-fill the vault. If tenant secrets were lost in the
--     manual run, operators must re-enter them via the settings UI
--     (which now writes only to vault).
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 0030 — google reviews quota ─────────────────────────────────────────

ALTER TABLE public.tenant_google_reviews
  ADD COLUMN IF NOT EXISTS quota_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quota_calls_used   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS google_reviews_daily_quota INTEGER;

DO $$ BEGIN
  ALTER TABLE public.settings
    ADD CONSTRAINT settings_google_reviews_daily_quota_check
    CHECK (google_reviews_daily_quota IS NULL OR google_reviews_daily_quota > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.consume_google_reviews_quota(
  p_tenant_id  UUID,
  p_place_id   TEXT,
  p_cap        INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_calls_used   INTEGER;
  v_now          TIMESTAMPTZ := NOW();
BEGIN
  SELECT quota_window_start, quota_calls_used
    INTO v_window_start, v_calls_used
    FROM public.tenant_google_reviews
    WHERE tenant_id = p_tenant_id
    FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.tenant_google_reviews (
      tenant_id, place_id, payload, fetched_at,
      quota_window_start, quota_calls_used
    ) VALUES (
      p_tenant_id, p_place_id, '{}'::jsonb, v_now,
      v_now, 1
    )
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN TRUE;
  END IF;

  IF v_window_start IS NULL
     OR (v_now - v_window_start) > INTERVAL '24 hours' THEN
    UPDATE public.tenant_google_reviews
      SET quota_window_start = v_now,
          quota_calls_used   = 1
      WHERE tenant_id = p_tenant_id;
    RETURN TRUE;
  END IF;

  IF v_calls_used >= p_cap THEN
    RETURN FALSE;
  END IF;

  UPDATE public.tenant_google_reviews
    SET quota_calls_used = v_calls_used + 1
    WHERE tenant_id = p_tenant_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_google_reviews_quota(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_google_reviews_quota(UUID, TEXT, INTEGER) TO service_role;

-- ── 0031 — hidden review list ───────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS google_reviews_hidden_review_times BIGINT[] NOT NULL DEFAULT '{}';

-- ── 0032 — email campaigns ──────────────────────────────────────────────

DO $$ BEGIN
  ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'email_campaign';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_campaign_status AS ENUM (
    'draft', 'scheduled', 'sending', 'sent', 'canceled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_campaign_recipient_status AS ENUM (
    'queued', 'sent', 'delivered', 'bounced',
    'complained', 'failed', 'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_unsubscribe_token UUID UNIQUE;

DO $$ BEGIN
  EXECUTE 'COMMENT ON COLUMN customers.email_unsubscribe_token IS '
       || quote_literal(
            'UUID generated on first marketing send. Used by /unsubscribe to map a token to (tenant, customer) without exposing internal IDs in URLs.'
          );
EXCEPTION WHEN undefined_column THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS email_campaigns (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name                     TEXT NOT NULL,
  subject                  TEXT NOT NULL,
  body_html                TEXT NOT NULL,
  body_text                TEXT NOT NULL,

  segment_language         TEXT
    CHECK (segment_language IS NULL OR segment_language IN ('en','es')),
  segment_tags             TEXT[] NOT NULL DEFAULT '{}',
  segment_marketing_opt_in_only
                           BOOLEAN NOT NULL DEFAULT TRUE,

  status                   email_campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at             TIMESTAMPTZ,
  sent_at                  TIMESTAMPTZ,

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
    (status <> 'scheduled' OR scheduled_at IS NOT NULL)
    AND
    (status <> 'sent' OR (scheduled_at IS NOT NULL AND sent_at IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_tenant_status
  ON email_campaigns(tenant_id, status, scheduled_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_campaigns_due
  ON email_campaigns(scheduled_at)
  WHERE status = 'scheduled' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_email_campaigns_updated_at ON email_campaigns;
CREATE TRIGGER trg_email_campaigns_updated_at
  BEFORE UPDATE ON email_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id              UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id              UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  email                    TEXT NOT NULL,
  language                 TEXT NOT NULL CHECK (language IN ('en','es')),

  status                   email_campaign_recipient_status NOT NULL DEFAULT 'queued',

  message_log_id           UUID REFERENCES message_log(id) ON DELETE SET NULL,
  resend_message_id        TEXT,

  sent_at                  TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  bounced_at               TIMESTAMPTZ,
  bounce_reason            TEXT,
  complained_at            TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  failure_reason           TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (campaign_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_ecr_campaign
  ON email_campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_ecr_tenant_customer
  ON email_campaign_recipients(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_ecr_resend_id
  ON email_campaign_recipients(resend_message_id)
  WHERE resend_message_id IS NOT NULL;

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

-- ── 0033 — tenant secrets vault ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_secrets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  vault_secret_id UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_tenant_secrets_tenant
  ON public.tenant_secrets(tenant_id);

DROP TRIGGER IF EXISTS trg_tenant_secrets_updated_at ON public.tenant_secrets;
CREATE TRIGGER trg_tenant_secrets_updated_at
  BEFORE UPDATE ON public.tenant_secrets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.tenant_secrets ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (bypasses RLS) can touch this table.

CREATE OR REPLACE FUNCTION public.set_tenant_secret(
  p_tenant_id UUID,
  p_kind      TEXT,
  p_value     TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id UUID;
  v_vault_id    UUID;
  v_name        TEXT;
BEGIN
  IF p_value IS NULL OR length(trim(p_value)) = 0 THEN
    SELECT vault_secret_id INTO v_existing_id
      FROM public.tenant_secrets
      WHERE tenant_id = p_tenant_id AND kind = p_kind;
    IF v_existing_id IS NOT NULL THEN
      DELETE FROM vault.secrets WHERE id = v_existing_id;
    END IF;
    DELETE FROM public.tenant_secrets
      WHERE tenant_id = p_tenant_id AND kind = p_kind;
    RETURN NULL;
  END IF;

  v_name := 'tenant:' || p_tenant_id::text || ':' || p_kind;

  SELECT vault_secret_id INTO v_existing_id
    FROM public.tenant_secrets
    WHERE tenant_id = p_tenant_id AND kind = p_kind;

  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_id, p_value, v_name, NULL);
    UPDATE public.tenant_secrets
      SET updated_at = NOW()
      WHERE tenant_id = p_tenant_id AND kind = p_kind;
    RETURN v_existing_id;
  ELSE
    v_vault_id := vault.create_secret(
      p_value,
      v_name,
      'Tenant credential managed via public.tenant_secrets'
    );
    INSERT INTO public.tenant_secrets (tenant_id, kind, vault_secret_id)
      VALUES (p_tenant_id, p_kind, v_vault_id);
    RETURN v_vault_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_secret(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_secret(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_tenant_secret(
  p_tenant_id UUID,
  p_kind      TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vault_id UUID;
  v_value    TEXT;
BEGIN
  SELECT vault_secret_id INTO v_vault_id
    FROM public.tenant_secrets
    WHERE tenant_id = p_tenant_id AND kind = p_kind;

  IF v_vault_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_value
    FROM vault.decrypted_secrets
    WHERE id = v_vault_id;

  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_secret(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_secret(UUID, TEXT) TO service_role;

-- ── plaintext-column drop (the originally-pending separate 0034 step) ──

ALTER TABLE public.settings
  DROP COLUMN IF EXISTS twilio_auth_token,
  DROP COLUMN IF EXISTS resend_api_key,
  DROP COLUMN IF EXISTS google_places_api_key;

ALTER TABLE public.tenant_billing_settings
  DROP COLUMN IF EXISTS stripe_access_token,
  DROP COLUMN IF EXISTS stripe_refresh_token,
  DROP COLUMN IF EXISTS stripe_webhook_secret;

ALTER TABLE public.tenant_ebay_credentials
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token;

COMMIT;

-- Reload PostgREST's schema cache so the new tables/columns/RPCs become
-- queryable through the REST API without a Supabase API restart.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0034-vault-cutover-resync.sql
-- ============================================================================
