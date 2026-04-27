/**
 * Server-side renderer for a generic report PDF. Each report API route
 * builds the column descriptor + rows and hands them to renderReportPdf().
 */

import { renderToBuffer } from '@react-pdf/renderer'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import ReportPDF, { type ReportPdfData } from './ReportPDF'

export async function renderReportPdf<Row>(
  data: ReportPdfData<Row>,
): Promise<Buffer> {
  registerPdfFonts()
  return renderToBuffer(<ReportPDF data={data} />)
}
