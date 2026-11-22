-- ───────────────────────────────────────────────────────────────────────────
-- 0095 — Per-item cap on a tax line ("only the first $X of each item")
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0094.
--
-- Some taxes stop at part of an item's price: a county surtax on the first
-- few thousand dollars of each item, a local tax on the first part of a
-- single article. Which taxes, and how much, differs by state, so it is a
-- setting on each tax line (tax_rates.item_cap), never a constant in code.
-- NULL = the tax applies to the whole price, as before.
--
-- A capped tax cannot be charged as "rate x sale total", so the tax of a
-- counter sale is now worked out per item by ONE function, sales_tax_quote(),
-- used by sale_create (and through it layaway_create) and by the online
-- store. The sale screen runs the same arithmetic (src/lib/pos/sales-tax.ts)
-- so the screen, the receipt and the card charge agree to the cent.
--
--   tax          = ROUND( SUM over tax lines and items of
--                         taxable part of the item x rate , 2)
--   taxable part = the item's price after every discount, or
--                  item_cap x quantity if that is less
--   With no caps this is exactly the old ROUND((subtotal - discount) x rate, 2).
--
-- sale_create gets p_tax_mode:
--   'shop'  the shop's own tax lines (caps included). p_tax_rate is ignored.
--   'flat'  p_tax_rate on the whole sale — the clerk typed a different rate
--           (exempt sale, special case). Default, and what every caller sent
--           before this patch.
--
-- Two things are now kept with each 'shop' sale, so a later change to the
-- tax lines never rewrites history:
--   sales.tax_breakdown    [{name, level, rate, item_cap, taxable, tax}]
--                          one entry per tax line — the state / county split
--   sale_items.tax_amount  that line's share of the tax (exact refunds)
-- Both are NULL on older sales and on 'flat' sales; returns fall back to
-- the proportional rule they used before.
--
-- Function bodies are the LIVE definitions (pg_get_functiondef, 2026-11-22)
-- with only the changes marked "0095". The signatures of sale_create and
-- layaway_create grow by one optional argument, so the old ones are dropped
-- and the grants (service_role only) are restated.
-- RLS: no policy added or changed.
--
-- Rollback
--   Re-apply patches/0084 (sale_create) and the layaway_create +
--   online_order_reserve bodies from 0076 / 0078 after dropping the new
--   signatures; then
--   DROP FUNCTION IF EXISTS sales_tax_quote(UUID, NUMERIC[], NUMERIC[]);
--   ALTER TABLE sale_items DROP COLUMN IF EXISTS tax_amount;
--   ALTER TABLE sales DROP COLUMN IF EXISTS tax_breakdown;
--   ALTER TABLE tax_rates DROP COLUMN IF EXISTS item_cap;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE tax_rates
  ADD COLUMN IF NOT EXISTS item_cap NUMERIC(18,4) CHECK (item_cap IS NULL OR item_cap > 0);
COMMENT ON COLUMN tax_rates.item_cap IS
  'When set, this tax applies only to the first item_cap dollars of each item (per unit). NULL = the whole price.';

ALTER TABLE sales ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;
COMMENT ON COLUMN sales.tax_breakdown IS
  'Tax by tax line at the time of sale: [{name, level, rate, item_cap, taxable, tax}]. NULL = one flat rate (sales.tax_rate), or a sale made before 0095.';

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,4);
COMMENT ON COLUMN sale_items.tax_amount IS
  'This line''s share of sales.tax_amount (lines add up to it). NULL on flat-rate sales and sales made before 0095.';

