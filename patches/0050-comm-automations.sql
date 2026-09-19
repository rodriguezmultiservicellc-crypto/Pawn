-- ============================================================================
-- PAWN — COMMUNICATION AUTOMATIONS (configurable reminders + lifecycle)
-- File:    patches/0050-comm-automations.sql
-- Date:    2026-09-18
-- Purpose: 1. comm_automations — per-tenant on/off + day offset for every
--             automated message (loan reminders, final notice before
--             forfeiture, birthday, dormant win-back, post-forfeiture
--             win-back, post-redemption thank-you). Rows are OVERRIDES —
--             code defaults apply when a row is absent.
--          2. comm_automation_sends — permanent send-once ledger keyed by a
--             deterministic automation_key (e.g. loan:<id>:loan_due_today:
--             <due_date>) so a message is never sent twice, even across
--             cron retries or days. Replaces the 24h message_log window.
--          3. Audience RPCs for birthday + dormant customers (service role).
--          4. seed_default_message_templates(tenant) — EN+ES SMS / email /
--             WhatsApp defaults for every kind, run for existing tenants now
--             and for new tenants via an AFTER INSERT trigger. Before this,
--             only one hard-coded tenant ever got templates (0010).
--
-- Apply to: existing project AFTER 0049. Append-only.
-- After apply: run `npm run db:types`.
--
-- Design notes:
--   - Lifecycle kinds (birthday / dormant / forfeiture win-back / thank-you)
--     are MARKETING: the audience RPCs only return marketing_opt_in = TRUE
--     customers, and the automations default to disabled (opt-in per shop).
--     Loan reminders + final notice are transactional and default enabled,
--     matching the behaviour of the old hard-coded cron.
--   - WhatsApp default rows are seeded DISABLED: WhatsApp Business requires
--     an approved Content SID per template. The dispatcher falls back to SMS
--     while the WhatsApp row is disabled or has no SID.
--   - RLS: comm_automations mirrors tenant_loan_rates (staff read, owner /
--     chain_admin / manager write). comm_automation_sends is staff-read only;
--     only the service-role cron writes it. NEW tables, NEW policies — no
--     existing policy is changed.
-- ============================================================================

-- ── 1. comm_automations ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comm_automations (
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         message_kind NOT NULL,
  is_enabled   BOOLEAN NOT NULL,
  offset_days  INTEGER NOT NULL CHECK (offset_days BETWEEN -60 AND 365),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES auth.users(id),
  PRIMARY KEY (tenant_id, kind)
);

COMMENT ON TABLE comm_automations IS
  'Per-tenant overrides for automated messages. Absent row = code default (src/lib/comms/automations.ts).';
COMMENT ON COLUMN comm_automations.offset_days IS
  'Days relative to the kind''s anchor: due date (loan reminders, negative = before), forfeiture date (final notice, days before), birthday (days before), last activity (dormant, days after), forfeiture / redemption (days after).';

