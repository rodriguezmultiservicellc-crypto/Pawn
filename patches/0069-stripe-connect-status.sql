-- ───────────────────────────────────────────────────────────────────────────
-- 0069 — Stripe Connect onboarding status on tenant_billing_settings
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0068 has already run.
--           Append-only — never edit prior migrations.
--
-- Per-tenant Stripe Connect (Express accounts + Account Links). The
-- onboarding routes (/api/stripe/connect/{start,callback,dashboard}) and
-- the `account.updated` webhook handler keep these three flags current
-- by re-reading the Account object from Stripe:
--   stripe_details_submitted  owner finished the hosted onboarding form
--   stripe_charges_enabled    Stripe will accept payments on the account
--   stripe_payouts_enabled    Stripe will pay the shop's bank account
-- "Connected" in the UI = details_submitted AND charges_enabled.
-- billing_enabled (0001) now mirrors charges_enabled on every sync so the
-- POS + portal gates (lib/stripe/payment-link.ts) follow Stripe's truth.
-- ============================================================================

ALTER TABLE tenant_billing_settings
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_status_synced_at  TIMESTAMPTZ;

-- The webhook resolves tenant by connected-account id; one account can
-- belong to exactly one tenant.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_billing_settings_stripe_account_id_key
  ON tenant_billing_settings (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

COMMENT ON COLUMN tenant_billing_settings.stripe_charges_enabled IS
  'Mirror of Stripe Account.charges_enabled. Synced at callback + account.updated.';
COMMENT ON COLUMN tenant_billing_settings.stripe_payouts_enabled IS
  'Mirror of Stripe Account.payouts_enabled. Informational — does not gate payments.';
COMMENT ON COLUMN tenant_billing_settings.stripe_details_submitted IS
  'Mirror of Stripe Account.details_submitted. Connected = this AND charges_enabled.';
COMMENT ON COLUMN tenant_billing_settings.stripe_status_synced_at IS
  'Last time the three stripe_* flags were re-read from Stripe.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0069-stripe-connect-status.sql
-- ============================================================================
