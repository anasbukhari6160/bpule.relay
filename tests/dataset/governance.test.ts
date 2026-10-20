import { describe, expect, it } from 'vitest'
import { anonId, exportSamples, sanitizeText } from '@/lib/dataset/export'
import { hashRawInput } from '@/lib/dataset/service'
import { opportunityKey } from '@/lib/scoring-v4/opportunity-key'
import type { IntelligenceSample } from '@/lib/dataset/types'

function sample(over: Partial<IntelligenceSample> = {}): IntelligenceSample {
  return {
    id: 'sample-1', organizationId: 'org-1', leadId: 'lead-1', upworkJobId: null, decisionRunId: 'run-1', platform: 'linkedin', version: 1, funnelStage: 'SENT',
    rawInput: 'Jane Example\nFounder at Acme\nWe are looking for an agency. Email jane@acme.example, https://acme.example', rawInputHash: null,
    extractedIdentity: null, sourceFacts: null, rejectedSignals: [], evidenceLedger: [], modelRawOutput: null, resolvedDecision: null,
    canonicalScore: 70, displayScore: 7, qualification: 'WORTH_PURSUING', scoreDimensions: [], confidence: 0.8, recommendedAction: 'CONNECT_WITH_NOTE',
    senderRankings: [{ senderId: 'p-1', name: 'x', profileMatch: 80, reasons: [] }], bestSenderId: 'p-1', currentSenderId: 'p-1',
    connectionNote: 'Hi Jane, saw your post — mail me at me@agency.example or +1 415-555-0100', firstDm: null, followupDrafts: [], replyDrafts: [], upworkCoverLetter: null, screeningAnswers: [],
    humanEditedText: [{ generatedText: 'draft with jane@acme.example', editedText: 'edited https://x.example', finalSentText: 'final', editorId: 'rep-1', timestamp: '2026-10-20T00:00:00Z' }],
    finalSentText: 'Thanks, see linkedin.com/in/jane-example', generatedText: null, messageStage: null, senderProfileId: 'p-1',
    clientReplies: ['Sure, call me on 020 7946 0000'], finalOutcome: 'reply', humanFeedback: [{ feedbackType: 'CORRECT', timestamp: '2026-10-20T00:00:00Z' }],
    scoringVersion: 'relay_decision_v3.3.0', sourceFactsVersion: 'source_facts_v1', buyerIntentVersion: 'buyer_intent_v4', attributionVersion: 'attribution_v2', routingVersion: 'routing_v1', promptVersion: 'v3_decision_prompt_v3', modelVersion: 'gpt-4o-mini',
    labelStatus: 'AI_ONLY', labelSource: 'ai', labelerId: null, reviewStatus: null, reviewNotes: null, reviewedAt: null, reviewedBy: null,
    trainingEligible: false, trainingApproved: false, approvedBy: null, approvedAt: null, needsReview: false, captureFailures: [], lastCaptureError: null,
    createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', sourceType: null,
    ...over,
  }
}

describe('dataset governance (Phase 1)', () => {
  it('raw_input_hash is SHA-256 of the normalised source and equals the opportunity key', () => {
    const raw = 'Jane Example\nFounder at Acme  \n\n\nWe are looking for an agency to rebuild our portal.'
    const h = hashRawInput(raw)
    expect(h).toMatch(/^[a-f0-9]{64}$/)
    expect(h).toBe(opportunityKey(raw))
    expect(h).toBe(hashRawInput(raw.replace(/\n/g, '\r\n')))
    expect(h).not.toContain('Jane')
  })

  it('redacts every email, phone and URL occurrence, in both privacy modes', () => {
    const text = 'a@b.example and c@d.example, +1 415-555-0100, https://x.example/p and linkedin.com/in/jane-example'
    const red = sanitizeText(text, 'REDACTED')!
    const anon = sanitizeText(text, 'ANONYMIZED')!
    for (const out of [red, anon]) {
      expect(out).not.toMatch(/@/)
      expect(out).not.toMatch(/https?:/)
      expect(out).not.toMatch(/linkedin\.com\/in/)
      expect(out).not.toMatch(/555-0100/)
    }
  })

  it('anonymous ids are stable per scope and differ across scopes', () => {
    expect(anonId('lead', 'lead-1', 'org-1')).toBe(anonId('lead', 'lead-1', 'org-1'))
    expect(anonId('lead', 'lead-1', 'org-1')).not.toBe(anonId('lead', 'lead-1', 'org-2'))
    expect(anonId('lead', 'lead-1', 'org-1')).not.toContain('lead-1')
    expect(anonId('lead', null, 'org-1')).toBeNull()
  })

  it('exports never carry raw source, real ids (anonymized) or unredacted contact details', () => {
    const s = sample()
    for (const privacy of ['REDACTED', 'ANONYMIZED'] as const) {
      const out = exportSamples([s], 'FULL_AUDIT', 'jsonl', privacy, { anonScope: 'org-1' }).content
      expect(out).not.toContain('Jane Example')
      expect(out).not.toContain('jane@acme.example')
      expect(out).not.toContain('me@agency.example')
      expect(out).not.toContain('acme.example')
      expect(out).not.toContain('020 7946 0000')
      if (privacy === 'ANONYMIZED') {
        expect(out).not.toContain('"lead-1"')
        expect(out).not.toContain('"p-1"')
        expect(out).toContain('anon_lead_id')
      }
    }
    const twice = exportSamples([s], 'FULL_AUDIT', 'json', 'ANONYMIZED', { anonScope: 'org-1' }).content
    const again = exportSamples([s], 'FULL_AUDIT', 'json', 'ANONYMIZED', { anonScope: 'org-1' }).content
    expect(JSON.parse(twice).samples[0].anon_lead_id).toBe(JSON.parse(again).samples[0].anon_lead_id)
  })

  it('TRAINING export only returns explicitly approved samples', () => {
    const approved = sample({ id: 's2', trainingApproved: true, labelStatus: 'TRAINING_APPROVED' })
    const outcomeOnly = sample({ id: 's3', finalOutcome: 'won', labelStatus: 'OUTCOME_VERIFIED' })
    const out = exportSamples([approved, outcomeOnly], 'TRAINING', 'json', 'REDACTED', { anonScope: 'org-1' })
    expect(JSON.parse(out.content).samples).toHaveLength(1)
  })
})