DROP TRIGGER IF EXISTS trg_comm_automations_updated_at ON comm_automations;
CREATE TRIGGER trg_comm_automations_updated_at BEFORE UPDATE ON comm_automations
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE comm_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comm_automations_staff_read ON comm_automations;
CREATE POLICY comm_automations_staff_read ON comm_automations FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS comm_automations_manager_write ON comm_automations;
CREATE POLICY comm_automations_manager_write ON comm_automations FOR ALL
  USING (my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager'))
  WITH CHECK (my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager'));

-- ── 2. comm_automation_sends (send-once ledger) ─────────────────────────────

CREATE TABLE IF NOT EXISTS comm_automation_sends (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  automation_key   TEXT NOT NULL CHECK (length(automation_key) BETWEEN 3 AND 300),
  kind             message_kind NOT NULL,
  customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
  related_loan_id  UUID REFERENCES loans(id) ON DELETE SET NULL,
  status           TEXT NOT NULL CHECK (status IN ('sent','skipped','failed')),
  reason           TEXT,
  message_log_id   UUID REFERENCES message_log(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT comm_automation_sends_key_unique UNIQUE (tenant_id, automation_key)
);

CREATE INDEX IF NOT EXISTS idx_comm_automation_sends_customer
  ON comm_automation_sends(tenant_id, customer_id, created_at DESC);

COMMENT ON TABLE comm_automation_sends IS
  'Send-once ledger for automated messages. One row per automation_key; the UNIQUE constraint is the idempotency guarantee.';

ALTER TABLE comm_automation_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comm_automation_sends_staff_read ON comm_automation_sends;
CREATE POLICY comm_automation_sends_staff_read ON comm_automation_sends FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );
-- No write policy: only the service-role cron inserts.

-- ── 3. Audience RPCs (service role only) ────────────────────────────────────

-- Marketing-eligible customers whose birthday is on (p_month, p_day).
-- Feb 29 birthdays are greeted on Feb 28 in non-leap years.
CREATE OR REPLACE FUNCTION lifecycle_birthday_customers(
  p_tenant_id UUID,
  p_on        DATE
)
RETURNS TABLE (customer_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
    FROM customers c
   WHERE c.tenant_id = p_tenant_id
     AND c.deleted_at IS NULL
     AND c.is_banned = FALSE
     AND c.marketing_opt_in = TRUE
     AND c.comm_preference <> 'none'
     AND c.date_of_birth IS NOT NULL
     AND (
       (EXTRACT(MONTH FROM c.date_of_birth) = EXTRACT(MONTH FROM p_on)
        AND EXTRACT(DAY FROM c.date_of_birth) = EXTRACT(DAY FROM p_on))
       OR (
         EXTRACT(MONTH FROM p_on) = 2 AND EXTRACT(DAY FROM p_on) = 28
         AND EXTRACT(MONTH FROM c.date_of_birth) = 2
         AND EXTRACT(DAY FROM c.date_of_birth) = 29
         AND NOT (
           (EXTRACT(YEAR FROM p_on)::int % 4 = 0 AND EXTRACT(YEAR FROM p_on)::int % 100 <> 0)
           OR EXTRACT(YEAR FROM p_on)::int % 400 = 0
         )
       )
     );
$$;

-- Marketing-eligible customers with no open loan whose most recent
-- transaction (loan issue / loan event / completed sale / repair intake or
-- pickup) falls in [p_from, p_to]. Customers with no transaction history
-- in this system (e.g. imported records) are never returned.
CREATE OR REPLACE FUNCTION lifecycle_dormant_customers(
  p_tenant_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (customer_id UUID, last_activity DATE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH activity AS (
    SELECT l.customer_id, l.issue_date AS d
      FROM loans l
     WHERE l.tenant_id = p_tenant_id AND l.deleted_at IS NULL
    UNION ALL
    SELECT l.customer_id, (e.occurred_at)::date
      FROM loan_events e JOIN loans l ON l.id = e.loan_id
     WHERE e.tenant_id = p_tenant_id
    UNION ALL
    SELECT s.customer_id, (s.completed_at)::date
      FROM sales s
     WHERE s.tenant_id = p_tenant_id AND s.customer_id IS NOT NULL
       AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL
    UNION ALL
    SELECT r.customer_id, GREATEST((r.created_at)::date, COALESCE((r.picked_up_at)::date, (r.created_at)::date))
      FROM repair_tickets r
     WHERE r.tenant_id = p_tenant_id AND r.deleted_at IS NULL
  ),
  last_seen AS (
    SELECT a.customer_id, MAX(a.d) AS last_activity
      FROM activity a
     GROUP BY a.customer_id
  )
  SELECT ls.customer_id, ls.last_activity
    FROM last_seen ls
    JOIN customers c ON c.id = ls.customer_id
   WHERE c.tenant_id = p_tenant_id
     AND c.deleted_at IS NULL
     AND c.is_banned = FALSE
     AND c.marketing_opt_in = TRUE
     AND c.comm_preference <> 'none'
     AND ls.last_activity BETWEEN p_from AND p_to
     AND NOT EXISTS (
       SELECT 1 FROM loans ol
        WHERE ol.customer_id = ls.customer_id
          AND ol.tenant_id = p_tenant_id
          AND ol.deleted_at IS NULL
          AND ol.status IN ('active','extended','partial_paid')
     );
$$;

REVOKE ALL ON FUNCTION lifecycle_birthday_customers(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lifecycle_dormant_customers(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lifecycle_birthday_customers(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION lifecycle_dormant_customers(UUID, DATE, DATE) TO service_role;

-- ── 4. Default templates for every tenant ───────────────────────────────────

CREATE OR REPLACE FUNCTION seed_default_message_templates(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nl CONSTANT TEXT := E'\n\n';
BEGIN
  -- (kind, language, sms, email subject, email body)
  CREATE TEMP TABLE IF NOT EXISTS _tpl (
    kind TEXT, lang TEXT, sms TEXT, subj TEXT, body TEXT
  ) ON COMMIT DROP;
  TRUNCATE _tpl;

  INSERT INTO _tpl VALUES
  -- ── Loan reminders (transactional)
  ('loan_maturity_t7','en',
   '{{shop_name}}: heads up, ticket {{ticket_number}} is due {{due_date}} (in {{days}} days). Payoff: {{amount}}.',
   'Pawn ticket {{ticket_number}} is due {{due_date}}',
   'Hi {{customer_first_name}},'||nl||'Your pawn ticket {{ticket_number}} at {{shop_name}} is due on {{due_date}} ({{days}} days from now). Current payoff is {{amount}}.'||nl||'You can pay in store or online: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_maturity_t7','es',
   '{{shop_name}}: aviso, el boleto {{ticket_number}} vence el {{due_date}} (en {{days}} días). Saldo: {{amount}}.',
   'El boleto {{ticket_number}} vence el {{due_date}}',
   'Hola {{customer_first_name}},'||nl||'Su boleto de empeño {{ticket_number}} en {{shop_name}} vence el {{due_date}} (en {{days}} días). Saldo actual: {{amount}}.'||nl||'Puede pagar en tienda o en línea: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_maturity_t1','en',
   '{{shop_name}}: ticket {{ticket_number}} is due {{due_date}}. Payoff: {{amount}}. Stop in or pay online.',
   'Pawn ticket {{ticket_number}} is due soon',
   'Hi {{customer_first_name}},'||nl||'Your pawn ticket {{ticket_number}} is due {{due_date}}. Payoff: {{amount}}.'||nl||'Pay in store or online: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_maturity_t1','es',
   '{{shop_name}}: el boleto {{ticket_number}} vence el {{due_date}}. Saldo: {{amount}}. Pase a la tienda o pague en línea.',
   'El boleto {{ticket_number}} vence pronto',
   'Hola {{customer_first_name}},'||nl||'Su boleto {{ticket_number}} vence el {{due_date}}. Saldo: {{amount}}.'||nl||'Pague en tienda o en línea: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_due_today','en',
   '{{shop_name}}: ticket {{ticket_number}} is due TODAY. Payoff: {{amount}}. Bring your ID.',
   'Pawn ticket {{ticket_number}} is due today',
   'Hi {{customer_first_name}},'||nl||'Pawn ticket {{ticket_number}} is due today. Payoff: {{amount}}.'||nl||'Pay online: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_due_today','es',
   '{{shop_name}}: el boleto {{ticket_number}} vence HOY. Saldo: {{amount}}. Traiga su ID.',
   'El boleto {{ticket_number}} vence hoy',
   'Hola {{customer_first_name}},'||nl||'El boleto {{ticket_number}} vence hoy. Saldo: {{amount}}.'||nl||'Pague en línea: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_overdue_t1','en',
   '{{shop_name}}: ticket {{ticket_number}} is past due. Redeem or extend before {{forfeit_date}} to keep your item.',
   'Pawn ticket {{ticket_number}} is past due',
   'Hi {{customer_first_name}},'||nl||'Your ticket {{ticket_number}} is past due. To keep your item, pay or extend before {{forfeit_date}}.'||nl||'Pay online: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_overdue_t1','es',
   '{{shop_name}}: el boleto {{ticket_number}} está vencido. Rescate o extienda antes del {{forfeit_date}} para conservar su artículo.',
   'El boleto {{ticket_number}} está vencido',
   'Hola {{customer_first_name}},'||nl||'Su boleto {{ticket_number}} está vencido. Para conservar su artículo, pague o extienda antes del {{forfeit_date}}.'||nl||'Pague en línea: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_overdue_t7','en',
   '{{shop_name}}: ticket {{ticket_number}} is {{days}} days past due. Pay or extend before {{forfeit_date}} to avoid forfeiture.',
   'Reminder — pawn ticket {{ticket_number}} is past due',
   'Hi {{customer_first_name}},'||nl||'Ticket {{ticket_number}} is {{days}} days past due. Please pay or extend before {{forfeit_date}} to avoid forfeiture of your item.'||nl||'Pay online: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_overdue_t7','es',
   '{{shop_name}}: el boleto {{ticket_number}} tiene {{days}} días vencido. Pague o extienda antes del {{forfeit_date}} para evitar la pérdida.',
   'Recordatorio — el boleto {{ticket_number}} está vencido',
   'Hola {{customer_first_name}},'||nl||'El boleto {{ticket_number}} tiene {{days}} días vencido. Pague o extienda antes del {{forfeit_date}} para no perder su artículo.'||nl||'Pague en línea: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_final_notice','en',
   '{{shop_name}}: FINAL NOTICE — ticket {{ticket_number}} will be forfeited on {{forfeit_date}} unless redeemed or extended. Payoff: {{amount}}.',
   'Final notice — pawn ticket {{ticket_number}}',
   'Hi {{customer_first_name}},'||nl||'This is the final notice for pawn ticket {{ticket_number}}. Unless it is redeemed or extended, your item will be forfeited on {{forfeit_date}}. Current payoff: {{amount}}.'||nl||'Pay online: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('loan_final_notice','es',
   '{{shop_name}}: AVISO FINAL — el boleto {{ticket_number}} se perderá el {{forfeit_date}} si no se rescata o extiende. Saldo: {{amount}}.',
   'Aviso final — boleto {{ticket_number}}',
   'Hola {{customer_first_name}},'||nl||'Este es el aviso final del boleto de empeño {{ticket_number}}. Si no se rescata o extiende, su artículo se perderá el {{forfeit_date}}. Saldo actual: {{amount}}.'||nl||'Pague en línea: {{portal_link}}'||nl||'— {{shop_name}}'),
  -- ── Repairs / layaways (transactional)
  ('repair_ready','en',
   '{{shop_name}}: your repair ticket {{ticket_number}} is ready for pickup. Balance due: {{amount}}.',
   'Your repair {{ticket_number}} is ready',
   'Hi {{customer_first_name}},'||nl||'Great news — your repair ticket {{ticket_number}} at {{shop_name}} is ready for pickup. Balance due at pickup: {{amount}}.'||nl||'— {{shop_name}}'),
  ('repair_ready','es',
   '{{shop_name}}: su reparación {{ticket_number}} está lista para recoger. Saldo: {{amount}}.',
   'Su reparación {{ticket_number}} está lista',
   'Hola {{customer_first_name}},'||nl||'Buenas noticias — su reparación {{ticket_number}} en {{shop_name}} está lista. Saldo al recoger: {{amount}}.'||nl||'— {{shop_name}}'),
  ('repair_pickup_reminder','en',
   '{{shop_name}}: friendly reminder — your repair {{ticket_number}} is still waiting for pickup. Balance: {{amount}}.',
   'Reminder: repair {{ticket_number}} awaiting pickup',
   'Hi {{customer_first_name}},'||nl||'Just a reminder that your repair ticket {{ticket_number}} is still waiting for pickup. Balance: {{amount}}.'||nl||'— {{shop_name}}'),
  ('repair_pickup_reminder','es',
   '{{shop_name}}: recordatorio — su reparación {{ticket_number}} aún espera ser recogida. Saldo: {{amount}}.',
   'Recordatorio: reparación {{ticket_number}} pendiente',
   'Hola {{customer_first_name}},'||nl||'Recordatorio: su reparación {{ticket_number}} está pendiente de recogida. Saldo: {{amount}}.'||nl||'— {{shop_name}}'),
  ('layaway_payment_due','en',
   '{{shop_name}}: layaway {{ticket_number}} payment is due {{due_date}}. Balance remaining: {{amount}}.',
   'Layaway {{ticket_number}} payment due {{due_date}}',
   'Hi {{customer_first_name}},'||nl||'A payment on layaway {{ticket_number}} is due on {{due_date}}. Balance remaining: {{amount}}.'||nl||'Pay online: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('layaway_payment_due','es',
   '{{shop_name}}: el pago del apartado {{ticket_number}} vence el {{due_date}}. Saldo: {{amount}}.',
   'Pago del apartado {{ticket_number}} vence el {{due_date}}',
   'Hola {{customer_first_name}},'||nl||'El pago del apartado {{ticket_number}} vence el {{due_date}}. Saldo: {{amount}}.'||nl||'Pague en línea: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('layaway_overdue','en',
   '{{shop_name}}: layaway {{ticket_number}} is past due. Make a payment to keep your items reserved.',
   'Layaway {{ticket_number}} is past due',
   'Hi {{customer_first_name}},'||nl||'Your layaway {{ticket_number}} payment is past due. Make a payment to keep your items reserved.'||nl||'Pay online: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('layaway_overdue','es',
   '{{shop_name}}: el apartado {{ticket_number}} está vencido. Haga un pago para mantener su mercancía reservada.',
   'El apartado {{ticket_number}} está vencido',
   'Hola {{customer_first_name}},'||nl||'Su pago del apartado {{ticket_number}} está vencido. Haga un pago para mantener su mercancía reservada.'||nl||'Pague en línea: {{portal_link}}'||nl||'— {{shop_name}}'),
  ('layaway_completed','en',
   '{{shop_name}}: thank you! Layaway {{ticket_number}} is paid in full. Stop by any time to pick up.',
   'Layaway {{ticket_number}} paid in full',
   'Hi {{customer_first_name}},'||nl||'Thank you! Your layaway {{ticket_number}} is paid in full. Stop by any time to pick up your items.'||nl||'— {{shop_name}}'),
  ('layaway_completed','es',
   '{{shop_name}}: ¡gracias! El apartado {{ticket_number}} está totalmente pagado. Pase a recogerlo cuando guste.',
   'Apartado {{ticket_number}} pagado',
   'Hola {{customer_first_name}},'||nl||'¡Gracias! Su apartado {{ticket_number}} está totalmente pagado. Pase a recogerlo cuando guste.'||nl||'— {{shop_name}}'),
  ('custom','en','{{shop_name}}: {{body}}','A message from {{shop_name}}','{{body}}'),
  ('custom','es','{{shop_name}}: {{body}}','Mensaje de {{shop_name}}','{{body}}'),
  -- ── Lifecycle (marketing — opted-in customers only)
  ('birthday_greeting','en',
   '{{shop_name}}: Happy birthday, {{customer_first_name}}! Stop by this week — we''d love to celebrate with you. Reply STOP to opt out.',
   'Happy birthday from {{shop_name}}!',
   'Hi {{customer_first_name}},'||nl||'Happy birthday from all of us at {{shop_name}}! Stop by this week — we''d love to celebrate with you.'||nl||'— {{shop_name}}'||nl||'To stop these emails: {{unsubscribe_url}}'),
  ('birthday_greeting','es',
   '{{shop_name}}: ¡Feliz cumpleaños, {{customer_first_name}}! Pase esta semana, queremos celebrar con usted. Responda STOP para no recibir más.',
   '¡Feliz cumpleaños de parte de {{shop_name}}!',
   'Hola {{customer_first_name}},'||nl||'¡Feliz cumpleaños de parte de todos en {{shop_name}}! Pase esta semana, queremos celebrar con usted.'||nl||'— {{shop_name}}'||nl||'Para dejar de recibir estos correos: {{unsubscribe_url}}'),
  ('dormant_winback','en',
   '{{shop_name}}: We miss you, {{customer_first_name}}! It''s been a while — come see what''s new in store. Reply STOP to opt out.',
   'We miss you at {{shop_name}}',
   'Hi {{customer_first_name}},'||nl||'It''s been a while since your last visit to {{shop_name}}. Come see what''s new in store — and remember we''re here whenever you need a loan.'||nl||'— {{shop_name}}'||nl||'To stop these emails: {{unsubscribe_url}}'),
  ('dormant_winback','es',
   '{{shop_name}}: ¡Le extrañamos, {{customer_first_name}}! Hace tiempo que no nos visita — venga a ver lo nuevo en la tienda. Responda STOP para no recibir más.',
   'Le extrañamos en {{shop_name}}',
   'Hola {{customer_first_name}},'||nl||'Hace tiempo que no visita {{shop_name}}. Venga a ver lo nuevo en la tienda — y recuerde que estamos aquí cuando necesite un préstamo.'||nl||'— {{shop_name}}'||nl||'Para dejar de recibir estos correos: {{unsubscribe_url}}'),
  ('forfeiture_winback','en',
   '{{shop_name}}: {{customer_first_name}}, we''re here whenever you need cash — come see us for a new loan or great deals in store. Reply STOP to opt out.',
   '{{shop_name}} is here when you need us',
   'Hi {{customer_first_name}},'||nl||'Whenever you need cash, {{shop_name}} is here — come see us for a new loan, or browse great deals in store.'||nl||'— {{shop_name}}'||nl||'To stop these emails: {{unsubscribe_url}}'),
  ('forfeiture_winback','es',
   '{{shop_name}}: {{customer_first_name}}, estamos aquí cuando necesite efectivo — visítenos para un nuevo préstamo o grandes ofertas. Responda STOP para no recibir más.',
   '{{shop_name}} está aquí cuando nos necesite',
   'Hola {{customer_first_name}},'||nl||'Cuando necesite efectivo, {{shop_name}} está aquí — visítenos para un nuevo préstamo o vea las ofertas en la tienda.'||nl||'— {{shop_name}}'||nl||'Para dejar de recibir estos correos: {{unsubscribe_url}}'),
  ('redemption_thankyou','en',
   '{{shop_name}}: Thanks for redeeming ticket {{ticket_number}}, {{customer_first_name}}! We appreciate your business. Reply STOP to opt out.',
   'Thank you from {{shop_name}}',
   'Hi {{customer_first_name}},'||nl||'Thank you for redeeming ticket {{ticket_number}}. We appreciate your business and hope to see you again soon.'||nl||'— {{shop_name}}'||nl||'To stop these emails: {{unsubscribe_url}}'),
  ('redemption_thankyou','es',
   '{{shop_name}}: ¡Gracias por rescatar el boleto {{ticket_number}}, {{customer_first_name}}! Apreciamos su preferencia. Responda STOP para no recibir más.',
   'Gracias de parte de {{shop_name}}',
   'Hola {{customer_first_name}},'||nl||'Gracias por rescatar el boleto {{ticket_number}}. Apreciamos su preferencia y esperamos verle pronto.'||nl||'— {{shop_name}}'||nl||'Para dejar de recibir estos correos: {{unsubscribe_url}}');

  INSERT INTO message_templates (tenant_id, kind, language, channel, body, is_enabled)
  SELECT p_tenant_id, t.kind::message_kind, t.lang, 'sms', t.sms, TRUE FROM _tpl t
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, subject, body, is_enabled)
  SELECT p_tenant_id, t.kind::message_kind, t.lang, 'email', t.subj, t.body, TRUE FROM _tpl t
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  -- WhatsApp needs an approved Content SID per template — seed disabled.
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, whatsapp_content_sid, is_enabled)
  SELECT p_tenant_id, t.kind::message_kind, t.lang, 'whatsapp', t.sms, NULL, FALSE FROM _tpl t
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION seed_default_message_templates(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_default_message_templates(UUID) TO service_role;

CREATE OR REPLACE FUNCTION tenant_after_insert_seed_templates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM seed_default_message_templates(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_after_insert_seed_templates ON tenants;
CREATE TRIGGER trg_tenant_after_insert_seed_templates
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION tenant_after_insert_seed_templates();

-- Backfill: every existing tenant gets any missing default rows (existing
-- rows — including operator edits — are never overwritten).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM tenants LOOP
    PERFORM seed_default_message_templates(r.id);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0050-comm-automations.sql
-- ============================================================================
