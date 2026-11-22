-- ───────────────────────────────────────────────────────────────────────────
-- 0097 — A tax-exempt sale, recorded
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0096.
--
-- Until now a clerk made a sale exempt by typing 0 in the Tax field. The
-- sale then looked like any other with a 0% rate: nothing said it was
-- exempt, why, or under which certificate. A shop has to be able to show
-- that for every sale it did not collect tax on.
--
-- sales gets three columns, set once when the sale is written:
--   tax_exempt              TRUE = no sales tax was charged, on purpose
--   tax_exempt_reason       resale | organization | government | export | other
--   tax_exempt_certificate  the buyer's certificate / permit number (optional;
--                           which sales need one differs by state, so the
--                           database does not decide)
-- A CHECK keeps them coherent (exempt <=> a reason, and tax_amount = 0) and a
-- trigger makes them write-once: a wrong exemption is fixed by voiding the
-- sale and ringing it again, like every other core field.
--
-- sale_create gets p_tax_mode = 'exempt' plus the reason and certificate;
-- layaway_create passes them through. 'flat' and 'shop' are unchanged, and a
-- reason sent with either of them is refused.
--
-- Function bodies are the LIVE definitions (pg_get_functiondef, 2026-11-22,
-- equal to patches/0095) with only the changes marked "0097". Both
-- signatures grow by two optional arguments, so the old ones are dropped and
-- the grants (service_role only) are restated.
-- RLS: no policy added or changed.
--
-- Rollback
--   Re-apply the sale_create + layaway_create section of patches/0095 after
--   dropping the new signatures; then
--   DROP TRIGGER IF EXISTS trg_sales_tax_exempt_write_once ON sales;
--   DROP FUNCTION IF EXISTS sales_tax_exempt_write_once();
--   ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_tax_exempt_shape,
--     DROP COLUMN IF EXISTS tax_exempt_certificate,
--     DROP COLUMN IF EXISTS tax_exempt_reason,
--     DROP COLUMN IF EXISTS tax_exempt;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_exempt_reason TEXT,
  ADD COLUMN IF NOT EXISTS tax_exempt_certificate TEXT;

COMMENT ON COLUMN sales.tax_exempt IS
  'TRUE = the sale was rung up tax exempt (sale_create p_tax_mode = ''exempt''). tax_amount is 0.';
COMMENT ON COLUMN sales.tax_exempt_reason IS
  'Why no tax was charged: resale | organization | government | export | other. NULL unless tax_exempt.';
COMMENT ON COLUMN sales.tax_exempt_certificate IS
  'The buyer''s exemption / resale certificate number, as typed at the counter. Optional.';

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_tax_exempt_shape;
ALTER TABLE sales ADD CONSTRAINT sales_tax_exempt_shape CHECK (
  (tax_exempt
     AND tax_amount = 0
     AND tax_exempt_reason IS NOT NULL
     AND tax_exempt_reason IN ('resale', 'organization', 'government', 'export', 'other')
     AND (tax_exempt_certificate IS NULL OR char_length(tax_exempt_certificate) BETWEEN 1 AND 60))
  OR
  (NOT tax_exempt AND tax_exempt_reason IS NULL AND tax_exempt_certificate IS NULL)
);

-- ── The exemption is written once ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sales_tax_exempt_write_once()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tax_exempt IS DISTINCT FROM OLD.tax_exempt
     OR NEW.tax_exempt_reason IS DISTINCT FROM OLD.tax_exempt_reason
     OR NEW.tax_exempt_certificate IS DISTINCT FROM OLD.tax_exempt_certificate THEN
    RAISE EXCEPTION 'sales tax exemption is set when the sale is created and cannot be changed (sale %).', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sales_tax_exempt_write_once ON sales;
CREATE TRIGGER trg_sales_tax_exempt_write_once
  BEFORE UPDATE OF tax_exempt, tax_exempt_reason, tax_exempt_certificate ON sales
  FOR EACH ROW EXECUTE FUNCTION sales_tax_exempt_write_once();

