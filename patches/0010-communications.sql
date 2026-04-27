-- ============================================================================
-- PAWN — COMMUNICATIONS MIGRATION (Phase 6)
-- File:    patches/0010-communications.sql
-- Date:    2026-04-27
-- Purpose: Per-tenant Twilio (SMS + WhatsApp) + Resend (email) + tenant-
--          editable message_templates + write-once message_log.
--
-- Apply to: existing project AFTER 0001 .. 0008 have run. Append-only —
-- never edit prior migrations.
--
-- Design notes:
--   - Per-tenant comms credentials live alongside the existing per-tenant
--     `settings` row from 0001-foundation.sql. We EXTEND that table here
--     rather than spinning up a parallel `tenant_communication_settings`
--     table — settings already carries Twilio + Resend columns from 0001
--     and a 1:1 row exists for every tenant via create_tenant_with_owner().
--     Adding a parallel table would duplicate ownership of per-tenant
--     comms config and force every read site to JOIN both tables. Owner
--     controls writes via the existing `settings_write` policy
--     (my_is_owner(tenant_id)). Rule 9 (server-action gate) still applies.
--   - Extension columns — twilio_messaging_service_sid, twilio_sms_from,
--     twilio_whatsapp_from, resend_from_email, resend_from_name. Older
--     "twilio_phone_number" + "twilio_whatsapp_number" + "email_from"
--     columns from 0001 stay around; new code reads the new columns and
--     falls back to the old ones for safety. The Settings UI writes the
--     new columns going forward.
--   - Template registry (message_templates) is fully tenant-editable.
--     Default seeds for tenant 1abc8070-0797-4740-8dea-70cbb16060fe live
--     at the bottom of this migration. Other tenants get nothing until an
--     owner clones the defaults via the Settings UI.
--   - SMS body fields stay short (160 chars guideline; Twilio segments
--     longer messages, but keep defaults under 160 unless we know it will
--     concat). WhatsApp uses approved templates only — `body` is filled
--     for preview/dev, but the actual send dispatches a Content SID
--     (`whatsapp_content_sid`) populated AFTER WhatsApp Business approval.
--   - message_log is write-once on snapshot fields. Status transitions
--     (queued → sent → delivered / failed / opted_out) are app-driven
--     UPDATEs; the trigger only blocks DELETE and snapshot mutations.
--   - All staff in tenant can SELECT and INSERT message_log via RLS.
--     Owners can SELECT/UPDATE/DELETE message_templates via RLS. Server
--     actions still gate with requireStaff() / requireOwner().
--   - pgsodium-at-rest encryption is NOT applied here. Twilio/Resend
--     creds remain plaintext until pgsodium is rolled out across all
--     tenant_billing_settings + settings columns at once. See "encrypt
--     at rest with pgsodium when available" comments below.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  ENUMS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE message_kind AS ENUM (
    'loan_maturity_t7',         -- 7 days before due
    'loan_maturity_t1',         -- 1 day before due
    'loan_due_today',           -- due date is today
    'loan_overdue_t1',          -- 1 day past due
    'loan_overdue_t7',          -- 7 days past due
    'repair_ready',             -- repair is ready for pickup
    'repair_pickup_reminder',   -- repair-ready reminder (no pickup yet)
    'layaway_payment_due',      -- next layaway payment within 3 days
    'layaway_overdue',          -- layaway payment past due
    'layaway_completed',        -- final layaway payment received
    'custom'                    -- catch-all for ad-hoc manual sends
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_channel AS ENUM (
    'sms',
    'whatsapp',
    'email'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_status AS ENUM (
    'queued',                   -- row written, provider call in flight
    'sent',                     -- provider accepted (Twilio queued / Resend 200)
    'delivered',                -- carrier delivery confirmation (webhook)
    'failed',                   -- provider rejected or carrier failure
    'opted_out'                 -- recipient on STOP list / unsubscribed
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  EXTEND settings — additional comms fields.
--  (twilio_account_sid / twilio_auth_token / twilio_phone_number /
--   twilio_whatsapp_number / resend_api_key / email_from already exist
--   from 0001-foundation.sql — those stay.)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS twilio_messaging_service_sid TEXT,        -- optional Twilio Messaging Service SID; takes precedence over twilio_sms_from when set.
  ADD COLUMN IF NOT EXISTS twilio_sms_from              TEXT,        -- new canonical column; mirrors twilio_phone_number on read fallback.
  ADD COLUMN IF NOT EXISTS twilio_whatsapp_from         TEXT,        -- new canonical column; mirrors twilio_whatsapp_number on read fallback.
  ADD COLUMN IF NOT EXISTS resend_from_email            TEXT,        -- new canonical column; mirrors email_from on read fallback.
  ADD COLUMN IF NOT EXISTS resend_from_name             TEXT;        -- friendly From name for Resend; optional.

-- pgsodium reminder. Apply column-encryption transforms in a follow-up
-- migration when pgsodium is enabled across the project.
COMMENT ON COLUMN settings.twilio_auth_token IS 'Twilio Auth Token. Encrypt at rest with pgsodium when available.';
COMMENT ON COLUMN settings.resend_api_key    IS 'Resend API key. Encrypt at rest with pgsodium when available.';

-- ───────────────────────────────────────────────────────────────────────────
--  MESSAGE_TEMPLATES — tenant-editable copy.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_templates (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  kind                     message_kind NOT NULL,
  language                 TEXT NOT NULL CHECK (language IN ('en','es')),
  channel                  message_channel NOT NULL,

  -- Email-only. NULL for SMS / WhatsApp.
  subject                  TEXT,

  -- Body uses {{var}} mustache-style placeholders. Renderer in
  -- src/lib/comms/render.ts. For email, both text + simple HTML are
  -- generated at send time from this single body.
  body                     TEXT NOT NULL,

  -- Twilio approved-template Content SID for WhatsApp. NULL ⇒ send
  -- `body` verbatim (only valid in dev / before WA Business approval).
  whatsapp_content_sid     TEXT,

  is_enabled               BOOLEAN NOT NULL DEFAULT TRUE,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, kind, language, channel)
);

CREATE INDEX IF NOT EXISTS idx_message_templates_tenant
  ON message_templates(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_message_templates_lookup
  ON message_templates(tenant_id, kind, language, channel)
  WHERE deleted_at IS NULL AND is_enabled = TRUE;

DROP TRIGGER IF EXISTS trg_message_templates_updated_at ON message_templates;
CREATE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  MESSAGE_LOG — write-once send history.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_log (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  customer_id              UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- Optional pointers — at most one of these is set per row, identifying
  -- the business object the message is about. NULL for ad-hoc sends.
  related_loan_id          UUID REFERENCES loans(id) ON DELETE SET NULL,
  related_repair_ticket_id UUID REFERENCES repair_tickets(id) ON DELETE SET NULL,
  related_layaway_id       UUID REFERENCES layaways(id) ON DELETE SET NULL,

  channel                  message_channel NOT NULL,
  kind                     message_kind NOT NULL,
  status                   message_status NOT NULL DEFAULT 'queued',

  -- Snapshot of the destination address (phone or email) at send time —
  -- the customer may change contact info later but the audit must reflect
  -- where it actually went.
  to_address               TEXT NOT NULL,
  body_rendered            TEXT NOT NULL,

  -- Provider message ID. Twilio Message SID for SMS/WhatsApp, Resend
  -- email ID for email. NULL while queued / on failure.
  provider_id              TEXT,

  -- When status='failed' or 'opted_out', the provider error / reason.
  error_text               TEXT,

  -- Timestamps. created_at = row insert; sent_at = provider accepted;
  -- delivered_at = carrier-side delivery (Twilio webhook only).
  sent_at                  TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_log_tenant_created
  ON message_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_log_customer
  ON message_log(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_log_loan
  ON message_log(related_loan_id, created_at DESC) WHERE related_loan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_log_repair
  ON message_log(related_repair_ticket_id, created_at DESC) WHERE related_repair_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_log_layaway
  ON message_log(related_layaway_id, created_at DESC) WHERE related_layaway_id IS NOT NULL;
-- Idempotency-window queries (per cron route): "any send for this
-- (customer, kind, related-row) in the last 24h?".
CREATE INDEX IF NOT EXISTS idx_message_log_idem
  ON message_log(tenant_id, customer_id, kind, created_at DESC);

-- Snapshot immutability — only status / provider_id / sent_at /
-- delivered_at / error_text may be updated. DELETE always rejected.
CREATE OR REPLACE FUNCTION prevent_message_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'message_log is write-once. Rows cannot be deleted.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id        IS DISTINCT FROM OLD.tenant_id        OR
       NEW.customer_id      IS DISTINCT FROM OLD.customer_id      OR
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_log_immutable ON message_log;
CREATE TRIGGER trg_message_log_immutable
  BEFORE UPDATE OR DELETE ON message_log
  FOR EACH ROW EXECUTE FUNCTION prevent_message_log_modification();

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log       ENABLE ROW LEVEL SECURITY;

-- ── message_templates
DROP POLICY IF EXISTS message_templates_staff_read ON message_templates;
CREATE POLICY message_templates_staff_read ON message_templates FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS message_templates_owner_write ON message_templates;
CREATE POLICY message_templates_owner_write ON message_templates FOR ALL
  USING (my_is_owner(tenant_id))
  WITH CHECK (my_is_owner(tenant_id));

-- ── message_log
-- Staff in tenant: full read + insert. Updates only via admin client (cron
-- + webhook handlers run with service role). Clients (portal users) read
-- their own messages via the customer FK chain — Phase 5 will restate
-- this policy if customers.user_id is added; for now portal users have
-- no direct membership and won't pass my_accessible_tenant_ids() anyway.
DROP POLICY IF EXISTS message_log_staff_read ON message_log;
CREATE POLICY message_log_staff_read ON message_log FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS message_log_staff_insert ON message_log;
CREATE POLICY message_log_staff_insert ON message_log FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Note: client (portal) read policy is intentionally omitted here. When
-- Phase 5 lands customers.user_id, add a policy along the lines of:
--   USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()))

-- ───────────────────────────────────────────────────────────────────────────
--  SEED DEFAULT TEMPLATES — first tenant only.
--  Tenant: 1abc8070-0797-4740-8dea-70cbb16060fe
--
--  Seed shape:
--    11 kinds × 2 languages = 22 rows per channel.
--    SMS  — every kind. Short copy, ≤160 chars.
--    EMAIL — every kind. Subject + longer body.
--    WHATSAPP — every kind, but body is a placeholder REPLACE-ME marker
--               and whatsapp_content_sid is NULL until approved.
--
--  Variables available in template bodies (see lib/comms/dispatch.ts):
--    {{shop_name}}      — tenant.dba or tenant.name
--    {{customer_first_name}} / {{customer_last_name}}
--    {{ticket_number}}  — loans.ticket_number / repair_tickets.ticket_number / layaways.layaway_number
--    {{due_date}}       — ISO yyyy-mm-dd
--    {{amount}}         — formatted "$1,234.56"
--    {{portal_link}}    — customer-portal deep link
-- ───────────────────────────────────────────────────────────────────────────

DO $seed$
DECLARE
  v_tenant UUID := '1abc8070-0797-4740-8dea-70cbb16060fe'::UUID;
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM tenants WHERE id = v_tenant) INTO v_exists;
  IF NOT v_exists THEN
    RAISE NOTICE 'Tenant % not found — skipping default-template seed. Run create_tenant_with_owner() first.', v_tenant;
    RETURN;
  END IF;

  -- ── SMS / EN
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, is_enabled) VALUES
    (v_tenant, 'loan_maturity_t7', 'en', 'sms', '{{shop_name}}: heads up, ticket {{ticket_number}} is due {{due_date}} (in 7 days). Payoff: {{amount}}. Reply STOP to opt out.', TRUE),
    (v_tenant, 'loan_maturity_t1', 'en', 'sms', '{{shop_name}}: ticket {{ticket_number}} is due tomorrow ({{due_date}}). Payoff: {{amount}}. Stop in or pay online.', TRUE),
    (v_tenant, 'loan_due_today',   'en', 'sms', '{{shop_name}}: ticket {{ticket_number}} is due TODAY. Payoff: {{amount}}. Bring your ID.', TRUE),
    (v_tenant, 'loan_overdue_t1',  'en', 'sms', '{{shop_name}}: ticket {{ticket_number}} is past due. Stop in to redeem or extend before the grace period ends.', TRUE),
    (v_tenant, 'loan_overdue_t7',  'en', 'sms', '{{shop_name}}: final notice — ticket {{ticket_number}} is 7+ days past due. Pay or extend now to avoid forfeiture.', TRUE),
    (v_tenant, 'repair_ready',     'en', 'sms', '{{shop_name}}: your repair ticket {{ticket_number}} is ready for pickup. Balance due: {{amount}}.', TRUE),
    (v_tenant, 'repair_pickup_reminder','en','sms','{{shop_name}}: friendly reminder — your repair {{ticket_number}} is still waiting for pickup. Balance: {{amount}}.', TRUE),
    (v_tenant, 'layaway_payment_due','en','sms','{{shop_name}}: layaway {{ticket_number}} payment is due {{due_date}}. Balance remaining: {{amount}}.', TRUE),
    (v_tenant, 'layaway_overdue',  'en', 'sms', '{{shop_name}}: layaway {{ticket_number}} is past due. Make a payment to keep your items reserved.', TRUE),
    (v_tenant, 'layaway_completed','en', 'sms', '{{shop_name}}: thank you! Layaway {{ticket_number}} is paid in full. Stop by any time to pick up.', TRUE),
    (v_tenant, 'custom',           'en', 'sms', '{{shop_name}}: {{body}}', TRUE);

  -- ── SMS / ES
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, is_enabled) VALUES
    (v_tenant, 'loan_maturity_t7', 'es', 'sms', '{{shop_name}}: aviso, el boleto {{ticket_number}} vence el {{due_date}} (en 7 días). Saldo: {{amount}}. Responde STOP para no recibir más.', TRUE),
    (v_tenant, 'loan_maturity_t1', 'es', 'sms', '{{shop_name}}: el boleto {{ticket_number}} vence mañana ({{due_date}}). Saldo: {{amount}}. Pase a la tienda o pague en línea.', TRUE),
    (v_tenant, 'loan_due_today',   'es', 'sms', '{{shop_name}}: el boleto {{ticket_number}} vence HOY. Saldo: {{amount}}. Traiga su ID.', TRUE),
    (v_tenant, 'loan_overdue_t1',  'es', 'sms', '{{shop_name}}: el boleto {{ticket_number}} está vencido. Pase para redimir o extender antes de que expire la gracia.', TRUE),
    (v_tenant, 'loan_overdue_t7',  'es', 'sms', '{{shop_name}}: aviso final — el boleto {{ticket_number}} tiene 7+ días vencido. Pague o extienda para evitar pérdida.', TRUE),
    (v_tenant, 'repair_ready',     'es', 'sms', '{{shop_name}}: su boleto de reparación {{ticket_number}} está listo. Saldo: {{amount}}.', TRUE),
    (v_tenant, 'repair_pickup_reminder','es','sms','{{shop_name}}: recordatorio — su reparación {{ticket_number}} aún espera recogida. Saldo: {{amount}}.', TRUE),
    (v_tenant, 'layaway_payment_due','es','sms','{{shop_name}}: el pago del apartado {{ticket_number}} vence el {{due_date}}. Saldo: {{amount}}.', TRUE),
    (v_tenant, 'layaway_overdue',  'es', 'sms', '{{shop_name}}: el apartado {{ticket_number}} está vencido. Haga un pago para mantener su mercancía.', TRUE),
    (v_tenant, 'layaway_completed','es', 'sms', '{{shop_name}}: ¡gracias! El apartado {{ticket_number}} está totalmente pagado. Pase a recogerlo cuando guste.', TRUE),
    (v_tenant, 'custom',           'es', 'sms', '{{shop_name}}: {{body}}', TRUE);

  -- ── EMAIL / EN (subject + body)
  INSERT INTO message_templates (tenant_id, kind, language, channel, subject, body, is_enabled) VALUES
    (v_tenant, 'loan_maturity_t7', 'en', 'email',
      'Pawn ticket {{ticket_number}} is due in 7 days',
      'Hi {{customer_first_name}},'||E'\n\n'||'Your pawn ticket {{ticket_number}} at {{shop_name}} is due on {{due_date}} (7 days from now). Current payoff is {{amount}}.'||E'\n\n'||'You can pay in store or online here: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'loan_maturity_t1', 'en', 'email',
      'Pawn ticket {{ticket_number}} is due tomorrow',
      'Hi {{customer_first_name}},'||E'\n\n'||'Your pawn ticket {{ticket_number}} is due tomorrow ({{due_date}}). Payoff: {{amount}}.'||E'\n\n'||'Pay in store or online: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'loan_due_today',   'en', 'email',
      'Pawn ticket {{ticket_number}} is due today',
      'Hi {{customer_first_name}},'||E'\n\n'||'Pawn ticket {{ticket_number}} is due today. Payoff: {{amount}}.'||E'\n\n'||'Pay online: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'loan_overdue_t1',  'en', 'email',
      'Pawn ticket {{ticket_number}} is past due',
      'Hi {{customer_first_name}},'||E'\n\n'||'Your ticket {{ticket_number}} is past due. To avoid forfeiture, pay or extend within the grace period.'||E'\n\n'||'Pay online: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'loan_overdue_t7',  'en', 'email',
      'Final notice — pawn ticket {{ticket_number}}',
      'Hi {{customer_first_name}},'||E'\n\n'||'This is a final notice for ticket {{ticket_number}}. It is 7+ days past due. Please pay or extend immediately to avoid forfeiture of your collateral.'||E'\n\n'||'Pay online: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'repair_ready',     'en', 'email',
      'Your repair {{ticket_number}} is ready',
      'Hi {{customer_first_name}},'||E'\n\n'||'Great news — your repair ticket {{ticket_number}} at {{shop_name}} is ready for pickup. Balance due at pickup: {{amount}}.'||E'\n\n'||'See you soon!'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'repair_pickup_reminder','en','email',
      'Reminder: repair {{ticket_number}} awaiting pickup',
      'Hi {{customer_first_name}},'||E'\n\n'||'Just a reminder that your repair ticket {{ticket_number}} is still waiting for pickup. Balance: {{amount}}.'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'layaway_payment_due','en','email',
      'Layaway {{ticket_number}} payment due {{due_date}}',
      'Hi {{customer_first_name}},'||E'\n\n'||'A payment on layaway {{ticket_number}} is due on {{due_date}}. Balance remaining: {{amount}}.'||E'\n\n'||'Pay online: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'layaway_overdue',  'en', 'email',
      'Layaway {{ticket_number}} is past due',
      'Hi {{customer_first_name}},'||E'\n\n'||'Your layaway {{ticket_number}} payment is past due. Make a payment to keep your items reserved.'||E'\n\n'||'Pay online: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'layaway_completed','en', 'email',
      'Layaway {{ticket_number}} paid in full',
      'Hi {{customer_first_name}},'||E'\n\n'||'Thank you! Your layaway {{ticket_number}} is paid in full. Stop by any time to pick up your items.'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'custom',           'en', 'email',
      'A message from {{shop_name}}',
      '{{body}}', TRUE);

  -- ── EMAIL / ES
  INSERT INTO message_templates (tenant_id, kind, language, channel, subject, body, is_enabled) VALUES
    (v_tenant, 'loan_maturity_t7', 'es', 'email',
      'Boleto {{ticket_number}} vence en 7 días',
      'Hola {{customer_first_name}},'||E'\n\n'||'Su boleto de empeño {{ticket_number}} en {{shop_name}} vence el {{due_date}} (en 7 días). Saldo actual: {{amount}}.'||E'\n\n'||'Puede pagar en tienda o en línea: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'loan_maturity_t1', 'es', 'email',
      'Boleto {{ticket_number}} vence mañana',
      'Hola {{customer_first_name}},'||E'\n\n'||'Su boleto {{ticket_number}} vence mañana ({{due_date}}). Saldo: {{amount}}.'||E'\n\n'||'Pague en tienda o en línea: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'loan_due_today',   'es', 'email',
      'Boleto {{ticket_number}} vence hoy',
      'Hola {{customer_first_name}},'||E'\n\n'||'El boleto {{ticket_number}} vence hoy. Saldo: {{amount}}.'||E'\n\n'||'Pague en línea: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'loan_overdue_t1',  'es', 'email',
      'Boleto {{ticket_number}} está vencido',
      'Hola {{customer_first_name}},'||E'\n\n'||'Su boleto {{ticket_number}} está vencido. Pague o extienda antes de que termine la gracia para evitar perder su colateral.'||E'\n\n'||'Pague en línea: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'loan_overdue_t7',  'es', 'email',
      'Aviso final — boleto {{ticket_number}}',
      'Hola {{customer_first_name}},'||E'\n\n'||'Aviso final por el boleto {{ticket_number}}. Tiene 7+ días vencido. Pague o extienda inmediatamente para evitar la pérdida del colateral.'||E'\n\n'||'Pague en línea: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'repair_ready',     'es', 'email',
      'Su reparación {{ticket_number}} está lista',
      'Hola {{customer_first_name}},'||E'\n\n'||'Buenas noticias — su reparación {{ticket_number}} en {{shop_name}} está lista. Saldo al recoger: {{amount}}.'||E'\n\n'||'¡Lo esperamos!'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'repair_pickup_reminder','es','email',
      'Recordatorio: reparación {{ticket_number}} pendiente',
      'Hola {{customer_first_name}},'||E'\n\n'||'Recordatorio: su reparación {{ticket_number}} está pendiente de recogida. Saldo: {{amount}}.'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'layaway_payment_due','es','email',
      'Apartado {{ticket_number}} vence {{due_date}}',
      'Hola {{customer_first_name}},'||E'\n\n'||'El pago del apartado {{ticket_number}} vence el {{due_date}}. Saldo: {{amount}}.'||E'\n\n'||'Pague en línea: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'layaway_overdue',  'es', 'email',
      'Apartado {{ticket_number}} está vencido',
      'Hola {{customer_first_name}},'||E'\n\n'||'Su pago del apartado {{ticket_number}} está vencido. Haga un pago para mantener su mercancía.'||E'\n\n'||'Pague en línea: {{portal_link}}'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'layaway_completed','es', 'email',
      'Apartado {{ticket_number}} pagado',
      'Hola {{customer_first_name}},'||E'\n\n'||'¡Gracias! Su apartado {{ticket_number}} está totalmente pagado. Pase a recogerlo cuando guste.'||E'\n\n'||'— {{shop_name}}', TRUE),
    (v_tenant, 'custom',           'es', 'email',
      'Mensaje de {{shop_name}}',
      '{{body}}', TRUE);

  -- ── WHATSAPP / EN  (placeholder bodies — REPLACE WITH APPROVED TEMPLATE BODY before WhatsApp Business approval)
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, whatsapp_content_sid, is_enabled) VALUES
    (v_tenant, 'loan_maturity_t7', 'en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: ticket {{ticket_number}} due {{due_date}}, payoff {{amount}}.', NULL, TRUE),
    (v_tenant, 'loan_maturity_t1', 'en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: ticket {{ticket_number}} due tomorrow {{due_date}}.', NULL, TRUE),
    (v_tenant, 'loan_due_today',   'en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: ticket {{ticket_number}} due today.', NULL, TRUE),
    (v_tenant, 'loan_overdue_t1',  'en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: ticket {{ticket_number}} past due.', NULL, TRUE),
    (v_tenant, 'loan_overdue_t7',  'en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: final notice ticket {{ticket_number}}.', NULL, TRUE),
    (v_tenant, 'repair_ready',     'en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: repair {{ticket_number}} ready, balance {{amount}}.', NULL, TRUE),
    (v_tenant, 'repair_pickup_reminder','en','whatsapp','[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: repair {{ticket_number}} pickup reminder.', NULL, TRUE),
    (v_tenant, 'layaway_payment_due','en','whatsapp','[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: layaway {{ticket_number}} payment due {{due_date}}.', NULL, TRUE),
    (v_tenant, 'layaway_overdue',  'en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: layaway {{ticket_number}} past due.', NULL, TRUE),
    (v_tenant, 'layaway_completed','en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: layaway {{ticket_number}} complete.', NULL, TRUE),
    (v_tenant, 'custom',           'en', 'whatsapp', '[REPLACE WITH APPROVED TEMPLATE BODY] {{shop_name}}: {{body}}', NULL, TRUE);

  -- ── WHATSAPP / ES
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, whatsapp_content_sid, is_enabled) VALUES
    (v_tenant, 'loan_maturity_t7', 'es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: boleto {{ticket_number}} vence {{due_date}}, saldo {{amount}}.', NULL, TRUE),
    (v_tenant, 'loan_maturity_t1', 'es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: boleto {{ticket_number}} vence mañana {{due_date}}.', NULL, TRUE),
    (v_tenant, 'loan_due_today',   'es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: boleto {{ticket_number}} vence hoy.', NULL, TRUE),
    (v_tenant, 'loan_overdue_t1',  'es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: boleto {{ticket_number}} vencido.', NULL, TRUE),
    (v_tenant, 'loan_overdue_t7',  'es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: aviso final boleto {{ticket_number}}.', NULL, TRUE),
    (v_tenant, 'repair_ready',     'es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: reparación {{ticket_number}} lista, saldo {{amount}}.', NULL, TRUE),
    (v_tenant, 'repair_pickup_reminder','es','whatsapp','[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: recordatorio reparación {{ticket_number}}.', NULL, TRUE),
    (v_tenant, 'layaway_payment_due','es','whatsapp','[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: pago de apartado {{ticket_number}} vence {{due_date}}.', NULL, TRUE),
    (v_tenant, 'layaway_overdue',  'es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: apartado {{ticket_number}} vencido.', NULL, TRUE),
    (v_tenant, 'layaway_completed','es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: apartado {{ticket_number}} completo.', NULL, TRUE),
    (v_tenant, 'custom',           'es', 'whatsapp', '[REEMPLAZAR CON TEXTO DE PLANTILLA APROBADA] {{shop_name}}: {{body}}', NULL, TRUE);

EXCEPTION WHEN unique_violation THEN
  -- Idempotent re-run: defaults already seeded.
  RAISE NOTICE 'message_templates defaults already seeded for tenant %; skipping.', v_tenant;
END
$seed$;

-- Tell PostgREST to reload the schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0010-communications.sql
-- ============================================================================
