-- ───────────────────────────────────────────────────────────────────────────
-- 0098 — Online orders keep their tax split
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0097.
--
-- An online order was quoted by the same function as a counter sale
-- (sales_tax_quote, 0095) but kept only the total. The sale written when the
-- card is charged therefore had no split by tax line, no tax per line, and
-- — when shipped out of the shop's state — nothing saying why it carried no
-- tax. On the sales tax report those sales fell under "One rate, no split"
-- and "No reason recorded".
--
-- Now the order keeps what it was quoted, at the moment it was quoted (the
-- shopper is charged that amount; the shop's tax lines may change before the
-- payment lands), and online_order_paid copies it onto the sale:
--   online_orders.tax_breakdown        the split by tax line (sales_tax_quote)
--   online_orders.tax_exempt_reason    'export' when shipped out of the
--                                      shop's state; NULL otherwise
--   online_order_items.tax_amount      that piece's share of the tax
-- -> sales.tax_breakdown, sales.tax_exempt + tax_exempt_reason,
--    sale_items.tax_amount (shipping line = 0).
--
-- An order with no tax because the SHOP has no tax lines stays a plain
-- no-tax sale: only "shipped out of state" is an exemption.
--
-- Function bodies are the LIVE definitions (pg_get_functiondef, 2026-11-22;
-- online_order_reserve equal to patches/0095, online_order_paid to 0078)
-- with only the changes marked "0098". Signatures are unchanged, so
-- CREATE OR REPLACE keeps the grants (service_role only).
-- RLS: no policy added or changed. The new columns are covered by the
-- existing policies of their tables.
--
-- Rollback
--   Re-apply online_order_reserve from patches/0095 and online_order_paid
--   from patches/0078; then
--   ALTER TABLE online_order_items DROP COLUMN IF EXISTS tax_amount;
--   ALTER TABLE online_orders DROP COLUMN IF EXISTS tax_exempt_reason,
--     DROP COLUMN IF EXISTS tax_breakdown;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS tax_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS tax_exempt_reason TEXT
    CHECK (tax_exempt_reason IS NULL OR tax_exempt_reason IN ('resale', 'organization', 'government', 'export', 'other'));
COMMENT ON COLUMN online_orders.tax_breakdown IS
  'Tax by tax line as quoted at checkout: [{name, level, rate, item_cap, taxable, tax}]. Copied to sales.tax_breakdown when the order is paid. NULL = no tax, or an order placed before 0098.';
COMMENT ON COLUMN online_orders.tax_exempt_reason IS
  'Why the order carries no tax (''export'' = shipped out of the shop''s state). Copied to sales.tax_exempt_reason. NULL = taxed, or the shop charges no tax.';

ALTER TABLE online_order_items ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,4);
COMMENT ON COLUMN online_order_items.tax_amount IS
  'This piece''s share of online_orders.tax_amount. Copied to sale_items.tax_amount. NULL when the order kept no split.';

