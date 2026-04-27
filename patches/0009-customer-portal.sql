-- ============================================================================
-- PAWN — CUSTOMER PORTAL MIGRATION (Phase 5)
-- File:    patches/0009-customer-portal.sql
-- Date:    2026-04-27
-- Purpose: Customer-portal data plumbing.
--   1. customers.auth_user_id — links a customer record to an auth.users row
--      so the logged-in `client` role can resolve their own customer id.
--   2. stripe_payment_links — pay-by-link sessions for loan payoff and
--      layaway balances. One row per Checkout Session.
--   3. RLS policies for the `client` role on:
--        - stripe_payment_links (own only, via customers.auth_user_id)
--        - loans / loan_collateral_items / loan_events (own customer's, SELECT)
--        - repair_tickets / repair_ticket_photos / repair_ticket_events
--          (own customer's, SELECT)
--        - layaways / layaway_payments (own customer's, SELECT)
--        - sales / sale_items / sale_payments (own customer's, SELECT)
--      Existing staff policies stay — these ADD parallel client policies.
--   4. get_my_customer_id() helper — looks up the customers row for
--      auth.uid() AND deleted_at IS NULL.
--
-- Apply to: existing project AFTER 0001..0008 have run.
-- Append-only — never edit prior migrations.
--
-- Design notes:
--   - Customer portal users have user_tenants.role = 'client' at the tenant
--     that owns their customer record. They are NOT staff anywhere, so
--     my_is_staff() returns FALSE. The new client policies don't go through
--     my_is_staff(); they go through get_my_customer_id() + the FK chain
--     (loan.customer_id, repair_ticket.customer_id, layaway.customer_id,
--     sale.customer_id).
--   - SELECT-only for clients on loans / repair_tickets / layaways / sales.
--     Writes always flow through staff or webhook server actions, never
--     directly from the portal.
--   - stripe_payment_links is the only client-writable table — and even
--     there, the INSERT comes from the server action (admin client) on
--     behalf of the client. Client RLS only grants SELECT on own rows.
--   - Money: numeric(18,4). Status / source_kind: TEXT CHECK enums (cheaper
--     to extend later than a Postgres ENUM type).
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  customers.auth_user_id
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Indexed lookup for get_my_customer_id().
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customers_auth_user_id
  ON customers(auth_user_id)
  WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_auth_user_id
  ON customers(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  get_my_customer_id() — resolve the active client's customer row.
-- ───────────────────────────────────────────────────────────────────────────
-- Used in client RLS policies. SECURITY DEFINER so the lookup happens with
-- elevated privileges (it has to read customers — the customer's own RLS
-- policy then references THIS function, so we'd recurse without DEFINER).
-- STABLE so the planner can cache within a query.

CREATE OR REPLACE FUNCTION get_my_customer_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT id FROM customers
  WHERE auth_user_id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  stripe_payment_links — pay-by-link sessions.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stripe_payment_links (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- 'loan_payoff' for a pawn loan, 'layaway_payment' for a layaway balance.
  source_kind        TEXT NOT NULL CHECK (source_kind IN ('loan_payoff','layaway_payment')),
  -- Loose FK — depends on source_kind. Constraints enforced at the action
  -- layer; we don't FK across kinds because kind switches the target table.
  source_id          UUID NOT NULL,

  -- The customer that initiated the payment. RLS ties the client row to the
  -- session via customers.auth_user_id.
  customer_id        UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  -- Stripe Checkout Session id (cs_test_... / cs_live_...). Globally unique
  -- on Stripe side; we make it unique here too for idempotency on webhook.
  stripe_session_id  TEXT NOT NULL UNIQUE,
  -- Hosted Checkout URL — what the portal redirects to.
  checkout_url       TEXT,
  -- The Connect account the session was created on (mirror of
  -- tenant_billing_settings.stripe_account_id at creation time).
  stripe_account_id  TEXT,
  -- PaymentIntent id once the session completes; populated from the webhook.
  stripe_payment_intent_id TEXT,

  amount             NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  currency           TEXT NOT NULL DEFAULT 'USD',

  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','expired','cancelled')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_payment_links_tenant
  ON stripe_payment_links(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_links_source
  ON stripe_payment_links(source_kind, source_id, status);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_links_customer
  ON stripe_payment_links(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_links_pending
  ON stripe_payment_links(tenant_id, status)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_stripe_payment_links_updated_at ON stripe_payment_links;
CREATE TRIGGER trg_stripe_payment_links_updated_at
BEFORE UPDATE ON stripe_payment_links
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY — stripe_payment_links
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE stripe_payment_links ENABLE ROW LEVEL SECURITY;

-- Staff can read/write their tenant's payment-link rows (server actions
-- write through the admin client, but the read paths in /staff use RLS).
DROP POLICY IF EXISTS stripe_payment_links_staff_read ON stripe_payment_links;
CREATE POLICY stripe_payment_links_staff_read ON stripe_payment_links FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS stripe_payment_links_staff_write ON stripe_payment_links;
CREATE POLICY stripe_payment_links_staff_write ON stripe_payment_links FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Client can read their own payment-link rows.
DROP POLICY IF EXISTS stripe_payment_links_client_read ON stripe_payment_links;
CREATE POLICY stripe_payment_links_client_read ON stripe_payment_links FOR SELECT
  USING (customer_id = get_my_customer_id());

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY — client policies on existing tables.
-- ───────────────────────────────────────────────────────────────────────────
-- Existing staff policies (loans_staff_read, etc.) stay. We add parallel
-- client policies so a logged-in client can see their own data — and ONLY
-- their own data.

-- ── loans
DROP POLICY IF EXISTS loans_client_read ON loans;
CREATE POLICY loans_client_read ON loans FOR SELECT
  USING (
    customer_id = get_my_customer_id()
    AND deleted_at IS NULL
  );

-- ── loan_collateral_items (read-only for owning client)
DROP POLICY IF EXISTS loan_collateral_client_read ON loan_collateral_items;
CREATE POLICY loan_collateral_client_read ON loan_collateral_items FOR SELECT
  USING (
    deleted_at IS NULL
    AND loan_id IN (
      SELECT id FROM loans
      WHERE customer_id = get_my_customer_id()
        AND deleted_at IS NULL
    )
  );

-- ── loan_events (payment history)
DROP POLICY IF EXISTS loan_events_client_read ON loan_events;
CREATE POLICY loan_events_client_read ON loan_events FOR SELECT
  USING (
    loan_id IN (
      SELECT id FROM loans
      WHERE customer_id = get_my_customer_id()
        AND deleted_at IS NULL
    )
  );

-- ── repair_tickets
DROP POLICY IF EXISTS repair_tickets_client_read ON repair_tickets;
CREATE POLICY repair_tickets_client_read ON repair_tickets FOR SELECT
  USING (
    customer_id = get_my_customer_id()
    AND deleted_at IS NULL
  );

-- ── repair_ticket_photos (only when the ticket belongs to the client)
DROP POLICY IF EXISTS repair_ticket_photos_client_read ON repair_ticket_photos;
CREATE POLICY repair_ticket_photos_client_read ON repair_ticket_photos FOR SELECT
  USING (
    deleted_at IS NULL
    AND ticket_id IN (
      SELECT id FROM repair_tickets
      WHERE customer_id = get_my_customer_id()
        AND deleted_at IS NULL
    )
  );

-- ── repair_ticket_events (status timeline — useful for the portal)
DROP POLICY IF EXISTS repair_ticket_events_client_read ON repair_ticket_events;
CREATE POLICY repair_ticket_events_client_read ON repair_ticket_events FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM repair_tickets
      WHERE customer_id = get_my_customer_id()
        AND deleted_at IS NULL
    )
  );

-- ── layaways
DROP POLICY IF EXISTS layaways_client_read ON layaways;
CREATE POLICY layaways_client_read ON layaways FOR SELECT
  USING (
    customer_id = get_my_customer_id()
    AND deleted_at IS NULL
  );

-- ── layaway_payments
DROP POLICY IF EXISTS layaway_payments_client_read ON layaway_payments;
CREATE POLICY layaway_payments_client_read ON layaway_payments FOR SELECT
  USING (
    deleted_at IS NULL
    AND layaway_id IN (
      SELECT id FROM layaways
      WHERE customer_id = get_my_customer_id()
        AND deleted_at IS NULL
    )
  );

-- ── sales (the layaway sale and any retail purchase by this customer)
DROP POLICY IF EXISTS sales_client_read ON sales;
CREATE POLICY sales_client_read ON sales FOR SELECT
  USING (
    customer_id = get_my_customer_id()
    AND deleted_at IS NULL
  );

-- ── sale_items (read-only for owning client)
DROP POLICY IF EXISTS sale_items_client_read ON sale_items;
CREATE POLICY sale_items_client_read ON sale_items FOR SELECT
  USING (
    deleted_at IS NULL
    AND sale_id IN (
      SELECT id FROM sales
      WHERE customer_id = get_my_customer_id()
        AND deleted_at IS NULL
    )
  );

-- ── sale_payments (so the client can see card-present + portal payments)
DROP POLICY IF EXISTS sale_payments_client_read ON sale_payments;
CREATE POLICY sale_payments_client_read ON sale_payments FOR SELECT
  USING (
    deleted_at IS NULL
    AND sale_id IN (
      SELECT id FROM sales
      WHERE customer_id = get_my_customer_id()
        AND deleted_at IS NULL
    )
  );

-- ── customers (clients can see their own row, useful for the portal header)
DROP POLICY IF EXISTS customers_client_self_read ON customers;
CREATE POLICY customers_client_self_read ON customers FOR SELECT
  USING (
    auth_user_id = auth.uid()
    AND deleted_at IS NULL
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0009-customer-portal.sql
-- ============================================================================
