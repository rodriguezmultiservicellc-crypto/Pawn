-- 0118 — Move a New repair ticket to another device with a QR code (Eddy,
-- 2026-11-26: "do the same as pawn ... the new repairs").
--
-- A repair intake travels the way a pawn one does (patches/0045 + 0117): the
-- computer saves it as a draft, shows a QR code for
-- /repair/new?draft=<id>&handoff=<code>, and the device that opens it CLAIMS
-- the draft; the computer sees the claim and closes its copy. Same columns,
-- same rules (src/lib/pawn/draft-handoff.ts takes the table name).
--
-- A draft is NOT a repair ticket: no ticket number, no events, no photos.
-- Opening the ticket runs createRepairTicketAction as usual and soft-deletes
-- the draft.
--
-- NEW table, NEW policies (Eddy approved them 2026-11-26). They mirror
-- loan_drafts / repair_tickets exactly: staff of the shop read + write their
-- own shop's drafts. No existing policy is changed.

CREATE TABLE IF NOT EXISTS repair_drafts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- The New repair form as it was (src/lib/repair/draft-payload.ts):
  --   { line_items: [...], stones: [...], promised_date, assigned_to,
  --     notes_internal, est_labor, est_materials, est_deposit }
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,

  handoff_token_hash  TEXT,
  handoff_expires_at  TIMESTAMPTZ,
  handoff_claimed_at  TIMESTAMPTZ,
  handoff_claimed_by  UUID REFERENCES auth.users(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id)
);

COMMENT ON COLUMN repair_drafts.handoff_token_hash IS
  'SHA-256 (hex) of the one-time code in the QR handoff link; NULL when no handoff is waiting.';
COMMENT ON COLUMN repair_drafts.handoff_claimed_at IS
  'When another device opened the draft through the QR code; the device that showed the code closes its copy.';

CREATE INDEX IF NOT EXISTS idx_repair_drafts_tenant
  ON repair_drafts(tenant_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_repair_drafts_customer
  ON repair_drafts(customer_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_repair_drafts_updated_at ON repair_drafts;
CREATE TRIGGER trg_repair_drafts_updated_at BEFORE UPDATE ON repair_drafts
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE repair_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repair_drafts_staff_read ON repair_drafts;
CREATE POLICY repair_drafts_staff_read ON repair_drafts FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS repair_drafts_staff_write ON repair_drafts;
CREATE POLICY repair_drafts_staff_write ON repair_drafts FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

NOTIFY pgrst, 'reload schema';
