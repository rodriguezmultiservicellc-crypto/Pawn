-- 0127 — Customer page for a pawn ticket (Eddy, 2026-11-27: "we have a
-- customer view side for repairs, can we do the same for pawns").
--
-- /p/<token>, no login, like the repair page (/t/<token>, patches/0061):
-- the shop, the ticket number and status, the due date and last day to pick
-- up, the amount to pick up today, the items with their photos and the
-- payments — never the customer's identity, address or ID.
--
-- loan_public_links: the link lives in its OWN table, not on loans — writing
-- loans would bump loans.updated_at, which is the closing time of an
-- imported loan (rule 22: never bulk-touch imported loans). A link is made
-- when staff first copies / sends it; one live link per loan; "New link"
-- revokes the old one; "Revoke" ends it. Token: 32 hex (one UUID), like the
-- repair token.
--
-- The public page resolves the token with the service role on the server
-- (the payoff is figured by the same code as the counter, which a SQL
-- function cannot run) — the token is the ONLY input and the tenant comes
-- from it (rule 8).
--
-- RLS: enabled with NO policy — service role only, after the role check.
-- No existing policy is added or changed.
--
-- Templates: 'pawn_tracking_link' (patches/0126) SMS / email / WhatsApp,
-- EN + ES, for every tenant and every new one, editable in
-- Settings → Communications.

CREATE TABLE IF NOT EXISTS public.loan_public_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  loan_id     UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  token       TEXT NOT NULL CHECK (token ~ '^[0-9a-f]{32}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id),
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_public_links_token ON public.loan_public_links(token);
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_public_links_live
  ON public.loan_public_links(loan_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.loan_public_links IS
  'The customer page link of a pawn ticket (/p/<token>). One live link per loan; revoked_at ends it. Service role only.';

ALTER TABLE public.loan_public_links ENABLE ROW LEVEL SECURITY;

-- ── Templates ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_pawn_tracking_templates(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nl CONSTANT TEXT := E'\n\n';
BEGIN
  INSERT INTO message_templates (tenant_id, kind, language, channel, body, is_enabled) VALUES
    (p_tenant_id, 'pawn_tracking_link', 'en', 'sms',
     '{{shop_name}}: see your pawn ticket {{ticket_number}}, its due date and the amount to pick it up here: {{tracking_link}}', TRUE),
    (p_tenant_id, 'pawn_tracking_link', 'es', 'sms',
     '{{shop_name}}: vea su boleto de empeño {{ticket_number}}, su fecha de vencimiento y el monto para recogerlo aquí: {{tracking_link}}', TRUE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, subject, body, is_enabled) VALUES
    (p_tenant_id, 'pawn_tracking_link', 'en', 'email',
     'Your pawn ticket {{ticket_number}}',
     'Hi {{customer_first_name}},'||nl||'You can see your pawn ticket {{ticket_number}} at {{shop_name}} any time here — its due date, the amount to pick it up today and your payments: {{tracking_link}}'||nl||'— {{shop_name}}', TRUE),
    (p_tenant_id, 'pawn_tracking_link', 'es', 'email',
     'Su boleto de empeño {{ticket_number}}',
     'Hola {{customer_first_name}},'||nl||'Puede ver su boleto de empeño {{ticket_number}} en {{shop_name}} en cualquier momento aquí: su fecha de vencimiento, el monto para recogerlo hoy y sus pagos: {{tracking_link}}'||nl||'— {{shop_name}}', TRUE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;

  INSERT INTO message_templates (tenant_id, kind, language, channel, body, whatsapp_content_sid, is_enabled) VALUES
    (p_tenant_id, 'pawn_tracking_link', 'en', 'whatsapp',
     '{{shop_name}}: see your pawn ticket {{ticket_number}} here: {{tracking_link}}', NULL, FALSE),
    (p_tenant_id, 'pawn_tracking_link', 'es', 'whatsapp',
     '{{shop_name}}: vea su boleto de empeño {{ticket_number}} aquí: {{tracking_link}}', NULL, FALSE)
  ON CONFLICT (tenant_id, kind, language, channel) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION seed_pawn_tracking_templates(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_pawn_tracking_templates(UUID) TO service_role;

CREATE OR REPLACE FUNCTION tenant_after_insert_seed_pawn_tracking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM seed_pawn_tracking_templates(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_after_insert_seed_pawn_tracking ON tenants;
CREATE TRIGGER trg_tenant_after_insert_seed_pawn_tracking
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION tenant_after_insert_seed_pawn_tracking();

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM tenants LOOP
    PERFORM seed_pawn_tracking_templates(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY
--   SELECT count(*) FROM pg_policies WHERE tablename = 'loan_public_links';            → 0
--   SELECT count(*) FROM message_templates WHERE kind = 'pawn_tracking_link';          → 6 per tenant
