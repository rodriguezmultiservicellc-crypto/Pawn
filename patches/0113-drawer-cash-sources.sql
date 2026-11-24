-- 0113 — Every cash movement the drawer close counts has a record it can
-- read.
--
-- Closing the register works out "expected cash" (src/lib/pos/drawer-cash.ts,
-- one drawer open at a time — Eddy, 2026-11-24). Until now it added up POS
-- sales only, and two kinds of cash had no record that says how they were
-- paid:
--
--   repair_ticket_events.payment_method   set on the "Collect deposit" and
--                                         pickup events (the method lived
--                                         only in the note text / audit row).
--                                         NULL on every other event — an
--                                         'approved' event carries the quote
--                                         amount, which is not money taken.
--
--   buy_payouts                           one row per tender paid to a
--                                         seller on a buy (a mixed payout is
--                                         two rows: cash + transfer). A buy
--                                         had no tender record of its own —
--                                         only the audit row's JSON.
--
-- No existing rows to fill: no repair deposit, pickup or buy has been taken
-- in Pawn yet (checked live 2026-11-24).
--
-- buy_payouts is append-only. Staff may READ their shop's rows; nobody
-- writes from the browser — the buy action writes them with the service
-- client after its role check (CLAUDE.md rule 10), as consignment_payouts
-- is written only by its function (patches/0054). No existing policy is
-- touched.

ALTER TABLE repair_ticket_events
  ADD COLUMN IF NOT EXISTS payment_method payment_method;

COMMENT ON COLUMN repair_ticket_events.payment_method IS
  'How the money on this event was paid — set only on deposit and pickup events (money taken). NULL elsewhere.';

CREATE INDEX IF NOT EXISTS idx_repair_ticket_events_cash
  ON repair_ticket_events (tenant_id, occurred_at)
  WHERE payment_method IS NOT NULL;

CREATE TABLE IF NOT EXISTS buy_payouts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  -- The buy's police-report row: the record a buy is known by.
  compliance_log_id UUID REFERENCES compliance_log(id) ON DELETE RESTRICT,
  -- The first item's SKU, as the buy is numbered on screen and in the export.
  reference_number TEXT,
  payout_method    payment_method NOT NULL,
  amount           NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_by          UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE buy_payouts IS
  'What a seller was paid on a buy, one row per tender. Append-only; written by the buy action (service client after its role check). Read by the drawer close.';

CREATE INDEX IF NOT EXISTS idx_buy_payouts_tenant_paid
  ON buy_payouts (tenant_id, paid_at DESC);

ALTER TABLE buy_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buy_payouts_staff_read ON buy_payouts;
CREATE POLICY buy_payouts_staff_read ON buy_payouts FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

NOTIFY pgrst, 'reload schema';
