-- ───────────────────────────────────────────────────────────────────────────
-- 0066 — bench calculators: recent calculations per user
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0065 has already run.
--           Append-only — never edit prior migrations.
--
-- Sol Pawn brief, Phase 4.1 — "Bench calculators page: pure calculators,
-- no database writes, except saving recent calculations per user."
--
-- This is the ONLY write the /tools page makes. One row per saved
-- calculation: which calculator, the inputs and the result as JSON, who
-- saved it, in which shop. Tenant-scoped like every other table, and
-- additionally scoped to the user: staff see their own rows only.
-- Nothing else reads this table; it is a per-user convenience, not a
-- ledger, so hard DELETE by the owner is allowed (CLAUDE.md rule 2 is
-- about financial records; this is scratch paper).
-- ============================================================================

CREATE TABLE IF NOT EXISTS bench_calculations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'ring_size' | 'weight' | 'alloy_down' | 'raise_karat' | 'mix_lots' | 'melt'
  calculator  TEXT NOT NULL CHECK (calculator IN
                ('ring_size','weight','alloy_down','raise_karat','mix_lots','melt')),
  label       TEXT NOT NULL CHECK (char_length(label) <= 200),
  inputs      JSONB NOT NULL DEFAULT '{}'::jsonb,
  result      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bench_calculations_user_recent
  ON bench_calculations (tenant_id, user_id, created_at DESC);

COMMENT ON TABLE bench_calculations IS
  'Per-user "recent calculations" for the /tools bench calculators (brief Phase 4.1). Scratch paper, not a ledger.';

ALTER TABLE bench_calculations ENABLE ROW LEVEL SECURITY;

-- Own rows only, and only as staff of that tenant.
DROP POLICY IF EXISTS bench_calculations_own_read ON bench_calculations;
CREATE POLICY bench_calculations_own_read ON bench_calculations FOR SELECT
  USING (user_id = auth.uid() AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS bench_calculations_own_write ON bench_calculations;
CREATE POLICY bench_calculations_own_write ON bench_calculations FOR ALL
  USING (user_id = auth.uid() AND my_is_staff(tenant_id))
  WITH CHECK (user_id = auth.uid() AND my_is_staff(tenant_id));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0066-bench-calculations.sql
-- ============================================================================
