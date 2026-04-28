-- ============================================================================
-- PAWN — EBAY LISTING PUBLISHER MIGRATION (Phase 10, Path B)
-- File:    patches/0015-ebay-listings.sql
-- Date:    2026-04-27
-- Purpose: Per-tenant eBay credentials (OAuth tokens), draft + published
--          listing rows linked to inventory_items, and an immutable event
--          stream of every API call we make to eBay (real or stubbed).
--
-- Apply to: existing project AFTER 0001..0014 have run. Append-only — never
--           edit prior migrations.
--
-- SCOPE — this is a SCAFFOLD migration. Real eBay API wire-up ships in a
-- follow-up after Eddy onboards an eBay developer account. The schema is
-- final; the only difference between scaffold and live is that the lib/ebay
-- client functions stop returning mock data and start hitting api.ebay.com.
--
-- Design notes:
--   - tenant_ebay_credentials is 1:1 with tenants. OAuth refresh + access
--     tokens stored alongside merchant location, fulfillment / payment /
--     return policy ids — every call to eBay's Sell APIs needs at least
--     one of these. Comment columns "encrypt at rest with pgsodium when
--     available" — same pattern as the comms settings extension. v1 stores
--     them as plain TEXT under RLS; encryption is a follow-up.
--   - ebay_listings is a tenant-scoped row that mirrors what we know about
--     a draft/active/sold listing on eBay. The source-of-truth for "what's
--     for sale" is still inventory_items — this table is a publishing layer.
--     When a listing sells, sale_id FK ties it back into the local POS
--     pipeline so reporting + register reconciliation still works.
--   - ebay_listing_events is the audit-trail of API calls. Every stub call
--     writes a row here with the would-be request payload so the UI can
--     show "we attempted X" even when the actual eBay round-trip never
--     happens. Read-only after insert.
--   - Soft-delete via deleted_at on listings only. Credentials and events
--     hard-delete is fine — credentials by tenant cascade, events by
--     listing cascade. (Audit history of eBay operations also lives in
--     audit_log, so wiping a listing's events doesn't lose the trail.)
--   - Money: list_price numeric(18,4), currency TEXT default 'USD'.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  ENUMS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ebay_environment AS ENUM (
    'sandbox',         -- api.sandbox.ebay.com (developer testing)
    'production'       -- api.ebay.com
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ebay_listing_status AS ENUM (
    'draft',           -- staff has filled the form but not pushed to eBay
    'submitting',      -- /sell/inventory create_offer + publish in flight
    'active',          -- live on eBay
    'ended',           -- ended by the seller (or expired)
    'sold',            -- buyer purchased; sale_id links to local sales row
    'error'            -- last API call failed; error_text populated
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ebay_listing_format AS ENUM (
    'FIXED_PRICE',     -- buy-it-now
    'AUCTION'          -- timed auction
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ebay_listing_event_kind AS ENUM (
    'create_offer',
    'publish',
    'update',
    'end',
    'sync',
    'webhook_received'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  TENANT_EBAY_CREDENTIALS — 1:1 with tenants. OAuth tokens + policy IDs.
-- ───────────────────────────────────────────────────────────────────────────
--
-- One row per tenant when (and if) the operator connects an eBay account.
-- Disconnecting clears the tokens but leaves the row so we keep the audit
-- trail of "was connected from X to Y".
--
-- TOKEN ENCRYPTION (deferred):
--   refresh_token / access_token are stored as TEXT today under RLS. The
--   follow-up migration will introduce pgsodium-encrypted columns and a
--   DB-side decrypt function callable only from the admin (service-role)
--   client. Pattern matches what we'll do for tenant_billing_settings'
--   stripe_access_token.
--
-- POLICY IDS:
--   Sell Inventory API publish requires fulfillment_policy_id +
--   payment_policy_id + return_policy_id. The operator creates these
--   inside eBay Seller Hub; we look them up and persist them per-tenant.

CREATE TABLE IF NOT EXISTS tenant_ebay_credentials (
  tenant_id                       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- The eBay user identifier the OAuth token grants on behalf of. Returned
  -- by /commerce/identity/v1/user when we resolve the connection.
  ebay_user_id                    TEXT,

  -- OAuth tokens. Encrypt at rest with pgsodium when available.
  refresh_token                   TEXT,
  refresh_token_expires_at        TIMESTAMPTZ,
  access_token                    TEXT,
  access_token_expires_at         TIMESTAMPTZ,

  -- Environment + marketplace. v1 ships sandbox-default until the
  -- production app key is approved. site_id is the eBay marketplace id —
  -- 'EBAY_US' for US, 'EBAY_GB' for UK, etc.
  environment                     ebay_environment NOT NULL DEFAULT 'sandbox',
  site_id                         TEXT NOT NULL DEFAULT 'EBAY_US',

  -- Sell Inventory API requires a merchant location key — the operator
  -- provisions one location per shop in eBay Seller Hub and we record the
  -- key here.
  merchant_location_key           TEXT,

  -- Sell Account policy ids. Required to publish.
  fulfillment_policy_id           TEXT,
  payment_policy_id               TEXT,
  return_policy_id                TEXT,

  connected_at                    TIMESTAMPTZ,
  disconnected_at                 TIMESTAMPTZ,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_ebay_credentials_user
  ON tenant_ebay_credentials(ebay_user_id)
  WHERE ebay_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tenant_ebay_credentials_updated_at ON tenant_ebay_credentials;
CREATE TRIGGER trg_tenant_ebay_credentials_updated_at
BEFORE UPDATE ON tenant_ebay_credentials
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  EBAY_LISTINGS — the publishing-layer row for an inventory item.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ebay_listings (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The local source-of-truth for what's being listed. RESTRICT so we
  -- never lose the link if someone soft-deletes the inventory row.
  inventory_item_id        UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,

  -- eBay-side identifiers, populated as the offer/listing progresses.
  -- Sell Inventory API: client creates an "offer" first (offerId), then
  -- publishes it which mints the actual listingId.
  ebay_offer_id            TEXT,
  ebay_listing_id          TEXT,
  -- eBay's SKU in the seller catalog. Usually mirrors inventory_items.sku
  -- so the Sell Inventory API "inventoryItem" call matches up cleanly.
  ebay_sku                 TEXT,

  -- Listing fields
  title                    TEXT NOT NULL,
  -- eBay condition id (e.g. '1000' = New, '3000' = Used). Stored as TEXT
  -- so we don't have to re-migrate when eBay adds new condition codes.
  condition_id             TEXT NOT NULL,
  -- eBay leaf category id (e.g. '281' for Jewelry > Fine Jewelry > Rings).
  category_id              TEXT NOT NULL,
  format                   ebay_listing_format NOT NULL DEFAULT 'FIXED_PRICE',
  list_price               NUMERIC(18,4) NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'USD',
  quantity                 INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),

  description              TEXT NOT NULL,
  marketing_message        TEXT,

  -- Public photo URLs eBay can fetch. eBay does NOT pull from private
  -- Supabase Storage signed URLs reliably (the URL must be publicly
  -- reachable for an extended TTL). Operator notes:
  --   * Either mirror the photos to a public bucket / CDN at publish time,
  --   * Or generate signed URLs with a 7-day TTL (eBay caches the image).
  -- v1 stores plain URLs and the publish step will be expected to upload
  -- to a public bucket; that helper ships in the follow-up wire-up.
  photo_urls               JSONB NOT NULL DEFAULT '[]'::jsonb,

  status                   ebay_listing_status NOT NULL DEFAULT 'draft',
  error_text               TEXT,

  -- Sync bookkeeping. Refreshed by the periodic cron and the manual sync
  -- button on the settings page.
  last_synced_at           TIMESTAMPTZ,
  view_count               INTEGER,
  watcher_count            INTEGER,

  -- Sale linkage. When an eBay buyer purchases the listing we book a row
  -- in `sales` (so the same reporting + register pipeline applies) and
  -- write the FK back here. NULL until the sale closes.
  sold_at                  TIMESTAMPTZ,
  sale_id                  UUID REFERENCES sales(id) ON DELETE SET NULL,

  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ
);

-- One eBay listing id can appear at most once per tenant when present.
-- (NULLs allowed — drafts haven't published yet.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ebay_listings_tenant_listing
  ON ebay_listings(tenant_id, ebay_listing_id)
  WHERE ebay_listing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ebay_listings_tenant_status_created
  ON ebay_listings(tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ebay_listings_tenant_inventory
  ON ebay_listings(tenant_id, inventory_item_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ebay_listings_tenant_sku
  ON ebay_listings(tenant_id, ebay_sku)
  WHERE ebay_sku IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ebay_listings_sale
  ON ebay_listings(sale_id)
  WHERE sale_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_ebay_listings_updated_at ON ebay_listings;
CREATE TRIGGER trg_ebay_listings_updated_at
BEFORE UPDATE ON ebay_listings
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  EBAY_LISTING_EVENTS — audit-trail of API calls (real or stubbed).
-- ───────────────────────────────────────────────────────────────────────────
--
-- Every time we attempt an eBay round-trip — create offer, publish, update,
-- end, sync, or receive a webhook — we write a row here with the would-be
-- request payload + the response we got back. STUBs in lib/ebay write a
-- synthetic response. Once the real client lands, the same writes happen
-- with real payloads.
--
-- READ-ONLY AFTER INSERT. Mistakes get corrected by writing a new row, not
-- by editing a previous one.

CREATE TABLE IF NOT EXISTS ebay_listing_events (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL allowed for events that don't bind to a single listing yet (e.g.
  -- a /commerce/identity/v1/user lookup at OAuth callback time). The UI
  -- panel filters on listing_id IS NOT NULL.
  listing_id          UUID REFERENCES ebay_listings(id) ON DELETE CASCADE,

  kind                ebay_listing_event_kind NOT NULL,
  request_payload     JSONB,
  response_payload    JSONB,
  http_status         INTEGER,
  error_text          TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ebay_listing_events_tenant_created
  ON ebay_listing_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ebay_listing_events_listing_created
  ON ebay_listing_events(listing_id, created_at DESC)
  WHERE listing_id IS NOT NULL;

-- Block UPDATE / DELETE on this table. Same shape as audit_log.
CREATE OR REPLACE FUNCTION prevent_ebay_listing_events_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ebay_listing_events is write-once. Rows cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ebay_listing_events_immutable ON ebay_listing_events;
CREATE TRIGGER trg_ebay_listing_events_immutable
BEFORE UPDATE OR DELETE ON ebay_listing_events
FOR EACH ROW EXECUTE FUNCTION prevent_ebay_listing_events_modification();

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_ebay_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_listings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_listing_events     ENABLE ROW LEVEL SECURITY;

-- ── tenant_ebay_credentials — staff read; owner/chain_admin write.
DROP POLICY IF EXISTS tenant_ebay_credentials_staff_read ON tenant_ebay_credentials;
CREATE POLICY tenant_ebay_credentials_staff_read ON tenant_ebay_credentials FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS tenant_ebay_credentials_owner_write ON tenant_ebay_credentials;
CREATE POLICY tenant_ebay_credentials_owner_write ON tenant_ebay_credentials FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager')
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager')
  );

-- ── ebay_listings — staff read+write.
DROP POLICY IF EXISTS ebay_listings_staff_read ON ebay_listings;
CREATE POLICY ebay_listings_staff_read ON ebay_listings FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS ebay_listings_staff_write ON ebay_listings;
CREATE POLICY ebay_listings_staff_write ON ebay_listings FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── ebay_listing_events — staff read; INSERT goes through the admin client
-- via the audit-style helper, so no tenant write policy here. (UPDATE/DELETE
-- already blocked by the immutability trigger.)
DROP POLICY IF EXISTS ebay_listing_events_staff_read ON ebay_listing_events;
CREATE POLICY ebay_listing_events_staff_read ON ebay_listing_events FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0015-ebay-listings.sql
-- ============================================================================
