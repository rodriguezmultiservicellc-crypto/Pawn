-- ───────────────────────────────────────────────────────────────────────────
-- 0091 — Customer merge (duplicate records → one canonical customer)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0090. Append-only.
--
-- Same model as Luna Azul's merge_customers(): one atomic function that
-- moves every reference from the duplicate ("loser") to the record that
-- stays ("winner"), fills the winner's blank fields, soft-deletes the
-- loser with a pointer to the winner, and writes an audit row.
--
-- Pawn-specific differences:
--
--   1. Locked records. Printed loans, locked sales / repair tickets,
--      finalized+printed appraisals, accepted custom quotes, message_log
--      and ofac_screenings all refuse a customer_id change. The merge has
--      to repoint them (the shop must see the person's full pawn history
--      on one record), so each guard gets ONE narrow exception:
--      customer_id may change only from a customer that has already been
--      merged INTO the new customer (customer_merge_repoint()). Every
--      other locked field stays frozen. The merge function marks the
--      loser merged before it repoints anything, so the exception only
--      ever opens inside a merge. compliance_log is untouched — it holds
--      its own write-once snapshot and has no customer FK.
--
--   2. Money ledgers stay append-only (CLAUDE.md rule 19). The loser's
--      store credit moves as a compensating pair — 'merge_out' on the
--      loser, 'merge_in' on the winner — and the existing balance trigger
--      materializes both. Loyalty points move the same way; the loyalty
--      balances are then recomputed from the ledger, because the 0028
--      loyalty triggers are not present on the live DB (flagged
--      separately).
--
--   3. Execution is service-role only. The server action gates on
--      owner / chain_admin / manager and pins both customers to the
--      active tenant; the function re-checks the tenant itself.
--
--   4. customer_merges has RLS ON with NO policies — staff never read
--      or write it directly; the app reads it through the admin client
--      after a guard. No existing RLS policy changes.
--
-- Rollback (only safe before any merge has run):
--   DROP FUNCTION IF EXISTS merge_customers(uuid, uuid, uuid, uuid, text);
--   DROP TABLE IF EXISTS customer_merges;
--   ALTER TABLE customers DROP COLUMN IF EXISTS merged_into_id;
--   then re-apply the seven guard functions from their original patches
--   and restore the two kind CHECKs below without merge_in / merge_out.
-- ============================================================================

-- ── 1. Pointer from a merged-away customer to the survivor ────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS merged_into_id UUID NULL REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_customers_merged_into_id
  ON customers(merged_into_id) WHERE merged_into_id IS NOT NULL;

COMMENT ON COLUMN customers.merged_into_id IS
  'Set when this record was merged into another customer (patches/0091). '
  'The row is soft-deleted at the same time; links to it redirect to the '
  'survivor.';

