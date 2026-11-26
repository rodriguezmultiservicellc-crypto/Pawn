import { describe, expect, it } from 'vitest'
import { appraisalCreateSchema, appraisalUpdateSchema } from './appraisal'

const base = {
  item_description: '14K gold chain',
  purpose: 'insurance',
  appraised_value: '500',
  valid_from: '2026-11-25',
}

function karatIssue(r: ReturnType<typeof appraisalCreateSchema.safeParse>): boolean {
  return !r.success && r.error.issues.some((i) => i.path[0] === 'karat' && i.message === 'karat_for_metal')
}

describe('appraisal purity follows the metal', () => {
  it('takes 14K gold and 925 silver', () => {
    expect(appraisalCreateSchema.safeParse({ ...base, metal_type: 'gold', karat: '14' }).success).toBe(true)
    expect(appraisalCreateSchema.safeParse({ ...base, metal_type: 'silver', karat: '925' }).success).toBe(true)
    expect(appraisalCreateSchema.safeParse({ ...base, metal_type: 'platinum', karat: '950' }).success).toBe(true)
    expect(appraisalCreateSchema.safeParse({ ...base, metal_type: 'gold', karat: '' }).success).toBe(true)
  })

  it('refuses 28K, karats of silver and a purity on steel', () => {
    expect(karatIssue(appraisalCreateSchema.safeParse({ ...base, metal_type: 'gold', karat: '28' }))).toBe(true)
    expect(karatIssue(appraisalCreateSchema.safeParse({ ...base, metal_type: 'silver', karat: '14' }))).toBe(true)
    expect(karatIssue(appraisalCreateSchema.safeParse({ ...base, metal_type: 'stainless_steel', karat: '14' }))).toBe(true)
  })

  it('checks an update the same way', () => {
    const id = '00000000-0000-4000-8000-000000000000'
    expect(appraisalUpdateSchema.safeParse({ appraisal_id: id, metal_type: 'gold', karat: '28' }).success).toBe(false)
    expect(appraisalUpdateSchema.safeParse({ appraisal_id: id, metal_type: 'silver', karat: '925' }).success).toBe(true)
  })
})
