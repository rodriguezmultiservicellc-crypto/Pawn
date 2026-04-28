# Pawn

Multi-tenant SaaS for pawn / jewelry / repair / retail shops, built by
Rodriguez Multi Service LLC.

Surfaces: pawn loans (gated per tenant), repair / stone setting, retail
POS (Stripe Terminal + Payment Links), customer portal, FL LeadsOnline
police-report exporter, per-tenant Stripe Connect billing, platform-level
SaaS billing with three plan tiers.

## Quickstart

```bash
npm install
npm run dev          # dev-watchdog → http://localhost:3060
```

Sister apps run alongside on different ports:

- Luna Azul Web SaaS — `:3000`
- Abacus            — `:3030`
- **Pawn**          — `:3060`

Never kill node processes by image name; always by PID — you'll knock
out the wrong app.

## Scripts

```bash
npm run dev          # dev-watchdog → :3060 (4 GB heap, 25-min recycle)
npm run dev:raw      # raw next dev :3060 (escape hatch)
npm run build        # production build
npm run start        # next start :3060
npm run lint
npm run db:types     # safe wrapper — write to tmp, atomic rename
npm run seed
node scripts/apply-migration.mjs patches/<NNNN>-<name>.sql
```

## Project structure

See [CLAUDE.md](CLAUDE.md) for the full architecture, role model,
phase plan, and gotchas. Highlights:

- Next.js 16 (App Router, TypeScript strict, Turbopack)
- Tailwind v4 with `@theme` tokens — design system documented in
  [DESIGN-airbnb.md](DESIGN-airbnb.md)
- Supabase (Postgres + Auth + Storage), RLS on every tenant-scoped table
- Stripe Connect per tenant + platform-level SaaS subscriptions
- Anthropic Claude API for AI-assisted copy (server-side only)
- Bilingual EN + ES on every customer-facing surface

## Environment

Copy `.env.local.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server-only — never put in `NEXT_PUBLIC_*`)
- `DATABASE_URL` (Supavisor pooler URL, not direct DB host)
- `ANTHROPIC_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SAAS_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `RESEND_PLATFORM_FROM_EMAIL`,
  `RESEND_PLATFORM_FROM_NAME`
- `CRON_SECRET` (required — cron routes reject anything without
  `Authorization: Bearer ${CRON_SECRET}`)
- `NEXT_PUBLIC_APP_URL`

Per-tenant Twilio / Resend / Stripe Connect creds live in the database
(`settings` + `tenant_billing_settings`), not env, so config changes
don't need redeploys.

## Session log

Each working session writes a checkpoint to [Progress.txt](Progress.txt)
and commits + pushes. The RESUME HERE block at the top is the
single-source-of-truth for "where did we leave off."

## License

Proprietary. © Rodriguez Multi Service LLC.
