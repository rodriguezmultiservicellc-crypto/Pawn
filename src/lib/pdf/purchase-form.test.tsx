import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { registerPdfFonts } from './fonts'
import PawnTicketPDF, { type PawnTicketData } from './PawnTicketPDF'
import { purchaseItemFromSnapshot } from './purchase-items'

describe('purchaseItemFromSnapshot', () => {
  it('prints the price paid as the Amount', () => {
    const it = purchaseItemFromSnapshot({ description: '14K chain', category: 'chain', payout: 250, est_value: 300 })
    expect(it.est_value).toBe(250)
  })
  it('keeps an older buy serial number as the general serial', () => {
    const it = purchaseItemFromSnapshot({ description: 'Watch', category: 'watch', serial_number: 'SN1', payout: 10 })
    expect(it.general_serial).toBe('SN1')
  })
  it('does not double a serial the item already carries', () => {
    const it = purchaseItemFromSnapshot({ description: 'Watch', jewelry_serial: 'J1', serial_number: 'J1', payout: 10 })
    expect(it.jewelry_serial).toBe('J1')
    expect(it.general_serial).toBeNull()
  })
  it('reads numbers saved as text', () => {
    const it = purchaseItemFromSnapshot({ description: 'Ring', karat: '14', weight_grams: '3.2', payout: '99.5' })
    expect(it.karat).toBe(14)
    expect(it.weight_grams).toBe(3.2)
    expect(it.est_value).toBe(99.5)
  })
})

// Renders a sample purchase and pawn so the sheet can be looked at:
// PURCHASE_PDF_OUT=<dir> npx vitest run src/lib/pdf/purchase-form.test.tsx
const OUT = process.env.PURCHASE_PDF_OUT
describe.runIf(!!OUT)('purchase form (render)', () => {
  it('renders', async () => {
    registerPdfFonts()
    const base: PawnTicketData = {
      transaction: 'purchase',
      ticket_number: 'BT-021668',
      status: 'active',
      principal: 350,
      issue_date: '2026-11-25',
      due_date: '',
      total_interest_at_term: 0,
      total_payoff_at_term: 0,
      apr: 0,
      transaction_time: '3:15 PM',
      default_date: '',
      amount_at_default: 0,
      jurisdiction_name: 'Florida',
      customer: {
        first_name: 'Test', last_name: 'Seller', middle_name: null, sex: 'M', race: 'W',
        height_inches: 70, weight_lbs: 180, eye_color: 'BRO', hair_color: 'BLK', identifying_marks: null,
        place_of_employment: 'Self', phone_alt: null, date_of_birth: '1980-01-01', address1: '1 Main St',
        address2: null, city: 'Tampa', state: 'FL', zip: '33607', phone: '8135550100', id_type: 'drivers_license',
        id_number: 'S123-456-80-001-0', id_state: 'FL',
      },
      tenant: { name: 'Test Jewelers', dba: null, address: '1 Columbus Dr', city: 'Tampa', state: 'FL', zip: '33607', phone: '813-555-0101' },
      collateral: [
        purchaseItemFromSnapshot({ description: '14K yellow gold rope chain 22 in', category: 'chain', metal_type: 'gold', karat: 14, weight_grams: 12.4, payout: 300 }),
        purchaseItemFromSnapshot({ description: 'Sterling silver ring', category: 'ring', metal_type: 'silver', weight_grams: 4, payout: 50 }),
      ],
      signatureImage: null,
      i18n: { en, es },
      backpage_text: '',
      legal_notices: [
        { bold: false, en: 'If you pay off your loan early you will not be entitled to a refund of part of the finance charge.', es: 'x', pawn_only: true },
        { bold: true, en: 'The pledgor or seller represents and warrants that the goods are not stolen.', es: 'El vendedor declara.' },
        { bold: false, en: 'Any personal property pledged to a pawnbroker within this state which is not redeemed ...', es: 'x', pawn_only: true },
        { bold: false, en: 'Any person who knowingly gives false verification of ownership ... commits a felony.', es: 'Toda persona ...' },
      ],
      spanish_copy: true,
      spanish_only: false,
    }
    const buf = await renderToBuffer(<PawnTicketPDF data={base} />)
    writeFileSync(`${OUT}/purchase.pdf`, buf)
    const pawn = await renderToBuffer(
      <PawnTicketPDF data={{ ...base, transaction: 'pawn', ticket_number: 'PT-015700', due_date: '2026-12-25', default_date: '2027-01-25', spanish_copy: false }} />,
    )
    writeFileSync(`${OUT}/pawn.pdf`, pawn)
    expect(buf.length).toBeGreaterThan(1000)
  }, 60000)
})
