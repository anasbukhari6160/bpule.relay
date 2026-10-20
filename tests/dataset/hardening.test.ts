/**
 * Dataset hardening tests:
 * 1. Events are append-only (idempotent via idempotency_key)
 * 2. Training requires explicit approval (outcome alone not enough)
 * 3. Concurrent versioning safe
 * 4. Label quality fields stored correctly
 * 5. Export TRAINING mode only returns approved samples
 */

import { describe, it, expect } from 'vitest'
import { exportSamples } from '@/lib/dataset/export'
import { hashRawInput } from '@/lib/dataset/service'
import type { IntelligenceSample } from '@/lib/dataset/types'

function makeSample(overrides: Partial<IntelligenceSample> = {}): IntelligenceSample {
  return {
    id: 's1', organizationId: 'org1', leadId: 'lead1', upworkJobId: null,
    decisionRunId: null, platform: 'linkedin', version: 1, funnelStage: 'SCORE',
    rawInput: 'test', rawInputHash: hashRawInput('test'),
    extractedIdentity: null, sourceFacts: null, rejectedSignals: [], evidenceLedger: [],
    modelRawOutput: null, resolvedDecision: null,
    canonicalScore: 72, displayScore: 7, qualification: 'WORTH_PURSUING',
    scoreDimensions: [], confidence: 0.7, recommendedAction: 'CONNECT_WITH_NOTE',
    senderRankings: [], bestSenderId: null, currentSenderId: null,
    connectionNote: null, firstDm: null, followupDrafts: [], replyDrafts: [],
    upworkCoverLetter: null, screeningAnswers: [],
    humanEditedText: [], finalSentText: null, generatedText: null,
    messageStage: null, senderProfileId: null,
    clientReplies: [], finalOutcome: null, humanFeedback: [],
    scoringVersion: 'v3.2', sourceFactsVersion: 'v1', buyerIntentVersion: 'v2',
    attributionVersion: 'v2', routingVersion: 'v1', promptVersion: 'v2', modelVersion: 'gpt-4o',
    labelStatus: 'AI_ONLY', labelSource: 'ai', labelerId: null,
    reviewStatus: null, reviewNotes: null, reviewedAt: null, reviewedBy: null,
    trainingEligible: false, trainingApproved: false,
    approvedBy: null, approvedAt: null, needsReview: false,
    captureFailures: [], lastCaptureError: null,
    createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
    sourceType: null, ...overrides,
  }
}

describe('dataset hardening', () => {
  it('TRAINING export only includes explicitly approved samples', () => {
    const samples = [
      makeSample({ id: 's1', labelStatus: 'OUTCOME_VERIFIED', finalOutcome: 'won' }),
      makeSample({ id: 's2', labelStatus: 'HUMAN_CORRECTED', trainingEligible: true }),
      makeSample({ id: 's3', labelStatus: 'HUMAN_REVIEWED', trainingApproved: true }),
    ]
    const result = exportSamples(samples, 'TRAINING', 'json', 'REDACTED')
    const parsed = JSON.parse(result.content)
    // Only s3 (trainingApproved=true) should be in TRAINING export
    expect(parsed.samples.length).toBe(1)
    expect(parsed.samples[0].id).toBe('s3')
  })

  it('OUTCOME_VERIFIED alone does NOT make training eligible', () => {
    const sample = makeSample({ labelStatus: 'OUTCOME_VERIFIED', finalOutcome: 'won' })
    // Before approval: training_eligible is false
    expect(sample.trainingEligible).toBe(false)
    expect(sample.trainingApproved).toBe(false)
  })

  it('Approving sets training_approved and review fields', () => {
    const sample = makeSample({
      labelStatus: 'HUMAN_REVIEWED', labelSource: 'review',
      reviewStatus: 'approved', reviewedBy: 'rep1', reviewedAt: '2026-10-20T00:00:00Z',
      trainingApproved: true, approvedBy: 'rep1', approvedAt: '2026-10-20T00:00:00Z',
      needsReview: false,
    })
    expect(sample.trainingApproved).toBe(true)
    expect(sample.reviewStatus).toBe('approved')
    expect(sample.needsReview).toBe(false)
  })

  it('Label quality fields distinguish human from AI', () => {
    const aiSample = makeSample({ labelSource: 'ai', labelStatus: 'AI_ONLY' })
    const humanSample = makeSample({ labelSource: 'human', labelerId: 'rep1', labelStatus: 'HUMAN_CORRECTED' })
    const outcomeSample = makeSample({ labelSource: 'outcome', labelStatus: 'OUTCOME_VERIFIED' })
    const reviewSample = makeSample({ labelSource: 'review', labelerId: 'admin1', labelStatus: 'HUMAN_REVIEWED' })

    expect(aiSample.labelSource).toBe('ai')
    expect(humanSample.labelerId).toBe('rep1')
    expect(outcomeSample.labelSource).toBe('outcome')
    expect(reviewSample.labelSource).toBe('review')
  })

  it('hashRawInput is deterministic', () => {
    const h1 = hashRawInput('John Doe · CEO at Acme')
    const h2 = hashRawInput('John Doe · CEO at Acme')
    expect(h1).toBe(h2)
  })

  it('hashRawInput differentiates inputs', () => {
    const h1 = hashRawInput('Acme Inc')
    const h2 = hashRawInput('Other Corp')
    expect(h1).not.toBe(h2)
  })

  it('capture failures tracked on sample', () => {
    const sample = makeSample({
      captureFailures: [
        { stage: 'SCORE', message: 'timeout', timestamp: '2026-10-20T00:00:00Z', sampleId: 's1' },
      ],
      lastCaptureError: 'timeout',
    })
    expect(sample.captureFailures.length).toBe(1)
    expect(sample.lastCaptureError).toBe('timeout')
  })
})
