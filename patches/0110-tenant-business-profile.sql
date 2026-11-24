-- 0110 — The shop's business profile, for government forms.
--
-- Agency forms (CBP 5106 importer identity, the state pawnbroker license
-- renewal, ...) keep asking for the same facts about the business: legal
-- name, EIN, entity type, incorporation, addresses, officers, bank. They
-- are kept once here and poured into each form by
-- src/lib/agency-forms/ (one mapping per form).
--
-- Sensitive: the EIN and bank routing number. Owner only (Eddy approved the
-- policy 2026-11-24, rule 1). my_is_owner() also admits the chain_admin of
-- the shop's HQ, same as the rest of the owner-only surface.
--
-- Officers' Social Security numbers are NEVER stored: optional on these
-- forms, written by hand by whoever signs.
--
-- officers: JSONB array of
--   { title, last_name, first_name, middle_initial, phone, phone_ext,
--     email, home_address }
-- form_answers: JSONB { "<form id>": { <question>: <answer> } } — the
--   choices a form asks that are not facts about the business (CBP 5106:
--   type of action, entries a year), kept so the next fill starts from them.

CREATE TABLE IF NOT EXISTS tenant_business_profile (
  tenant_id            UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name           TEXT,
  ein                  TEXT CHECK (ein IS NULL OR ein ~ '^\d{2}-\d{7}$'),
  entity_type          TEXT CHECK (entity_type IS NULL OR entity_type IN
                         ('corporation', 'llc', 'partnership', 'sole_proprietorship', 'individual')),
  incorporation_state  TEXT CHECK (incorporation_state IS NULL OR incorporation_state ~ '^[A-Z]{2}$'),
  incorporation_number TEXT,
  year_established     INT CHECK (year_established IS NULL OR year_established BETWEEN 1800 AND 2100),
  naics_code           TEXT CHECK (naics_code IS NULL OR naics_code ~ '^\d{6}$'),
  business_description TEXT,
  duns                 TEXT,
  phone                TEXT,
  phone_ext            TEXT,
  fax                  TEXT,
  email                TEXT,
  website              TEXT,
  mailing_address1     TEXT,
  mailing_address2     TEXT,
  mailing_city         TEXT,
  mailing_state        TEXT CHECK (mailing_state IS NULL OR mailing_state ~ '^[A-Z]{2}$'),
  mailing_zip          TEXT,
  mailing_type         TEXT,
  physical_same        BOOLEAN NOT NULL DEFAULT TRUE,
  physical_address1    TEXT,
  physical_address2    TEXT,
  physical_city        TEXT,
  physical_state       TEXT CHECK (physical_state IS NULL OR physical_state ~ '^[A-Z]{2}$'),
  physical_zip         TEXT,
  physical_type        TEXT,
  bank_name            TEXT,
  bank_routing         TEXT CHECK (bank_routing IS NULL OR bank_routing ~ '^\d{9}$'),
  bank_city            TEXT,
  bank_state           TEXT CHECK (bank_state IS NULL OR bank_state ~ '^[A-Z]{2}$'),
  officers             JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(officers) = 'array'),
  form_answers         JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(form_answers) = 'object'),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID REFERENCES auth.users(id)
);

DROP TRIGGER IF EXISTS trg_tenant_business_profile_updated_at ON tenant_business_profile;
CREATE TRIGGER trg_tenant_business_profile_updated_at
  BEFORE UPDATE ON tenant_business_profile
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE tenant_business_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_business_profile_owner ON tenant_business_profile;
CREATE POLICY tenant_business_profile_owner ON tenant_business_profile FOR ALL
  USING (my_is_owner(tenant_id))
  WITH CHECK (my_is_owner(tenant_id));

REVOKE ALL ON tenant_business_profile FROM anon;

NOTIFY pgrst, 'reload schema';
