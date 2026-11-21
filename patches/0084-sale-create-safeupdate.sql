-- ───────────────────────────────────────────────────────────────────────────
-- 0084 — sale_create: every counter sale and layaway failed  [CRITICAL]
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0083.
--
-- Since 0076 (2026-11-13) Charge and Save as layaway answered "Something went
-- wrong". Production log: "[pos.money] sale_create DELETE requires a WHERE
-- clause". Supabase loads pg_safeupdate for API (PostgREST) requests, which
-- refuses DELETE / UPDATE with no WHERE — even on a temp table. sale_create
-- cleared and priced its temp line table that way. The 0076 dry run passed
-- because the Management API SQL session does not load safeupdate.
--
-- Fix: the LIVE function body (pg_get_functiondef, 2026-11-21) with exactly
-- two statements given WHERE true. Nothing else changes. CREATE OR REPLACE
-- keeps the existing grants (service_role only).
-- RLS: no policy added or changed.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sale_create(p_tenant_id uuid, p_user_id uuid, p_register_session_id uuid, p_sale_kind sale_kind, p_customer_id uuid, p_tax_rate numeric, p_discount numeric, p_notes text, p_items jsonb)
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
    quantity NUMERIC, unit_price NUMERIC, line_discount NUMERIC, line_total NUMERIC
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.sale_create_lines WHERE true;  -- 0084: PostgREST safeupdate refuses a DELETE with no WHERE

  INSERT INTO pg_temp.sale_create_lines
  SELECT (e.ord - 1)::int,
         NULLIF(e.item ->> 'inventory_item_id', '')::uuid,
         btrim(COALESCE(e.item ->> 'description', '')),
         COALESCE((e.item ->> 'quantity')::numeric, 1),
         ROUND(COALESCE((e.item ->> 'unit_price')::numeric, 0), 2),
         ROUND(COALESCE((e.item ->> 'line_discount')::numeric, 0), 2),
         NULL
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
  v_tax      := ROUND(v_taxable * v_rate, 2);
  v_total    := v_taxable + v_tax;

  INSERT INTO sales (
    tenant_id, register_session_id, sale_kind, status, customer_id,
    subtotal, tax_amount, tax_rate, discount_amount, total,
    paid_total, returned_total, notes, is_locked, created_by, updated_by
  ) VALUES (
    p_tenant_id, p_register_session_id, p_sale_kind, 'open', p_customer_id,
    v_subtotal, v_tax, v_rate, v_discount, v_total,
    0, 0, NULLIF(btrim(COALESCE(p_notes, '')), ''), FALSE, p_user_id, p_user_id
  )
  RETURNING id, sale_number INTO v_sale_id, v_number;

  -- The consignment floor trigger checks each line here.
  INSERT INTO sale_items (
    sale_id, tenant_id, inventory_item_id, description, quantity,
    unit_price, line_discount, line_total, position, returned_qty
  )
  SELECT v_sale_id, p_tenant_id, l.inventory_item_id, l.description, l.quantity,
         l.unit_price, l.line_discount, l.line_total, l.pos, 0
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
