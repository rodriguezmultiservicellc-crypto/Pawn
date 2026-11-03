-- ───────────────────────────────────────────────────────────────────────────
-- 0061 — Repair tracking: public link + customer-facing stages
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0060 (separate apply — this
--           file seeds templates of the enum value 0060 adds).
--           Append-only — never edit prior migrations.
--
-- Brief Phase 1: customers keep calling to ask "is my piece ready?". Every
-- repair ticket gets an UNGUESSABLE public token; the page at /t/<token>
-- shows store branding, ticket number, the piece, a reference photo, the
-- promised date, a progress bar of named STAGES, quoted / paid / balance
-- and the store phone — and never the customer's identity, address, other
-- tickets or internal notes.
--
-- Design
--   repair_stages          Per-tenant, per-service_type ordered stages
--                          (name EN/ES, percent for the bar, optional list
--                          of workflow statuses that map onto the stage).
--                          Defaults seeded for every tenant and every new
--                          tenant; editable at /settings/repair-stages.
--   repair_tickets         + public_token (nullable = link revoked),
--                          + public_stage_id (customer-facing pointer).
--   Stage ↔ status         A BEFORE trigger keeps the pointer coherent with
--                          the workflow: when status changes, the ticket
--                          moves to the stage that maps that status (first
--                          match going forward, last match going back) —
--                          unless the current stage already covers the new
--                          status, so a custom piece sitting at "Casting"
--                          is not yanked back to "Wax" by a timer event.
--                          Sub-stages inside in_progress advance by hand
--                          ("Next stage" on the board / ticket).
--   repair_public_ticket() SECURITY DEFINER, callable by anon: resolves the
--                          token to ONE jsonb document containing only the
--                          customer-safe fields. The tenant comes from the
--                          token (rule 8) — no other input.
--   settings               + repair_ready_auto_notify: text the customer
--                          the moment a ticket reaches 'ready' (the daily
--                          repair-ready cron remains the catch-up).
--   message_templates      + 'repair_tracking_link' templates per tenant;
--                          existing repair_ready / pickup_reminder bodies
--                          gain a {{tracking_link}} line where missing.
--
-- RLS: repair_stages mirrors tenant_loan_rates (staff read; owner /
-- chain_admin / manager write). No policy is touched on existing tables.
-- The public read path is the RPC, not a policy — anon never sees a row.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. repair_stages ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repair_stages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_type      service_type NOT NULL,
  sort_order        INTEGER NOT NULL,
  name_en           TEXT NOT NULL CHECK (length(name_en) BETWEEN 1 AND 60),
  name_es           TEXT NOT NULL CHECK (length(name_es) BETWEEN 1 AND 60),
  -- How full the customer's progress bar is at this stage.
  percent           INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
  -- Workflow statuses that land the ticket on this stage automatically.
  -- Empty = a hand-advanced sub-stage (e.g. "Casting").
  maps_to_statuses  repair_status[] NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  UNIQUE (tenant_id, service_type, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_repair_stages_tenant_type
  ON repair_stages (tenant_id, service_type, sort_order)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_repair_stages_updated_at ON repair_stages;
CREATE TRIGGER trg_repair_stages_updated_at
  BEFORE UPDATE ON repair_stages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE repair_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repair_stages_staff_read ON repair_stages;
CREATE POLICY repair_stages_staff_read ON repair_stages FOR SELECT
  USING (my_is_staff(tenant_id));

DROP POLICY IF EXISTS repair_stages_owner_write ON repair_stages;
CREATE POLICY repair_stages_owner_write ON repair_stages FOR ALL
  USING (my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager'))
  WITH CHECK (my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager'));

-- ── 2. repair_tickets: token + stage pointer ──────────────────────────────

ALTER TABLE repair_tickets
  ADD COLUMN IF NOT EXISTS public_token             TEXT,
  ADD COLUMN IF NOT EXISTS public_token_created_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_stage_id          UUID REFERENCES repair_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS public_stage_updated_at  TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_repair_tickets_public_token
  ON repair_tickets (public_token) WHERE public_token IS NOT NULL;

COMMENT ON COLUMN repair_tickets.public_token IS
  '32 hex chars from gen_random_uuid(); NULL = tracking link revoked. The URL carries ONLY this.';

-- ── 3. settings: auto-notify at ready ─────────────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS repair_ready_auto_notify BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN settings.repair_ready_auto_notify IS
  'Text/email the customer (repair_ready template, with {{tracking_link}}) the moment a ticket reaches ready.';

-- ── 4. Token generator ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION repair_public_token()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  -- One v4 UUID = 122 random bits; hex without dashes keeps the SMS short.
  SELECT replace(gen_random_uuid()::text, '-', '');
$$;

-- ── 5. Default stages ─────────────────────────────────────────────────────
-- p_reset = TRUE wipes the tenant's rows for that service type first
-- (ticket pointers go NULL via the FK and are re-synced below).

CREATE OR REPLACE FUNCTION seed_default_repair_stages(
  p_tenant_id    UUID,
  p_service_type service_type DEFAULT NULL,
  p_reset        BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type service_type;
BEGIN
  FOR v_type IN
    SELECT unnest(enum_range(NULL::service_type))
  LOOP
    IF p_service_type IS NOT NULL AND v_type <> p_service_type THEN
      CONTINUE;
    END IF;

    IF p_reset THEN
      DELETE FROM repair_stages
      WHERE tenant_id = p_tenant_id AND service_type = v_type;
    END IF;

    IF EXISTS (
      SELECT 1 FROM repair_stages
      WHERE tenant_id = p_tenant_id AND service_type = v_type
    ) THEN
      CONTINUE;
    END IF;

    IF v_type = 'custom' THEN
      INSERT INTO repair_stages
        (tenant_id, service_type, sort_order, name_en, name_es, percent, maps_to_statuses)
      VALUES
        (p_tenant_id, v_type, 10,  'Design',           'Diseño',                10,  '{intake}'),
        (p_tenant_id, v_type, 20,  'Design approved',  'Diseño aprobado',       20,  '{quoted,awaiting_approval,assigned}'),
        (p_tenant_id, v_type, 30,  'Wax / 3D print',   'Cera / impresión 3D',   30,  '{in_progress,needs_parts}'),
        (p_tenant_id, v_type, 40,  'Casting',          'Fundición',             40,  '{}'),
        (p_tenant_id, v_type, 50,  'Metal work',       'Trabajo en metal',      50,  '{}'),
        (p_tenant_id, v_type, 60,  'Stone setting',    'Montaje de piedras',    60,  '{}'),
        (p_tenant_id, v_type, 70,  'Finishing',        'Acabado',               70,  '{}'),
        (p_tenant_id, v_type, 80,  'Quality check',    'Control de calidad',    85,  '{tech_qa}'),
        (p_tenant_id, v_type, 90,  'Ready for pickup', 'Listo para recoger',    95,  '{ready}'),
        (p_tenant_id, v_type, 100, 'Delivered',        'Entregado',             100, '{picked_up}');
    ELSE
      INSERT INTO repair_stages
        (tenant_id, service_type, sort_order, name_en, name_es, percent, maps_to_statuses)
      VALUES
        (p_tenant_id, v_type, 10,  'Received',          'Recibido',               10,  '{intake}'),
        (p_tenant_id, v_type, 20,  'Diagnosed / Quoted','Diagnosticado / Cotizado',25, '{quoted,awaiting_approval}'),
        (p_tenant_id, v_type, 30,  'Approved',          'Aprobado',               40,  '{assigned}'),
        (p_tenant_id, v_type, 40,  'In progress',       'En proceso',             60,  '{in_progress,needs_parts}'),
        (p_tenant_id, v_type, 50,  'Quality check',     'Control de calidad',     80,  '{tech_qa}'),
        (p_tenant_id, v_type, 60,  'Ready for pickup',  'Listo para recoger',     95,  '{ready}'),
        (p_tenant_id, v_type, 70,  'Picked up',         'Recogido',               100, '{picked_up}');
    END IF;
  END LOOP;

  -- Re-point open tickets of the (re)seeded type(s) whose stage vanished.
  UPDATE repair_tickets
  SET status = status
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND public_stage_id IS NULL
    AND (p_service_type IS NULL OR service_type = p_service_type);
END;
$$;

REVOKE ALL ON FUNCTION seed_default_repair_stages(UUID, service_type, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION seed_default_repair_stages(UUID, service_type, BOOLEAN) TO authenticated, service_role;

-- ── 6. Stage ↔ status sync + token on insert ──────────────────────────────

CREATE OR REPLACE FUNCTION repair_tickets_sync_public_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_cur  repair_stages%ROWTYPE;
  v_new  repair_stages%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.public_token IS NULL THEN
    NEW.public_token := repair_public_token();
    NEW.public_token_created_at := NOW();
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.service_type IS NOT DISTINCT FROM OLD.service_type
     AND NEW.public_stage_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.public_stage_id IS NOT NULL THEN
    SELECT * INTO v_cur FROM repair_stages WHERE id = NEW.public_stage_id;
  END IF;

  -- Current stage still covers the new status → leave the pointer alone.
  IF v_cur.id IS NOT NULL
     AND v_cur.service_type = NEW.service_type
     AND v_cur.is_active
     AND NEW.status = ANY (v_cur.maps_to_statuses) THEN
    RETURN NEW;
  END IF;

  v_new := NULL;

  IF v_cur.id IS NULL OR v_cur.service_type <> NEW.service_type THEN
    -- No usable current stage: first stage that maps this status.
    SELECT * INTO v_new FROM repair_stages
    WHERE tenant_id = NEW.tenant_id AND service_type = NEW.service_type
      AND is_active AND NEW.status = ANY (maps_to_statuses)
    ORDER BY sort_order ASC LIMIT 1;
  ELSE
    -- Forward: the first mapping stage after the current one …
    SELECT * INTO v_new FROM repair_stages
    WHERE tenant_id = NEW.tenant_id AND service_type = NEW.service_type
      AND is_active AND NEW.status = ANY (maps_to_statuses)
      AND sort_order > v_cur.sort_order
    ORDER BY sort_order ASC LIMIT 1;
    -- … else backward: the last mapping stage before it.
    IF v_new.id IS NULL THEN
      SELECT * INTO v_new FROM repair_stages
      WHERE tenant_id = NEW.tenant_id AND service_type = NEW.service_type
        AND is_active AND NEW.status = ANY (maps_to_statuses)
        AND sort_order < v_cur.sort_order
      ORDER BY sort_order DESC LIMIT 1;
    END IF;
  END IF;

  IF v_new.id IS NOT NULL AND v_new.id IS DISTINCT FROM NEW.public_stage_id THEN
    NEW.public_stage_id := v_new.id;
    NEW.public_stage_updated_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_repair_tickets_sync_public_stage ON repair_tickets;
CREATE TRIGGER trg_repair_tickets_sync_public_stage
  BEFORE INSERT OR UPDATE OF status, service_type ON repair_tickets
  FOR EACH ROW EXECUTE FUNCTION repair_tickets_sync_public_stage();

-- ── 7. Public read: token → customer-safe document ────────────────────────
-- Returns NULL for an unknown / revoked token, a soft-deleted or voided
-- ticket, or an inactive tenant — all the same answer, nothing to probe.
-- The photo is returned as a STORAGE PATH; the page signs it (1h) with the
-- service role. Customer identity: only `language`, to pick the copy.

CREATE OR REPLACE FUNCTION repair_public_ticket(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t   repair_tickets%ROWTYPE;
  v_tenant   RECORD;
  v_stage    RECORD;
  v_stages   JSONB;
  v_photo    TEXT;
  v_lang     TEXT;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 32 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO t FROM repair_tickets
  WHERE public_token = p_token AND deleted_at IS NULL AND status <> 'voided';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT name, dba, logo_url, phone, public_slug, public_landing_enabled
  INTO v_tenant
  FROM tenants WHERE id = t.tenant_id AND is_active = TRUE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id, name_en, name_es, percent, sort_order INTO v_stage
  FROM repair_stages WHERE id = t.public_stage_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name_en', s.name_en, 'name_es', s.name_es,
           'percent', s.percent, 'sort_order', s.sort_order
         ) ORDER BY s.sort_order), '[]'::jsonb)
  INTO v_stages
  FROM repair_stages s
  WHERE s.tenant_id = t.tenant_id AND s.service_type = t.service_type AND s.is_active;

  -- Reference photo first, then the intake shot; never the pickup signature.
  SELECT storage_path INTO v_photo
  FROM repair_ticket_photos
  WHERE ticket_id = t.id AND deleted_at IS NULL AND kind IN ('reference','intake')
  ORDER BY (kind = 'reference') DESC, position ASC, created_at ASC
  LIMIT 1;

  SELECT language INTO v_lang FROM customers WHERE id = t.customer_id;

  RETURN jsonb_build_object(
    'ticket_number',    t.ticket_number,
    'service_type',     t.service_type,
    'status',           t.status,
    'item_description', t.item_description,
    'promised_date',    t.promised_date,
    'quote_amount',     t.quote_amount,
    'deposit_amount',   t.deposit_amount,
    'paid_amount',      t.paid_amount,
    'balance_due',      t.balance_due,
    'completed_at',     t.completed_at,
    'picked_up_at',     t.picked_up_at,
    'created_at',       t.created_at,
    'stage', CASE WHEN v_stage.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_stage.id, 'name_en', v_stage.name_en, 'name_es', v_stage.name_es,
        'percent', v_stage.percent, 'sort_order', v_stage.sort_order) END,
    'stages',           v_stages,
    'photo_path',       v_photo,
    'language',         COALESCE(v_lang, 'en'),
    'shop', jsonb_build_object(
        'name',        COALESCE(v_tenant.dba, v_tenant.name),
        'logo_url',    v_tenant.logo_url,
        'phone',       v_tenant.phone,
        'public_slug', CASE WHEN v_tenant.public_landing_enabled THEN v_tenant.public_slug ELSE NULL END)
  );
END;
$$;

REVOKE ALL ON FUNCTION repair_public_ticket(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION repair_public_ticket(TEXT) TO anon, authenticated, service_role;

-- ── 8. Message templates for the link + {{tracking_link}} on ready texts ──

CREATE OR REPLACE FUNCTION seed_repair_tracking_templates(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nl CONSTANT TEXT := E'\n\n';
BEGIN
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, is_enabled) VALUES
    (p_tenant_id, 'repair_tracking_link', 'en', 'sms',
     '{{shop_name}}: follow your repair {{ticket_number}} here: {{tracking_link}}', TRUE),
    (p_tenant_id, 'repair_tracking_link', 'es', 'sms',
     '{{shop_name}}: siga su reparación {{ticket_number}} aquí: {{tracking_link}}', TRUE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, subject, body, is_enabled) VALUES
    (p_tenant_id, 'repair_tracking_link', 'en', 'email',
     'Follow your repair {{ticket_number}}',
     'Hi {{customer_first_name}},'||nl||'You can follow the progress of your repair {{ticket_number}} at {{shop_name}} any time here: {{tracking_link}}'||nl||'— {{shop_name}}', TRUE),
    (p_tenant_id, 'repair_tracking_link', 'es', 'email',
     'Siga su reparación {{ticket_number}}',
     'Hola {{customer_first_name}},'||nl||'Puede seguir el avance de su reparación {{ticket_number}} en {{shop_name}} en cualquier momento aquí: {{tracking_link}}'||nl||'— {{shop_name}}', TRUE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, body, whatsapp_content_sid, is_enabled) VALUES
    (p_tenant_id, 'repair_tracking_link', 'en', 'whatsapp',
     '{{shop_name}}: follow your repair {{ticket_number}} here: {{tracking_link}}', NULL, FALSE),
    (p_tenant_id, 'repair_tracking_link', 'es', 'whatsapp',
     '{{shop_name}}: siga su reparación {{ticket_number}} aquí: {{tracking_link}}', NULL, FALSE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  -- Ready / pickup-reminder texts gain the link once (operator edits kept).
  UPDATE message_templates
  SET body = body || CASE WHEN language = 'es' THEN ' Siga su reparación: {{tracking_link}}'
                                                ELSE ' Track it here: {{tracking_link}}' END,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND kind IN ('repair_ready', 'repair_pickup_reminder')
    AND deleted_at IS NULL
    AND body NOT LIKE '%{{tracking_link}}%';
END;
$$;

REVOKE ALL ON FUNCTION seed_repair_tracking_templates(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_repair_tracking_templates(UUID) TO service_role;

-- New tenants: stages + tracking templates alongside the 0050 template seed.
CREATE OR REPLACE FUNCTION tenant_after_insert_seed_repair_tracking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM seed_default_repair_stages(NEW.id, NULL, FALSE);
  PERFORM seed_repair_tracking_templates(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_after_insert_seed_repair_tracking ON tenants;
CREATE TRIGGER trg_tenant_after_insert_seed_repair_tracking
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION tenant_after_insert_seed_repair_tracking();

-- ── 9. Backfill every existing tenant + ticket ────────────────────────────

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM tenants LOOP
    PERFORM seed_default_repair_stages(r.id, NULL, FALSE);
    PERFORM seed_repair_tracking_templates(r.id);
  END LOOP;
END $$;

-- Tokens for tickets that predate this patch.
UPDATE repair_tickets
SET public_token = repair_public_token(),
    public_token_created_at = NOW()
WHERE public_token IS NULL AND deleted_at IS NULL;

-- Stage pointers for tickets that predate this patch (UPDATE OF status
-- fires the sync trigger even when the value is unchanged).
UPDATE repair_tickets
SET status = status
WHERE public_stage_id IS NULL AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
