-- ───────────────────────────────────────────────────────────────────────────
-- 0079 — Custom store domains (PLAN-2026-11-13 Phase 3, store builder 15)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0078.
--
-- A shop can serve its public page and store on its own domain
-- (shop.example.com). Ownership is proved with a DNS TXT record:
--   _solpawn.<domain>  TXT  <custom_domain_token>
-- Only a verified domain is routed. The domain still has to point at the
-- app (CNAME) and be added to the Vercel project by RMS.
--
--   tenants.custom_domain             lowercase host, unique
--   tenants.custom_domain_token       random, shown to the owner
--   tenants.custom_domain_verified_at set when the TXT record matched
--   public_custom_domains view        verified host → public slug, for the
--                                     proxy (anon SELECT; public anyway)
--
-- RLS: no table, policy or existing view changes. Writes go through the
-- server (owner guard, then admin client).
--
-- Rollback
--   DROP VIEW IF EXISTS public_custom_domains;
--   ALTER TABLE tenants DROP COLUMN IF EXISTS custom_domain_verified_at,
--     DROP COLUMN IF EXISTS custom_domain_token, DROP COLUMN IF EXISTS custom_domain;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS custom_domain TEXT
    CHECK (custom_domain IS NULL OR custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  ADD COLUMN IF NOT EXISTS custom_domain_token TEXT,
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_custom_domain
  ON tenants (custom_domain) WHERE custom_domain IS NOT NULL;

CREATE OR REPLACE VIEW public_custom_domains
WITH (security_invoker = false) AS
SELECT t.custom_domain AS host, t.public_slug AS slug
FROM tenants t
WHERE t.custom_domain IS NOT NULL
  AND t.custom_domain_verified_at IS NOT NULL
  AND t.public_landing_enabled = TRUE
  AND t.public_slug IS NOT NULL
  AND t.is_active = TRUE;

COMMENT ON VIEW public_custom_domains IS
  'Verified custom store domains → public slug. Read by the proxy to route a shop''s own domain.';

GRANT SELECT ON public_custom_domains TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
