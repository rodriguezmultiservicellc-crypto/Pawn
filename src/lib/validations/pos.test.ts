import { describe, expect, it } from 'vitest'
import { layawayCreateSchema, saleCreateSchema, taxExemptionOf } from './pos'

const item = { description: 'Ring', quantity: '1', unit_price: '200', line_discount: '0', position: '0' }
const sale = (over: Record<string, unknown>) =>
  saleCreateSchema.safeParse({ tax_rate: '0', discount_amount: '0', items: [item], ...over })

describe('a tax-exempt sale (patches/0097)', () => {
  it('needs a reason', () => {
    expect(sale({ tax_mode: 'exempt' }).success).toBe(false)
    expect(sale({ tax_mode: 'exempt', tax_exempt_reason: '' }).success).toBe(false)
    expect(sale({ tax_mode: 'exempt', tax_exempt_reason: 'because' }).success).toBe(false)
  })

  it('keeps the reason, and the certificate trimmed', () => {
    const r = sale({ tax_mode: 'exempt', tax_exempt_reason: 'resale', tax_exempt_certificate: '  85-801  ' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(taxExemptionOf(r.data)).toEqual({ reason: 'resale', certificate: '85-801' })
  })

  it('takes an empty certificate as none', () => {
    const r = sale({ tax_mode: 'exempt', tax_exempt_reason: 'government', tax_exempt_certificate: '   ' })
    expect(r.success && taxExemptionOf(r.data)).toEqual({ reason: 'government', certificate: null })
  })

  it('refuses a certificate longer than the column allows', () => {
    expect(
      sale({ tax_mode: 'exempt', tax_exempt_reason: 'other', tax_exempt_certificate: 'x'.repeat(61) }).success,
    ).toBe(false)
  })

  it('refuses an exemption on a taxed sale', () => {
    expect(sale({ tax_mode: 'shop', tax_exempt_reason: 'resale' }).success).toBe(false)
    expect(sale({ tax_mode: 'flat', tax_exempt_certificate: '85-801' }).success).toBe(false)
  })

  it('leaves a taxed sale as it was: no exemption', () => {
    const r = sale({ tax_mode: 'shop' })
    expect(r.success && taxExemptionOf(r.data)).toBe(null)
    // Absent mode is still 'flat' — what every caller sent before 0095.
    const old = sale({})
    expect(old.success && old.data.tax_mode).toBe('flat')
  })

  it('applies to a layaway the same way', () => {
    const base = {
      customer_id: '3f0e8b9e-6c59-4b55-9d0f-0d4f1b9a5a11',
      tax_rate: '0',
      discount_amount: '0',
      items: [item],
    }
    expect(layawayCreateSchema.safeParse({ ...base, tax_mode: 'exempt' }).success).toBe(false)
    const ok = layawayCreateSchema.safeParse({ ...base, tax_mode: 'exempt', tax_exempt_reason: 'organization' })
    expect(ok.success && taxExemptionOf(ok.data)).toEqual({ reason: 'organization', certificate: null })
  })
})
