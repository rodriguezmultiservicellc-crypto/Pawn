import { describe, expect, it } from 'vitest'
import {
  makeItemMapper,
  mapLoan,
  originalAmountFromNote,
  parseKarat,
  mapMetal,
  rateFromCharge,
  shopDate,
  weightGrams,
  type XRow,
} from './xpawn-loans'

const opts = { timezone: 'America/New_York', rateCap: 0.25, minChargeCap: 5 }

const ticket = (over: XRow = {}): XRow => ({
  'Ticket Key': 100,
  'Customer Key': 7,
  'Ticket No': 15664,
  'Ticket Type': 2,
  'Issue Date': '11/17/2026',
  'Due Date': '12/17/2026',
  Amount: 300,
  'Standard RE': 30,
  Status: 'A',
  Notes: '',
  OperatorInitials: 'ER',
  'Creation Timestamp': '2026-11-17T20:15:04.000Z',
  'Update Timestamp': '2026-11-17T20:15:04.000Z',
  'Pickup Customer Key': 0,
  ...over,
})

const payment = (over: XRow = {}): XRow => ({
  Key: 1,
  'Payment Type': 1,
  PaymentStatus: 'A',
  'Interest Charge Paid': 30,
  'Accumulated Charges Paid': 0,
  'Principal paid': 0,
  'Lost Ticket fee paid': 0,
  'Net Payment': 30,
  Cash: 30,
  Credits: 0,
  'Cred.Card': 0,
  'Payment Date': '2026-12-10T15:00:00.000Z',
  'Old Due Date': '2026-12-17T05:00:00.000Z',
  'New Due Date': '2027-01-17T05:00:00.000Z',
  OperatorInitials: 'MA',
  Note: '',
  ...over,
})

describe('shopDate', () => {
  it('reads the export text dates, spaces and trailing time included', () => {
    expect(shopDate('7/15/2004', 'America/New_York')).toBe('2004-07-15')
    expect(shopDate('9 /13/2004', 'America/New_York')).toBe('2004-09-13')
    expect(shopDate('2 /5 /2019', 'America/New_York')).toBe('2019-02-05')
    expect(shopDate('7/11/2013 1:22:48 PM', 'America/New_York')).toBe('2013-07-11')
  })
  it('takes the day of an instant in the shop timezone, not UTC', () => {
    // 03:30 UTC on the 16th is still the 15th in New York.
    expect(shopDate('2004-07-16T03:30:00.000Z', 'America/New_York')).toBe('2004-07-15')
    expect(shopDate('2004-09-16T04:00:00.000Z', 'America/New_York')).toBe('2004-09-16')
  })
  it('refuses junk', () => {
    expect(shopDate('', 'America/New_York')).toBeNull()
    expect(shopDate('13/40/2020', 'America/New_York')).toBeNull()
  })
})

describe('rateFromCharge', () => {
  it('keeps an exact rate', () => {
    expect(rateFromCharge(2, 300, 30, opts)).toEqual({ rate: 0.1, minCharge: null, note: null })
    expect(rateFromCharge(3, 200, 30, opts)).toEqual({ rate: 0.15, minCharge: null, note: null })
  })
  it('reads a minimum charge on a small loan as the type rate plus the minimum', () => {
    // $5 on $40 is 12.5% — not a rate: 10% would be $4, under the $5 minimum.
    expect(rateFromCharge(2, 40, 5, opts)).toEqual({ rate: 0.1, minCharge: 5, note: null })
    // $5 on $10 would be 50%, over the cap.
    expect(rateFromCharge(2, 10, 5, opts)).toEqual({ rate: 0.1, minCharge: 5, note: null })
  })
  it('caps a charge over the cap and keeps the old charge in a note', () => {
    const r = rateFromCharge(2, 500, 130, opts)
    expect(r.rate).toBe(0.25)
    expect(r.note).toBe('Old system charge per period: $130.00')
  })
  it('rounds a charge that is not a 4-decimal rate and says so', () => {
    const r = rateFromCharge(2, 300, 20, opts)
    expect(r.rate).toBe(0.0667)
    expect(r.note).toBe('Old system charge per period: $20.00')
  })
  it('gives rate 0 to a ticket with no charge', () => {
    expect(rateFromCharge(2, 150, 0, opts).rate).toBe(0)
  })
  it('does not invent a minimum where the jurisdiction has none', () => {
    const r = rateFromCharge(2, 40, 5, { rateCap: null, minChargeCap: null })
    expect(r).toEqual({ rate: 0.125, minCharge: null, note: null })
  })
})

