-- ───────────────────────────────────────────────────────────────────────────
-- 0075 — Count sessions (PLAN-2026-11-13 Phase 2a)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0074.
--           Append-only — never edit prior migrations.
--
-- A count compares what SHOULD be on hand (a snapshot taken when the count
-- starts) with what was SCANNED. Three kinds:
--
--   case      available inventory in one location (optional shelf and
--             category). Run at open and close.
--   vault     the collateral of every active / extended / partial_paid loan
--             (has_pawn only). A missing pledged item is the most serious
--             exception in the system: closing needs a note for each one.
--   transfer  the items on one inventory transfer, scanned by either shop.
--
-- Reads arrive in batches from any source (keyboard scanner today, RFID
-- later) through count_add_reads(); the server does not care where they
-- come from. The exception list is computed by ONE function,
-- count_findings(), used both for the live preview and at close, so the
-- screen and the stored result can never disagree.
--
-- Tables
--   count_sessions    one count: kind, scope, status, who/when, totals
--   count_expected    snapshot of what should be there (written at start)
--   count_reads       each distinct code seen, read count, first/last seen
--   count_exceptions  one row per problem, written at close; resolution
--                     (found / written_off / explained) set later
--
-- Functions (SECURITY DEFINER, EXECUTE granted to service_role ONLY — the
-- app guards with requireRoleInTenant() first, then calls them through the
-- admin client; same pattern as consignment_pay_out in 0054):
--   count_start(tenant, user, kind, location, shelf, category, transfer, note)
--   count_add_reads(tenant, session, user, codes[], source)
--   count_findings(session)
--   count_close(tenant, session, user, notes jsonb)
--   count_cancel(tenant, session, user)
--   count_resolve_exception(tenant, exception, user, resolution, note)
--
-- RLS (NEW policies on the NEW tables only — no existing policy changes):
--   count_sessions_staff_read     SELECT for staff of the tenant
--   count_expected_staff_read     SELECT for staff of the tenant
--   count_reads_staff_read        SELECT for staff of the tenant
--   count_exceptions_staff_read   SELECT for staff of the tenant
--   No INSERT / UPDATE / DELETE policy: every write goes through the
--   functions above, so a count's record cannot be hand-edited.
--
-- Rollback
--   DROP FUNCTION IF EXISTS count_resolve_exception(UUID, UUID, UUID, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS count_cancel(UUID, UUID, UUID);
--   DROP FUNCTION IF EXISTS count_close(UUID, UUID, UUID, JSONB);
--   DROP FUNCTION IF EXISTS count_findings(UUID);
--   DROP FUNCTION IF EXISTS count_add_reads(UUID, UUID, UUID, TEXT[], TEXT);
--   DROP FUNCTION IF EXISTS count_start(UUID, UUID, TEXT, inventory_location, TEXT, inventory_category, UUID, TEXT);
--   DROP TABLE IF EXISTS count_exceptions, count_reads, count_expected, count_sessions;
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. count_sessions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS count_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  count_number     TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('case', 'vault', 'transfer')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  scope_location   inventory_location,
  scope_shelf      TEXT CHECK (scope_shelf IS NULL OR length(btrim(scope_shelf)) BETWEEN 1 AND 60),
  scope_category   inventory_category,
  transfer_id      UUID REFERENCES inventory_transfers(id),
  note             TEXT CHECK (note IS NULL OR length(note) <= 500),
  -- Totals, written at close.
  expected_count   INTEGER,
  seen_count       INTEGER,
  missing_count    INTEGER,
  unexpected_count INTEGER,
  left_count       INTEGER,
  missing_value    NUMERIC(18,4),
  started_by       UUID REFERENCES auth.users(id),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by        UUID REFERENCES auth.users(id),
  closed_at        TIMESTAMPTZ,
  cancelled_by     UUID REFERENCES auth.users(id),
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  UNIQUE (tenant_id, count_number),
  CHECK (kind <> 'case' OR scope_location IS NOT NULL),
  CHECK (kind <> 'transfer' OR transfer_id IS NOT NULL),
  CHECK (kind = 'case' OR (scope_location IS NULL AND scope_shelf IS NULL AND scope_category IS NULL)),
  CHECK (kind = 'transfer' OR transfer_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_count_sessions_tenant
  ON count_sessions (tenant_id, started_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_count_sessions_transfer
  ON count_sessions (transfer_id) WHERE transfer_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_count_sessions_updated_at ON count_sessions;
CREATE TRIGGER trg_count_sessions_updated_at BEFORE UPDATE ON count_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. count_expected ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS count_expected (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id         UUID NOT NULL REFERENCES count_sessions(id) ON DELETE RESTRICT,
  inventory_item_id  UUID REFERENCES inventory_items(id),
  collateral_item_id UUID REFERENCES loan_collateral_items(id),
  loan_id            UUID REFERENCES loans(id),
  -- What the tag says: the SKU, or PT-######-n for collateral.
  code               TEXT NOT NULL,
  sku_number         BIGINT,
  description        TEXT,
  -- Inventory: cost_basis. Collateral: est_value. Shrinkage is valued at this.
  value              NUMERIC(18,4) NOT NULL DEFAULT 0,
  state_at_start     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((inventory_item_id IS NULL) <> (collateral_item_id IS NULL)),
  UNIQUE (session_id, inventory_item_id),
  UNIQUE (session_id, collateral_item_id)
);

CREATE INDEX IF NOT EXISTS idx_count_expected_code
  ON count_expected (session_id, upper(code));
CREATE INDEX IF NOT EXISTS idx_count_expected_sku_number
  ON count_expected (session_id, sku_number) WHERE sku_number IS NOT NULL;

-- ── 3. count_reads ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS count_reads (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id         UUID NOT NULL REFERENCES count_sessions(id) ON DELETE RESTRICT,
  code               TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  expected_id        UUID REFERENCES count_expected(id),
  inventory_item_id  UUID REFERENCES inventory_items(id),
  collateral_item_id UUID REFERENCES loan_collateral_items(id),
  source             TEXT NOT NULL DEFAULT 'scanner' CHECK (source IN ('scanner', 'rfid', 'manual')),
  read_count         INTEGER NOT NULL DEFAULT 1 CHECK (read_count >= 1),
  first_read_by      UUID REFERENCES auth.users(id),
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, code)
);

CREATE INDEX IF NOT EXISTS idx_count_reads_expected
  ON count_reads (session_id, expected_id);

-- ── 4. count_exceptions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS count_exceptions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id         UUID NOT NULL REFERENCES count_sessions(id) ON DELETE RESTRICT,
  kind               TEXT NOT NULL CHECK (kind IN (
                       'missing',            -- expected, not seen, still in scope
                       'missing_pledge',     -- vault: pledged item not seen
                       'unexpected',         -- seen, not expected (see reason)
                       'held_in_sales',      -- buy-hold item sitting in a case / display
                       'left_during_count'   -- sold, redeemed or moved while counting
                     )),
  reason             TEXT,
  code               TEXT,
  inventory_item_id  UUID REFERENCES inventory_items(id),
  collateral_item_id UUID REFERENCES loan_collateral_items(id),
  loan_id            UUID REFERENCES loans(id),
  description        TEXT,
  value              NUMERIC(18,4) NOT NULL DEFAULT 0,
  close_note         TEXT,
  resolution         TEXT CHECK (resolution IS NULL OR resolution IN ('found', 'written_off', 'explained')),
  resolution_note    TEXT,
  resolved_by        UUID REFERENCES auth.users(id),
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((resolution IS NULL) = (resolved_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_count_exceptions_session
  ON count_exceptions (session_id);
CREATE INDEX IF NOT EXISTS idx_count_exceptions_open
  ON count_exceptions (tenant_id, kind) WHERE resolution IS NULL;

-- ── 5. Functions ──────────────────────────────────────────────────────────

-- Start a count and take the expected snapshot in the same transaction.
CREATE OR REPLACE FUNCTION count_start(
  p_tenant_id   UUID,
  p_user_id     UUID,
  p_kind        TEXT,
  p_location    inventory_location DEFAULT NULL,
  p_shelf       TEXT DEFAULT NULL,
  p_category    inventory_category DEFAULT NULL,
  p_transfer_id UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id       UUID;
  v_number   TEXT;
  v_shelf    TEXT := NULLIF(btrim(COALESCE(p_shelf, '')), '');
  v_transfer inventory_transfers%ROWTYPE;
BEGIN
  IF p_kind = 'vault' THEN
    PERFORM 1 FROM tenants WHERE id = p_tenant_id AND has_pawn;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'count_module_off' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_kind = 'case' THEN
    IF p_location IS NULL THEN
      RAISE EXCEPTION 'count_location_required' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_kind = 'transfer' THEN
    SELECT * INTO v_transfer FROM inventory_transfers
     WHERE id = p_transfer_id AND deleted_at IS NULL;
    IF NOT FOUND OR p_tenant_id NOT IN (v_transfer.from_tenant_id, v_transfer.to_tenant_id) THEN
      RAISE EXCEPTION 'count_transfer_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_transfer.status IN ('cancelled', 'rejected') THEN
      RAISE EXCEPTION 'count_transfer_closed' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'count_bad_kind' USING ERRCODE = 'P0001';
  END IF;

  v_number := 'CT-' || lpad(next_tenant_counter(p_tenant_id, 'count_session')::text, 6, '0');

  INSERT INTO count_sessions (
    tenant_id, count_number, kind, scope_location, scope_shelf, scope_category,
    transfer_id, note, started_by
  ) VALUES (
    p_tenant_id, v_number, p_kind,
    CASE WHEN p_kind = 'case' THEN p_location END,
    CASE WHEN p_kind = 'case' THEN v_shelf END,
    CASE WHEN p_kind = 'case' THEN p_category END,
    CASE WHEN p_kind = 'transfer' THEN p_transfer_id END,
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    p_user_id
  )
  RETURNING id INTO v_id;

  IF p_kind = 'vault' THEN
    INSERT INTO count_expected (
      tenant_id, session_id, collateral_item_id, loan_id, code, description, value, state_at_start
    )
    SELECT p_tenant_id, v_id, c.id, l.id,
           l.ticket_number || '-' || (c.position + 1),
           c.description, COALESCE(c.est_value, 0), l.status::text
      FROM loan_collateral_items c
      JOIN loans l ON l.id = c.loan_id
     WHERE l.tenant_id = p_tenant_id
       AND c.tenant_id = p_tenant_id
       AND l.deleted_at IS NULL
       AND c.deleted_at IS NULL
       AND l.ticket_number IS NOT NULL
       AND l.status IN ('active', 'extended', 'partial_paid');
  ELSIF p_kind = 'case' THEN
    INSERT INTO count_expected (
      tenant_id, session_id, inventory_item_id, code, sku_number, description, value, state_at_start
    )
    SELECT p_tenant_id, v_id, i.id, i.sku, i.sku_number, i.description,
           COALESCE(i.cost_basis, 0), i.status::text
      FROM inventory_items i
     WHERE i.tenant_id = p_tenant_id
       AND i.deleted_at IS NULL
       AND i.status = 'available'
       AND i.location = p_location
       AND (v_shelf IS NULL OR lower(btrim(COALESCE(i.shelf_location, ''))) = lower(v_shelf))
       AND (p_category IS NULL OR i.category = p_category);
  ELSE
    INSERT INTO count_expected (
      tenant_id, session_id, inventory_item_id, code, sku_number, description, value, state_at_start
    )
    SELECT p_tenant_id, v_id, i.id, i.sku, i.sku_number, i.description,
           COALESCE(i.cost_basis, 0), i.status::text
      FROM inventory_transfer_items ti
      JOIN inventory_items i ON i.id = ti.inventory_item_id
     WHERE ti.transfer_id = p_transfer_id
       AND i.deleted_at IS NULL;
  END IF;

  RETURN v_id;
END;
$$;

-- Record a batch of reads. Returns one row per distinct code in the batch:
--   expected    first time this expected item was seen
--   repeat      already seen in this count (another read of the same tag)
--   unexpected  resolves to a record that is not on the expected list
--   unknown     does not resolve to anything in this shop
-- Matching mirrors src/lib/labels/scan.ts: PT-######-n is collateral,
-- INV-###### or bare digits is the SKU / sku_number, anything else is a
-- legacy SKU compared case-insensitively. The expected list is matched
-- first, so a transfer count finds the sending shop's items.
CREATE OR REPLACE FUNCTION count_add_reads(
  p_tenant_id  UUID,
  p_session_id UUID,
  p_user_id    UUID,
  p_codes      TEXT[],
  p_source     TEXT DEFAULT 'scanner'
)
RETURNS TABLE (o_code TEXT, o_outcome TEXT, o_description TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session   count_sessions%ROWTYPE;
  v_code      TEXT;
  v_sku       TEXT;
  v_num       BIGINT;
  v_ticket    TEXT;
  v_pos       INTEGER;
  v_expected  UUID;
  v_inv       UUID;
  v_coll      UUID;
  v_desc      TEXT;
  v_inserted  BOOLEAN;
  v_dup       BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM count_sessions
   WHERE id = p_session_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'count_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'count_not_open' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(array_length(p_codes, 1), 0) > 500 THEN
    RAISE EXCEPTION 'count_batch_too_large' USING ERRCODE = 'P0001';
  END IF;

  FOR v_code IN
    SELECT DISTINCT upper(btrim(regexp_replace(x, '[\r\n\t]', '', 'g')))
      FROM unnest(p_codes) AS x
     WHERE x IS NOT NULL
  LOOP
    CONTINUE WHEN v_code = '' OR length(v_code) > 64;
    v_expected := NULL; v_inv := NULL; v_coll := NULL; v_desc := NULL;
    v_sku := NULL; v_num := NULL; v_ticket := NULL; v_pos := NULL;

    IF v_code ~ '^PT-\d+-\d{1,3}$' THEN
      v_ticket := substring(v_code FROM '^(PT-\d+)-\d{1,3}$');
      v_pos := substring(v_code FROM '^PT-\d+-(\d{1,3})$')::int - 1;
      SELECT e.id, e.collateral_item_id, e.description INTO v_expected, v_coll, v_desc
        FROM count_expected e
       WHERE e.session_id = p_session_id AND upper(e.code) = v_code
       LIMIT 1;
      IF v_expected IS NULL THEN
        SELECT c.id, c.description INTO v_coll, v_desc
          FROM loans l
          JOIN loan_collateral_items c ON c.loan_id = l.id AND c.deleted_at IS NULL
         WHERE l.tenant_id = p_tenant_id
           AND l.ticket_number = v_ticket
           AND l.deleted_at IS NULL
           AND c.position = v_pos
         LIMIT 1;
      END IF;
    ELSIF v_code !~ '^RT-\d+$' THEN
      IF v_code ~ '^INV-\d{1,12}$' THEN
        v_sku := v_code;
        v_num := substring(v_code FROM 5)::bigint;
      ELSIF v_code ~ '^\d{1,12}$' THEN
        v_num := NULLIF(v_code::bigint, 0);
        v_sku := 'INV-' || CASE WHEN length(v_code::bigint::text) >= 6
                                THEN v_code::bigint::text
                                ELSE lpad(v_code::bigint::text, 6, '0') END;
      ELSE
        v_sku := v_code;
      END IF;

      SELECT e.id, e.inventory_item_id, e.description INTO v_expected, v_inv, v_desc
        FROM count_expected e
       WHERE e.session_id = p_session_id
         AND e.inventory_item_id IS NOT NULL
         AND (upper(e.code) = v_sku OR (v_num IS NOT NULL AND e.sku_number = v_num))
       ORDER BY (upper(e.code) = v_sku) DESC
       LIMIT 1;

      IF v_expected IS NULL THEN
        SELECT i.id, i.description INTO v_inv, v_desc
          FROM inventory_items i
         WHERE i.tenant_id = p_tenant_id AND i.deleted_at IS NULL AND i.sku = v_sku
         LIMIT 1;
        IF v_inv IS NULL THEN
          SELECT i.id, i.description INTO v_inv, v_desc
            FROM inventory_items i
           WHERE i.tenant_id = p_tenant_id AND i.deleted_at IS NULL AND upper(i.sku) = v_sku
           LIMIT 1;
        END IF;
        IF v_inv IS NULL AND v_num IS NOT NULL THEN
          SELECT i.id, i.description INTO v_inv, v_desc
            FROM inventory_items i
           WHERE i.tenant_id = p_tenant_id AND i.deleted_at IS NULL AND i.sku_number = v_num
           LIMIT 1;
        END IF;
      END IF;
    END IF;

    -- Another code for the same expected item already read (INV-000123 vs 000123)?
    v_dup := v_expected IS NOT NULL AND EXISTS (
      SELECT 1 FROM count_reads r
       WHERE r.session_id = p_session_id AND r.expected_id = v_expected AND r.code <> v_code
    );

    INSERT INTO count_reads AS r (
      tenant_id, session_id, code, expected_id, inventory_item_id, collateral_item_id,
      source, first_read_by
    ) VALUES (
      p_tenant_id, p_session_id, v_code, v_expected, v_inv, v_coll,
      CASE WHEN p_source IN ('scanner', 'rfid', 'manual') THEN p_source ELSE 'scanner' END,
      p_user_id
    )
    ON CONFLICT (session_id, code) DO UPDATE
      SET read_count = r.read_count + 1, last_seen_at = NOW()
    RETURNING (r.xmax = 0) INTO v_inserted;

    o_code := v_code;
    o_description := v_desc;
    o_outcome := CASE
      WHEN NOT v_inserted OR v_dup THEN 'repeat'
      WHEN v_expected IS NOT NULL THEN 'expected'
      WHEN v_inv IS NOT NULL OR v_coll IS NOT NULL THEN 'unexpected'
      ELSE 'unknown'
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- What is wrong with a count right now. Used by the live preview and by
-- count_close(), so both always agree.
CREATE OR REPLACE FUNCTION count_findings(p_session_id UUID)
RETURNS TABLE (
  o_kind               TEXT,
  o_reason             TEXT,
  o_code               TEXT,
  o_inventory_item_id  UUID,
  o_collateral_item_id UUID,
  o_loan_id            UUID,
  o_description        TEXT,
  o_value              NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH s AS (
    SELECT * FROM count_sessions WHERE id = p_session_id
  ),
  seen AS (
    SELECT DISTINCT expected_id FROM count_reads
     WHERE session_id = p_session_id AND expected_id IS NOT NULL
  ),
  not_seen AS (
    SELECT
      e.*,
      s.kind AS s_kind,
      CASE
        WHEN s.kind = 'vault' THEN
          CASE WHEN l.id IS NULL OR l.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL
                    OR l.status NOT IN ('active', 'extended', 'partial_paid')
               THEN COALESCE(l.status::text, 'deleted') END
        WHEN s.kind = 'case' THEN
          CASE WHEN i.id IS NULL OR i.deleted_at IS NOT NULL THEN 'deleted'
               WHEN i.tenant_id <> s.tenant_id THEN 'transferred'
               WHEN i.status <> 'available' THEN i.status::text
               WHEN i.location <> s.scope_location THEN 'moved'
          END
      END AS left_reason
    FROM count_expected e
    CROSS JOIN s
    LEFT JOIN inventory_items i       ON i.id = e.inventory_item_id
    LEFT JOIN loan_collateral_items c ON c.id = e.collateral_item_id
    LEFT JOIN loans l                 ON l.id = c.loan_id
    WHERE e.session_id = p_session_id
      AND e.id NOT IN (SELECT expected_id FROM seen)
  ),
  stray AS (
    SELECT DISTINCT ON (COALESCE(r.inventory_item_id::text, r.collateral_item_id::text, 'code:' || r.code))
      r.code,
      r.inventory_item_id,
      r.collateral_item_id,
      c.loan_id,
      COALESCE(i.description, c.description) AS description,
      COALESCE(i.cost_basis, c.est_value, 0) AS value,
      CASE
        WHEN r.inventory_item_id IS NOT NULL
             AND s.kind = 'case' AND i.status = 'held'
             AND s.scope_location IN ('case', 'display')
          THEN 'held_in_sales'
        ELSE 'unexpected'
      END AS kind,
      CASE
        WHEN r.inventory_item_id IS NULL AND r.collateral_item_id IS NULL THEN 'unknown_code'
        WHEN r.inventory_item_id IS NOT NULL THEN
          CASE
            WHEN s.kind = 'case' AND i.status = 'held' AND s.scope_location IN ('case', 'display') THEN NULL
            WHEN s.kind = 'transfer' THEN 'not_on_transfer'
            WHEN i.status NOT IN ('available', 'held') THEN 'not_in_stock'
            WHEN s.kind = 'vault' THEN 'not_in_scope'
            WHEN i.location <> s.scope_location THEN 'other_location'
            WHEN i.status = 'held' THEN 'other_status'
            WHEN (s.scope_shelf IS NOT NULL
                  AND lower(btrim(COALESCE(i.shelf_location, ''))) <> lower(s.scope_shelf))
              OR (s.scope_category IS NOT NULL AND i.category <> s.scope_category)
              THEN 'not_in_scope'
            ELSE 'added_after_start'
          END
        ELSE
          CASE
            WHEN l.deleted_at IS NOT NULL OR l.status IN ('redeemed', 'forfeited', 'voided') THEN 'loan_closed'
            WHEN s.kind = 'vault' THEN 'added_after_start'
            ELSE 'pledged_item'
          END
      END AS reason
    FROM count_reads r
    CROSS JOIN s
    LEFT JOIN inventory_items i       ON i.id = r.inventory_item_id
    LEFT JOIN loan_collateral_items c ON c.id = r.collateral_item_id
    LEFT JOIN loans l                 ON l.id = c.loan_id
    WHERE r.session_id = p_session_id
      AND r.expected_id IS NULL
    ORDER BY COALESCE(r.inventory_item_id::text, r.collateral_item_id::text, 'code:' || r.code), r.first_seen_at
  )
  SELECT
    CASE
      WHEN n.left_reason IS NOT NULL THEN 'left_during_count'
      WHEN n.collateral_item_id IS NOT NULL THEN 'missing_pledge'
      ELSE 'missing'
    END,
    n.left_reason,
    n.code, n.inventory_item_id, n.collateral_item_id, n.loan_id, n.description, n.value
  FROM not_seen n
  UNION ALL
  SELECT t.kind, t.reason, t.code, t.inventory_item_id, t.collateral_item_id, t.loan_id,
         t.description, t.value
  FROM stray t;
$$;

-- Close a count: write the exceptions and the totals. Every missing pledged
-- item needs a note (p_notes: { "<collateral_item_id>": "note" }).
CREATE OR REPLACE FUNCTION count_close(
  p_tenant_id  UUID,
  p_session_id UUID,
  p_user_id    UUID,
  p_notes      JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (o_missing INTEGER, o_unexpected INTEGER, o_left INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session count_sessions%ROWTYPE;
  v_notes      JSONB := COALESCE(p_notes, '{}'::jsonb);
  v_missing    INTEGER;
  v_unexpected INTEGER;
  v_left       INTEGER;
  v_value      NUMERIC(18,4);
BEGIN
  SELECT * INTO v_session FROM count_sessions
   WHERE id = p_session_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'count_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'count_not_open' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM count_findings(p_session_id) f
     WHERE f.o_kind = 'missing_pledge'
       AND length(btrim(COALESCE(v_notes ->> f.o_collateral_item_id::text, ''))) < 3
  ) THEN
    RAISE EXCEPTION 'count_pledge_note_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO count_exceptions (
    tenant_id, session_id, kind, reason, code, inventory_item_id, collateral_item_id,
    loan_id, description, value, close_note
  )
  SELECT p_tenant_id, p_session_id, f.o_kind, f.o_reason, f.o_code, f.o_inventory_item_id,
         f.o_collateral_item_id, f.o_loan_id, f.o_description, COALESCE(f.o_value, 0),
         NULLIF(btrim(COALESCE(
           v_notes ->> COALESCE(f.o_collateral_item_id, f.o_inventory_item_id)::text, ''
         )), '')
    FROM count_findings(p_session_id) f;

  -- Totals come from the exceptions just stored, so they always match.
  SELECT COUNT(*) FILTER (WHERE kind IN ('missing', 'missing_pledge')),
         COUNT(*) FILTER (WHERE kind IN ('unexpected', 'held_in_sales')),
         COUNT(*) FILTER (WHERE kind = 'left_during_count'),
         COALESCE(SUM(value) FILTER (WHERE kind IN ('missing', 'missing_pledge')), 0)
    INTO v_missing, v_unexpected, v_left, v_value
    FROM count_exceptions
   WHERE session_id = p_session_id;

  UPDATE count_sessions SET
    status           = 'closed',
    closed_by        = p_user_id,
    closed_at        = NOW(),
    expected_count   = (SELECT COUNT(*) FROM count_expected WHERE session_id = p_session_id),
    seen_count       = (SELECT COUNT(DISTINCT expected_id) FROM count_reads
                         WHERE session_id = p_session_id AND expected_id IS NOT NULL),
    missing_count    = v_missing,
    unexpected_count = v_unexpected,
    left_count       = v_left,
    missing_value    = v_value
  WHERE id = p_session_id;

  RETURN QUERY SELECT v_missing, v_unexpected, v_left;
END;
$$;

CREATE OR REPLACE FUNCTION count_cancel(
  p_tenant_id  UUID,
  p_session_id UUID,
  p_user_id    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE count_sessions
     SET status = 'cancelled', cancelled_by = p_user_id, cancelled_at = NOW()
   WHERE id = p_session_id AND tenant_id = p_tenant_id
     AND deleted_at IS NULL AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'count_not_open' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Resolve one exception, once. A note is required to write something off
-- and for any missing pledged item.
CREATE OR REPLACE FUNCTION count_resolve_exception(
  p_tenant_id    UUID,
  p_exception_id UUID,
  p_user_id      UUID,
  p_resolution   TEXT,
  p_note         TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ex   count_exceptions%ROWTYPE;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF p_resolution NOT IN ('found', 'written_off', 'explained') THEN
    RAISE EXCEPTION 'count_bad_resolution' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ex FROM count_exceptions
   WHERE id = p_exception_id AND tenant_id = p_tenant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'count_exception_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_ex.resolution IS NOT NULL THEN
    RAISE EXCEPTION 'count_exception_resolved' USING ERRCODE = 'P0001';
  END IF;
  IF (p_resolution IN ('written_off', 'explained') OR v_ex.kind = 'missing_pledge')
     AND length(COALESCE(v_note, '')) < 3 THEN
    RAISE EXCEPTION 'count_note_required' USING ERRCODE = 'P0001';
  END IF;

  UPDATE count_exceptions
     SET resolution = p_resolution, resolution_note = v_note,
         resolved_by = p_user_id, resolved_at = NOW()
   WHERE id = p_exception_id;
END;
$$;

REVOKE ALL ON FUNCTION count_start(UUID, UUID, TEXT, inventory_location, TEXT, inventory_category, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION count_add_reads(UUID, UUID, UUID, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION count_findings(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION count_close(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION count_cancel(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION count_resolve_exception(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION count_start(UUID, UUID, TEXT, inventory_location, TEXT, inventory_category, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION count_add_reads(UUID, UUID, UUID, TEXT[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION count_findings(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION count_close(UUID, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION count_cancel(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION count_resolve_exception(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

-- ── 6. RLS — read-only for staff; every write goes through the functions ──
ALTER TABLE count_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE count_expected   ENABLE ROW LEVEL SECURITY;
ALTER TABLE count_reads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE count_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS count_sessions_staff_read ON count_sessions;
CREATE POLICY count_sessions_staff_read ON count_sessions FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS count_expected_staff_read ON count_expected;
CREATE POLICY count_expected_staff_read ON count_expected FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS count_reads_staff_read ON count_reads;
CREATE POLICY count_reads_staff_read ON count_reads FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS count_exceptions_staff_read ON count_exceptions;
CREATE POLICY count_exceptions_staff_read ON count_exceptions FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

NOTIFY pgrst, 'reload schema';
