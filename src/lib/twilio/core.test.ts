import { describe, expect, test } from 'vitest'
import { withComplianceFooter } from './compliance'

const FOOTER = '\n\nReply STOP to unsubscribe. Msg&Data Rates may apply.'

describe('withComplianceFooter', () => {
  test('appends the TCPA opt-out footer to a plain body', () => {
    expect(withComplianceFooter('Your loan is due tomorrow.')).toBe(
      'Your loan is due tomorrow.' + FOOTER,
    )
  })

  test('is idempotent — does not double-stack when body already has a STOP instruction', () => {
    const once = withComplianceFooter('Hello')
    expect(withComplianceFooter(once)).toBe(once)
  })

  test('skips bodies that already mention "Reply STOP" (any case)', () => {
    const body = 'Promo! reply stop to opt out.'
    expect(withComplianceFooter(body)).toBe(body)
  })

  test('returns empty body untouched (no footer on nothing)', () => {
    expect(withComplianceFooter('')).toBe('')
  })
})