describe('mapLoan', () => {
  it('skips buys, the test customer and tickets with no amount', () => {
    expect(mapLoan(ticket({ 'Ticket Type': 0 }), [], opts)).toEqual({ ok: false, reason: 'buy' })
    expect(mapLoan(ticket(), [], { ...opts, skipCustomerKeys: new Set([7]) })).toEqual({ ok: false, reason: 'test_customer' })
    expect(mapLoan(ticket({ Amount: 0 }), [], opts)).toEqual({ ok: false, reason: 'no_amount' })
  })

  it('maps an open ticket with no payments to an active loan', () => {
    const r = mapLoan(ticket(), [], opts)
    if (!r.ok) throw new Error('expected a loan')
    expect(r.loan).toMatchObject({
      legacy_key: 100,
      customer_key: 7,
      ticket_number: '15664',
      principal: 300,
      rate: 0.1,
      min_charge: null,
      issue_date: '2026-11-17',
      due_date: '2026-12-17',
      status: 'active',
      pickup_customer_key: null,
    })
    expect(r.events.map((e) => e.event_type)).toEqual(['issued'])
    expect(r.events[0]).toMatchObject({ amount: 300, legacy_ref: 'xpawn:ticket:100:issued' })
  })

  it('an interest payment that moves the due date is a payment plus an extension', () => {
    const r = mapLoan(ticket(), [payment()], opts)
    if (!r.ok) throw new Error('expected a loan')
    expect(r.loan.status).toBe('extended')
    expect(r.events.map((e) => e.event_type)).toEqual(['issued', 'payment', 'extension'])
    expect(r.events[1]).toMatchObject({ amount: 30, interest_paid: 30, principal_paid: 0, payment_method: 'cash' })
    expect(r.events[2]).toMatchObject({ new_due_date: '2027-01-17', legacy_ref: 'xpawn:pay:1:ext' })
    expect(r.events[2].occurred_at > r.events[1].occurred_at).toBe(true)
  })

  it('a principal paydown makes the open loan partial_paid', () => {
    const r = mapLoan(
      ticket(),
      [payment({ 'Payment Type': 4, 'Interest Charge Paid': 0, 'Principal paid': 100, 'Net Payment': 100 })],
      opts,
    )
    if (!r.ok) throw new Error('expected a loan')
    expect(r.loan.status).toBe('partial_paid')
    expect(r.events.map((e) => e.event_type)).toEqual(['issued', 'payment'])
  })

  it('a redemption payment closes the loan and keeps who picked it up', () => {
    const r = mapLoan(
      ticket({ Status: 'X', 'Pickup Customer Key': 9, 'Date Closed': '2026-12-01T05:00:00.000Z' }),
      [payment({ Key: 5, 'Payment Type': 3, 'Principal paid': 300, 'Net Payment': 330, 'Payment Date': '2026-12-01T19:00:00.000Z' })],
      opts,
    )
    if (!r.ok) throw new Error('expected a loan')
    expect(r.loan.status).toBe('redeemed')
    expect(r.loan.pickup_customer_key).toBe(9)
    expect(r.events.map((e) => e.event_type)).toEqual(['issued', 'payment', 'redemption'])
    expect(r.events[1]).toMatchObject({ amount: 330, principal_paid: 300, interest_paid: 30 })
    // The loan's last change is its closing, not the day of the import.
    expect(r.loan.updated_at).toBe(r.events[2].occurred_at)
  })

  it('leaves voided payments out', () => {
    const r = mapLoan(ticket(), [payment({ PaymentStatus: 'V' })], opts)
    if (!r.ok) throw new Error('expected a loan')
    expect(r.events.map((e) => e.event_type)).toEqual(['issued'])
    expect(r.loan.status).toBe('active')
  })

  it('a forfeited ticket gets a forfeiture event dated at its closing', () => {
    const r = mapLoan(
      ticket({ Status: 'P', 'How closed': 'PFX-', TicketStatusDate: '2027-02-20T17:50:17.000Z' }),
      [],
      opts,
    )
    if (!r.ok) throw new Error('expected a loan')
    expect(r.loan.status).toBe('forfeited')
    expect(r.events[1]).toMatchObject({
      event_type: 'forfeiture',
      notes: 'Old system: PFX-',
      occurred_at: '2027-02-20T17:50:17.000Z',
    })
  })

  it('a voided ticket takes its principal from the old note', () => {
    const r = mapLoan(
      ticket({ Status: 'V', Amount: 0, Notes: 'Original amount $200.00 Voided by ER 7/20/2026' }),
      [],
      opts,
    )
    if (!r.ok) throw new Error('expected a loan')
    expect(r.loan).toMatchObject({ status: 'voided', principal: 200 })
    expect(r.events[1].event_type).toBe('void')
    expect(originalAmountFromNote('Original amount $0.00 Voided by EDR')).toBeNull()
  })

  it('a discounted redemption keeps the cash paid and never a negative split', () => {
    const r = mapLoan(
      ticket({ Status: 'X', Amount: 350 }),
      [payment({ 'Payment Type': 3, 'Interest Charge Paid': -5.8333, 'Principal paid': 350, 'Net Payment': 344.1667 })],
      opts,
    )
    if (!r.ok) throw new Error('expected a loan')
    expect(r.events[1]).toMatchObject({ amount: 344.1667, principal_paid: 350, interest_paid: 0 })
    expect(r.events[1].notes).toContain('Old system adjustment')
  })

  it('charges paid from a credit on account keep their amount', () => {
    const r = mapLoan(
      ticket({ Status: 'X', Amount: 900 }),
      [
        payment({ Key: 1, 'Payment Type': 5, 'Interest Charge Paid': 0, 'Net Payment': 900, Credits: 900, 'Payment Date': '2026-11-20T15:00:00.000Z' }),
        payment({ Key: 2, 'Payment Type': 3, 'Interest Charge Paid': 0, 'Principal paid': 900, 'Net Payment': 0, Cash: 0, Credits: -900, 'Payment Date': '2026-11-20T15:01:00.000Z' }),
      ],
      opts,
    )
    if (!r.ok) throw new Error('expected a loan')
    expect(r.events[1]).toMatchObject({ amount: 900, principal_paid: 0, payment_method: 'cash' })
    expect(r.events[2]).toMatchObject({ amount: 900, principal_paid: 900, payment_method: 'other' })
  })
})

