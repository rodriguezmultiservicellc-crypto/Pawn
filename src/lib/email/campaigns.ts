/**
 * Email campaigns — segmentation, recipient snapshotting, dispatch.
 *
 * The campaign engine has three phases:
 *
 *   1. authoring (operator-driven)
 *      Server actions create / update an email_campaigns row with status
 *      = 'draft'. Body, segment criteria, scheduled_at can change freely.
 *
 *   2. scheduling (operator-driven)
 *      Operator clicks "Schedule" → status flips to 'scheduled'. THIS
 *      step calls `snapshotRecipients(campaignId)`, which resolves the
 *      segment criteria into a static list of email_campaign_recipients
 *      rows (status='queued'). After this point, edits to customer
 *      records do NOT change the audience.
 *
 *   3. dispatch (cron-driven)
 *      `/api/cron/send-email-campaigns` picks up campaigns where
 *      status='scheduled' AND scheduled_at <= NOW(), flips them to
 *      'sending', then calls `dispatchCampaign(campaignId)` which
 *      iterates queued recipients, sends via Resend, and updates per-
 *      recipient outcome. Campaign closes with status='sent' regardless
 *      of individual outcomes — partial failures live on the recipient
 *      rows.
 *
 * All writes go through the admin client. Server actions / cron route
 * gate access at their own boundary.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from './send'
import { renderEmailTemplate } from '@/lib/comms/render'
import type { Database } from '@/types/database'

type CampaignRow = Database['public']['Tables']['email_campaigns']['Row']
type RecipientInsert =
  Database['public']['Tables']['email_campaign_recipients']['Insert']
type CustomerLite = {
  id: string
  email: string | null
  language: string
  email_unsubscribe_token: string | null
}

const RECIPIENT_BATCH_SIZE = 500
const DISPATCH_BATCH_SIZE = 25 // Resend free tier: 100/sec; we go gentler.

/**
 * Resolve segment criteria → list of eligible customers. Static query;
 * caller is responsible for snapshotting the result into the recipients
 * table.
 *
 * Filters always applied:
 *   - tenant_id = campaign.tenant_id
 *   - deleted_at IS NULL
 *   - is_banned = FALSE
 *   - email IS NOT NULL AND email != ''
 *
 * Conditional filters:
 *   - language matches `segment_language` if set (else both en + es)
 *   - marketing_opt_in = TRUE if `segment_marketing_opt_in_only`
 *   - tags && `segment_tags` (PG array overlap) if non-empty
 */
export async function resolveSegment(args: {
  tenantId: string
  segmentLanguage: string | null
  segmentTags: string[]
  segmentMarketingOptInOnly: boolean
}): Promise<CustomerLite[]> {
  const admin = createAdminClient()

  let query = admin
    .from('customers')
    .select('id, email, language, email_unsubscribe_token')
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
    .eq('is_banned', false)
    .not('email', 'is', null)
    .neq('email', '')

  if (args.segmentLanguage) {
    query = query.eq('language', args.segmentLanguage)
  }
  if (args.segmentMarketingOptInOnly) {
    query = query.eq('marketing_opt_in', true)
  }
  if (args.segmentTags.length > 0) {
    query = query.overlaps('tags', args.segmentTags)
  }

  // Pull in batches to avoid Supabase's 1000-row default limit.
  const out: CustomerLite[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await query.range(
      offset,
      offset + RECIPIENT_BATCH_SIZE - 1,
    )
    if (error) {
      throw new Error(`resolveSegment: ${error.message}`)
    }
    const rows = (data ?? []) as CustomerLite[]
    out.push(...rows)
    if (rows.length < RECIPIENT_BATCH_SIZE) break
    offset += RECIPIENT_BATCH_SIZE
  }
  return out
}

/**
 * Snapshot the segment into email_campaign_recipients (status='queued')
 * and update the campaign's recipient_count. Idempotent: if a recipient
 * row already exists for (campaign_id, customer_id), the UNIQUE
 * constraint silently dedupes via ON CONFLICT.
 *
 * Also lazy-generates email_unsubscribe_token for any customer that
 * doesn't have one yet, so /unsubscribe links can resolve.
 */
