/** BUG-LEAD-004 — empty stage ≠ search with no results. */
import { describe, expect, it } from 'vitest'
import { resolvePipelineEmptyState, type PipelineStage } from '@/components/leads/pipeline-utils'

const STAGES: PipelineStage[] = ['to_contact', 'needs_reply', 'follow_up_due', 'waiting', 'done', 'cold']

describe('BUG-LEAD-004 pipeline empty states', () => {
  it('reported: empty Follow-Up stage with no search does not mention a search', () => {
    const e = resolvePipelineEmptyState({ stage: 'follow_up_due', query: '' })
    expect(e.kind).toBe('stage')
    expect(e.title).toBe('No follow-ups due.')
    expect(e.title).not.toMatch(/search|match/i)
  })

  it.each(STAGES)('%s: empty → stage copy; searched → search copy naming the query', (stage) => {
    const empty = resolvePipelineEmptyState({ stage, query: '   ' })
    expect(empty.kind).toBe('stage')
    expect(empty.title).not.toMatch(/match/i)
    const searched = resolvePipelineEmptyState({ stage, query: 'globex' })
    expect(searched.kind).toBe('search')
    expect(searched.title).toMatch(/No leads match "globex"/)
  })

  it('control: All with no leads and no search', () => {
    expect(resolvePipelineEmptyState({ stage: 'all', query: '' }).title).toBe('No leads yet.')
    expect(resolvePipelineEmptyState({ stage: 'all', query: 'x' }).title).toBe('No leads match "x".')
  })
})
