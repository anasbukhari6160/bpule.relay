/** BUG-CL-003 — "Nothing flagged" only when nothing blocks or is unsupported. */
import { describe, expect, it } from 'vitest'
import { validateLeadDraft } from '@/lib/leads/lead-validation'
import { evaluateProspectQualification } from '@/lib/prospect/qualification-gate'
import { computeScore } from '@/lib/score/rubric'
import { RULEBOOK as DEFAULT_RULEBOOK } from './helpers'
import type { ExtractedLead } from '@/lib/domain/types'

const RAW = `Sarah Lane
CTO at Fieldnote Apps
Location: Austin, Texas, USA
We are looking for a software development agency to rebuild our mobile app in React Native.
Budget approved for Q1. Launch planned within 3 months.`

function lead(over: Partial<ExtractedLead> = {}): ExtractedLead {
  return {
    name: 'Sarah Lane', title: 'CTO', titleRaw: 'CTO', company: 'Fieldnote Apps', url: null, locationRaw: 'Austin, Texas, USA',
    aboutSummary: null, experienceSummary: null, recentPosts: [], roleCategory: 'technical_leadership', marketRegion: 'US',
    signalType: 7, signalEvidence: 'We are looking for a software development agency to rebuild our mobile app in React Native.',
    extractionConfidence: 100, confidenceNotes: [], verbatimQuote: null, tags: [], ...over,
  }
}

function validate(l: ExtractedLead, raw: string) {
  const qualification = evaluateProspectQualification({ extracted: l, rawText: raw })
  const score = computeScore(l, DEFAULT_RULEBOOK, { sourceText: raw })
  return validateLeadDraft({ company: l.company, signalEvidence: l.signalEvidence ?? '', locationRaw: l.locationRaw ?? '', fieldErrors: {}, confidenceNotes: [], qualification, score })
}

describe('BUG-CL-003 validation summary', () => {
  it('reported: blocked/missing information never says "Nothing flagged"', () => {
    const v = validate(lead({ company: 'Unknown company', name: null, title: null, titleRaw: null, signalEvidence: 'hello' }), 'hello there friend')
    expect(v.ok).toBe(false)
    expect(v.summary).not.toMatch(/Nothing flagged/)
    expect(v.missingRequiredFields).toContain('Company')
    expect(v.qualificationBlockers.length).toBeGreaterThan(0)
  })

  it('unsupported evidence is listed and prevents the success message', () => {
    const v = validate(lead({ signalType: 3, verbatimQuote: 'This sentence does not exist anywhere in the original research.' }), RAW)
    expect(v.ok).toBe(false)
    expect(v.unsupportedEvidence).toEqual(expect.arrayContaining([
      'Selected signal is not supported by the research.',
      'Quote could not be verified against the research.',
    ]))
  })

  it('control: a complete, supported lead gets the success message', () => {
    const v = validate(lead(), RAW)
    expect(v.ok).toBe(true)
    expect(v.summary).toBe('Nothing flagged. Every field checked out.')
  })
})
