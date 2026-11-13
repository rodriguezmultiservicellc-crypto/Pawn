/** Badge tone per online order status (semantic colors only). */
export const ORDER_STATUS_TONE: Record<string, string> = {
  pending_payment: 'border-border bg-background text-muted',
  expired: 'border-border bg-background text-muted',
  cancelled: 'border-border bg-background text-muted',
  paid: 'border-info/30 bg-info/10 text-info',
  picking: 'border-warning/30 bg-warning/10 text-warning',
  ready: 'border-success/30 bg-success/10 text-success',
  shipped: 'border-info/30 bg-info/10 text-info',
  completed: 'border-success/30 bg-success/10 text-success',
  needs_refund: 'border-danger/30 bg-danger/10 text-danger',
}