-- ── 2. Audit table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_merges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  winner_id       UUID NOT NULL REFERENCES customers(id),
  loser_id        UUID NOT NULL REFERENCES customers(id),
  performed_by    UUID NULL REFERENCES auth.users(id),
  performed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  loser_snapshot  JSONB NOT NULL,
  winner_before   JSONB NOT NULL,
  fk_move_counts  JSONB NOT NULL,
  notes           TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_merges_tenant ON customer_merges(tenant_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_merges_winner ON customer_merges(winner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_merges_loser ON customer_merges(loser_id);

ALTER TABLE customer_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_merges FROM anon, authenticated;

-- ── 3. Ledger kinds for the compensating pair ──────────────────────────────

ALTER TABLE store_credit_events DROP CONSTRAINT IF EXISTS store_credit_events_kind_check;
ALTER TABLE store_credit_events ADD CONSTRAINT store_credit_events_kind_check
  CHECK (kind = ANY (ARRAY['issue_return','issue_buy','issue_manual','redeem_pos',
                           'redeem_undo','clawback','adjust_manual',
                           'merge_in','merge_out']));

ALTER TABLE store_credit_events DROP CONSTRAINT IF EXISTS store_credit_events_sign_matches_kind;
ALTER TABLE store_credit_events ADD CONSTRAINT store_credit_events_sign_matches_kind
  CHECK (
    (kind = ANY (ARRAY['issue_return','issue_buy','issue_manual','redeem_undo','merge_in']) AND amount_delta > 0)
    OR (kind = ANY (ARRAY['redeem_pos','clawback','merge_out']) AND amount_delta < 0)
    OR (kind = 'adjust_manual' AND amount_delta <> 0)
  );

ALTER TABLE loyalty_events DROP CONSTRAINT IF EXISTS loyalty_events_kind_check;
ALTER TABLE loyalty_events ADD CONSTRAINT loyalty_events_kind_check
  CHECK (kind = ANY (ARRAY['earn_sale','earn_loan_interest','earn_referral_bonus',
                           'redeem_pos','adjust_manual','merge_in','merge_out']));

-- ── 4. The one exception the lock guards allow ─────────────────────────────

CREATE OR REPLACE FUNCTION customer_merge_repoint(p_old UUID, p_new UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_old IS NOT NULL AND p_new IS NOT NULL AND EXISTS (
    SELECT 1 FROM customers WHERE id = p_old AND merged_into_id = p_new
  );
$$;

COMMENT ON FUNCTION customer_merge_repoint(UUID, UUID) IS
  'TRUE only when p_old was merged into p_new (patches/0091). The lock '
  'guards let customer_id change in exactly that case and no other.';

CREATE OR REPLACE FUNCTION public.loans_enforce_print_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.is_printed = TRUE THEN
    IF NEW.principal              IS DISTINCT FROM OLD.principal THEN
      RAISE EXCEPTION 'loans.principal is immutable after the ticket is printed (loan %).', OLD.id;
    END IF;
    IF NEW.interest_rate_monthly  IS DISTINCT FROM OLD.interest_rate_monthly THEN
      RAISE EXCEPTION 'loans.interest_rate_monthly is immutable after the ticket is printed (loan %).', OLD.id;
    END IF;
    IF NEW.customer_id            IS DISTINCT FROM OLD.customer_id
       AND NOT customer_merge_repoint(OLD.customer_id, NEW.customer_id) THEN
      RAISE EXCEPTION 'loans.customer_id is immutable after the ticket is printed (loan %).', OLD.id;
    END IF;
    -- term_days + due_date are immutable EXCEPT when the new status is
    -- 'extended' (legitimate extension flow rewrites both fields). The
    -- extension server action always sets status='extended' before the
    -- UPDATE, so the trigger sees NEW.status = 'extended' and allows the
    -- due_date / term_days rewrite.
    IF NEW.status IS DISTINCT FROM 'extended' THEN
      IF NEW.term_days IS DISTINCT FROM OLD.term_days THEN
        RAISE EXCEPTION 'loans.term_days is immutable after the ticket is printed except via extension (loan %).', OLD.id;
      END IF;
      IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
        RAISE EXCEPTION 'loans.due_date is immutable after the ticket is printed except via extension (loan %).', OLD.id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.repair_tickets_enforce_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.is_locked = TRUE THEN
    IF NEW.customer_id        IS DISTINCT FROM OLD.customer_id
       AND NOT customer_merge_repoint(OLD.customer_id, NEW.customer_id) THEN
      RAISE EXCEPTION 'repair_tickets.customer_id is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.service_type       IS DISTINCT FROM OLD.service_type THEN
      RAISE EXCEPTION 'repair_tickets.service_type is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.item_description   IS DISTINCT FROM OLD.item_description THEN
      RAISE EXCEPTION 'repair_tickets.item_description is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.quote_amount       IS DISTINCT FROM OLD.quote_amount THEN
      RAISE EXCEPTION 'repair_tickets.quote_amount is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.deposit_amount     IS DISTINCT FROM OLD.deposit_amount THEN
      RAISE EXCEPTION 'repair_tickets.deposit_amount is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.paid_amount        IS DISTINCT FROM OLD.paid_amount THEN
      RAISE EXCEPTION 'repair_tickets.paid_amount is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.picked_up_at       IS DISTINCT FROM OLD.picked_up_at THEN
      RAISE EXCEPTION 'repair_tickets.picked_up_at is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
    IF NEW.pickup_by_name     IS DISTINCT FROM OLD.pickup_by_name THEN
      RAISE EXCEPTION 'repair_tickets.pickup_by_name is immutable after the ticket is locked (ticket %).', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sales_enforce_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.is_locked = TRUE THEN
    IF NEW.subtotal       IS DISTINCT FROM OLD.subtotal THEN
      RAISE EXCEPTION 'sales.subtotal is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
    IF NEW.tax_amount     IS DISTINCT FROM OLD.tax_amount THEN
      RAISE EXCEPTION 'sales.tax_amount is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
    IF NEW.total          IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'sales.total is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
    IF NEW.customer_id    IS DISTINCT FROM OLD.customer_id
       AND NOT customer_merge_repoint(OLD.customer_id, NEW.customer_id) THEN
      RAISE EXCEPTION 'sales.customer_id is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
    IF NEW.completed_at   IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'sales.completed_at is immutable after the sale is locked (sale %).', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.appraisals_enforce_print_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status = 'finalized' AND OLD.is_printed = TRUE THEN
    IF NEW.appraised_value      IS DISTINCT FROM OLD.appraised_value THEN
      RAISE EXCEPTION 'appraisals.appraised_value is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.replacement_value    IS DISTINCT FROM OLD.replacement_value THEN
      RAISE EXCEPTION 'appraisals.replacement_value is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.item_description     IS DISTINCT FROM OLD.item_description THEN
      RAISE EXCEPTION 'appraisals.item_description is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.metal_type           IS DISTINCT FROM OLD.metal_type THEN
      RAISE EXCEPTION 'appraisals.metal_type is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.weight_grams         IS DISTINCT FROM OLD.weight_grams THEN
      RAISE EXCEPTION 'appraisals.weight_grams is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.customer_id          IS DISTINCT FROM OLD.customer_id
       AND NOT customer_merge_repoint(OLD.customer_id, NEW.customer_id) THEN
      RAISE EXCEPTION 'appraisals.customer_id is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.inventory_item_id    IS DISTINCT FROM OLD.inventory_item_id THEN
      RAISE EXCEPTION 'appraisals.inventory_item_id is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
    IF NEW.valid_from           IS DISTINCT FROM OLD.valid_from THEN
      RAISE EXCEPTION 'appraisals.valid_from is immutable after finalize+print (appraisal %).', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_quotes_enforce_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status NOT IN ('draft', 'sent') THEN
    IF (NEW.customer_id         IS DISTINCT FROM OLD.customer_id
        AND NOT customer_merge_repoint(OLD.customer_id, NEW.customer_id))
    OR NEW.category             IS DISTINCT FROM OLD.category
    OR NEW.description          IS DISTINCT FROM OLD.description
    OR NEW.size                 IS DISTINCT FROM OLD.size
    OR NEW.margin_pct           IS DISTINCT FROM OLD.margin_pct
    OR NEW.cost_total           IS DISTINCT FROM OLD.cost_total
    OR NEW.price_total          IS DISTINCT FROM OLD.price_total
    OR NEW.spot_priced_at       IS DISTINCT FROM OLD.spot_priced_at
    OR NEW.spot_price_per_gram  IS DISTINCT FROM OLD.spot_price_per_gram
    OR NEW.spot_metal_label     IS DISTINCT FROM OLD.spot_metal_label
    OR NEW.deposit_pct          IS DISTINCT FROM OLD.deposit_pct
    OR NEW.deposit_amount       IS DISTINCT FROM OLD.deposit_amount
    OR NEW.balance_due          IS DISTINCT FROM OLD.balance_due
    OR NEW.payment_method       IS DISTINCT FROM OLD.payment_method
    OR NEW.expires_on           IS DISTINCT FROM OLD.expires_on THEN
      RAISE EXCEPTION 'custom_quote_locked: quote % is % and can no longer be edited — void it and write a new quote', OLD.quote_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_message_log_modification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'message_log is write-once. Rows cannot be deleted.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id        IS DISTINCT FROM OLD.tenant_id        OR
       (NEW.customer_id     IS DISTINCT FROM OLD.customer_id
        AND NOT customer_merge_repoint(OLD.customer_id, NEW.customer_id)) OR
       NEW.related_loan_id  IS DISTINCT FROM OLD.related_loan_id  OR
       NEW.related_repair_ticket_id IS DISTINCT FROM OLD.related_repair_ticket_id OR
       NEW.related_layaway_id IS DISTINCT FROM OLD.related_layaway_id OR
       NEW.channel          IS DISTINCT FROM OLD.channel          OR
       NEW.kind             IS DISTINCT FROM OLD.kind             OR
       NEW.to_address       IS DISTINCT FROM OLD.to_address       OR
       NEW.body_rendered    IS DISTINCT FROM OLD.body_rendered    OR
       NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'message_log snapshot fields are immutable. Only status, provider_id, sent_at, delivered_at, and error_text may be updated.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ofac_screenings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Foreign-key cascades (tenant / customer removal, list-version pruning
  -- nulling list_version_id) run at trigger depth > 1 — let them through.
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ofac_screenings is append-only' USING ERRCODE = 'check_violation';
  END IF;
  -- A customer merge may repoint customer_id to the survivor (0091);
  -- every other snapshot field stays frozen.
  IF (NEW.tenant_id,
      CASE WHEN customer_merge_repoint(OLD.customer_id, NEW.customer_id)
           THEN OLD.customer_id ELSE NEW.customer_id END,
      NEW.list_version_id, NEW.screened_name,
      NEW.screened_dob, NEW.context, NEW.result, NEW.matches, NEW.top_score,
      NEW.carried_from, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.customer_id, OLD.list_version_id, OLD.screened_name,
      OLD.screened_dob, OLD.context, OLD.result, OLD.matches, OLD.top_score,
      OLD.carried_from, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'ofac_screenings: only review fields can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.review_status IS DISTINCT FROM OLD.review_status
     AND NOT (OLD.review_status = 'pending' AND NEW.review_status IN ('cleared','confirmed')) THEN
    RAISE EXCEPTION 'ofac_screenings: invalid review transition % -> %',
      OLD.review_status, NEW.review_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- ── 5. The merge ───────────────────────────────────────────────────────────
-- Error tokens (raised verbatim, translated by the UI):
--   merge_same_customer, merge_customer_not_found, merge_already_merged,
--   merge_both_consignors

CREATE OR REPLACE FUNCTION merge_customers(
  p_tenant_id  UUID,
  p_winner_id  UUID,
  p_loser_id   UUID,
  p_actor      UUID,
  p_notes      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  w          customers%ROWTYPE;
  w2         customers%ROWTYPE;
  l          customers%ROWTYPE;
  v_extra    TEXT[] := '{}';
  v_merge_id UUID := gen_random_uuid();
  v_counts   JSONB := '{}'::jsonb;
  v_n        INT;
  v_loser_name TEXT;
  v_tags     TEXT[];
BEGIN
  IF p_winner_id IS NULL OR p_loser_id IS NULL OR p_winner_id = p_loser_id THEN
    RAISE EXCEPTION 'merge_same_customer';
  END IF;

  -- Lock both rows in a stable order so two overlapping merges can't deadlock.
  PERFORM 1 FROM customers WHERE id IN (p_winner_id, p_loser_id) ORDER BY id FOR UPDATE;
  SELECT * INTO w FROM customers WHERE id = p_winner_id;
  SELECT * INTO l FROM customers WHERE id = p_loser_id;

  IF w.id IS NULL OR l.id IS NULL
     OR w.tenant_id <> p_tenant_id OR l.tenant_id <> p_tenant_id
     OR w.deleted_at IS NOT NULL OR l.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'merge_customer_not_found';
  END IF;
  IF w.merged_into_id IS NOT NULL OR l.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'merge_already_merged';
  END IF;
  IF EXISTS (SELECT 1 FROM consignors WHERE customer_id = p_winner_id AND deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM consignors WHERE customer_id = p_loser_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'merge_both_consignors';
  END IF;

  v_loser_name := trim(both ' ' FROM l.first_name || ' ' || l.last_name);

  -- 1. Retire the loser FIRST. Setting merged_into_id is what opens the
  --    customer_merge_repoint() exception in the lock guards; soft-delete
  --    frees its unique keys (auth_user_id, legacy_ref) for the winner.
  --    referral_code's unique index ignores deleted_at, so it is cleared
  --    here and kept in the snapshot.
  UPDATE customers SET
    merged_into_id = p_winner_id,
    deleted_at     = NOW(),
    auth_user_id   = NULL,
    referral_code  = NULL,
    updated_by     = p_actor
  WHERE id = p_loser_id;

  -- 2. Fill the winner's blanks from the loser. The ID block moves as a
  --    unit so fields from two different documents never mix.
  SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(w.tags, '{}') || COALESCE(l.tags, '{}'))) INTO v_tags;

  UPDATE customers SET
    middle_name         = COALESCE(NULLIF(w.middle_name, ''), l.middle_name),
    date_of_birth       = COALESCE(w.date_of_birth, l.date_of_birth),
    photo_url           = COALESCE(NULLIF(w.photo_url, ''), l.photo_url),
    phone               = COALESCE(NULLIF(w.phone, ''), l.phone),
    -- The duplicate's number is often the customer's other phone: keep it.
    phone_alt           = COALESCE(
                            NULLIF(w.phone_alt, ''),
                            CASE WHEN NULLIF(w.phone, '') IS NOT NULL
                                  AND NULLIF(l.phone, '') IS NOT NULL
                                  AND regexp_replace(l.phone, '\D', '', 'g')
                                      <> regexp_replace(w.phone, '\D', '', 'g')
                                 THEN l.phone END,
                            NULLIF(l.phone_alt, '')),
    email               = COALESCE(NULLIF(w.email, ''), l.email),
    address1            = CASE WHEN NULLIF(w.address1, '') IS NULL THEN l.address1 ELSE w.address1 END,
    address2            = CASE WHEN NULLIF(w.address1, '') IS NULL THEN l.address2 ELSE w.address2 END,
    city                = CASE WHEN NULLIF(w.address1, '') IS NULL THEN COALESCE(NULLIF(w.city, ''), l.city) ELSE w.city END,
    state               = CASE WHEN NULLIF(w.address1, '') IS NULL THEN COALESCE(NULLIF(w.state, ''), l.state) ELSE w.state END,
    zip                 = CASE WHEN NULLIF(w.address1, '') IS NULL THEN COALESCE(NULLIF(w.zip, ''), l.zip) ELSE w.zip END,
    country             = COALESCE(NULLIF(w.country, ''), l.country),
    id_type             = CASE WHEN NULLIF(w.id_number, '') IS NULL THEN l.id_type     ELSE w.id_type END,
    id_number           = CASE WHEN NULLIF(w.id_number, '') IS NULL THEN l.id_number   ELSE w.id_number END,
    id_state            = CASE WHEN NULLIF(w.id_number, '') IS NULL THEN l.id_state    ELSE w.id_state END,
    id_country          = CASE WHEN NULLIF(w.id_number, '') IS NULL THEN l.id_country  ELSE w.id_country END,
    id_expiry           = CASE WHEN NULLIF(w.id_number, '') IS NULL THEN l.id_expiry   ELSE w.id_expiry END,
    dl_raw_payload      = CASE WHEN NULLIF(w.id_number, '') IS NULL THEN l.dl_raw_payload ELSE w.dl_raw_payload END,
    height_inches       = COALESCE(w.height_inches, l.height_inches),
    weight_lbs          = COALESCE(w.weight_lbs, l.weight_lbs),
    sex                 = COALESCE(NULLIF(w.sex, ''), l.sex),
    hair_color          = COALESCE(NULLIF(w.hair_color, ''), l.hair_color),
    eye_color           = COALESCE(NULLIF(w.eye_color, ''), l.eye_color),
    race                = COALESCE(NULLIF(w.race, ''), l.race),
    identifying_marks   = COALESCE(NULLIF(w.identifying_marks, ''), l.identifying_marks),
    place_of_employment = COALESCE(NULLIF(w.place_of_employment, ''), l.place_of_employment),
    -- A ban on either record carries over — a duplicate is not a way around it.
    is_banned           = w.is_banned OR l.is_banned,
    banned_reason       = CASE WHEN w.is_banned THEN w.banned_reason ELSE l.banned_reason END,
    banned_at           = CASE WHEN w.is_banned THEN w.banned_at     ELSE l.banned_at END,
    banned_by           = CASE WHEN w.is_banned THEN w.banned_by     ELSE l.banned_by END,
    tags                = CASE WHEN cardinality(v_tags) = 0 THEN w.tags ELSE v_tags END,
    auth_user_id       = COALESCE(w.auth_user_id, l.auth_user_id),
    referral_code       = COALESCE(w.referral_code, l.referral_code),
    referred_by_customer_id = CASE
                                WHEN w.referred_by_customer_id IS NOT NULL THEN w.referred_by_customer_id
                                WHEN l.referred_by_customer_id = p_winner_id THEN NULL
                                ELSE l.referred_by_customer_id END,
    referral_credited   = w.referral_credited OR l.referral_credited,
    legacy_ref          = CASE WHEN w.legacy_ref IS NULL THEN l.legacy_ref    ELSE w.legacy_ref END,
    import_source       = CASE WHEN w.legacy_ref IS NULL THEN l.import_source ELSE w.import_source END,
    updated_by          = p_actor
  WHERE id = p_winner_id;

  -- A winner that was "referred by" its own duplicate refers to nobody.
  UPDATE customers SET referred_by_customer_id = NULL
   WHERE id = p_winner_id AND referred_by_customer_id = p_loser_id;

  -- Contact details from the duplicate that found no empty field on the
  -- winner are written into the winner's notes, with the duplicate's own
  -- notes, so nothing the shop typed in is lost.
  SELECT * INTO w2 FROM customers WHERE id = p_winner_id;
  IF NULLIF(l.phone, '') IS NOT NULL
     AND regexp_replace(l.phone, '\D', '', 'g') NOT IN (
           regexp_replace(COALESCE(w2.phone, ''), '\D', '', 'g'),
           regexp_replace(COALESCE(w2.phone_alt, ''), '\D', '', 'g')) THEN
    v_extra := v_extra || ('phone ' || l.phone);
  END IF;
  IF NULLIF(l.phone_alt, '') IS NOT NULL
     AND regexp_replace(l.phone_alt, '\D', '', 'g') NOT IN (
           regexp_replace(COALESCE(w2.phone, ''), '\D', '', 'g'),
           regexp_replace(COALESCE(w2.phone_alt, ''), '\D', '', 'g'),
           regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g')) THEN
    v_extra := v_extra || ('phone ' || l.phone_alt);
  END IF;
  IF NULLIF(l.email, '') IS NOT NULL AND lower(l.email) IS DISTINCT FROM lower(w2.email) THEN
    v_extra := v_extra || ('email ' || l.email);
  END IF;
  IF NULLIF(l.address1, '') IS NOT NULL AND lower(l.address1) IS DISTINCT FROM lower(w2.address1) THEN
    v_extra := v_extra || ('address ' || concat_ws(', ', l.address1, NULLIF(l.address2, ''),
                                                    NULLIF(l.city, ''), NULLIF(l.state, ''), NULLIF(l.zip, '')));
  END IF;
  IF cardinality(v_extra) > 0 OR NULLIF(trim(l.notes), '') IS NOT NULL THEN
    UPDATE customers SET notes = concat_ws(E'\n\n',
             NULLIF(trim(w2.notes), ''),
             'Merged from ' || v_loser_name || ' on ' || to_char(tenant_today(p_tenant_id), 'YYYY-MM-DD') || ':'
               || CASE WHEN cardinality(v_extra) > 0 THEN E'\n' || array_to_string(v_extra, E'\n') ELSE '' END
               || CASE WHEN NULLIF(trim(l.notes), '') IS NOT NULL THEN E'\n' || trim(l.notes) ELSE '' END)
     WHERE id = p_winner_id;
  END IF;

  -- 3. Repoint every reference.
  UPDATE loans                   SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('loans', v_n);
  UPDATE repair_tickets          SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('repair_tickets', v_n);
  UPDATE sales                   SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('sales', v_n);
  UPDATE layaways                SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('layaways', v_n);
  UPDATE appraisals              SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('appraisals', v_n);
  UPDATE custom_quotes           SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('custom_quotes', v_n);
  UPDATE online_orders           SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('online_orders', v_n);
  UPDATE stripe_payment_links    SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('stripe_payment_links', v_n);
  UPDATE customer_documents      SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('customer_documents', v_n);
  UPDATE customer_portal_invites SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('customer_portal_invites', v_n);
  UPDATE loan_drafts             SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('loan_drafts', v_n);
  UPDATE message_log             SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('message_log', v_n);
  UPDATE comm_automation_sends   SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('comm_automation_sends', v_n);
  UPDATE ofac_screenings         SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ofac_screenings', v_n);
  UPDATE consignors              SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('consignors', v_n);
  -- Campaign recipient lists: one row per (campaign, customer). Where both
  -- were on the same campaign the winner's row already covers it.
  DELETE FROM email_campaign_recipients r
   WHERE r.customer_id = p_loser_id
     AND EXISTS (SELECT 1 FROM email_campaign_recipients x
                  WHERE x.campaign_id = r.campaign_id AND x.customer_id = p_winner_id);
  UPDATE email_campaign_recipients SET customer_id = p_winner_id WHERE customer_id = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_campaign_recipients', v_n);
  UPDATE customers SET referred_by_customer_id = p_winner_id
   WHERE referred_by_customer_id = p_loser_id AND id <> p_winner_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('referrals', v_n);

  -- 4. Money ledgers: compensating pairs, never edits.
  IF l.store_credit_balance > 0 THEN
    INSERT INTO store_credit_events (tenant_id, customer_id, kind, amount_delta, source_kind, source_id, reason, performed_by)
    VALUES (p_tenant_id, p_loser_id,  'merge_out', -l.store_credit_balance, 'customer_merge', v_merge_id,
            'Merged into customer ' || p_winner_id, p_actor),
           (p_tenant_id, p_winner_id, 'merge_in',   l.store_credit_balance, 'customer_merge', v_merge_id,
            'Merged from ' || v_loser_name, p_actor);
  END IF;
  v_counts := v_counts || jsonb_build_object('store_credit_moved', l.store_credit_balance);

  IF l.loyalty_points_balance > 0 THEN
    INSERT INTO loyalty_events (tenant_id, customer_id, kind, points_delta, source_kind, source_id, reason, performed_by)
    VALUES (p_tenant_id, p_loser_id,  'merge_out', -l.loyalty_points_balance, 'customer_merge', v_merge_id,
            'Merged into customer ' || p_winner_id, p_actor),
           (p_tenant_id, p_winner_id, 'merge_in',   l.loyalty_points_balance, 'customer_merge', v_merge_id,
            'Merged from ' || v_loser_name, p_actor);
    -- Derive both balances from the ledger: correct whether or not the
    -- 0028 balance trigger is installed.
    UPDATE customers c SET loyalty_points_balance = GREATEST(0, COALESCE(
             (SELECT SUM(points_delta) FROM loyalty_events e WHERE e.customer_id = c.id), 0))
     WHERE c.id IN (p_winner_id, p_loser_id);
  END IF;
  v_counts := v_counts || jsonb_build_object('loyalty_points_moved', l.loyalty_points_balance);

  -- 5. Audit.
  INSERT INTO customer_merges (id, tenant_id, winner_id, loser_id, performed_by,
                               loser_snapshot, winner_before, fk_move_counts, notes)
  VALUES (v_merge_id, p_tenant_id, p_winner_id, p_loser_id, p_actor,
          to_jsonb(l), to_jsonb(w), v_counts, NULLIF(trim(p_notes), ''));

  INSERT INTO audit_log (tenant_id, user_id, action, table_name, record_id, changes)
  VALUES (p_tenant_id, p_actor, 'customer_merge', 'customers', p_winner_id,
          jsonb_build_object('merge_id', v_merge_id, 'loser_id', p_loser_id,
                             'loser_name', v_loser_name, 'moved', v_counts));

  RETURN jsonb_build_object('ok', true, 'merge_id', v_merge_id, 'counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION merge_customers(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_customers(UUID, UUID, UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0091-customer-merge.sql
-- ============================================================================
