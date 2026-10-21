import { describe, expect, it } from 'vitest'
import { isLegacyUpworkStatus, upworkStageDetail, upworkStageLabel } from '@/lib/upwork/pipeline'

describe('upwork pipeline stages', () => {
  it('names the stages a rep can actually save', () => {
    expect(upworkStageLabel('new')).toBe('Saved')
    expect(upworkStageLabel('drafted')).toBe('Draft ready')
    expect(upworkStageLabel('applied')).toBe('Proposal sent')
    expect(upworkStageLabel('replied')).toBe('Client replied')
    expect(upworkStageLabel('no')).toBe('Passed')
    expect(upworkStageLabel('dead')).toBe('Closed')
  })

  it('treats interview and hire marks as legacy', () => {
    expect(isLegacyUpworkStatus('shortlisted')).toBe(true)
    expect(isLegacyUpworkStatus('awarded')).toBe(true)
    expect(isLegacyUpworkStatus('applied')).toBe(false)
    expect(upworkStageDetail('interviewing')).toMatch(/not a stage/i)
  })
})
