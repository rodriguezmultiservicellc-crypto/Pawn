import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField } from 'pdf-lib'
import type { PdfFieldValues } from './types'

/** Where the blank forms live. Traced into the route's bundle by
 *  next.config.ts outputFileTracingIncludes ('/api/agency-forms/**'). */
const TEMPLATES = path.join(process.cwd(), 'src', 'lib', 'agency-forms', 'templates')

/**
 * Write the values into a blank agency PDF and return the bytes.
 *
 * - The XFA layer is removed: XFA viewers (Acrobat) show it instead of the
 *   AcroForm fields, and it would show the form empty.
 * - A dropdown the blank form ships with a junk value ("0") is set back to
 *   its first option ("Please select").
 * - A field name the PDF does not have is an error: the mapping is wrong,
 *   and a form missing a value it was meant to carry must not go out.
 * - A value longer than its box allows is REFUSED (ValueTooLongError), never
 *   cut: a cut EIN or phone number is a wrong one.
 */
export class ValueTooLongError extends Error {
  constructor(public readonly fields: string[]) {
    super(`agency_form_value_too_long:${fields.join(',')}`)
  }
}

export async function fillAgencyPdf(template: string, values: PdfFieldValues): Promise<Uint8Array> {
  const bytes = await readFile(path.join(TEMPLATES, template))
  const pdf = await PDFDocument.load(bytes)
  const form = pdf.getForm()
  form.deleteXFA()

  for (const field of form.getFields()) {
    if (field instanceof PDFDropdown) {
      const options = field.getOptions()
      const selected = field.getSelected()
      if (selected.length > 0 && !selected.every((v) => options.includes(v)) && options.length > 0) {
        field.select(options[0])
      }
    }
  }

  const tooLong: string[] = []
  for (const [name, value] of Object.entries(values.text)) {
    const f = form.getField(name)
    if (!(f instanceof PDFTextField)) throw new Error(`agency_form_field_not_text:${name}`)
    const max = f.getMaxLength()
    if (max && value.length > max) tooLong.push(name)
    else f.setText(value)
  }
  if (tooLong.length > 0) throw new ValueTooLongError(tooLong)
  for (const name of values.checks) {
    const f = form.getField(name)
    if (!(f instanceof PDFCheckBox)) throw new Error(`agency_form_field_not_checkbox:${name}`)
    f.check()
  }
  for (const [name, value] of Object.entries(values.choices)) {
    const f = form.getField(name)
    if (!(f instanceof PDFDropdown)) throw new Error(`agency_form_field_not_dropdown:${name}`)
    f.select(value)
  }

  return pdf.save()
}
