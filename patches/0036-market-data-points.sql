-- ───────────────────────────────────────────────────────────────────────────
-- 0036 — Cross-tenant market data warehouse (admin-only)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0035 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- Creates an anonymized cross-tenant data warehouse for pricing trends.
-- Every pawn loan, retail sale, and buy-outright transaction emits one
-- row at write time via triggers. Admins can query this table to answer
-- questions like "what's the market for an iPhone 7 64GB blue?" — pawn
-- p25/p50/p75, retail p25/p50/p75, last 90 days, by US state.
--
-- THIS IS THE ONE PLACE in the schema that DELIBERATELY VIOLATES tenant
-- isolation. It pools data across all tenants. To make that safe:
--   1. Source attribution (`source_tenant_id`) is stored for audit but
--      MUST NEVER be returned to clients. Admin queries return aggregates
--      only, never source rows.
--   2. RLS allows reads ONLY when profiles.role = 'superadmin'.
--   3. There are NO INSERT/UPDATE/DELETE policies — only the service-role
--      key can write. Triggers run as SECURITY DEFINER + locked
--      search_path so they bypass RLS without granting any new write
--      policy to authenticated users.
--   4. Per-tenant opt-out via tenants.share_market_data — when FALSE,
--      the trigger silently skips the write.
--
-- Item identification uses pgvector cosine similarity on text-embedding-
-- 3-small (1536 dims). Triggers write the row with item_embedding=NULL;
-- a separate cron job (/api/cron/embed-market-data) batches NULL rows
-- and fills them in. Async by design — triggers can't make HTTP calls
-- safely, and a single failed embed must not block a real pawn intake.
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- EXTENSION
-- ───────────────────────────────────────────────────────────────────────────
-- pgvector ships with Supabase. If this fails, the operator must enable
-- the extension via Supabase dashboard → Database → Extensions → vector.
CREATE EXTENSION IF NOT EXISTS vector;

-- ───────────────────────────────────────────────────────────────────────────
-- PER-TENANT OPT-OUT FLAG
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS share_market_data BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.tenants.share_market_data IS
  'When TRUE, this tenant''s pawn loans, sales, and buy-outright '
  'transactions emit anonymized rows into market_data_points for '
  'cross-tenant pricing aggregation. When FALSE, triggers skip the '
  'write — opt-out is immediate.';

