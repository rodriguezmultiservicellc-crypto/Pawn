-- ───────────────────────────────────────────────────────────────────────────
-- 0087 — Which Stripe account a shop's card charges run on
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0086.
--
--   settings.stripe_charge_mode
--     'connect'  (default) the shop's Express account under the RMS platform
--                — tenant_billing_settings.stripe_account_id, Stripe-Account
--                header. Needs the platform signed up for Connect.
--     'own_key'  the shop's OWN Stripe secret key (Luna Azul model), kept in
--                Vault as tenant secret kind 'stripe_own_secret_key'.
--     'platform' charges run directly on the RMS account (STRIPE_SECRET_KEY).
--                For RMS testing / RMS-run shops ONLY: switching a shop INTO
--                this mode is refused unless the request runs as
--                service_role — which the app does only after
--                requireSuperAdmin(). An owner writing their own settings
--                row (settings RLS: owner write) cannot point their shop at
--                RMS's account. Leaving 'platform' is allowed to anyone who
--                can write the row.
--
-- A reader and its Terminal Location belong to ONE Stripe account; the app
-- clears them when the mode changes.
-- RLS: no policy added or changed. Trigger function is SECURITY INVOKER.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS stripe_charge_mode text NOT NULL DEFAULT 'connect';

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_stripe_charge_mode_check;
ALTER TABLE public.settings ADD CONSTRAINT settings_stripe_charge_mode_check
  CHECK (stripe_charge_mode IN ('connect', 'own_key', 'platform'));

CREATE OR REPLACE FUNCTION public.settings_guard_stripe_platform_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.stripe_charge_mode = 'platform'
     AND (TG_OP = 'INSERT' OR OLD.stripe_charge_mode IS DISTINCT FROM 'platform')
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'stripe_platform_mode_superadmin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_settings_guard_stripe_platform_mode ON public.settings;
CREATE TRIGGER trg_settings_guard_stripe_platform_mode
  BEFORE INSERT OR UPDATE OF stripe_charge_mode ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.settings_guard_stripe_platform_mode();

COMMENT ON COLUMN public.settings.stripe_charge_mode IS
  'Card charges run on: connect (Express account under RMS), own_key (shop''s own Stripe key in Vault), platform (RMS account directly — superadmin/service_role only, 0087).';
