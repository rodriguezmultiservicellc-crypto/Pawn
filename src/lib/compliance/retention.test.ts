import { describe, expect, it } from 'vitest'
import { decideDocumentDelete } from './retention'

describe('decideDocumentDelete', () => {
  it('allows when the customer has no holds at all', () => {
    expect(
      decideDocumentDelete({ gate: { canDelete: true }, otherLiveSameKind: 0 }),
    ).toEqual({ allow: true })
  })

  it('blocks the LAST id scan while a loan is active', () => {
    expect(
      decideDocumentDelete({
        gate: { canDelete: false, reasons: ['active_loan'], blockedUntil: null },
        otherLiveSameKind: 0,
      }),
    ).toEqual({ allow: false, error: 'delete_blocked:active_loan:' })
  })

  it('blocks the last scan inside the retention window and reports the date', () => {
    expect(
      decideDocumentDelete({
        gate: {
          canDelete: false,
          reasons: ['pawn_retention_window', 'buy_retention_window'],
          blockedUntil: '2029-11-11',
        },
        otherLiveSameKind: 0,
      }),
    ).toEqual({
      allow: false,
      error: 'delete_blocked:pawn_retention_window,buy_retention_window:2029-11-11',
    })
  })

  it('allows removing a replaced scan while a hold is running', () => {
    expect(
      decideDocumentDelete({
        gate: { canDelete: false, reasons: ['active_loan'], blockedUntil: null },
        otherLiveSameKind: 1,
      }),
    ).toEqual({ allow: true })
  })

  it('reasons that only block deleting the CUSTOMER do not hold documents', () => {
    expect(
      decideDocumentDelete({
        gate: {
          canDelete: false,
          reasons: ['active_repair', 'active_layaway', 'unspent_store_credit', 'open_consignment'],
          blockedUntil: null,
        },
        otherLiveSameKind: 0,
      }),
    ).toEqual({ allow: true })
  })

  it('reports only the document-hold reasons when mixed', () => {
    expect(
      decideDocumentDelete({
        gate: {
          canDelete: false,
          reasons: ['active_repair', 'active_loan'],
          blockedUntil: null,
        },
        otherLiveSameKind: 0,
      }),
    ).toEqual({ allow: false, error: 'delete_blocked:active_loan:' })
  })
})
