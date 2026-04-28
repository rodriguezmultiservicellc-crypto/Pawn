-- ───────────────────────────────────────────────────────────────────────────
-- 0018 — Customer portal invites
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0017 has already run.
--           Append-only — never edit prior migrations.
--
-- Adds the per-customer portal-invite token table + the new
-- `portal_invite` MessageKind for message_log.
--
-- Flow:
--   Operator clicks "Send portal invite" on a customer detail page.
--     ↓
--   Server action mints a row in customer_portal_invites with a UUID
--   token + 7-day expiry, then asks Supabase Auth admin.generateLink
--   (type='invite', email=customer.email,
--    options.redirectTo='/magic-link?next=/portal/claim/<token>') for an
--   action_link. Email is dispatched via per-tenant Resend (we own the
--   send so the customer sees the SHOP's brand, not Supabase's). If
--   Resend isn't configured, the action returns the link so the
--   operator can copy + send manually.
--     ↓
--   Customer clicks the link → Supabase verifies OTP, sets session,
--   redirects to /magic-link → /portal/claim/<token>.
--     ↓
--   /portal/claim/<token>:
--     - validates invite (not consumed, not expired),
--     - validates auth.email matches invite.email (anti-theft),
--     - inserts user_tenants(role='client', is_active=true),
--     - sets customers.auth_user_id,
--     - marks invite consumed,
--     - sets pawn-active-tenant cookie,
--     - redirects to /portal.
--
-- RLS on this NEW table: staff-read at the invite's tenant, all writes
-- go through the admin client (server actions).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'portal_invite';

CREATE TABLE IF NOT EXISTS customer_portal_invites (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  customer_id   UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email         TEXT         NOT NULL,                                 -- snapshot at send time
  token         UUID         NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  expires_at    TIMESTAMPTZ  NOT NULL,
  consumed_at   TIMESTAMPTZ,
  consumed_by   UUID         REFERENCES auth.users(id),
  created_by    UUID         REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpi_token    ON customer_portal_invites(token);
CREATE INDEX IF NOT EXISTS idx_cpi_customer ON customer_portal_invites(customer_id);
CREATE INDEX IF NOT EXISTS idx_cpi_tenant   ON customer_portal_invites(tenant_id);

ALTER TABLE customer_portal_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_portal_invites_staff_read ON customer_portal_invites;
CREATE POLICY customer_portal_invites_staff_read ON customer_portal_invites FOR SELECT
  USING (my_is_staff(tenant_id));
