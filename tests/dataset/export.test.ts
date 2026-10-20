import { describe, it, expect } from 'vitest'
import { exportSamples } from '@/lib/dataset/export'
import type { IntelligenceSample } from '@/lib/dataset/types'

function makeSample(overrides: Partial<IntelligenceSample> = {}): IntelligenceSample {
  return {
    id: 's1',
    organizationId: 'org1',
    leadId: 'lead1',
    upworkJobId: null,
    platform: 'linkedin',
    version: 1,
    funnelStage: 'SCORE',
    rawInput: 'John Doe · CEO at Acme Inc\nLooking for a React team to build our MVP.',
    rawInputHash: '100:John',
    extractedIdentity: { name: 'John Doe', title: 'CEO' },
    sourceFacts: null,
    rejectedSignals: [],
    evidenceLedger: [],
    modelRawOutput: null,
    resolvedDecision: null,
    canonicalScore: 72,
    displayScore: 7,
    qualification: 'WORTH_PURSUING',
    scoreDimensions: [],
    confidence: 0.7,
    recommendedAction: 'CONNECT_WITH_NOTE',
    senderRankings: [],
    bestSenderId: null,
    currentSenderId: null,
    connectionNote: 'Hey John — saw you\'re building at Acme.',
    firstDm: null,
    followupDrafts: [],
    replyDrafts: [],
    upworkCoverLetter: null,
    screeningAnswers: [],
    humanEditedText: [],
    finalSentText: null,
    clientReplies: [],
    finalOutcome: null,
    humanFeedback: [],
    scoringVersion: 'relay_decision_v3.2.0',
    sourceFactsVersion: 'source_facts_v1',
    buyerIntentVersion: 'buyer_intent_v2',
    attributionVersion: 'attribution_v2',
    routingVersion: 'routing_v1',
    promptVersion: 'v3_decision_prompt_v2',
    modelVersion: 'gpt-4o',
    labelStatus: 'AI_ONLY',
    trainingEligible: false,
    needsReview: false,
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    sourceType: null,
    rawInputHash: '100:John',
    ...overrides,
  }
}

describe('dataset export', () => {
  it('REDACTED mode strips PII from text fields', () => {
    const samples = [makeSample({
      connectionNote: 'Reach me at john@acme.com or 555-123-4567',
      rawInput: 'Profile: https://linkedin.com/in/johndoe',
    })]
    const result = exportSamples(samples, 'FULL_AUDIT', 'json', 'REDACTED')
    const parsed = JSON.parse(result.content)

    expect(parsed.samples[0].raw_input).toBe('[REDACTED]')
    expect(parsed.samples[0].connection_note).toContain('[REDACTED]')
  })

  it('TRAINING mode requires explicit trainingApproved', () => {
    const samples = [
      makeSample({ id: 's1', labelStatus: 'AI_ONLY' }),
      makeSample({ id: 's2', labelStatus: 'HUMAN_REVIEWED' }),
      makeSample({ id: 's3', labelStatus: 'HUMAN_CORRECTED', trainingEligible: true }),
      makeSample({ id: 's4', labelStatus: 'OUTCOME_VERIFIED' }),
      makeSample({ id: 's5', labelStatus: 'HUMAN_REVIEWED', trainingApproved: true }),
    ]
    const result = exportSamples(samples, 'TRAINING', 'jsonl', 'REDACTED')
    const lines = result.content.trim().split('\n')
    // Only s5 has trainingApproved=true
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>
    expect(parsed.id).toBe('s5')
  })

  it('MESSAGE_PREFERENCE mode filters to samples with human edits', () => {
    const samples = [
      makeSample({ id: 's1', humanEditedText: [] }),
      makeSample({ id: 's2', humanEditedText: [{ generatedText: 'hi', editedText: 'hello', finalSentText: 'hello', editorId: null, timestamp: '2026-10-20' }] }),
    ]
    const result = exportSamples(samples, 'MESSAGE_PREFERENCE', 'json', 'REDACTED')
    const parsed = JSON.parse(result.content)
    expect(parsed.samples.length).toBe(1)
    expect(parsed.samples[0].id).toBe('s2')
  })

  it('UPWORK_TRAINING mode filters to upwork platform', () => {
    const samples = [
      makeSample({ id: 's1', platform: 'linkedin' }),
      makeSample({ id: 's2', platform: 'upwork', upworkJobId: 'job1' }),
    ]
    const result = exportSamples(samples, 'UPWORK_TRAINING', 'json', 'REDACTED')
    const parsed = JSON.parse(result.content)
    expect(parsed.samples.length).toBe(1)
    expect(parsed.samples[0].platform).toBe('upwork')
  })

  it('includes schema version and metadata in JSON export', () => {
    const result = exportSamples([makeSample()], 'FULL_AUDIT', 'json', 'REDACTED')
    const parsed = JSON.parse(result.content)
    expect(parsed.meta.dataset_schema_version).toBe('intelligence_dataset_v1')
    expect(parsed.meta.export_mode).toBe('FULL_AUDIT')
    expect(parsed.meta.count).toBe(1)
  })

  it('CSV export produces valid header + rows', () => {
    const result = exportSamples([makeSample(), makeSample({ id: 's2' })], 'FULL_AUDIT', 'csv', 'REDACTED')
    const lines = result.content.split('\n')
    expect(lines.length).toBe(3) // header + 2 rows
    expect(lines[0]).toContain('platform')
    expect(lines[0]).toContain('qualification')
  })

  it('JSONL export produces one JSON object per line', () => {
    const result = exportSamples([makeSample(), makeSample({ id: 's2' })], 'FULL_AUDIT', 'jsonl', 'REDACTED')
    const lines = result.content.trim().split('\n')
    expect(lines.length).toBe(2)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })
})
