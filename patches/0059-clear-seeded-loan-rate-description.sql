-- ───────────────────────────────────────────────────────────────────────────
-- 0059 — Remove developer text from the seeded default loan rate
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0058.
--           Append-only — never edit prior migrations.
--
-- 0021 seeded every tenant's default 10%/mo rate with the description
-- "Default rate seeded by migration 0021. Edit at /settings/loan-rates."
-- tenant_loan_rates.description renders under the rate picker on
-- /pawn/new, so staff were reading a migration note. Clearing it lets the
-- form fall back to its translated "Manage rates in Settings" hint.
--
-- Scoped to the exact seed text so an operator-written description is
-- never touched. The jurisdiction trigger (0048) fires only on
-- rate_monthly / min_monthly_charge / is_active, so this is inert to it.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE tenant_loan_rates
SET description = NULL,
    updated_at  = NOW()
WHERE description = 'Default rate seeded by migration 0021. Edit at /settings/loan-rates.';
