-- ───────────────────────────────────────────────────────────────────────────
-- 0078 — Online orders (PLAN-2026-11-13 Phase 3)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0077 (message kinds).
--           Append-only — never edit prior migrations.
--
-- Online checkout on the existing public catalog. The order row is the
-- trusted record (like stripe_payment_links for portal payments): it is
-- written by OUR server when checkout starts, and the webhook only acts on
-- a session that matches it, from the shop's own Stripe account, for the
-- exact amount. stripe_payment_links is not used — it requires a customer,
-- and a guest only becomes a customer once they have paid.
--
--   1. sales.channel ('counter' | 'online'). Online sales have no register
--      session and stay out of the cash drawer.
--   2. inventory_items.reserved_order_id — a piece held for a checkout in
--      progress. NOT status='held' (that already means buy hold / layaway).
--      public_catalog_items hides reserved pieces.
--   3. settings: online store switches, default tax rate, shipping rules,
--      the per-order card limit (fraud decision 2), policies, branding.
--   4. online_orders + online_order_items.
--   5. public_store_settings view — what the storefront may show.
--   6. Functions (SECURITY DEFINER, service_role only):
--        online_order_reserve   lock pieces, re-check the public view,
--                               compute totals, create the order
--        online_order_attach_session  record the Checkout session
--        online_order_release   give pieces back (abandoned / expired)
--        online_order_sweep     release every overdue reservation (cron)
--        online_order_paid      create + complete the sale (channel online)
--        online_order_advance   staff: picking → ready / shipped → completed
--   7. Message templates for the three new kinds (EN + ES).
--
-- RLS (NEW policies on the NEW tables only — no existing policy changes):
--   online_orders_staff_read        SELECT for staff of the tenant
--   online_order_items_staff_read   SELECT for staff of the tenant
--   No write policies: every write goes through the functions. The public
--   order status page reads by token on the server, never through anon.
--
-- Views changed: public_catalog_items gains `reserved_order_id IS NULL`
-- (same columns). New view public_store_settings (anon SELECT).
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. sales.channel ──────────────────────────────────────────────────────
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'counter'
  CHECK (channel IN ('counter', 'online'));

-- ── 3. settings ───────────────────────────────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS online_checkout_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_tax_rate          NUMERIC(6,4) NOT NULL DEFAULT 0
    CHECK (default_tax_rate >= 0 AND default_tax_rate <= 1),
  ADD COLUMN IF NOT EXISTS online_pickup_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS online_ship_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ship_flat_rate            NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (ship_flat_rate >= 0),
  ADD COLUMN IF NOT EXISTS ship_free_over            NUMERIC(18,4) CHECK (ship_free_over IS NULL OR ship_free_over >= 0),
  ADD COLUMN IF NOT EXISTS ship_signature_over       NUMERIC(18,4) CHECK (ship_signature_over IS NULL OR ship_signature_over >= 0),
  -- Decision 2 (approved 2026-11-13): above this, the store says "contact us".
  ADD COLUMN IF NOT EXISTS online_order_max          NUMERIC(18,4) NOT NULL DEFAULT 2500 CHECK (online_order_max > 0),
  ADD COLUMN IF NOT EXISTS online_reservation_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (online_reservation_minutes BETWEEN 30 AND 120),
  ADD COLUMN IF NOT EXISTS store_return_policy_en    TEXT,
  ADD COLUMN IF NOT EXISTS store_return_policy_es    TEXT,
  ADD COLUMN IF NOT EXISTS store_shipping_policy_en  TEXT,
  ADD COLUMN IF NOT EXISTS store_shipping_policy_es  TEXT,
  ADD COLUMN IF NOT EXISTS store_tagline_en          TEXT CHECK (store_tagline_en IS NULL OR length(store_tagline_en) <= 140),
  ADD COLUMN IF NOT EXISTS store_tagline_es          TEXT CHECK (store_tagline_es IS NULL OR length(store_tagline_es) <= 140),
  ADD COLUMN IF NOT EXISTS store_accent_color        TEXT CHECK (store_accent_color IS NULL OR store_accent_color ~ '^#[0-9a-fA-F]{6}$');

COMMENT ON COLUMN settings.online_order_max IS
  'Largest order a shopper may pay by card online. A chargeback a shop cannot cover falls on the platform (Stripe Express), so every shop has a cap.';
