/**
 * Cron — process the next due email campaign.
 *
 * One campaign per run. The route:
 *   1. Picks the next campaign (resume any 'sending' first, else start
 *      the earliest 'scheduled' campaign whose scheduled_at <= now).
 *   2. If status='scheduled' and recipient_count=0, snapshots the
 *      segment into email_campaign_recipients, flips status='sending'.
 *   3. Dispatches queued recipients via Resend. If a previous run timed
 *      out mid-flight the queued ones simply pick up where they left off.
 *   4. When the queue is empty, flips status='sent', recomputes
 *      aggregate counts, audit-logs the run.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`. The `x-vercel-cron`
 *       header is NOT a security check.
 *
 * Recommended cadence: every 1–2 minutes during operating hours, hourly
 * off-hours. Configure in vercel.json. Each run is bounded by the
 * Resend dispatch loop's natural pace plus the segment-snapshot query;
 * if a single campaign exceeds the Vercel function timeout the
 * remaining queue is durable across runs.
 *
 * Idempotency: re-running while a campaign is in 'sending' resumes from
 * remaining queued recipients. Re-running after 'sent' is a no-op
 * (route only acts on 'scheduled' or 'sending').
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  dispatchCampaign,
  pickNextCampaign,
  recomputeAggregates,
  snapshotRecipients,
} from '@/lib/email/campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const ranAt = new Date().toISOString()
  const admin = createAdminClient()

  const campaign = await pickNextCampaign()
  if (!campaign) {
    return NextResponse.json({ ok: true, ran_at: ranAt, picked: null })
  }

  // Phase 1 → 2: snapshot + flip to sending if first run.
  if (campaign.status === 'scheduled') {
    try {
      const { count } = await snapshotRecipients(campaign)
      const { error: flipErr } = await admin
        .from('email_campaigns')
        .update({ status: 'sending' })
        .eq('id', campaign.id)
      if (flipErr) {
        return NextResponse.json(
          {
            ok: false,
            ran_at: ranAt,
            campaign_id: campaign.id,
            phase: 'flip_to_sending',
            error: flipErr.message,
          },
          { status: 502 },
        )
      }
      // If the segment yielded zero recipients, short-circuit straight to
      // 'sent'. No reason to spin another cron tick on an empty campaign.
      if (count === 0) {
        await admin
          .from('email_campaigns')
          .update({ status: 'sent', sent_at: ranAt })
          .eq('id', campaign.id)
        await logCampaignAudit({
          tenantId: campaign.tenant_id,
          campaignId: campaign.id,
          action: 'sent_empty',
          summary: { recipients: 0 },
          ranAt,
        })
        return NextResponse.json({
          ok: true,
          ran_at: ranAt,
          campaign_id: campaign.id,
          recipients: 0,
          status: 'sent',
        })
      }
      // Re-fetch to get the freshly-set 'sending' status for the dispatch
      // call — campaigns lib uses the row's status to log, not the param.
      campaign.status = 'sending'
    } catch (err) {
      const message = err instanceof Error ? err.message : 'snapshot_failed'
      return NextResponse.json(
        {
          ok: false,
          ran_at: ranAt,
          campaign_id: campaign.id,
          phase: 'snapshot',
          error: message,
        },
        { status: 502 },
      )
    }
  }

  // Phase 3: dispatch queued recipients. Each recipient is a Resend call;
  // the function returns when the queue is drained or it errors out
  // structurally. Per-recipient failures live on the recipient rows and
  // do not abort the loop.
  let dispatchSummary: { sent: number; failed: number; skipped: number }
  try {
    dispatchSummary = await dispatchCampaign(campaign)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'dispatch_failed'
    return NextResponse.json(
      {
        ok: false,
        ran_at: ranAt,
        campaign_id: campaign.id,
        phase: 'dispatch',
        error: message,
      },
      { status: 502 },
    )
  }

  // Phase 4: close campaign if no queued recipients remain.
  const { count: remainingQueued } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'queued')

  let finalStatus: string = 'sending'
  if ((remainingQueued ?? 0) === 0) {
    await admin
      .from('email_campaigns')
      .update({ status: 'sent', sent_at: ranAt })
      .eq('id', campaign.id)
    await recomputeAggregates(campaign.id)
    finalStatus = 'sent'
  }

  await logCampaignAudit({
    tenantId: campaign.tenant_id,
    campaignId: campaign.id,
    action: finalStatus === 'sent' ? 'sent' : 'dispatch_partial',
    summary: dispatchSummary,
    ranAt,
  })

  return NextResponse.json({
    ok: true,
    ran_at: ranAt,
    campaign_id: campaign.id,
    status: finalStatus,
    ...dispatchSummary,
    remaining_queued: remainingQueued ?? 0,
  })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

async function logCampaignAudit(args: {
  tenantId: string
  campaignId: string
  action: 'sent' | 'sent_empty' | 'dispatch_partial'
  summary: Record<string, unknown>
  ranAt: string
}): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('audit_log').insert({
    tenant_id: args.tenantId,
    user_id: null,
    action: 'email_campaign_dispatch',
    table_name: 'email_campaigns',
    record_id: args.campaignId,
    changes: {
      phase: args.action,
      ran_at: args.ranAt,
      ...args.summary,
    },
  })
  if (error) {
    console.error(
      '[cron:send-email-campaigns] audit insert failed',
      args.campaignId,
      error.message,
    )
  }
}