export async function snapshotRecipients(
  campaign: CampaignRow,
): Promise<{ count: number }> {
  const admin = createAdminClient()

  const customers = await resolveSegment({
    tenantId: campaign.tenant_id,
    segmentLanguage: campaign.segment_language,
    segmentTags: campaign.segment_tags,
    segmentMarketingOptInOnly: campaign.segment_marketing_opt_in_only,
  })

  // Lazy-generate unsubscribe tokens for any customer missing one. Doing
  // this here (not at send time) means the token is durable from the
  // moment a customer enters any campaign audience — they'll get the
  // same link across multiple campaigns.
  const tokenless = customers.filter((c) => !c.email_unsubscribe_token)
  for (const c of tokenless) {
    const token = randomUUID()
    const { error } = await admin
      .from('customers')
      .update({ email_unsubscribe_token: token })
      .eq('id', c.id)
      .is('email_unsubscribe_token', null) // race-safe: another caller may have set it
    if (!error) c.email_unsubscribe_token = token
  }

  if (customers.length === 0) {
    await admin
      .from('email_campaigns')
      .update({ recipient_count: 0 })
      .eq('id', campaign.id)
    return { count: 0 }
  }

  // Bulk insert in batches; ON CONFLICT dedupe handles re-runs.
  for (let i = 0; i < customers.length; i += RECIPIENT_BATCH_SIZE) {
    const slice = customers.slice(i, i + RECIPIENT_BATCH_SIZE)
    const rows: RecipientInsert[] = slice.map((c) => ({
      campaign_id: campaign.id,
      tenant_id: campaign.tenant_id,
      customer_id: c.id,
      email: c.email ?? '', // already filtered to non-null/non-empty
      language: c.language === 'es' ? 'es' : 'en',
      status: 'queued',
    }))
    const { error } = await admin
      .from('email_campaign_recipients')
      .upsert(rows, {
        onConflict: 'campaign_id,customer_id',
        ignoreDuplicates: true,
      })
    if (error) {
      throw new Error(`snapshotRecipients insert: ${error.message}`)
    }
  }

  await admin
    .from('email_campaigns')
    .update({ recipient_count: customers.length })
    .eq('id', campaign.id)

  return { count: customers.length }
}

/**
 * Iterate queued recipients and send each via the existing Resend
 * wrapper. Updates per-recipient outcome rows. Never throws on a
 * single-recipient failure — only propagates if a structural error
 * (e.g., campaign row vanished) occurs.
 *
 * Returns a summary the caller (cron route) can include in its audit.
 */
