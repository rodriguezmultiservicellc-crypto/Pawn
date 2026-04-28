-- patches/0016-saas-dunning-message-kinds.sql
--
-- Phase 9 (A) chunk 5 — extend the message_kind enum so SaaS dunning
-- emails can be logged in message_log alongside tenant→customer comms.
-- These kinds are PLATFORM→TENANT-OWNER messages (RMS reaching out to a
-- tenant about their subscription state), distinct from the existing
-- kinds which are TENANT→CUSTOMER.
--
-- New kinds:
--   saas_trial_ending      — trial_will_end webhook (fires ~3 days out)
--   saas_payment_failed    — invoice.payment_failed webhook
--   saas_payment_recovered — invoice.paid AFTER a previous payment_failed
--   saas_subscription_cancelled — subscription.deleted webhook
--
-- Idempotent: ADD VALUE IF NOT EXISTS lets us re-run without erroring.
-- Postgres requires ADD VALUE outside a transaction; supabase-js applies
-- migration files statement-by-statement, so this works.

ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'saas_trial_ending';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'saas_payment_failed';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'saas_payment_recovered';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'saas_subscription_cancelled';
