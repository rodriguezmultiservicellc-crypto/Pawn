-- ───────────────────────────────────────────────────────────────────────────
-- 0019 — Tighten RLS SELECT policies on secret-bearing tables
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0018 has already run.
--           Append-only — never edit prior migrations.
--
-- Closes the disclosed leak from the external security review:
--   Before: SELECT on tenant_billing_settings, settings, and
--           tenant_ebay_credentials gated on
--           `tenant_id IN (SELECT my_accessible_tenant_ids())`, which
--           includes 'client' role memberships. A portal customer
--           could SELECT Stripe access/refresh/webhook secrets,
--           Twilio creds, Resend creds, eBay OAuth tokens.
--   After:  All three policies require an owner-tier role
--           (`my_role_in_tenant() IN ('owner','chain_admin')` for
--           billing + settings; same set + 'manager' for eBay creds
--           since managers run the inventory listings).
--
-- Safety verification (grep audit Session 10):
--   Every read of these tables in the codebase uses
--   createAdminClient() (service-role, bypasses RLS). Confirmed
--   targets:
--     - tenant_billing_settings: lib/stripe/{terminal,payment-link}.ts,
--       (staff)/settings/{page,integrations/page}.tsx
--     - settings: lib/twilio/sms.ts, lib/email/send.ts,
--       (staff)/settings/{page,communications/{page,actions},
--       integrations/page}.tsx, (staff)/buy/new/{page,actions}.ts
--     - tenant_ebay_credentials: (staff)/settings/{page,integrations/
--       {page,ebay/actions}}.tsx, api/cron/ebay-sync/route.ts,
--       (staff)/inventory/[id]/page.tsx, lib/ebay/auth.ts
--   None use the user-scoped client. Tightening is therefore zero-
--   regression for the read paths.
--
-- Bigger-picture follow-up: the reviewer's stronger architectural
-- recommendation (split secret columns into a separate table or
-- masked-status view + service-role-only reads) bundles with the
-- pgsodium-encryption migration on the backlog. This patch is the
-- "close the disclosed leak today" step.
-- ───────────────────────────────────────────────────────────────────────────

-- tenant_billing_settings
DROP POLICY IF EXISTS tenant_billing_read ON tenant_billing_settings;
CREATE POLICY tenant_billing_read ON tenant_billing_settings FOR SELECT
  USING (my_role_in_tenant(tenant_id) IN ('owner','chain_admin'));

-- settings
DROP POLICY IF EXISTS settings_read ON settings;
CREATE POLICY settings_read ON settings FOR SELECT
  USING (my_role_in_tenant(tenant_id) IN ('owner','chain_admin'));

-- tenant_ebay_credentials
DROP POLICY IF EXISTS tenant_ebay_credentials_staff_read ON tenant_ebay_credentials;
CREATE POLICY tenant_ebay_credentials_staff_read
  ON tenant_ebay_credentials FOR SELECT
  USING (my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager'));