describe('items', () => {
  const header = ['Item Key', 'Ticket Key', 'Category Code', 'Public Description', 'Private Description', 'Item No.', 'Quantity', 'Serial No', 'Mfg', 'Model', 'Cost', 'Size', 'Weight', 'Units of weight', 'Color', 'Karat', 'Finish', 'Caliber', 'Action', 'Marks', 'Misc 1', 'Qty', 'Type', 'Color', 'Cut', 'Qty', 'Type', 'Color', 'Cut', 'OtherStones', 'CreationTimestamp']
  const mapItem = makeItemMapper(header)

  it('maps a ring with stones', () => {
    const it0 = mapItem([12, 15, 'RING', 'Heart with 4 stones', '', 1, 1, '', '', '', 10, '8', 1.9, 'Grams', '', '18k', '', '', '', '18k', 'Yellow Gold', '1', 'Cubic Zirconia', 'White', 'Heart', '4', 'Emerald', 'Green', 'Round', '', '2004-07-19T18:37:14.000Z'], 0)
    expect(it0).toMatchObject({
      legacy_key: 12,
      ticket_key: 15,
      category: 'ring',
      metal_type: 'gold',
      karat: 18,
      weight_grams: 1.9,
      est_value: 10,
      jewelry_size: '8',
      color: 'Yellow Gold',
      gemstone_description: '1 White Cubic Zirconia Heart; 4 Green Emerald Round',
      unique_marks: '18k',
      pawn_category_slug: 'jewelry',
      pawn_subcategory_slug: 'rings',
      firearm_type: null,
    })
  })

  it('maps a handgun with its serial and never as jewelry', () => {
    const g = mapItem([900, 77, 'HANDGUN', 'Glock handgun', '', 1, 1, 'BPNL281', 'Glock', '19X', 200, '', 0, 'Grams', '', '', 'Black', '9mm', 'Handgun/Semi-Auto', '', '', '', '', '', '', '', '', '', '', '', null], 0)
    expect(g).toMatchObject({
      category: 'other',
      pawn_category_slug: 'firearms',
      pawn_subcategory_slug: 'handguns',
      firearm_type: 'handgun',
      firearm_make: 'Glock',
      firearm_model: '19X',
      firearm_caliber: '9mm',
      firearm_serial_number: 'BPNL281',
      karat: null,
      weight_grams: null,
    })
  })

  it('reads karat, metal and weight', () => {
    expect(parseKarat('14k')).toBe(14)
    expect(parseKarat('750')).toBe(18)
    expect(parseKarat('00k')).toBeNull()
    expect(parseKarat('0 k')).toBeNull()
    expect(parseKarat('ed')).toBeNull()
    expect(mapMetal('White Gold', '14k')).toBe('white_gold')
    expect(mapMetal('Two Tone', '10k')).toBe('mixed')
    expect(mapMetal('Silver 925', '925')).toBe('silver')
    expect(mapMetal('', '14k')).toBe('gold')
    expect(mapMetal('', '')).toBeNull()
    expect(weightGrams(10, 'Dwt')).toBe(15.5517)
    expect(weightGrams(0, 'Grams')).toBeNull()
  })
})