COMMENT ON COLUMN settings.default_tax_rate IS
  'Sales tax for online orders picked up or shipped in the shop''s state (decision 1). Other states: no tax charged; shops ask their accountant.';

-- ── 4. online_orders ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS online_orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number        TEXT NOT NULL,
  -- Unguessable; the shopper's order status page is /s/<slug>/order/<token>.
  public_token        TEXT NOT NULL UNIQUE CHECK (length(public_token) >= 32),
  status              TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
                        'pending_payment', 'expired', 'cancelled',
                        'paid', 'picking', 'ready', 'shipped', 'completed',
                        'needs_refund')),
  contact_name        TEXT NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 1 AND 120),
  contact_email       TEXT NOT NULL CHECK (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone       TEXT CHECK (contact_phone IS NULL OR length(contact_phone) <= 40),
  language            TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es')),
  fulfillment         TEXT NOT NULL CHECK (fulfillment IN ('pickup', 'ship')),
  ship_line1          TEXT,
  ship_line2          TEXT,
  ship_city           TEXT,
  ship_state          TEXT,
  ship_postal         TEXT,
  signature_required  BOOLEAN NOT NULL DEFAULT FALSE,
  subtotal            NUMERIC(18,4) NOT NULL,
  tax_rate            NUMERIC(6,4) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
  shipping_amount     NUMERIC(18,4) NOT NULL DEFAULT 0,
  total               NUMERIC(18,4) NOT NULL CHECK (total > 0),
  customer_id         UUID REFERENCES customers(id),
  sale_id             UUID REFERENCES sales(id),
  stripe_session_id   TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_account_id   TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  paid_at             TIMESTAMPTZ,
  ready_at            TIMESTAMPTZ,
  shipped_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  released_at         TIMESTAMPTZ,
  carrier             TEXT,
  tracking_number     TEXT,
  picked_up_by_name   TEXT,
  pickup_id_check     TEXT,
  pickup_signature_path TEXT,
  refund_reason       TEXT,
  staff_notes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, order_number),
  CHECK (fulfillment = 'pickup' OR (ship_line1 IS NOT NULL AND ship_city IS NOT NULL
                                    AND ship_state IS NOT NULL AND ship_postal IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_online_orders_tenant_status
  ON online_orders (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_orders_pending_expiry
  ON online_orders (expires_at) WHERE status = 'pending_payment';

DROP TRIGGER IF EXISTS trg_online_orders_updated_at ON online_orders;
CREATE TRIGGER trg_online_orders_updated_at BEFORE UPDATE ON online_orders
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS online_order_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id          UUID NOT NULL REFERENCES online_orders(id) ON DELETE RESTRICT,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  sku               TEXT NOT NULL,
  description       TEXT NOT NULL,
  unit_price        NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0),
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_online_order_items_order ON online_order_items (order_id);

-- ── 2. inventory_items.reserved_order_id ──────────────────────────────────
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS reserved_order_id UUID REFERENCES online_orders(id);

CREATE INDEX IF NOT EXISTS idx_inventory_items_reserved
  ON inventory_items (reserved_order_id) WHERE reserved_order_id IS NOT NULL;

COMMENT ON COLUMN inventory_items.reserved_order_id IS
  'Held for an online checkout in progress (not status=held, which means buy hold or layaway). Cleared on payment, expiry or cancel.';

-- ── RLS: staff read; writes only through the functions ────────────────────
ALTER TABLE online_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS online_orders_staff_read ON online_orders;
CREATE POLICY online_orders_staff_read ON online_orders FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS online_order_items_staff_read ON online_order_items;
CREATE POLICY online_order_items_staff_read ON online_order_items FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

-- ── 5. Views ──────────────────────────────────────────────────────────────
-- Same columns as 0072; a piece in someone's checkout is not for sale.
CREATE OR REPLACE VIEW public_catalog_items
WITH (security_invoker = false) AS
SELECT
  i.id, i.tenant_id, i.sku, i.description, i.category, i.brand, i.model,
  i.serial_number, i.metal, i.karat, i.weight_grams, i.weight_dwt,
  i.list_price, i.created_at
FROM inventory_items i
JOIN tenants t ON t.id = i.tenant_id
WHERE t.public_landing_enabled = TRUE
  AND t.public_catalog_enabled = TRUE
  AND t.has_retail = TRUE
  AND t.is_active = TRUE
  AND i.status = 'available'
  AND i.reserved_order_id IS NULL
  AND i.is_hidden_from_catalog = FALSE
  AND i.list_price IS NOT NULL
  AND i.deleted_at IS NULL;

CREATE OR REPLACE VIEW public_store_settings
WITH (security_invoker = false) AS
SELECT
  s.tenant_id,
  (s.online_checkout_enabled AND t.public_catalog_enabled AND t.has_retail) AS checkout_enabled,
  s.online_pickup_enabled  AS pickup_enabled,
  s.online_ship_enabled    AS ship_enabled,
  s.ship_flat_rate,
  s.ship_free_over,
  s.online_order_max       AS order_max,
  s.store_return_policy_en,
  s.store_return_policy_es,
  s.store_shipping_policy_en,
  s.store_shipping_policy_es,
  s.store_tagline_en,
  s.store_tagline_es,
  s.store_accent_color
FROM settings s
JOIN tenants t ON t.id = s.tenant_id
WHERE t.public_landing_enabled = TRUE
  AND t.public_slug IS NOT NULL
  AND t.is_active = TRUE;

COMMENT ON VIEW public_store_settings IS
  'Public projection of a shop''s online-store settings. Never the tax rate, signature threshold or any credential.';

GRANT SELECT ON public_store_settings TO anon, authenticated;

-- ── 6. Functions ──────────────────────────────────────────────────────────

-- Reserve pieces and create the order. Totals are cents. Refusal tokens:
--   checkout_off, too_many_items, item_unavailable, fulfillment_off,
--   order_over_limit, cannot_checkout (banned contact), too_many_pending
CREATE OR REPLACE FUNCTION online_order_reserve(
  p_tenant_id   UUID,
  p_item_ids    UUID[],
  p_token       TEXT,
  p_name        TEXT,
  p_email       TEXT,
  p_phone       TEXT,
  p_language    TEXT,
  p_fulfillment TEXT,
  p_ship_line1  TEXT DEFAULT NULL,
  p_ship_line2  TEXT DEFAULT NULL,
  p_ship_city   TEXT DEFAULT NULL,
  p_ship_state  TEXT DEFAULT NULL,
  p_ship_postal TEXT DEFAULT NULL
)
RETURNS TABLE (o_order_id UUID, o_order_number TEXT, o_total NUMERIC, o_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set       settings%ROWTYPE;
  v_shop_state TEXT;
  v_ids       UUID[];
  v_n         INTEGER;
  v_subtotal  NUMERIC(18,4);
  v_rate      NUMERIC(6,4) := 0;
  v_tax       NUMERIC(18,4);
  v_ship      NUMERIC(18,4) := 0;
  v_total     NUMERIC(18,4);
  v_email     TEXT := lower(btrim(COALESCE(p_email, '')));
  v_phone     TEXT := NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), '');
  v_order_id  UUID;
  v_number    TEXT;
  v_expires   TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_set FROM settings WHERE tenant_id = p_tenant_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public_store_settings ps WHERE ps.tenant_id = p_tenant_id AND ps.checkout_enabled
  ) THEN
    RAISE EXCEPTION 'checkout_off' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_item_ids) x WHERE x IS NOT NULL;
  v_n := COALESCE(array_length(v_ids, 1), 0);
  IF v_n = 0 OR v_n > 10 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = 'P0001';
  END IF;

  IF p_fulfillment = 'pickup' AND NOT v_set.online_pickup_enabled
     OR p_fulfillment = 'ship' AND NOT v_set.online_ship_enabled
     OR p_fulfillment NOT IN ('pickup', 'ship') THEN
    RAISE EXCEPTION 'fulfillment_off' USING ERRCODE = 'P0001';
  END IF;

  -- A banned customer matched by email or phone cannot check out.
  IF EXISTS (
    SELECT 1 FROM customers c
     WHERE c.tenant_id = p_tenant_id AND c.deleted_at IS NULL AND c.is_banned
       AND (lower(c.email) = v_email
            OR (v_phone IS NOT NULL AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = v_phone))
  ) THEN
    RAISE EXCEPTION 'cannot_checkout' USING ERRCODE = 'P0001';
  END IF;

  -- One shopper cannot tie up the case with open checkouts.
  IF (SELECT COUNT(*) FROM online_orders
       WHERE tenant_id = p_tenant_id AND status = 'pending_payment'
         AND lower(contact_email) = v_email AND expires_at > NOW()) >= 2 THEN
    RAISE EXCEPTION 'too_many_pending' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the pieces, then re-check them against the public view: the page
  -- is not trusted. Reserved, sold, held, hidden or unpriced → refused.
  PERFORM 1 FROM inventory_items
   WHERE id = ANY (v_ids) AND tenant_id = p_tenant_id
   ORDER BY id FOR UPDATE;
  IF (SELECT COUNT(*) FROM public_catalog_items pci
       WHERE pci.id = ANY (v_ids) AND pci.tenant_id = p_tenant_id) <> v_n THEN
    RAISE EXCEPTION 'item_unavailable' USING ERRCODE = 'P0001';
  END IF;
  -- The consignment floor is a contract; a listed price under it never sells.
  IF EXISTS (SELECT 1 FROM inventory_items i
              WHERE i.id = ANY (v_ids) AND i.consignment_min_price IS NOT NULL
                AND ROUND(i.list_price, 2) < i.consignment_min_price) THEN
    RAISE EXCEPTION 'item_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(ROUND(list_price, 2)), 0) INTO v_subtotal
    FROM inventory_items WHERE id = ANY (v_ids);

  -- Decision 1: tax for pickup and for shipping inside the shop's state.
  SELECT upper(btrim(COALESCE(state, ''))) INTO v_shop_state FROM tenants WHERE id = p_tenant_id;
  IF p_fulfillment = 'pickup' OR upper(btrim(COALESCE(p_ship_state, ''))) = v_shop_state THEN
    v_rate := v_set.default_tax_rate;
  END IF;
  v_tax := ROUND(v_subtotal * v_rate, 2);

  IF p_fulfillment = 'ship' AND NOT (v_set.ship_free_over IS NOT NULL AND v_subtotal >= v_set.ship_free_over) THEN
    v_ship := ROUND(v_set.ship_flat_rate, 2);
  END IF;
  v_total := v_subtotal + v_tax + v_ship;

  IF v_total > v_set.online_order_max THEN
    RAISE EXCEPTION 'order_over_limit' USING ERRCODE = 'P0001';
  END IF;

  v_number  := 'WO-' || lpad(next_tenant_counter(p_tenant_id, 'online_order')::text, 6, '0');
  v_expires := NOW() + make_interval(mins => v_set.online_reservation_minutes);

  INSERT INTO online_orders (
    tenant_id, order_number, public_token, contact_name, contact_email, contact_phone,
    language, fulfillment, ship_line1, ship_line2, ship_city, ship_state, ship_postal,
    signature_required, subtotal, tax_rate, tax_amount, shipping_amount, total, expires_at
  ) VALUES (
    p_tenant_id, v_number, p_token, btrim(p_name), v_email, NULLIF(btrim(COALESCE(p_phone, '')), ''),
    CASE WHEN p_language = 'es' THEN 'es' ELSE 'en' END, p_fulfillment,
    CASE WHEN p_fulfillment = 'ship' THEN NULLIF(btrim(p_ship_line1), '') END,
    CASE WHEN p_fulfillment = 'ship' THEN NULLIF(btrim(COALESCE(p_ship_line2, '')), '') END,
    CASE WHEN p_fulfillment = 'ship' THEN NULLIF(btrim(p_ship_city), '') END,
    CASE WHEN p_fulfillment = 'ship' THEN upper(NULLIF(btrim(p_ship_state), '')) END,
    CASE WHEN p_fulfillment = 'ship' THEN NULLIF(btrim(p_ship_postal), '') END,
    p_fulfillment = 'ship' AND v_set.ship_signature_over IS NOT NULL AND v_total >= v_set.ship_signature_over,
    v_subtotal, v_rate, v_tax, v_ship, v_total, v_expires
  )
  RETURNING id INTO v_order_id;

  INSERT INTO online_order_items (tenant_id, order_id, inventory_item_id, sku, description, unit_price, position)
  SELECT p_tenant_id, v_order_id, i.id, i.sku, i.description, ROUND(i.list_price, 2),
         array_position(v_ids, i.id) - 1
    FROM inventory_items i WHERE i.id = ANY (v_ids);

  UPDATE inventory_items SET reserved_order_id = v_order_id WHERE id = ANY (v_ids);

  RETURN QUERY SELECT v_order_id, v_number, v_total, v_expires;