-- ── sale_create (+ 'exempt', p_tax_exempt_reason, p_tax_exempt_certificate) ─
DROP FUNCTION IF EXISTS sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.sale_create(p_tenant_id uuid, p_user_id uuid, p_register_session_id uuid, p_sale_kind sale_kind, p_customer_id uuid, p_tax_rate numeric, p_discount numeric, p_notes text, p_items jsonb, p_tax_mode text DEFAULT 'flat'::text, p_tax_exempt_reason text DEFAULT NULL::text, p_tax_exempt_certificate text DEFAULT NULL::text)
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
  -- 0097: 'exempt' = no tax, and the sale keeps why (reason + certificate).
  v_mode      TEXT := COALESCE(p_tax_mode, 'flat');
  v_ex_reason TEXT := NULLIF(btrim(COALESCE(p_tax_exempt_reason, '')), '');
  v_ex_cert   TEXT := NULLIF(btrim(COALESCE(p_tax_exempt_certificate, '')), '');
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
  IF v_mode NOT IN ('flat', 'shop', 'exempt') THEN
    RAISE EXCEPTION 'bad_tax_mode' USING ERRCODE = 'P0001';
  END IF;
  -- 0097: an exempt sale says why; any other sale carries no exemption.
  IF v_mode = 'exempt' THEN
    IF v_ex_reason IS NULL
       OR v_ex_reason NOT IN ('resale', 'organization', 'government', 'export', 'other')
       OR char_length(COALESCE(v_ex_cert, '')) > 60 THEN
      RAISE EXCEPTION 'bad_tax_exempt' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_ex_reason IS NOT NULL OR v_ex_cert IS NOT NULL THEN
    RAISE EXCEPTION 'bad_tax_exempt' USING ERRCODE = 'P0001';
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
  ELSIF v_mode = 'exempt' THEN
    v_rate := 0;  -- 0097
    v_tax  := 0;
  ELSE
    v_tax := ROUND(v_taxable * v_rate, 2);
  END IF;
  v_total    := v_taxable + v_tax;

  INSERT INTO sales (
    tenant_id, register_session_id, sale_kind, status, customer_id,
    subtotal, tax_amount, tax_rate, discount_amount, total,
    paid_total, returned_total, notes, is_locked, created_by, updated_by,
    tax_breakdown, tax_exempt, tax_exempt_reason, tax_exempt_certificate
  ) VALUES (
    p_tenant_id, p_register_session_id, p_sale_kind, 'open', p_customer_id,
    v_subtotal, v_tax, v_rate, v_discount, v_total,
    0, 0, NULLIF(btrim(COALESCE(p_notes, '')), ''), FALSE, p_user_id, p_user_id,
    v_breakdown, v_mode = 'exempt', v_ex_reason, v_ex_cert
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

REVOKE ALL ON FUNCTION sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, TEXT, TEXT) TO service_role;

-- ── layaway_create (passes the exemption through) ─────────────────────────
DROP FUNCTION IF EXISTS layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.layaway_create(p_tenant_id uuid, p_user_id uuid, p_register_session_id uuid, p_customer_id uuid, p_tax_rate numeric, p_discount numeric, p_notes text, p_items jsonb, p_schedule_kind text, p_down_payment numeric, p_down_method payment_method, p_first_payment_due date, p_final_due_date date, p_cancellation_fee numeric, p_tax_mode text DEFAULT 'flat'::text, p_tax_exempt_reason text DEFAULT NULL::text, p_tax_exempt_certificate text DEFAULT NULL::text)
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
                     p_customer_id, p_tax_rate, p_discount, p_notes, p_items, p_tax_mode,
                     p_tax_exempt_reason, p_tax_exempt_certificate) c;  -- 0097

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

REVOKE ALL ON FUNCTION layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