-- ───────────────────────────────────────────────────────────────────────────
-- WAREHOUSE TABLE
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.market_data_points (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Source provenance — internal only. NEVER returned by admin queries.
  source_tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_table        TEXT NOT NULL CHECK (source_table IN ('loans','sales','inventory_items')),
  source_row_id       UUID NOT NULL,

  -- Idempotency guard — re-running the trigger or a backfill is safe.
  CONSTRAINT market_data_points_source_unique UNIQUE (source_table, source_row_id),

  -- The actual data point
  transaction_type    TEXT NOT NULL CHECK (transaction_type IN ('pawn','sale','buy')),
  amount              NUMERIC(18,4) NOT NULL CHECK (amount >= 0),
  transaction_date    DATE NOT NULL,

  -- Item identity (free-text + structured for jewelry)
  item_category       inventory_category NOT NULL,
  item_description    TEXT NOT NULL,
  -- 1536-dim vector for OpenAI text-embedding-3-small. NULL until the
  -- embed cron picks the row up.
  item_embedding      vector(1536),

  metal_type          metal_type,
  -- karat is TEXT: inventory_items.karat is TEXT ('10K','14K','925',etc.)
  -- and loan_collateral_items.karat is NUMERIC(4,1). Storing as TEXT
  -- handles both — aggregations filter on it as a dimension, not a
  -- value to average.
  karat               TEXT,
  weight_grams        NUMERIC(10,4),
  est_value           NUMERIC(18,4),

  -- Geographic cut — copied from tenants.state at write time so a tenant
  -- moving doesn't retroactively rewrite history.
  state               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_data_category_date
  ON public.market_data_points(item_category, transaction_type, transaction_date);
CREATE INDEX IF NOT EXISTS idx_market_data_state
  ON public.market_data_points(state) WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_data_unembedded
  ON public.market_data_points(created_at) WHERE item_embedding IS NULL;

-- ivfflat index for vector cosine similarity. Built lazily after
-- ~1k rows are present; for now it'll do sequential scans which is
-- fine. After the table grows, run:
--   REINDEX INDEX idx_market_data_embedding;
CREATE INDEX IF NOT EXISTS idx_market_data_embedding
  ON public.market_data_points
  USING ivfflat (item_embedding vector_cosine_ops)
  WITH (lists = 100);

-- ───────────────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.market_data_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_data_superadmin_read ON public.market_data_points;
CREATE POLICY market_data_superadmin_read
  ON public.market_data_points
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- INTENTIONALLY NO INSERT/UPDATE/DELETE POLICIES.
-- Writes happen only via triggers (SECURITY DEFINER) or via the
-- service-role key (admin client). authenticated users cannot mutate
-- this table directly through PostgREST.

-- ───────────────────────────────────────────────────────────────────────────
-- HELPER — write-one-data-point (called by all three triggers)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.write_market_data_point(
  p_tenant_id        UUID,
  p_source_table     TEXT,
  p_source_row_id    UUID,
  p_transaction_type TEXT,
  p_amount           NUMERIC,
  p_transaction_date DATE,
  p_item_category    inventory_category,
  p_item_description TEXT,
  p_metal_type       metal_type DEFAULT NULL,
  p_karat            TEXT DEFAULT NULL,
  p_weight_grams     NUMERIC DEFAULT NULL,
  p_est_value        NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_share BOOLEAN;
  v_state TEXT;
BEGIN
  -- Per-tenant opt-out check + fetch state for the geographic cut.
  SELECT share_market_data, state INTO v_share, v_state
  FROM public.tenants WHERE id = p_tenant_id;

  IF v_share IS DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  -- Idempotent insert — re-running the trigger or a backfill is safe.
  INSERT INTO public.market_data_points (
    source_tenant_id, source_table, source_row_id,
    transaction_type, amount, transaction_date,
    item_category, item_description,
    metal_type, karat, weight_grams, est_value,
    state
  ) VALUES (
    p_tenant_id, p_source_table, p_source_row_id,
    p_transaction_type, p_amount, p_transaction_date,
    p_item_category, p_item_description,
    p_metal_type, p_karat, p_weight_grams, p_est_value,
    v_state
  )
  ON CONFLICT (source_table, source_row_id) DO NOTHING;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- TRIGGER — pawn loans
-- ───────────────────────────────────────────────────────────────────────────
-- Fires on INSERT into loans. Writes ONE market data point per pawn,
-- with the principal as the amount and the FIRST collateral item's
-- description / category / metal as the item identity. (A pawn ticket
-- can have multiple collateral items but the principal is one number;
-- joining at the ticket level keeps the math clean.)
CREATE OR REPLACE FUNCTION public.market_data_loan_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first_collateral RECORD;
BEGIN
  -- Look up the first collateral item (lowest position, oldest if tied).
  -- Wait until at least one collateral row exists — if the trigger
  -- fires before collateral is inserted (e.g., during a bulk insert),
  -- there's nothing to write yet. The application code currently
  -- inserts the loan and then collateral items in the same transaction,
  -- so by the time the AFTER trigger fires, collateral may or may not
  -- be visible depending on order.
  --
  -- Defensive: if no collateral, bail and let the collateral trigger
  -- (below) handle it.
  SELECT lci.description, lci.category, lci.metal_type, lci.karat,
         lci.weight_grams, lci.est_value
    INTO v_first_collateral
  FROM public.loan_collateral_items lci
  WHERE lci.loan_id = NEW.id
    AND lci.deleted_at IS NULL
  ORDER BY lci.position ASC, lci.created_at ASC
  LIMIT 1;

  IF v_first_collateral IS NULL THEN
    -- Collateral hasn't landed yet. Will be picked up by the
    -- collateral-insert trigger below.
    RETURN NEW;
  END IF;

  PERFORM public.write_market_data_point(
    NEW.tenant_id,
    'loans',
    NEW.id,
    'pawn',
    NEW.principal,
    NEW.issue_date,
    v_first_collateral.category,
    v_first_collateral.description,
    v_first_collateral.metal_type,
    v_first_collateral.karat::TEXT,
    v_first_collateral.weight_grams,
    v_first_collateral.est_value
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_data_loan_after_insert ON public.loans;
CREATE TRIGGER trg_market_data_loan_after_insert
  AFTER INSERT ON public.loans
  FOR EACH ROW
  EXECUTE FUNCTION public.market_data_loan_after_insert();

-- Companion trigger on loan_collateral_items: if collateral is inserted
-- AFTER the loan AFTER-trigger ran (collateral wasn't visible yet), this
-- fires for the FIRST collateral row only and writes the data point.
-- The UNIQUE constraint on (source_table, source_row_id) means duplicate
-- attempts (loan trigger + collateral trigger both racing) are no-ops.
CREATE OR REPLACE FUNCTION public.market_data_collateral_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_loan RECORD;
BEGIN
  -- Only first collateral row per loan triggers the write.
  IF NEW.position > 0 THEN
    RETURN NEW;
  END IF;

  SELECT l.tenant_id, l.principal, l.issue_date
    INTO v_loan
  FROM public.loans l
  WHERE l.id = NEW.loan_id AND l.deleted_at IS NULL;

  IF v_loan IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.write_market_data_point(
    v_loan.tenant_id,
    'loans',
    NEW.loan_id,
    'pawn',
    v_loan.principal,
    v_loan.issue_date,
    NEW.category,
    NEW.description,
    NEW.metal_type,
    NEW.karat::TEXT,
    NEW.weight_grams,
    NEW.est_value
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_data_collateral_after_insert
  ON public.loan_collateral_items;
CREATE TRIGGER trg_market_data_collateral_after_insert
  AFTER INSERT ON public.loan_collateral_items
  FOR EACH ROW
  EXECUTE FUNCTION public.market_data_collateral_after_insert();

-- ───────────────────────────────────────────────────────────────────────────
-- TRIGGER — sales (one row per sale_item when sale completes)
-- ───────────────────────────────────────────────────────────────────────────
-- Fires when a sale moves into 'completed' status. Writes ONE row per
-- sale_item line — each line is its own market data point with its own
-- inventory_item description / category / metal.
CREATE OR REPLACE FUNCTION public.market_data_sale_after_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line RECORD;
BEGIN
  -- Only fire on the transition into 'completed'.
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  FOR v_line IN
    SELECT si.id, si.unit_price, si.quantity, si.inventory_item_id,
           si.description AS line_description,
           ii.description AS inv_description,
           ii.category, ii.metal AS metal_type, ii.karat,
           ii.weight_grams, ii.list_price
    FROM public.sale_items si
    LEFT JOIN public.inventory_items ii ON ii.id = si.inventory_item_id
    WHERE si.sale_id = NEW.id
  LOOP
    PERFORM public.write_market_data_point(
      NEW.tenant_id,
      'sales',
      v_line.id,  -- one row per sale_item, not per sale
      'sale',
      v_line.unit_price,
      COALESCE(NEW.completed_at::date, NEW.created_at::date),
      COALESCE(v_line.category, 'other'::inventory_category),
      COALESCE(v_line.inv_description, v_line.line_description),
      v_line.metal_type,
      v_line.karat,
      v_line.weight_grams,
      v_line.list_price
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_data_sale_after_completed ON public.sales;
CREATE TRIGGER trg_market_data_sale_after_completed
  AFTER INSERT OR UPDATE OF status ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.market_data_sale_after_completed();

-- ───────────────────────────────────────────────────────────────────────────
-- TRIGGER — buy-outright (inventory_items with source='bought')
-- ───────────────────────────────────────────────────────────────────────────
-- Fires on INSERT into inventory_items where source='bought'. The
-- buy-outright price is captured at acquired_cost.
CREATE OR REPLACE FUNCTION public.market_data_buy_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source <> 'bought' THEN RETURN NEW; END IF;
  IF NEW.acquired_cost IS NULL OR NEW.acquired_cost <= 0 THEN
    RETURN NEW;
  END IF;

  PERFORM public.write_market_data_point(
    NEW.tenant_id,
    'inventory_items',
    NEW.id,
    'buy',
    NEW.acquired_cost,
    NEW.acquired_at,
    NEW.category,
    NEW.description,
    NEW.metal,
    NEW.karat,
    NEW.weight_grams,
    NEW.list_price
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_data_buy_after_insert ON public.inventory_items;
CREATE TRIGGER trg_market_data_buy_after_insert
  AFTER INSERT ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.market_data_buy_after_insert();

-- ───────────────────────────────────────────────────────────────────────────
-- COMMENTS
-- ───────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.market_data_points IS
  'Cross-tenant anonymized warehouse of pawn / sale / buy transactions '
  'for market-pricing aggregation. SUPERADMIN-ONLY READ. Service-role '
  'WRITE only (via triggers). source_tenant_id is internal-audit only — '
  'NEVER return to clients. See patches/0036 header for the full rationale.';

COMMENT ON FUNCTION public.write_market_data_point IS
  'Internal helper used by market_data_* triggers. SECURITY DEFINER + '
  'locked search_path so the trigger bypasses RLS without granting any '
  'authenticated user write access to market_data_points.';

-- ───────────────────────────────────────────────────────────────────────────
-- ADMIN SEARCH RPC — vector similarity + filters
-- ───────────────────────────────────────────────────────────────────────────
-- Called by /admin/market-data/actions.ts → lookupMarketData(). Returns
-- rows ordered by cosine similarity DESC, with optional category/state/
-- date filters. NEVER returns source_tenant_id.
--
-- SECURITY DEFINER + caller-side superadmin gate: the action
-- (lookupMarketData) checks profiles.role='superadmin' BEFORE calling
-- this function. RLS on market_data_points provides defense-in-depth
-- (admin client used in the action bypasses RLS, but the gate above
-- is the actual access control).
CREATE OR REPLACE FUNCTION public.market_data_search_by_embedding(
  p_query     vector(1536),
  p_threshold FLOAT DEFAULT 0.3,
  p_category  TEXT DEFAULT NULL,
  p_state     TEXT DEFAULT NULL,
  p_since     DATE DEFAULT NULL,
  p_limit     INTEGER DEFAULT 5000
)
RETURNS TABLE (
  id                 UUID,
  transaction_type   TEXT,
  amount             NUMERIC,
  transaction_date   DATE,
  item_description   TEXT,
  item_category      inventory_category,
  state              TEXT,
  similarity         FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    mdp.id,
    mdp.transaction_type,
    mdp.amount,
    mdp.transaction_date,
    mdp.item_description,
    mdp.item_category,
    mdp.state,
    1 - (mdp.item_embedding <=> p_query) AS similarity
  FROM public.market_data_points mdp
  WHERE mdp.item_embedding IS NOT NULL
    AND (mdp.item_embedding <=> p_query) <= p_threshold
    AND (p_category IS NULL OR mdp.item_category::TEXT = p_category)
    AND (p_state IS NULL OR mdp.state = p_state)
    AND (p_since IS NULL OR mdp.transaction_date >= p_since)
  ORDER BY mdp.item_embedding <=> p_query ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.market_data_search_by_embedding IS
  'Vector cosine-similarity search across market_data_points. Returns '
  'anonymized rows (NEVER source_tenant_id) ordered by similarity DESC, '
  'with optional category/state/date filters. Caller must enforce '
  'superadmin gate before invoking — this function is SECURITY DEFINER '
  'and bypasses RLS for performance.';

-- Refresh PostgREST schema cache so /api routes can see the new table
-- without a Supabase API restart.
NOTIFY pgrst, 'reload schema';
