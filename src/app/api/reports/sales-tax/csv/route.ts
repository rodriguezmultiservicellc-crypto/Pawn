import { guardReportRequest } from '@/lib/reports/api-guard'
import { getSalesTaxReport } from '@/lib/reports/sales-tax'
import { salesTaxCsvRows, type SalesTaxCsvRow } from '@/lib/reports/sales-tax-export'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// One row per sale / return / void and tax line — see salesTaxCsvRows().
const COLUMNS: ReadonlyArray<CsvColumn<SalesTaxCsvRow>> = [
  { header: 'type', value: 'type' },
  { header: 'date', value: 'date' },
  { header: 'number', value: 'number' },
  { header: 'sale_number', value: 'sale_number' },
  { header: 'tenant_id', value: 'tenant_id' },
  { header: 'customer_name', value: 'customer_name' },
  { header: 'tax_line', value: 'tax_line' },
  { header: 'rate', value: 'rate' },
  { header: 'amount', value: 'amount' },
  { header: 'tax', value: 'tax' },
  { header: 'exempt_reason', value: 'exempt_reason' },
  { header: 'certificate', value: 'certificate' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const report = await getSalesTaxReport({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  const rows = salesTaxCsvRows(report)
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'sales',
    recordId: guarded.tenantId,
    changes: {
      report: 'sales-tax',
      format: 'csv',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: rows.length,
    },
  })
  return csvResponse(`sales-tax-${guarded.range.from}_to_${guarded.range.to}.csv`, rowsToCsv(rows, COLUMNS))
}