export async function dispatchCampaign(
  campaign: CampaignRow,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const admin = createAdminClient()

  let sent = 0
  let failed = 0
  let skipped = 0

  for (;;) {
    const { data: batch, error } = await admin
      .from('email_campaign_recipients')
      .select('id, customer_id, email, language')
      .eq('campaign_id', campaign.id)
      .eq('status', 'queued')
      .limit(DISPATCH_BATCH_SIZE)

    if (error) {
      throw new Error(`dispatchCampaign batch select: ${error.message}`)
    }
    const rows = batch ?? []
    if (rows.length === 0) break

    for (const row of rows) {
      // Re-check unsubscribe state at send time. Operator may have flipped
      // marketing_opt_in between snapshot and send; respecting the latest
      // state matters for compliance. Skip + log; never charge Resend.
      const { data: customer } = await admin
        .from('customers')
        .select('marketing_opt_in, email, first_name, email_unsubscribe_token')
        .eq('id', row.customer_id)
        .maybeSingle()

      if (
        !customer ||
        !customer.email ||
        (campaign.segment_marketing_opt_in_only && !customer.marketing_opt_in)
      ) {
        await admin
          .from('email_campaign_recipients')
          .update({
            status: 'skipped',
            failed_at: new Date().toISOString(),
            failure_reason: customer?.email
              ? 'unsubscribed_between_snapshot_and_send'
              : 'no_email',
          })
          .eq('id', row.id)
        skipped++
        continue
      }

      const unsubscribeUrl = customer.email_unsubscribe_token
        ? buildUnsubscribeUrl(customer.email_unsubscribe_token)
        : ''

      const rendered = renderEmailTemplate({
        subject: campaign.subject,
        body: campaign.body_text,
        vars: {
          customer_first_name: customer.first_name ?? '',
          unsubscribe_url: unsubscribeUrl,
        },
      })
      // body_html honors operator's HTML directly (escaping is operator's
      // responsibility — this is a marketing surface, not user-generated).
      const renderedHtml = renderEmailTemplate({
        subject: campaign.subject,
        body: campaign.body_html,
        vars: {
          customer_first_name: customer.first_name ?? '',
          unsubscribe_url: unsubscribeUrl,
        },
      })

      const result = await sendEmail({
        tenantId: campaign.tenant_id,
        to: customer.email,
        subject: rendered.subject,
        html: renderedHtml.text || renderedHtml.html, // operator-authored HTML wins
        text: rendered.text,
        kind: 'email_campaign',
        customerId: row.customer_id,
      })

      if (result.ok) {
        await admin
          .from('email_campaign_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            message_log_id: result.messageLogId,
            resend_message_id: result.providerId,
          })
          .eq('id', row.id)
        sent++
      } else {
        await admin
          .from('email_campaign_recipients')
          .update({
            status: 'failed',
            failed_at: new Date().toISOString(),
            failure_reason: result.error ?? result.reason,
            message_log_id: result.messageLogId,
          })
          .eq('id', row.id)
        failed++
      }
    }
  }

  return { sent, failed, skipped }
}

/**
 * Build the public unsubscribe URL for a token. The token is the only
 * thing that appears in the URL — no tenant_id, no customer_id, no
 * email. The /unsubscribe page does the reverse-lookup server-side.
 */
export function buildUnsubscribeUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? ''
  if (!base) return `/unsubscribe?t=${encodeURIComponent(token)}`
  return `${base.replace(/\/+$/, '')}/unsubscribe?t=${encodeURIComponent(token)}`
}

/**
 * Recompute the materialized counts on email_campaigns from per-recipient
 * state. Called after a dispatch run finishes (or a webhook updates a
 * recipient's status). Cheap query — one row per campaign × recipient.
 */
export async function recomputeAggregates(campaignId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('email_campaign_recipients')
    .select('status')
    .eq('campaign_id', campaignId)
  const counts = {
    delivered_count: 0,
    bounced_count: 0,
    complained_count: 0,
    failed_count: 0,
  }
  for (const r of rows ?? []) {
    if (r.status === 'delivered' || r.status === 'sent') counts.delivered_count++
    if (r.status === 'bounced') counts.bounced_count++
    if (r.status === 'complained') counts.complained_count++
    if (r.status === 'failed' || r.status === 'skipped') counts.failed_count++
  }
  await admin.from('email_campaigns').update(counts).eq('id', campaignId)
}

/**
 * Pick the next campaign for the cron route to act on. Resumes any
 * 'sending' campaign first (in case a previous run timed out mid-
 * dispatch); falls back to 'scheduled' campaigns whose scheduled_at
 * has elapsed. Returns null if no work is due.
 */
export async function pickNextCampaign(): Promise<CampaignRow | null> {
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: resuming } = await admin
    .from('email_campaigns')
    .select('*')
    .eq('status', 'sending')
    .is('deleted_at', null)
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle<CampaignRow>()
  if (resuming) return resuming

  const { data: starting } = await admin
    .from('email_campaigns')
    .select('*')
    .eq('status', 'scheduled')
    .is('deleted_at', null)
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle<CampaignRow>()
  return (starting as CampaignRow | null) ?? null
}
