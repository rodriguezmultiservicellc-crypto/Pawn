-- ============================================================================
-- patches/0012-saas-billing.sql
-- Phase 9 (Path A) — SaaS billing schema for the platform.
--
-- This is platform-side billing — the operator (RMS) charges tenants
-- monthly for access to the Pawn SaaS. Distinct from per-tenant Stripe
-- Connect (in-store card-present + portal pay-by-link), which uses each
-- tenant's own connected Stripe account. Platform billing uses RMS's
-- own Stripe account.
--
-- Tables:
--   subscription_plans       — pricing tiers (basic / pro / chain)
--   tenant_subscriptions     — 1:1 with tenants, current subscription
--   billing_invoices         — denormalized invoice history (Stripe is
--                              source of truth; this is for fast admin
--                              UI rendering without round-trips)
-- ============================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM (
    'trialing',
    'active',
    'past_due',
    'cancelled',
    'unpaid',
    'incomplete',
    'incomplete_expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE billing_cycle AS ENUM ('monthly', 'yearly');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── subscription_plans (platform-wide; readable by everyone) ──────────────
CREATE TABLE IF NOT EXISTS subscription_plans (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                        TEXT UNIQUE NOT NULL,
  name                        TEXT NOT NULL,
  description                 TEXT,
  -- Pricing in cents (USD). Yearly price is the FULL year amount (so you can
  -- show e.g. "$199/mo or $1,990/yr — save $398").
  price_monthly_cents         INTEGER NOT NULL CHECK (price_monthly_cents >= 0),
  price_yearly_cents          INTEGER CHECK (price_yearly_cents IS NULL OR price_yearly_cents >= 0),
  -- Stripe Product + Price ids — populated when the operator creates the
  -- corresponding objects in the platform Stripe account. Until then NULL
  -- and the plan is local-only (visible in admin UI but not chargeable).
  stripe_product_id           TEXT UNIQUE,
  stripe_price_monthly_id     TEXT UNIQUE,
  stripe_price_yearly_id      TEXT UNIQUE,
  -- features: array of feature-flag strings the plan unlocks. Used for
  -- runtime feature gating in the app. Examples: 'communications',
  -- 'customer_portal', 'multi_shop', 'cross_shop_transfers', 'appraisals'.
  features                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- feature_limits: numeric caps. NULL means unlimited. Examples:
  --   { "max_locations": 1, "max_users": 3, "max_active_loans": 100 }
  feature_limits              JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  is_public                   BOOLEAN NOT NULL DEFAULT TRUE,  -- shown in pricing pages
  sort_order                  INTEGER NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active
  ON subscription_plans(is_active, sort_order);

-- ── tenant_subscriptions (1:1 with tenants) ───────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id                   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                     UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  -- Stripe Customer + Subscription on the platform account (NOT a tenant's
  -- Connect account).
  stripe_customer_id          TEXT,
  stripe_subscription_id      TEXT UNIQUE,
  status                      subscription_status NOT NULL DEFAULT 'trialing',
  billing_cycle               billing_cycle NOT NULL DEFAULT 'monthly',
  trial_ends_at               TIMESTAMPTZ,
  current_period_start        TIMESTAMPTZ,
  current_period_end          TIMESTAMPTZ,
  cancel_at_period_end        BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at                TIMESTAMPTZ,
  cancel_reason               TEXT,
  -- Cached invoice info for fast admin views.
  last_invoice_id             TEXT,
  last_invoice_amount_cents   INTEGER,
  last_invoice_paid_at        TIMESTAMPTZ,
  next_invoice_amount_cents   INTEGER,
  next_invoice_due_at         TIMESTAMPTZ,
  -- Operator notes (not customer-facing).
  internal_notes              TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subs_status
  ON tenant_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_tenant_subs_period_end
  ON tenant_subscriptions(current_period_end);

-- ── billing_invoices (denormalized cache) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_invoices (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_invoice_id   TEXT UNIQUE,
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  -- Stripe invoice statuses: draft, open, paid, void, uncollectible.
  status              TEXT NOT NULL,
  hosted_invoice_url  TEXT,
  invoice_pdf_url     TEXT,
  paid_at             TIMESTAMPTZ,
  due_date            TIMESTAMPTZ,
  period_start        TIMESTAMPTZ,
  period_end          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant
  ON billing_invoices(tenant_id, created_at DESC);

-- ── updated_at triggers ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION saas_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON subscription_plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION saas_set_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_subs_updated_at ON tenant_subscriptions;
CREATE TRIGGER trg_tenant_subs_updated_at
  BEFORE UPDATE ON tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION saas_set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE subscription_plans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices       ENABLE ROW LEVEL SECURITY;

-- Plans are globally readable (every tenant can see what they can upgrade
-- to). Writes only via service-role admin client.
DROP POLICY IF EXISTS plans_read ON subscription_plans;
CREATE POLICY plans_read ON subscription_plans
  FOR SELECT USING (TRUE);

-- tenant_subscriptions: superadmin all; tenant owner reads own.
DROP POLICY IF EXISTS tenant_subs_superadmin ON tenant_subscriptions;
CREATE POLICY tenant_subs_superadmin ON tenant_subscriptions
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'superadmin'
  );

DROP POLICY IF EXISTS tenant_subs_owner_read ON tenant_subscriptions;
CREATE POLICY tenant_subs_owner_read ON tenant_subscriptions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_tenants
      WHERE user_id = auth.uid()
        AND tenant_id = tenant_subscriptions.tenant_id
        AND role = 'owner'
    )
  );

-- billing_invoices: superadmin all; tenant owner reads own.
DROP POLICY IF EXISTS invoices_superadmin ON billing_invoices;
CREATE POLICY invoices_superadmin ON billing_invoices
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'superadmin'
  );

DROP POLICY IF EXISTS invoices_owner_read ON billing_invoices;
CREATE POLICY invoices_owner_read ON billing_invoices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_tenants
      WHERE user_id = auth.uid()
        AND tenant_id = billing_invoices.tenant_id
        AND role = 'owner'
    )
  );

-- ── Seed default plans (placeholder pricing — operator adjusts) ───────────
INSERT INTO subscription_plans
  (code, name, description, price_monthly_cents, price_yearly_cents, features, feature_limits, sort_order)
VALUES
  ('basic',
   'Basic',
   'Single shop, core modules — customers, inventory, pawn, repair, POS, reports, audit log.',
   9900,
   99900,
   '["customers","inventory","pawn","repair","pos","reports","audit_log"]'::jsonb,
   '{"max_locations":1,"max_users":3,"max_active_loans":100}'::jsonb,
   1),
  ('pro',
   'Pro',
   'Single shop, full feature set — adds communications, customer portal, and appraisals.',
   19900,
   199900,
   '["customers","inventory","pawn","repair","pos","reports","audit_log","communications","customer_portal","appraisals"]'::jsonb,
   '{"max_locations":1,"max_users":10,"max_active_loans":null}'::jsonb,
   2),
  ('chain',
   'Chain',
   'Multi-shop chain with rollup reporting, cross-shop transfers, and chain admin role.',
   49900,
   499900,
   '["customers","inventory","pawn","repair","pos","reports","audit_log","communications","customer_portal","appraisals","multi_shop","chain_admin","cross_shop_transfers","rollup_reporting"]'::jsonb,
   '{"max_locations":10,"max_users":30,"max_active_loans":null}'::jsonb,
   3)
ON CONFLICT (code) DO NOTHING;