-- ── online_order_reserve (same signature; grants kept) ────────────────────
CREATE OR REPLACE FUNCTION public.online_order_reserve(p_tenant_id uuid, p_item_ids uuid[], p_token text, p_name text, p_email text, p_phone text, p_language text, p_fulfillment text, p_ship_line1 text DEFAULT NULL::text, p_ship_line2 text DEFAULT NULL::text, p_ship_city text DEFAULT NULL::text, p_ship_state text DEFAULT NULL::text, p_ship_postal text DEFAULT NULL::text)
 RETURNS TABLE(o_order_id uuid, o_order_number text, o_total numeric, o_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- 0098: what the order keeps about its tax, for the sale made when it is paid.
  v_line_tax  NUMERIC[];
  v_breakdown JSONB;
  v_exempt    TEXT;
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
  ELSE
    -- 0098: shipped out of the shop's state — no tax, and the sale says why.
    v_exempt := 'export';
  END IF;
  -- 0095: the same calculation the counter uses, so a per-item cap on a tax
  -- line applies online too. With no caps this equals subtotal x rate.
  IF v_rate > 0 THEN
    -- 0098: keep each piece's tax and the split by tax line, not only the total.
    SELECT q.o_tax, q.o_line_tax, NULLIF(q.o_breakdown, '[]'::jsonb)
      INTO v_tax, v_line_tax, v_breakdown
      FROM sales_tax_quote(
             p_tenant_id,
             (SELECT array_agg(1::numeric ORDER BY i.id) FROM inventory_items i WHERE i.id = ANY (v_ids)),
             (SELECT array_agg(ROUND(i.list_price, 2) ORDER BY i.id) FROM inventory_items i WHERE i.id = ANY (v_ids))
           ) q;
  ELSE
    v_tax := 0;
  END IF;

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
    signature_required, subtotal, tax_rate, tax_amount, shipping_amount, total, expires_at,
    tax_breakdown, tax_exempt_reason
  ) VALUES (
    p_tenant_id, v_number, p_token, btrim(p_name), v_email, NULLIF(btrim(COALESCE(p_phone, '')), ''),
    CASE WHEN p_language = 'es' THEN 'es' ELSE 'en' END, p_fulfillment,
    CASE WHEN p_fulfillment = 'ship' THEN NULLIF(btrim(p_ship_line1), '') END,
    CASE WHEN p_fulfillment = 'ship' THEN NULLIF(btrim(COALESCE(p_ship_line2, '')), '') END,
    CASE WHEN p_fulfillment = 'ship' THEN NULLIF(btrim(p_ship_city), '') END,
    CASE WHEN p_fulfillment = 'ship' THEN upper(NULLIF(btrim(p_ship_state), '')) END,
    CASE WHEN p_fulfillment = 'ship' THEN NULLIF(btrim(p_ship_postal), '') END,
    p_fulfillment = 'ship' AND v_set.ship_signature_over IS NOT NULL AND v_total >= v_set.ship_signature_over,
    v_subtotal, v_rate, v_tax, v_ship, v_total, v_expires,
    v_breakdown, v_exempt
  )
  RETURNING id INTO v_order_id;

  -- 0098: v_ids is in id order — the order the pieces were quoted in.
  INSERT INTO online_order_items (tenant_id, order_id, inventory_item_id, sku, description, unit_price, position, tax_amount)
  SELECT p_tenant_id, v_order_id, i.id, i.sku, i.description, ROUND(i.list_price, 2),
         array_position(v_ids, i.id) - 1,
         CASE WHEN v_breakdown IS NOT NULL THEN v_line_tax[array_position(v_ids, i.id)] END
    FROM inventory_items i WHERE i.id = ANY (v_ids);

  UPDATE inventory_items SET reserved_order_id = v_order_id WHERE id = ANY (v_ids);

  RETURN QUERY SELECT v_order_id, v_number, v_total, v_expires;
END;
$function$;

-- ── online_order_paid (same signature; grants kept) ───────────────────────
CREATE OR REPLACE FUNCTION public.online_order_paid(p_tenant_id uuid, p_order_id uuid, p_session_id text, p_pi text, p_amount_cents bigint)
 RETURNS TABLE(o_reason text, o_sale_id uuid, o_customer_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    notes, is_locked,
    tax_breakdown, tax_exempt, tax_exempt_reason  -- 0098: what the order was quoted
  ) VALUES (
    p_tenant_id, NULL, 'retail', 'open', 'online', v_customer,
    v_o.subtotal + v_o.shipping_amount, v_o.tax_amount, v_o.tax_rate, 0, v_o.total, 0, 0,
    'Online order ' || v_o.order_number, FALSE,
    v_o.tax_breakdown, v_o.tax_exempt_reason IS NOT NULL, v_o.tax_exempt_reason
  )
  RETURNING id INTO v_sale;

  -- The consignment floor trigger checks each line here.
  INSERT INTO sale_items (sale_id, tenant_id, inventory_item_id, description, quantity,
                          unit_price, line_discount, line_total, position, returned_qty, tax_amount)
  SELECT v_sale, p_tenant_id, oi.inventory_item_id, oi.description, 1,
         oi.unit_price, 0, oi.unit_price, oi.position, 0, oi.tax_amount  -- 0098
    FROM online_order_items oi WHERE oi.order_id = p_order_id;
  IF v_o.shipping_amount > 0 THEN
    -- 0098: shipping carries no tax. With a split kept it says 0, so every
    -- line of the sale has its own tax and a return refunds it exactly.
    INSERT INTO sale_items (sale_id, tenant_id, inventory_item_id, description, quantity,
                            unit_price, line_discount, line_total, position, returned_qty, tax_amount)
    VALUES (v_sale, p_tenant_id, NULL, 'Shipping', 1, v_o.shipping_amount, 0, v_o.shipping_amount, 1000, 0,
            CASE WHEN v_o.tax_breakdown IS NOT NULL THEN 0 END);
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
$function$;

NOTIFY pgrst, 'reload schema';
