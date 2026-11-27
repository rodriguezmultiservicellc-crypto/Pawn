import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { REPAIR_PHOTOS_BUCKET, getSignedUrls } from '@/lib/supabase/storage'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { daysBetween } from '@/lib/pawn/math'
import { elapsedTimeMs } from '@/lib/repair/billing'
import { loadTechnicianOptions } from '@/lib/repair/technicians'
import { loadPartPickerOptions } from '@/lib/repair/part-options'
import type { RepairStatus, TenantRole } from '@/types/database-aliases'
import MyJobsContent, { type MyJobView } from './content'

/** Who works the bench. */
const TECH_ROLES = new Set<TenantRole>(['owner', 'manager', 'repair_tech', 'chain_admin'])
/** Who may look at another technician's jobs (read only). */
const LEAD_ROLES = new Set<TenantRole>(['owner', 'manager', 'chain_admin'])
/** A job on the bench: assigned to the tech and being worked. */
const BENCH_STATUSES: RepairStatus[] = ['assigned', 'in_progress', 'needs_parts', 'tech_qa']
const CLOSED: ReadonlySet<string> = new Set(['picked_up', 'abandoned', 'voided'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * /repair/my-jobs — the technician's page: the jobs on their bench with the
 * work to do and a Start / Stop timer each (one job at a time). Owners and
 * managers can look at any technician's list; only the technician runs
 * their own timer.
 */
export default async function MyJobsPage(props: {
  searchParams: Promise<{ tech?: string }>
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId || !ctx.userId) redirect('/no-tenant')
  if (!ctx.tenantRole || !TECH_ROLES.has(ctx.tenantRole)) redirect('/repair')
  const tenantId = ctx.tenantId

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair, timezone')
    .eq('id', tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')
  const shopToday = todayInTimezone(tenant.timezone)

  const canSeeOthers = LEAD_ROLES.has(ctx.tenantRole)
  const technicians = canSeeOthers ? await loadTechnicianOptions(ctx.supabase, tenantId) : []
  const { tech } = await props.searchParams
  const techId =
    canSeeOthers && tech && UUID.test(tech) && technicians.some((t) => t.id === tech)
      ? tech
      : ctx.userId
  const isMe = techId === ctx.userId

  // Every timer this tech ever ran on a ticket we show, plus any running now
  // (a running timer keeps its job on the list even if it was reassigned).
  const { data: runningLogs } = await ctx.supabase
    .from('repair_time_logs')
    .select('ticket_id')
    .eq('tenant_id', tenantId)
    .eq('technician_id', techId)
    .is('stopped_at', null)
  const runningTicketIds = [...new Set((runningLogs ?? []).map((l) => l.ticket_id))]

  const select =
    'id, ticket_number, title, status, promised_date, is_locked, created_at, customer:customers(first_name)'
  const [{ data: assigned }, { data: running }] = await Promise.all([
    ctx.supabase
      .from('repair_tickets')
      .select(select)
      .eq('tenant_id', tenantId)
      .eq('assigned_to', techId)
      .in('status', BENCH_STATUSES)
      .is('deleted_at', null)
      .limit(200),
    runningTicketIds.length
      ? ctx.supabase
          .from('repair_tickets')
          .select(select)
          .eq('tenant_id', tenantId)
          .in('id', runningTicketIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [] as never[] }),
  ])
  const byId = new Map<string, NonNullable<typeof assigned>[number]>()
  for (const t of [...(assigned ?? []), ...(running ?? [])]) byId.set(t.id, t)
  const tickets = [...byId.values()]
  const ids = tickets.map((t) => t.id)

  const [{ data: lineItems }, { data: photos }, { data: logs }, { data: parts }] = ids.length
    ? await Promise.all([
        ctx.supabase
          .from('repair_ticket_line_items')
          .select(
            'id, ticket_id, line_index, title, work_needed, karat, weight_grams, received_weight_grams, received_karat, received_at, final_weight_grams',
          )
          .eq('tenant_id', tenantId)
          .in('ticket_id', ids)
          .is('deleted_at', null)
          .order('line_index', { ascending: true }),
        ctx.supabase
          .from('repair_ticket_photos')
          .select('ticket_id, storage_path, position')
          .eq('tenant_id', tenantId)
          .in('ticket_id', ids)
          .eq('kind', 'intake')
          .is('deleted_at', null)
          .order('position', { ascending: true }),
        ctx.supabase
          .from('repair_time_logs')
          .select('id, ticket_id, started_at, stopped_at')
          .eq('tenant_id', tenantId)
          .eq('technician_id', techId)
          .in('ticket_id', ids),
        ctx.supabase
          .from('repair_ticket_items')
          .select('id, ticket_id, inventory_item_id, description, quantity, unit_cost, total_cost, notes')
          .eq('tenant_id', tenantId)
          .in('ticket_id', ids)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
  // Parts can be added from here (in stock or not, like solder).
  const partOptions = tickets.some((t) => !t.is_locked && !CLOSED.has(t.status))
    ? await loadPartPickerOptions(ctx.supabase, tenantId)
    : []

  // One photo per ticket: the first intake photo.
  const firstPhoto = new Map<string, string>()
  for (const p of photos ?? []) if (!firstPhoto.has(p.ticket_id)) firstPhoto.set(p.ticket_id, p.storage_path)
  const signed = await getSignedUrls({ bucket: REPAIR_PHOTOS_BUCKET, paths: [...firstPhoto.values()] })

  // A server component renders once per request: "now" is the request time.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const jobs: MyJobView[] = tickets.map((t) => {
    const mine = (logs ?? []).filter((l) => l.ticket_id === t.id)
    const run = mine.find((l) => l.stopped_at == null) ?? null
    const doneMs = elapsedTimeMs(mine.filter((l) => l.stopped_at != null), now)
    const path = firstPhoto.get(t.id)
    return {
      id: t.id,
      ticket_number: t.ticket_number ?? '',
      title: t.title,
      status: t.status as RepairStatus,
      customer_first_name: t.customer?.first_name ?? null,
      promised_date: t.promised_date,
      late_by: t.promised_date ? daysBetween(t.promised_date, shopToday) : null,
      items: (lineItems ?? [])
        .filter((li) => li.ticket_id === t.id)
        .map((li) => ({
          id: li.id,
          title: li.title,
          work_needed: li.work_needed,
          karat: li.karat,
          weight_grams: num(li.weight_grams),
          received_weight_grams: num(li.received_weight_grams),
          received_karat: li.received_karat,
          received_at: li.received_at,
          final_weight_grams: num(li.final_weight_grams),
        })),
      parts: (parts ?? [])
        .filter((pt) => pt.ticket_id === t.id)
        .map((pt) => ({
          id: pt.id,
          inventory_item_id: pt.inventory_item_id,
          description: pt.description,
          quantity: Number(pt.quantity ?? 0),
          unit_cost: Number(pt.unit_cost ?? 0),
          total_cost: Number(pt.total_cost ?? 0),
          notes: pt.notes,
        })),
      photo_url: path ? (signed.get(path) ?? null) : null,
      done_ms: doneMs,
      running: run ? { id: run.id, started_at: run.started_at } : null,
      closed: t.is_locked || CLOSED.has(t.status),
    }
  })

  // Running first, then the most urgent promise, then the oldest job.
  jobs.sort((a, b) => {
    if (!!a.running !== !!b.running) return a.running ? -1 : 1
    const la = a.late_by ?? -Infinity
    const lb = b.late_by ?? -Infinity
    if (la !== lb) return lb - la
    return a.ticket_number.localeCompare(b.ticket_number)
  })

  return (
    <MyJobsContent
      jobs={jobs}
      isMe={isMe}
      techId={techId}
      technicians={technicians}
      partOptions={partOptions}
      serverNow={now}
    />
  )
}

const num = (v: number | string | null): number | null => (v == null ? null : Number(v))
