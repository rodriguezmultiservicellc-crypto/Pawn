-- ============================================================================
-- PAWN — FOUNDATION MIGRATION (Phase 0)
-- File:    patches/0001-foundation.sql
-- Date:    2026-04-26
-- Purpose: Multi-tenant root + multi-store/chain support + module gating +
--          police-report compliance log + RLS helpers + tenant provisioning RPC.
--
-- Apply to: brand-new Supabase project (DEDICATED — never reuse Luna Azul or
-- Abacus). Paste into the Supabase SQL Editor and run once.
--
-- Design notes:
--   - profiles.role is GLOBAL only ('superadmin' or NULL). Per-tenant role
--     lives on user_tenants. Never check profiles.role for a tenant role.
--   - Multi-store baked in from day 1 via tenants.parent_tenant_id +
--     tenant_type. RLS exposes children of any chain_hq tenant the user
--     is chain_admin at via my_accessible_tenant_ids().
--   - Every tenant-scoped table will (in later migrations) ENABLE RLS and
--     reference my_accessible_tenant_ids() / my_is_staff().
--   - compliance_log is WRITE-ONCE (UPDATE/DELETE blocked by trigger).
--     Police-report exports read from this table — never derive from loans
--     at report time. Keeps reports deterministic across edits / voids.
--   - audit_log is mutation history. Soft-delete is OK (deleted_at) but no
--     actual rows are ever removed.
--   - All money columns (later migrations): numeric(18,4). All metal
--     weights: numeric(10,4) grams.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ───────────────────────────────────────────────────────────────────────────
--  ENUMS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE tenant_role AS ENUM (
    'owner',          -- full access in one tenant
    'chain_admin',    -- HQ-only role; reads + writes across child tenants
    'manager',        -- full ops in one shop, no team / billing
    'pawn_clerk',     -- pawn intake/redeem/extend, retail sale, customer mgmt
    'repair_tech',    -- repair-ticket workflow
    'appraiser',      -- read-only on intake, can quote, no ledger writes
    'client'          -- customer portal — own loans / repairs / layaways
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tenant_type AS ENUM (
    'chain_hq',       -- rollup container, no shop floor
    'shop',           -- a single physical store, child of a chain_hq
    'standalone'      -- independent single shop, no chain
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE police_report_format AS ENUM (
    'fl_leadsonline'  -- Florida LeadsOnline (v1 ships with this only)
    -- Add new states by adding enum values here AND a new exporter under
    -- src/lib/compliance/police-report/formats/<state>-<vendor>.ts
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  TENANTS — multi-tenant root with chain support + module gates
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL,
  dba                   TEXT,
  -- Chain support: nullable parent_tenant_id; chain_hq has children, shop
  -- has a parent, standalone has neither.
  parent_tenant_id      UUID REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_type           tenant_type NOT NULL DEFAULT 'standalone',
  -- Module gates: shops opt out of pawn/repair/retail surfaces individually.
  has_pawn              BOOLEAN NOT NULL DEFAULT TRUE,
  has_repair            BOOLEAN NOT NULL DEFAULT TRUE,
  has_retail            BOOLEAN NOT NULL DEFAULT TRUE,
  -- Compliance: per-tenant police-report format. Defaults to FL.
  police_report_format  police_report_format NOT NULL DEFAULT 'fl_leadsonline',
  -- Address
  address               TEXT,
  city                  TEXT,
  state                 TEXT DEFAULT 'FL',
  zip                   TEXT,
  -- Contact
  phone                 TEXT,
  email                 TEXT,
  logo_url              TEXT,
  -- Operations
  default_currency      TEXT NOT NULL DEFAULT 'USD',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE, -- soft suspend
  license_key           TEXT UNIQUE,                   -- one-time onboarding token
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sanity: a chain_hq must NOT have a parent. A shop MUST have a parent.
  -- Standalone may or may not have a parent (typically not).
  CONSTRAINT tenants_chain_shape CHECK (
    (tenant_type = 'chain_hq'   AND parent_tenant_id IS NULL) OR
    (tenant_type = 'shop'       AND parent_tenant_id IS NOT NULL) OR
    (tenant_type = 'standalone')
  )
);

CREATE INDEX IF NOT EXISTS idx_tenants_parent ON tenants(parent_tenant_id) WHERE parent_tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_license_key ON tenants(license_key) WHERE license_key IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  PROFILES — extends auth.users; GLOBAL fields only.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Home tenant — used by getCtx() as fallback when the active-tenant cookie
  -- is missing. Nullable for superadmins and freshly-invited users.
  tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,
  -- Global role only: 'superadmin' or NULL. NEVER per-tenant role.
  role          TEXT CHECK (role IS NULL OR role = 'superadmin'),
  full_name     TEXT,
  email         TEXT,
  avatar_url    TEXT,
  language      TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON profiles(tenant_id);

-- ───────────────────────────────────────────────────────────────────────────
--  USER_TENANTS — many-to-many membership with per-tenant role.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_tenants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL,                        -- auth.users.id (no FK across schemas)
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role          tenant_role NOT NULL DEFAULT 'pawn_clerk',
  -- Per-user permission overrides on top of role defaults. Layer is checked
  -- via lib/permissions.ts (resolvePermissions).
  permissions   JSONB,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tenants_user ON user_tenants(user_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_tenants_tenant ON user_tenants(tenant_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_tenants_chain_admin ON user_tenants(tenant_id) WHERE role = 'chain_admin' AND is_active = TRUE;

-- ───────────────────────────────────────────────────────────────────────────
--  TENANT BILLING SETTINGS — 1:1 with tenants. Stripe Connect tokens.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_billing_settings (
  tenant_id               UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id       TEXT,                        -- Stripe Connect account ID
  stripe_access_token     TEXT,
  stripe_refresh_token    TEXT,
  stripe_publishable_key  TEXT,
  stripe_webhook_secret   TEXT,
  stripe_connected_at     TIMESTAMPTZ,
  -- Both surfaces (Terminal + Payment Links) share this connected account.
  billing_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Stripe Terminal location for the shop (one terminal per shop typically).
  stripe_terminal_location_id TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────────────────────
--  SETTINGS — per-tenant Twilio + Resend + general preferences.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Twilio SMS
  twilio_account_sid  TEXT,
  twilio_auth_token   TEXT,
  twilio_phone_number TEXT,
  -- Twilio WhatsApp (same Twilio account, different sender)
  twilio_whatsapp_number TEXT,
  -- Resend Email
  resend_api_key      TEXT,
  email_from          TEXT,
  -- Operational defaults
  default_currency    TEXT NOT NULL DEFAULT 'USD',
  default_loan_term_days INTEGER NOT NULL DEFAULT 30,
  default_loan_interest_rate NUMERIC(6,4) NOT NULL DEFAULT 0.25, -- 25% / month, FL legal
  -- Hold periods (in days). Set per-state. Configurable.
  buy_hold_period_days INTEGER NOT NULL DEFAULT 30,    -- FL = 30 days for jewelry
  abandoned_repair_days INTEGER NOT NULL DEFAULT 90,   -- FL = 90 days post-promised-pickup
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────────────────────
--  USER SETTINGS — per-user UI preferences.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_settings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  language            TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','es')),
  default_date_range  TEXT DEFAULT 'this_month',
  notify_email        BOOLEAN NOT NULL DEFAULT TRUE,
  notify_sms          BOOLEAN NOT NULL DEFAULT FALSE,
  notify_whatsapp     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────────────────────
--  AUDIT LOG — generic mutation history. Read-only after insert.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id),
  action        TEXT NOT NULL,            -- 'create' | 'update' | 'soft_delete' | 'send' | etc.
  table_name    TEXT NOT NULL,
  record_id     UUID,
  changes       JSONB,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
--  COMPLIANCE LOG — write-once police-report source of truth.
-- ───────────────────────────────────────────────────────────────────────────
-- Every pawn-loan and buy-outright transaction emits a row here at intake.
-- The police-report exporter reads from compliance_log only — never from
-- loans / sales — so reports stay deterministic across edits and voids.

CREATE TABLE IF NOT EXISTS compliance_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Source row reference (loans.id or sales.id depending on event_type).
  -- Kept loose (UUID + TEXT discriminator) because loans/sales tables don't
  -- exist yet; will be added in Phase 1/2.
  source_table      TEXT NOT NULL CHECK (source_table IN ('loans','sales')),
  source_id         UUID NOT NULL,
  event_type        TEXT NOT NULL CHECK (event_type IN (
    'pawn_intake',     -- new pawn loan
    'pawn_redemption', -- loan paid off, collateral returned (some states require)
    'pawn_forfeiture', -- loan defaulted, collateral converted to inventory
    'buy_outright',    -- direct purchase from customer (held during hold-period)
    'buy_release'      -- end of hold period, item available for sale
  )),
  -- Snapshot at the time of the event. Police reports must reflect the data
  -- as it was on intake, not as it is today after any subsequent edits.
  customer_snapshot JSONB NOT NULL,        -- name, ID type/#/expiry, address, photo URL
  items_snapshot    JSONB NOT NULL,        -- array of items with descriptions, photos, weights, etc.
  amount            NUMERIC(18,4),         -- principal (for loans) or buy price (for sales)
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Bookkeeping for exports
  exported_at       TIMESTAMPTZ,
  exported_format   police_report_format,
  exported_batch_id UUID,                  -- groups rows submitted in one export run
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_log_tenant ON compliance_log(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_log_unexported ON compliance_log(tenant_id, occurred_at) WHERE exported_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_log_source ON compliance_log(source_table, source_id);

-- ───────────────────────────────────────────────────────────────────────────
--  TRIGGERS
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated_at ON settings;
CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_billing_updated_at ON tenant_billing_settings;
CREATE TRIGGER trg_tenant_billing_updated_at BEFORE UPDATE ON tenant_billing_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON user_settings;
CREATE TRIGGER trg_user_settings_updated_at BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- compliance_log is INSERT-only. Block UPDATE and DELETE on the snapshot
-- columns. The exporter is allowed to update only the bookkeeping columns
-- (exported_at, exported_format, exported_batch_id). DELETE always rejected.
CREATE OR REPLACE FUNCTION prevent_compliance_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'compliance_log is write-once. Rows cannot be deleted.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id        IS DISTINCT FROM OLD.tenant_id        OR
       NEW.source_table     IS DISTINCT FROM OLD.source_table     OR
       NEW.source_id        IS DISTINCT FROM OLD.source_id        OR
       NEW.event_type       IS DISTINCT FROM OLD.event_type       OR
       NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot OR
       NEW.items_snapshot   IS DISTINCT FROM OLD.items_snapshot   OR
       NEW.amount           IS DISTINCT FROM OLD.amount           OR
       NEW.occurred_at      IS DISTINCT FROM OLD.occurred_at THEN
      RAISE EXCEPTION 'compliance_log snapshot fields are immutable. Only export bookkeeping fields may be updated.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compliance_log_immutable ON compliance_log;
CREATE TRIGGER trg_compliance_log_immutable
BEFORE UPDATE OR DELETE ON compliance_log
FOR EACH ROW EXECUTE FUNCTION prevent_compliance_log_modification();

-- audit_log is also write-once. No updates, no deletes.
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is write-once. Rows cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

-- ───────────────────────────────────────────────────────────────────────────
--  RLS HELPER FUNCTIONS — SECURITY DEFINER, STABLE.
-- ───────────────────────────────────────────────────────────────────────────

-- Direct memberships only.
CREATE OR REPLACE FUNCTION my_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT tenant_id FROM user_tenants
  WHERE user_id = auth.uid() AND is_active = TRUE;
$$;

-- Children of any chain_hq tenant where I'm chain_admin. This is what
-- gives a chain owner read+write across all their shops without needing
-- explicit owner rows on every child.
CREATE OR REPLACE FUNCTION my_chain_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT t.id FROM tenants t
  WHERE t.parent_tenant_id IN (
    SELECT ut.tenant_id FROM user_tenants ut
    WHERE ut.user_id = auth.uid()
      AND ut.role = 'chain_admin'
      AND ut.is_active = TRUE
  );
$$;

-- Union of direct + chain access. THIS is the function every RLS policy uses.
CREATE OR REPLACE FUNCTION my_accessible_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT my_tenant_ids()
  UNION
  SELECT my_chain_tenant_ids();
$$;

-- Per-tenant role check. Returns NULL if no membership.
CREATE OR REPLACE FUNCTION my_role_in_tenant(p_tenant_id UUID)
RETURNS tenant_role
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT role FROM user_tenants
  WHERE user_id = auth.uid()
    AND tenant_id = p_tenant_id
    AND is_active = TRUE
  LIMIT 1;
$$;

-- Am I staff (any non-client role) at this tenant? Also returns true when
-- I'm a chain_admin at the tenant's parent — chain admins have staff rights
-- across child shops.
CREATE OR REPLACE FUNCTION my_is_staff(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_tenants ut
    WHERE ut.user_id = auth.uid()
      AND ut.is_active = TRUE
      AND ut.role IN ('owner','manager','pawn_clerk','repair_tech','appraiser')
      AND ut.tenant_id = p_tenant_id
  ) OR EXISTS (
    SELECT 1
    FROM user_tenants ut
    JOIN tenants t ON t.parent_tenant_id = ut.tenant_id
    WHERE ut.user_id = auth.uid()
      AND ut.is_active = TRUE
      AND ut.role = 'chain_admin'
      AND t.id = p_tenant_id
  );
$$;

-- Am I owner of THIS tenant (direct), OR chain_admin of its parent?
CREATE OR REPLACE FUNCTION my_is_owner(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_tenants ut
    WHERE ut.user_id = auth.uid()
      AND ut.is_active = TRUE
      AND ut.role = 'owner'
      AND ut.tenant_id = p_tenant_id
  ) OR EXISTS (
    SELECT 1
    FROM user_tenants ut
    JOIN tenants t ON t.parent_tenant_id = ut.tenant_id
    WHERE ut.user_id = auth.uid()
      AND ut.is_active = TRUE
      AND ut.role = 'chain_admin'
      AND t.id = p_tenant_id
  );
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  PROVISIONING RPCS
-- ───────────────────────────────────────────────────────────────────────────

-- Atomic create-tenant: writes the tenants row, the per-tenant settings
-- shells, and the user_tenants membership for the acting superadmin (so
-- they don't lock themselves out of the very tenant they just created).
-- Optionally also adds an owner user_tenants row if p_owner_user_id is set.
-- Returns (tenant_id, license_key) for the onboarding link.
CREATE OR REPLACE FUNCTION create_tenant_with_owner(
  p_name                 TEXT,
  p_superadmin_user_id   UUID,
  p_owner_user_id        UUID DEFAULT NULL,
  p_parent_tenant_id     UUID DEFAULT NULL,
  p_tenant_type          tenant_type DEFAULT 'standalone',
  p_dba                  TEXT DEFAULT NULL,
  p_address              TEXT DEFAULT NULL,
  p_city                 TEXT DEFAULT NULL,
  p_state                TEXT DEFAULT 'FL',
  p_zip                  TEXT DEFAULT NULL,
  p_phone                TEXT DEFAULT NULL,
  p_email                TEXT DEFAULT NULL,
  p_has_pawn             BOOLEAN DEFAULT TRUE,
  p_has_repair           BOOLEAN DEFAULT TRUE,
  p_has_retail           BOOLEAN DEFAULT TRUE,
  p_police_report_format police_report_format DEFAULT 'fl_leadsonline'
) RETURNS TABLE (tenant_id UUID, license_key TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id    UUID;
  v_license_key  TEXT;
BEGIN
  v_license_key := uuid_generate_v4()::TEXT;

  INSERT INTO tenants (
    name, dba, parent_tenant_id, tenant_type,
    has_pawn, has_repair, has_retail, police_report_format,
    address, city, state, zip, phone, email, license_key
  )
  VALUES (
    p_name, p_dba, p_parent_tenant_id, p_tenant_type,
    p_has_pawn, p_has_repair, p_has_retail, p_police_report_format,
    p_address, p_city, p_state, p_zip, p_phone, p_email, v_license_key
  )
  RETURNING id INTO v_tenant_id;

  -- Seed empty per-tenant settings + billing shell.
  INSERT INTO settings (tenant_id) VALUES (v_tenant_id);
  INSERT INTO tenant_billing_settings (tenant_id) VALUES (v_tenant_id);

  -- Superadmin becomes a member of every tenant they create (prevents lockout).
  IF p_superadmin_user_id IS NOT NULL THEN
    INSERT INTO user_tenants (user_id, tenant_id, role)
    VALUES (p_superadmin_user_id, v_tenant_id, 'owner')
    ON CONFLICT (user_id, tenant_id) DO NOTHING;
  END IF;

  -- Optional immediate owner assignment (skip if onboarding via license_key).
  IF p_owner_user_id IS NOT NULL THEN
    INSERT INTO user_tenants (user_id, tenant_id, role)
    VALUES (p_owner_user_id, v_tenant_id, 'owner')
    ON CONFLICT (user_id, tenant_id) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_tenant_id, v_license_key;
END;
$$;

-- Hard-delete a tenant + all child rows. Superadmin-only via app-layer guard.
-- For a chain_hq, ALSO null-out parent_tenant_id on children before deleting
-- (otherwise children orphan-set-null and stay around — sometimes desirable,
-- but if you want full cascade, delete the children first).
CREATE OR REPLACE FUNCTION delete_tenant_cascade(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM tenants WHERE id = p_tenant_id;
END;
$$;

-- License-key claim: a fresh user logs in for the first time with a tenant
-- onboarding link, calls this RPC, gets attached as 'owner' to the tenant
-- and the license_key is consumed.
CREATE OR REPLACE FUNCTION claim_tenant_with_license_key(
  p_user_id      UUID,
  p_license_key  TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants
  WHERE license_key = p_license_key AND is_active = TRUE;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or already-used license key.';
  END IF;

  INSERT INTO user_tenants (user_id, tenant_id, role)
  VALUES (p_user_id, v_tenant_id, 'owner')
  ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'owner', is_active = TRUE;

  UPDATE profiles SET tenant_id = v_tenant_id WHERE id = p_user_id;

  -- Consume the key.
  UPDATE tenants SET license_key = NULL WHERE id = v_tenant_id;

  RETURN v_tenant_id;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_log           ENABLE ROW LEVEL SECURITY;

-- ── tenants
DROP POLICY IF EXISTS tenants_select ON tenants;
CREATE POLICY tenants_select ON tenants FOR SELECT
  USING (id IN (SELECT my_accessible_tenant_ids()));

-- Writes go through the service-role client gated by requireSuperAdmin().

-- ── profiles
DROP POLICY IF EXISTS profiles_self_read ON profiles;
CREATE POLICY profiles_self_read ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR id IN (
      SELECT user_id FROM user_tenants
      WHERE tenant_id IN (SELECT my_accessible_tenant_ids())
    )
  );

DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles FOR UPDATE
  USING (id = auth.uid());

-- ── user_tenants
DROP POLICY IF EXISTS user_tenants_self_read ON user_tenants;
CREATE POLICY user_tenants_self_read ON user_tenants FOR SELECT
  USING (
    user_id = auth.uid()
    OR tenant_id IN (SELECT my_accessible_tenant_ids())
  );

-- Writes (invite, role change, revoke) go through server actions gated by
-- my_is_owner(tenant_id). Skipped here — Phase 0 has no team-management UI.

-- ── tenant_billing_settings
DROP POLICY IF EXISTS tenant_billing_read ON tenant_billing_settings;
CREATE POLICY tenant_billing_read ON tenant_billing_settings FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()));

DROP POLICY IF EXISTS tenant_billing_write ON tenant_billing_settings;
CREATE POLICY tenant_billing_write ON tenant_billing_settings FOR ALL
  USING (my_is_owner(tenant_id))
  WITH CHECK (my_is_owner(tenant_id));

-- ── settings
DROP POLICY IF EXISTS settings_read ON settings;
CREATE POLICY settings_read ON settings FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()));

DROP POLICY IF EXISTS settings_write ON settings;
CREATE POLICY settings_write ON settings FOR ALL
  USING (my_is_owner(tenant_id))
  WITH CHECK (my_is_owner(tenant_id));

-- ── user_settings (own row only)
DROP POLICY IF EXISTS user_settings_own ON user_settings;
CREATE POLICY user_settings_own ON user_settings FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── audit_log (read for staff; inserts via service-role server actions)
DROP POLICY IF EXISTS audit_log_staff_read ON audit_log;
CREATE POLICY audit_log_staff_read ON audit_log FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── compliance_log (read for staff; inserts via service-role server actions
--   only — never client-issued INSERTs)
DROP POLICY IF EXISTS compliance_log_staff_read ON compliance_log;
CREATE POLICY compliance_log_staff_read ON compliance_log FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Tell PostgREST to reload the schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0001-foundation.sql
-- ============================================================================