-- ── sales_tax_quote ───────────────────────────────────────────────────────
-- p_qty[i] / p_net[i]: quantity and price of line i after every discount,
-- in cents. Returns the tax, the nominal rate (sum of the active lines), the
-- tax of each line and the breakdown by tax line. Reads tax_rates; writes
-- nothing.
CREATE OR REPLACE FUNCTION public.sales_tax_quote(p_tenant_id uuid, p_qty numeric[], p_net numeric[])
 RETURNS TABLE(o_tax numeric, o_rate numeric, o_line_tax numeric[], o_breakdown jsonb)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n          INTEGER := COALESCE(array_length(p_net, 1), 0);
  v_raw      NUMERIC[];              -- unrounded tax of each line
  v_line     NUMERIC[];              -- the same, in cents
  v_part_raw NUMERIC[] := '{}';      -- unrounded tax of each tax line
  v_part_tax NUMERIC[] := '{}';      -- the same, in cents
  v_parts    JSONB := '[]'::jsonb;
  v_rate     NUMERIC := 0;
  v_sum      NUMERIC := 0;           -- unrounded tax of the whole sale
  v_tax      NUMERIC;
  v_base     NUMERIC;
  v_taxable  NUMERIC;
  v_fix      NUMERIC;
  v_at       INTEGER;
  r          RECORD;
  i          INTEGER;
BEGIN
  IF COALESCE(array_length(p_qty, 1), 0) <> n THEN
    RAISE EXCEPTION 'bad_tax_lines' USING ERRCODE = 'P0001';
  END IF;
  IF n > 0 THEN
    v_raw  := array_fill(0::numeric, ARRAY[n]);
    v_line := array_fill(0::numeric, ARRAY[n]);
  ELSE
    v_raw  := '{}';
    v_line := '{}';
  END IF;

  FOR r IN
    SELECT t.name, t.level, t.rate, t.item_cap
      FROM tax_rates t
     WHERE t.tenant_id = p_tenant_id AND t.is_active AND t.deleted_at IS NULL
     ORDER BY array_position(ARRAY['state', 'county', 'city', 'district', 'other'], t.level),
              t.created_at, t.id
  LOOP
    v_base := 0;
    FOR i IN 1..n LOOP
      v_taxable := GREATEST(0, COALESCE(p_net[i], 0));
      IF r.item_cap IS NOT NULL THEN
        v_taxable := LEAST(v_taxable, ROUND(r.item_cap * GREATEST(COALESCE(p_qty[i], 0), 0), 2));
      END IF;
      v_base   := v_base + v_taxable;
      v_raw[i] := v_raw[i] + v_taxable * r.rate;
    END LOOP;
    v_rate     := v_rate + r.rate;
    v_sum      := v_sum + v_base * r.rate;
    v_part_raw := v_part_raw || (v_base * r.rate);
    v_part_tax := v_part_tax || ROUND(v_base * r.rate, 2);
    v_parts    := v_parts || jsonb_build_object(
                    'name', r.name, 'level', r.level, 'rate', r.rate,
                    'item_cap', r.item_cap, 'taxable', v_base, 'tax', 0);
  END LOOP;

  -- One rounding, on the whole sale.
  v_tax := ROUND(v_sum, 2);

  -- The tax lines add up to it: a leftover cent goes to the largest.
  IF COALESCE(array_length(v_part_tax, 1), 0) > 0 THEN
    v_fix := v_tax - (SELECT SUM(x) FROM unnest(v_part_tax) AS x);
    IF v_fix <> 0 THEN
      SELECT u.ord INTO v_at
        FROM unnest(v_part_raw) WITH ORDINALITY AS u(x, ord)
       ORDER BY u.x DESC, u.ord ASC LIMIT 1;
      v_part_tax[v_at] := v_part_tax[v_at] + v_fix;
    END IF;
    FOR i IN 1..array_length(v_part_tax, 1) LOOP
      v_parts := jsonb_set(v_parts, ARRAY[(i - 1)::text, 'tax'], to_jsonb(v_part_tax[i]));
    END LOOP;
  END IF;

  -- So do the sale's lines.
  IF n > 0 THEN
    FOR i IN 1..n LOOP
      v_line[i] := ROUND(v_raw[i], 2);
    END LOOP;
    v_fix := v_tax - (SELECT SUM(x) FROM unnest(v_line) AS x);
    IF v_fix <> 0 THEN
      SELECT u.ord INTO v_at
        FROM unnest(v_raw) WITH ORDINALITY AS u(x, ord)
       ORDER BY u.x DESC, u.ord ASC LIMIT 1;
      v_line[v_at] := v_line[v_at] + v_fix;
    END IF;
  END IF;

  RETURN QUERY SELECT v_tax, v_rate, v_line, v_parts;
