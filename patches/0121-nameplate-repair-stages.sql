-- 0121 — Tracking stages for the new 'nameplate' service (0120) in every
-- existing shop. seed_default_repair_stages (patches/0061) loops over the
-- enum, so shops created from now on get them by themselves; it skips a shop
-- that already has stages for the type, so running this again does nothing.
-- Nameplates get the default stages (Received → Picked up); a shop can
-- rename them in Settings → Repair stages.

SELECT seed_default_repair_stages(t.id, 'nameplate'::service_type, FALSE)
FROM tenants t;