END;
$$;

-- Record the Stripe Checkout session created for a pending order (the
-- webhook later matches on it, and on the connected account).
CREATE OR REPLACE FUNCTION online_order_attach_session(
  p_tenant_id  UUID,
  p_order_id   UUID,
  p_session_id TEXT,
  p_account_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE online_orders SET stripe_session_id = p_session_id, stripe_account_id = p_account_id
   WHERE id = p_order_id AND tenant_id = p_tenant_id
     AND status = 'pending_payment' AND stripe_session_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_pending' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Give the pieces back. Only an unpaid order can be released.
CREATE OR REPLACE FUNCTION online_order_release(
  p_tenant_id UUID,
  p_order_id  UUID,
  p_reason    TEXT DEFAULT 'expired'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE online_orders
     SET status = CASE WHEN p_reason = 'cancelled' THEN 'cancelled' ELSE 'expired' END,
         released_at = NOW()
   WHERE id = p_order_id AND tenant_id = p_tenant_id AND status = 'pending_payment';
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  UPDATE inventory_items SET reserved_order_id = NULL
   WHERE reserved_order_id = p_order_id AND tenant_id = p_tenant_id;
  RETURN TRUE;
END;
$$;

-- Release every reservation past its expiry (5 min grace for a webhook in
-- flight). Run by cron; returns how many orders were released.
CREATE OR REPLACE FUNCTION online_order_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  n INTEGER := 0;
BEGIN
  FOR r IN SELECT id, tenant_id FROM online_orders
            WHERE status = 'pending_payment' AND expires_at < NOW() - INTERVAL '5 minutes'
            ORDER BY expires_at LIMIT 500
  LOOP
    IF online_order_release(r.tenant_id, r.id, 'expired') THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- Payment confirmed by Stripe: create and complete the sale.
-- Reasons: applied | duplicate | amount_mismatch | needs_refund (pieces gone)
CREATE OR REPLACE FUNCTION online_order_paid(
  p_tenant_id    UUID,
  p_order_id     UUID,
  p_session_id   TEXT,
  p_pi           TEXT,
  p_amount_cents BIGINT
)
RETURNS TABLE (o_reason TEXT, o_sale_id UUID, o_customer_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_o        online_orders%ROWTYPE;
  v_ids      UUID[];
  v_n        INTEGER;
  v_customer UUID;
  v_first    TEXT;
  v_last     TEXT;
  v_phone    TEXT;
  v_sale     UUID;
BEGIN
  SELECT * INTO v_o FROM online_orders
   WHERE id = p_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_o.stripe_session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'session_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_o.status NOT IN ('pending_payment', 'expired', 'cancelled') THEN
    RETURN QUERY SELECT 'duplicate'::text, v_o.sale_id, v_o.customer_id;
    RETURN;
  END IF;
  IF p_amount_cents <> ROUND(v_o.total * 100)::bigint THEN
    UPDATE online_orders SET status = 'needs_refund', refund_reason = 'amount_mismatch',
           stripe_payment_intent_id = p_pi
     WHERE id = p_order_id;
    UPDATE inventory_items SET reserved_order_id = NULL WHERE reserved_order_id = p_order_id;
    RETURN QUERY SELECT 'amount_mismatch'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT array_agg(inventory_item_id ORDER BY inventory_item_id) INTO v_ids
    FROM online_order_items WHERE order_id = p_order_id;
  v_n := array_length(v_ids, 1);

  -- The pieces must still be ours to sell: available and reserved for this
  -- order — or, if the reservation lapsed, not taken by anyone else since.
  PERFORM 1 FROM inventory_items WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;
  IF (SELECT COUNT(*) FROM inventory_items
       WHERE id = ANY (v_ids) AND tenant_id = p_tenant_id AND deleted_at IS NULL
         AND status = 'available'
         AND (reserved_order_id = p_order_id OR reserved_order_id IS NULL)) <> v_n THEN
    UPDATE online_orders SET status = 'needs_refund', refund_reason = 'items_gone',
           stripe_payment_intent_id = p_pi, paid_at = NOW()
     WHERE id = p_order_id;
    UPDATE inventory_items SET reserved_order_id = NULL WHERE reserved_order_id = p_order_id;
    RETURN QUERY SELECT 'needs_refund'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- Guest checkout: match an existing customer by email, then phone;
  -- otherwise create one in this shop.
  v_phone := NULLIF(regexp_replace(COALESCE(v_o.contact_phone, ''), '\D', '', 'g'), '');
  SELECT c.id INTO v_customer FROM customers c
   WHERE c.tenant_id = p_tenant_id AND c.deleted_at IS NULL AND lower(c.email) = v_o.contact_email
   ORDER BY c.created_at LIMIT 1;
  IF v_customer IS NULL AND v_phone IS NOT NULL THEN
    SELECT c.id INTO v_customer FROM customers c
     WHERE c.tenant_id = p_tenant_id AND c.deleted_at IS NULL
       AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = v_phone
     ORDER BY c.created_at LIMIT 1;
  END IF;
  IF v_customer IS NULL THEN
    v_first := split_part(btrim(v_o.contact_name), ' ', 1);
    v_last  := NULLIF(btrim(substr(btrim(v_o.contact_name), length(v_first) + 1)), '');
    INSERT INTO customers (tenant_id, first_name, last_name, email, phone, language, comm_preference)
    VALUES (p_tenant_id, v_first, COALESCE(v_last, '-'), v_o.contact_email, v_o.contact_phone,
            v_o.language, 'email')
    RETURNING id INTO v_customer;
  END IF;

  INSERT INTO sales (
    tenant_id, register_session_id, sale_kind, status, channel, customer_id,
    subtotal, tax_amount, tax_rate, discount_amount, total, paid_total, returned_total,
    notes, is_locked
  ) VALUES (
    p_tenant_id, NULL, 'retail', 'open', 'online', v_customer,
    v_o.subtotal + v_o.shipping_amount, v_o.tax_amount, v_o.tax_rate, 0, v_o.total, 0, 0,
    'Online order ' || v_o.order_number, FALSE
  )
  RETURNING id INTO v_sale;

  -- The consignment floor trigger checks each line here.
  INSERT INTO sale_items (sale_id, tenant_id, inventory_item_id, description, quantity,
                          unit_price, line_discount, line_total, position, returned_qty)
  SELECT v_sale, p_tenant_id, oi.inventory_item_id, oi.description, 1,
         oi.unit_price, 0, oi.unit_price, oi.position, 0
    FROM online_order_items oi WHERE oi.order_id = p_order_id;
  IF v_o.shipping_amount > 0 THEN
    INSERT INTO sale_items (sale_id, tenant_id, inventory_item_id, description, quantity,
                            unit_price, line_discount, line_total, position, returned_qty)
    VALUES (v_sale, p_tenant_id, NULL, 'Shipping', 1, v_o.shipping_amount, 0, v_o.shipping_amount, 1000, 0);
  END IF;

  UPDATE inventory_items SET status = 'sold', reserved_order_id = NULL
   WHERE id = ANY (v_ids);

  INSERT INTO sale_payments (sale_id, tenant_id, amount, payment_method, card_present_status,
                             stripe_payment_intent_id, notes)
  VALUES (v_sale, p_tenant_id, v_o.total, 'card', 'succeeded', p_pi,
          'Online order ' || v_o.order_number);
  UPDATE sales SET paid_total = v_o.total WHERE id = v_sale;

  -- Completion: consignment accrual + market data triggers, same as the counter.
  PERFORM sale_complete(p_tenant_id, v_sale, NULL);

  UPDATE online_orders
     SET status = 'paid', paid_at = NOW(), sale_id = v_sale, customer_id = v_customer,
         stripe_payment_intent_id = p_pi, released_at = NULL
   WHERE id = p_order_id;

  RETURN QUERY SELECT 'applied'::text, v_sale, v_customer;
END;
$$;

-- Staff moves a paid order along. Allowed:
--   paid → picking → ready (pickup) → completed (handover: name, ID, signature)
--   paid → picking → shipped (carrier + tracking) → completed
CREATE OR REPLACE FUNCTION online_order_advance(
  p_tenant_id      UUID,
  p_order_id       UUID,
  p_user_id        UUID,
  p_to             TEXT,
  p_carrier        TEXT DEFAULT NULL,
  p_tracking       TEXT DEFAULT NULL,
  p_pickup_name    TEXT DEFAULT NULL,
  p_pickup_id      TEXT DEFAULT NULL,
  p_signature_path TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_o online_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_o FROM online_orders WHERE id = p_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_to = 'picking' AND v_o.status = 'paid' THEN
    UPDATE online_orders SET status = 'picking' WHERE id = p_order_id;
  ELSIF p_to = 'ready' AND v_o.status IN ('paid', 'picking') AND v_o.fulfillment = 'pickup' THEN
    UPDATE online_orders SET status = 'ready', ready_at = NOW() WHERE id = p_order_id;
  ELSIF p_to = 'shipped' AND v_o.status IN ('paid', 'picking') AND v_o.fulfillment = 'ship' THEN
    IF length(btrim(COALESCE(p_tracking, ''))) < 4 OR length(btrim(COALESCE(p_carrier, ''))) < 2 THEN
      RAISE EXCEPTION 'tracking_required' USING ERRCODE = 'P0001';
    END IF;
    UPDATE online_orders SET status = 'shipped', shipped_at = NOW(),
           carrier = btrim(p_carrier), tracking_number = btrim(p_tracking)
     WHERE id = p_order_id;
  ELSIF p_to = 'completed' AND v_o.status = 'ready' THEN
    IF length(btrim(COALESCE(p_pickup_name, ''))) < 2 OR length(btrim(COALESCE(p_pickup_id, ''))) < 2
       OR p_signature_path IS NULL THEN
      RAISE EXCEPTION 'pickup_check_required' USING ERRCODE = 'P0001';
    END IF;
    UPDATE online_orders SET status = 'completed', completed_at = NOW(),
           picked_up_by_name = btrim(p_pickup_name), pickup_id_check = btrim(p_pickup_id),
           pickup_signature_path = p_signature_path
     WHERE id = p_order_id;
  ELSIF p_to = 'completed' AND v_o.status = 'shipped' THEN
    UPDATE online_orders SET status = 'completed', completed_at = NOW() WHERE id = p_order_id;
  ELSE
    RAISE EXCEPTION 'bad_transition' USING ERRCODE = 'P0001',
      DETAIL = format('%s → %s (%s)', v_o.status, p_to, v_o.fulfillment);
  END IF;
  RETURN p_to;
END;
$$;

REVOKE ALL ON FUNCTION online_order_reserve(UUID, UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION online_order_attach_session(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION online_order_release(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION online_order_sweep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION online_order_paid(UUID, UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION online_order_advance(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION online_order_reserve(UUID, UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION online_order_attach_session(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION online_order_release(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION online_order_sweep() TO service_role;
GRANT EXECUTE ON FUNCTION online_order_paid(UUID, UUID, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION online_order_advance(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── 7. Message templates (EN + ES; sms + email; whatsapp off) ─────────────
CREATE OR REPLACE FUNCTION seed_online_order_templates(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nl CONSTANT TEXT := E'\n\n';
BEGIN
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, is_enabled) VALUES
    (p_tenant_id, 'online_order_confirmed', 'en', 'sms', '{{shop_name}}: thank you! Order {{order_number}} ({{amount}}) is confirmed. Status: {{order_link}}', TRUE),
    (p_tenant_id, 'online_order_confirmed', 'es', 'sms', '{{shop_name}}: ¡gracias! Su pedido {{order_number}} ({{amount}}) está confirmado. Estado: {{order_link}}', TRUE),
    (p_tenant_id, 'online_order_ready', 'en', 'sms', '{{shop_name}}: order {{order_number}} is ready for pickup. Bring a photo ID. {{order_link}}', TRUE),
    (p_tenant_id, 'online_order_ready', 'es', 'sms', '{{shop_name}}: su pedido {{order_number}} está listo para recoger. Traiga una identificación con foto. {{order_link}}', TRUE),
    (p_tenant_id, 'online_order_shipped', 'en', 'sms', '{{shop_name}}: order {{order_number}} shipped via {{carrier}}, tracking {{tracking_number}}. {{order_link}}', TRUE),
    (p_tenant_id, 'online_order_shipped', 'es', 'sms', '{{shop_name}}: su pedido {{order_number}} fue enviado por {{carrier}}, rastreo {{tracking_number}}. {{order_link}}', TRUE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, subject, body, is_enabled) VALUES
    (p_tenant_id, 'online_order_confirmed', 'en', 'email', 'Order {{order_number}} confirmed — {{shop_name}}',
     'Hi {{customer_first_name}},'||nl||'Thank you for your order {{order_number}} ({{amount}}). We will let you know as soon as it is {{fulfillment_next}}.'||nl||'Order status: {{order_link}}'||nl||'— {{shop_name}}', TRUE),
    (p_tenant_id, 'online_order_confirmed', 'es', 'email', 'Pedido {{order_number}} confirmado — {{shop_name}}',
     'Hola {{customer_first_name}},'||nl||'Gracias por su pedido {{order_number}} ({{amount}}). Le avisaremos en cuanto esté {{fulfillment_next}}.'||nl||'Estado del pedido: {{order_link}}'||nl||'— {{shop_name}}', TRUE),
    (p_tenant_id, 'online_order_ready', 'en', 'email', 'Order {{order_number}} is ready for pickup — {{shop_name}}',
     'Hi {{customer_first_name}},'||nl||'Your order {{order_number}} is ready for pickup. Please bring a photo ID; we will ask for a signature at handover.'||nl||'{{order_link}}'||nl||'— {{shop_name}}', TRUE),
    (p_tenant_id, 'online_order_ready', 'es', 'email', 'Su pedido {{order_number}} está listo — {{shop_name}}',
     'Hola {{customer_first_name}},'||nl||'Su pedido {{order_number}} está listo para recoger. Traiga una identificación con foto; le pediremos una firma al entregarlo.'||nl||'{{order_link}}'||nl||'— {{shop_name}}', TRUE),
    (p_tenant_id, 'online_order_shipped', 'en', 'email', 'Order {{order_number}} has shipped — {{shop_name}}',
     'Hi {{customer_first_name}},'||nl||'Your order {{order_number}} shipped via {{carrier}}. Tracking number: {{tracking_number}}.'||nl||'{{order_link}}'||nl||'— {{shop_name}}', TRUE),
    (p_tenant_id, 'online_order_shipped', 'es', 'email', 'Su pedido {{order_number}} fue enviado — {{shop_name}}',
     'Hola {{customer_first_name}},'||nl||'Su pedido {{order_number}} fue enviado por {{carrier}}. Número de rastreo: {{tracking_number}}.'||nl||'{{order_link}}'||nl||'— {{shop_name}}', TRUE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, body, whatsapp_content_sid, is_enabled)
  SELECT p_tenant_id, k, l, 'whatsapp', b, NULL, FALSE
    FROM (VALUES
      ('online_order_confirmed'::message_kind, 'en', '{{shop_name}}: order {{order_number}} confirmed. {{order_link}}'),
      ('online_order_confirmed'::message_kind, 'es', '{{shop_name}}: pedido {{order_number}} confirmado. {{order_link}}'),
      ('online_order_ready'::message_kind,     'en', '{{shop_name}}: order {{order_number}} is ready for pickup. {{order_link}}'),
      ('online_order_ready'::message_kind,     'es', '{{shop_name}}: su pedido {{order_number}} está listo. {{order_link}}'),
      ('online_order_shipped'::message_kind,   'en', '{{shop_name}}: order {{order_number}} shipped, tracking {{tracking_number}}.'),
      ('online_order_shipped'::message_kind,   'es', '{{shop_name}}: pedido {{order_number}} enviado, rastreo {{tracking_number}}.')
    ) AS v(k, l, b)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION seed_online_order_templates(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_online_order_templates(UUID) TO service_role;

CREATE OR REPLACE FUNCTION tenant_after_insert_seed_online_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM seed_online_order_templates(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_after_insert_seed_online_orders ON tenants;
CREATE TRIGGER trg_tenant_after_insert_seed_online_orders
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION tenant_after_insert_seed_online_orders();

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM tenants LOOP
    PERFORM seed_online_order_templates(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