END;
$function$;

REVOKE ALL ON FUNCTION sales_tax_quote(UUID, NUMERIC[], NUMERIC[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sales_tax_quote(UUID, NUMERIC[], NUMERIC[]) TO service_role;

-- ── sale_create (+ p_tax_mode) ────────────────────────────────────────────
DROP FUNCTION IF EXISTS sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.sale_create(p_tenant_id uuid, p_user_id uuid, p_register_session_id uuid, p_sale_kind sale_kind, p_customer_id uuid, p_tax_rate numeric, p_discount numeric, p_notes text, p_items jsonb, p_tax_mode text DEFAULT 'flat'::text)
 RETURNS TABLE(o_sale_id uuid, o_sale_number text, o_total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale_id   UUID;
  v_number    TEXT;
  v_ids       UUID[];
  v_locked    INTEGER;
  v_subtotal  NUMERIC(18,4);
  v_discount  NUMERIC(18,4);
  v_taxable   NUMERIC(18,4);
  v_tax       NUMERIC(18,4);
  v_total     NUMERIC(18,4);
  v_rate      NUMERIC := COALESCE(p_tax_rate, 0);
  -- 0095: 'shop' = tax from the shop's tax_rates (per-item caps included);
  --       'flat' = p_tax_rate on the whole sale, as before.
  v_mode      TEXT := COALESCE(p_tax_mode, 'flat');
  v_qty       NUMERIC[];
  v_net       NUMERIC[];
  v_line_tax  NUMERIC[];
  v_breakdown JSONB;
  v_fix       NUMERIC;
BEGIN
  IF p_sale_kind NOT IN ('retail', 'layaway') THEN
    RAISE EXCEPTION 'sale_bad_kind' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'cart_too_large' USING ERRCODE = 'P0001';
  END IF;
  IF v_rate < 0 OR v_rate > 1 THEN
    RAISE EXCEPTION 'bad_tax_rate' USING ERRCODE = 'P0001';
  END IF;
  IF v_mode NOT IN ('flat', 'shop') THEN
    RAISE EXCEPTION 'bad_tax_mode' USING ERRCODE = 'P0001';
  END IF;
  IF p_sale_kind = 'layaway' AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM register_sessions
   WHERE id = p_register_session_id AND tenant_id = p_tenant_id
     AND status = 'open' AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_open_session' USING ERRCODE = 'P0001';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    PERFORM 1 FROM customers
     WHERE id = p_customer_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Lines, validated and priced in cents.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_create_lines (
    pos INTEGER, inventory_item_id UUID, description TEXT,
    quantity NUMERIC, unit_price NUMERIC, line_discount NUMERIC, line_total NUMERIC,
    net NUMERIC, line_tax NUMERIC  -- 0095: after the cart discount; this line's tax
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.sale_create_lines WHERE true;  -- 0084: PostgREST safeupdate refuses a DELETE with no WHERE

  INSERT INTO pg_temp.sale_create_lines
  SELECT (e.ord - 1)::int,
         NULLIF(e.item ->> 'inventory_item_id', '')::uuid,
         btrim(COALESCE(e.item ->> 'description', '')),
         COALESCE((e.item ->> 'quantity')::numeric, 1),
         ROUND(COALESCE((e.item ->> 'unit_price')::numeric, 0), 2),
         ROUND(COALESCE((e.item ->> 'line_discount')::numeric, 0), 2),
         NULL, NULL, NULL
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(item, ord);

  IF EXISTS (SELECT 1 FROM pg_temp.sale_create_lines
              WHERE description = '' OR quantity <= 0 OR unit_price < 0 OR line_discount < 0) THEN
    RAISE EXCEPTION 'bad_line' USING ERRCODE = 'P0001';
  END IF;
  -- A piece is one of a kind: one line, quantity one.
  IF EXISTS (SELECT 1 FROM pg_temp.sale_create_lines
              WHERE inventory_item_id IS NOT NULL AND quantity <> 1) THEN
    RAISE EXCEPTION 'bad_line' USING ERRCODE = 'P0001';
  END IF;

  UPDATE pg_temp.sale_create_lines
     SET line_total = GREATEST(0, ROUND(quantity * unit_price - line_discount, 2))
   WHERE true;  -- 0084: same rule for UPDATE

  -- Lock every linked piece, in id order (no deadlock between two registers).
  SELECT array_agg(DISTINCT inventory_item_id ORDER BY inventory_item_id)
    INTO v_ids
    FROM pg_temp.sale_create_lines WHERE inventory_item_id IS NOT NULL;

  IF v_ids IS NOT NULL THEN
    IF (SELECT COUNT(*) FROM pg_temp.sale_create_lines WHERE inventory_item_id IS NOT NULL)
       <> array_length(v_ids, 1) THEN
      RAISE EXCEPTION 'duplicate_item' USING ERRCODE = 'P0001';
    END IF;
    SELECT COUNT(*) INTO v_locked FROM (
      SELECT 1 FROM inventory_items i
       WHERE i.id = ANY (v_ids) AND i.tenant_id = p_tenant_id AND i.deleted_at IS NULL
       ORDER BY i.id
         FOR UPDATE
    ) l;
    IF v_locked <> array_length(v_ids, 1) OR EXISTS (
      SELECT 1 FROM inventory_items i
       WHERE i.id = ANY (v_ids) AND i.status <> 'available'
    ) THEN
      RAISE EXCEPTION 'inventory_out_of_stock' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal FROM pg_temp.sale_create_lines;
  v_discount := ROUND(GREATEST(0, COALESCE(p_discount, 0)), 2);
  v_taxable  := GREATEST(0, v_subtotal - v_discount);

  IF v_mode = 'shop' THEN
    -- Spread the cart discount over the lines by value, to the cent, so a
    -- per-item cap sees what each item really sold for. Rounding leftovers
    -- go to the largest line; the lines always add up to v_taxable.
    UPDATE pg_temp.sale_create_lines
       SET net = line_total - CASE WHEN v_subtotal > 0
                                   THEN ROUND(LEAST(v_discount, v_subtotal) * line_total / v_subtotal, 2)
                                   ELSE 0 END
     WHERE true;
    v_fix := v_taxable - (SELECT COALESCE(SUM(net), 0) FROM pg_temp.sale_create_lines);
    IF v_fix <> 0 THEN
      UPDATE pg_temp.sale_create_lines
         SET net = GREATEST(0, net + v_fix)
       WHERE pos = (SELECT pos FROM pg_temp.sale_create_lines ORDER BY line_total DESC, pos ASC LIMIT 1);
    END IF;

    SELECT array_agg(quantity ORDER BY pos), array_agg(net ORDER BY pos)
      INTO v_qty, v_net FROM pg_temp.sale_create_lines;
    SELECT q.o_tax, q.o_rate, q.o_line_tax, q.o_breakdown
      INTO v_tax, v_rate, v_line_tax, v_breakdown
      FROM sales_tax_quote(p_tenant_id, v_qty, v_net) q;
    UPDATE pg_temp.sale_create_lines SET line_tax = v_line_tax[pos + 1] WHERE true;
  ELSE
    v_tax := ROUND(v_taxable * v_rate, 2);
  END IF;
  v_total    := v_taxable + v_tax;

  INSERT INTO sales (
    tenant_id, register_session_id, sale_kind, status, customer_id,
    subtotal, tax_amount, tax_rate, discount_amount, total,
    paid_total, returned_total, notes, is_locked, created_by, updated_by,
    tax_breakdown
  ) VALUES (
    p_tenant_id, p_register_session_id, p_sale_kind, 'open', p_customer_id,
    v_subtotal, v_tax, v_rate, v_discount, v_total,
    0, 0, NULLIF(btrim(COALESCE(p_notes, '')), ''), FALSE, p_user_id, p_user_id,
    v_breakdown
  )
  RETURNING id, sale_number INTO v_sale_id, v_number;

  -- The consignment floor trigger checks each line here.
  INSERT INTO sale_items (
    sale_id, tenant_id, inventory_item_id, description, quantity,
    unit_price, line_discount, line_total, position, returned_qty, tax_amount
  )
  SELECT v_sale_id, p_tenant_id, l.inventory_item_id, l.description, l.quantity,
         l.unit_price, l.line_discount, l.line_total, l.pos, 0, l.line_tax
    FROM pg_temp.sale_create_lines l
   ORDER BY l.pos;

  IF v_ids IS NOT NULL THEN
    UPDATE inventory_items
       SET status = CASE WHEN p_sale_kind = 'layaway' THEN 'held'::inventory_status
                         ELSE 'sold'::inventory_status END,
           updated_by = p_user_id
     WHERE id = ANY (v_ids) AND tenant_id = p_tenant_id;
  END IF;

  RETURN QUERY SELECT v_sale_id, v_number, v_total;
END;
$function$;

REVOKE ALL ON FUNCTION sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT) TO service_role;

-- ── layaway_create (+ p_tax_mode, passed through) ─────────────────────────
DROP FUNCTION IF EXISTS layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC);

CREATE OR REPLACE FUNCTION public.layaway_create(p_tenant_id uuid, p_user_id uuid, p_register_session_id uuid, p_customer_id uuid, p_tax_rate numeric, p_discount numeric, p_notes text, p_items jsonb, p_schedule_kind text, p_down_payment numeric, p_down_method payment_method, p_first_payment_due date, p_final_due_date date, p_cancellation_fee numeric, p_tax_mode text DEFAULT 'flat'::text)
 RETURNS TABLE(o_sale_id uuid, o_layaway_id uuid, o_layaway_number text, o_total numeric, o_completed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale_id UUID;
  v_total   NUMERIC(18,4);
  v_lay_id  UUID;
  v_number  TEXT;
  v_down    NUMERIC(18,4) := ROUND(COALESCE(p_down_payment, 0), 2);
  v_done    BOOLEAN := FALSE;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.o_sale_id, c.o_total INTO v_sale_id, v_total
    FROM sale_create(p_tenant_id, p_user_id, p_register_session_id, 'layaway',
                     p_customer_id, p_tax_rate, p_discount, p_notes, p_items, p_tax_mode) c;

  IF v_down > v_total THEN
    RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO layaways (
    tenant_id, sale_id, customer_id, status, total_due, paid_total, balance_remaining,
    schedule_kind, down_payment, first_payment_due, final_due_date,
    cancellation_fee_pct, notes, created_by, updated_by
  ) VALUES (
    p_tenant_id, v_sale_id, p_customer_id, 'active', v_total, 0, v_total,
    COALESCE(p_schedule_kind, 'weekly'), v_down, p_first_payment_due, p_final_due_date,
    COALESCE(p_cancellation_fee, 0), NULLIF(btrim(COALESCE(p_notes, '')), ''), p_user_id, p_user_id
  )
  RETURNING id, layaway_number INTO v_lay_id, v_number;

  IF v_down > 0 THEN
    SELECT p.o_completed INTO v_done
      FROM layaway_add_payment(p_tenant_id, v_lay_id, p_user_id, v_down, p_down_method,
                               'not_used', NULL, NULL, 'down_payment') p;
  END IF;

  RETURN QUERY SELECT v_sale_id, v_lay_id, v_number, v_total, COALESCE(v_done, FALSE);
END;
$function$;

REVOKE ALL ON FUNCTION layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC, TEXT) TO service_role;

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
  -- 0095: the same calculation the counter uses, so a per-item cap on a tax
  -- line applies online too. With no caps this equals subtotal x rate.
  IF v_rate > 0 THEN
    SELECT q.o_tax INTO v_tax
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
$function$;

NOTIFY pgrst, 'reload schema';
