/**
 * Prospect Analysis QA report (Module 01, 16 Oct 2026) — PRO-001 … PRO-020.
 * Uses the report's control scenarios. The decision model is replaced by a
 * fake provider that returns the answers QA captured from production, so the
 * deterministic guards, episode selection, scoring and evidence are tested
 * end to end without network calls.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { normalizeProspectPaste } from '@/lib/prospect/paste-normalize'
import { buildMinimalV2Canonical, buildV3BridgeInput } from '@/lib/intelligence-v3/bridge'
import { runV3Decision } from '@/lib/intelligence-v3/orchestrator'
import { getDecisionRegistry, type V3DecisionProvider, type V3ProviderResult } from '@/lib/intelligence-v3/decision/decision-provider'
import { guardBoundedDecision } from '@/lib/intelligence-v3/decision/decision-assembler'
import { detectCommercialRequest, extractStatedBudget, extractStatedTimeline } from '@/lib/intelligence-v3/source-facts'
import { classifyInput, evaluateProspectQualification } from '@/lib/prospect/qualification-gate'
import { deriveSignalEvidenceFallback } from '@/lib/intelligence-v2/orchestrator'
import { deriveCommercialReading } from '@/lib/intelligence-v2/commercial-reading'
import { extractSignals } from '@/lib/scoring/signal-extractor'
import { formatRoleLine } from '@/lib/leads/role-line'
import { normalizeScoreCalculation, normalizeScoreDimensions } from '@/lib/scoring/display-score'
import type { V3BoundedDecision, V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import type { ExtractedEvent } from '@/lib/intelligence-v3/event-extractor'
import type { ExtractedLead } from '@/lib/domain/types'

const HIRING_ONLY = `Alex Morgan
Technical Recruiter at Northstar Technologies
Company: Northstar Technologies
Role: Technical Recruiter
LinkedIn Post:
We are hiring a Full-Time React Developer to join our internal engineering team.
Requirements:
- 3+ years of React experience
- REST API integration
Interested candidates should submit their CV.`

const EXTERNAL_AGENCY = `Alex Morgan
Technical Recruiter at Northstar Technologies
Company: Northstar Technologies
Role: Technical Recruiter
LinkedIn Post:
We are looking for an external software development agency to help us build a customer portal in React.
We want an outsourced development team, not full-time employees.
Scope:
- React frontend
- REST API integration
- Dashboard development
Approved project budget: $20,000
Expected start: Within 2 weeks.
Interested development agencies should contact us with their portfolio and project proposal.`

const JOHN_BODY = `John Gummadi

Senior Director of Software Engineering at Acme Labs

About
I lead the engineering team at Acme Labs.
We develop internal software products.`
const JOHN_WITH_VIEW = `View John Gummadi's profile\n${JOHN_BODY}`
const JOHN_WITH_CURLY_VIEW = `View John Gummadi’s profile\n${JOHN_BODY}`

const GENERIC = `Hello everyone!

I am exploring some new ideas.

Technology is changing rapidly, and there
are many interesting things happening.

Looking forward to connecting with people.`

/** What production's model answered for both Alex scenarios (QA SSE payloads). */
class CapturedModelProvider implements V3DecisionProvider {
  readonly id = 'qa_captured'
  readonly modelVersion = 'qa_captured_v1'
  isAvailable() { return true }
  async decide(): Promise<V3ProviderResult> {
    return {
      answers: {
        relationship: 'BUYER',
        buyerRequestProbability: 0.98,
        externalNeedProbability: 0.98,
        needOwner: 'HIRING_NEED',
        fit: 'EXCELLENT',
        timing: 'CURRENT',
        access: 'DIRECT',
        messageEligible: 0.9,
      },
      providerId: this.id,
      modelVersion: this.modelVersion,
      latencyMs: 0,
      confidence: 0.96,
    }
  }
}

function event(partial: Partial<ExtractedEvent>): ExtractedEvent {
  return {
    eventType: 'HIRING',
    organizationName: 'Northstar Technologies',
    organizationEvidence: 'Northstar Technologies',
    requestedCapabilities: ['React', 'REST API'],
    requestedAssets: [],
    applicationChannels: [],
    applyInstructions: [],
    explicitness: 'EXPLICIT',
    needOwner: 'HIRING_NEED',
    evidenceQuote: '',
    confidence: 0.9,
    ageDays: null,
    ...partial,
  }
}

async function decide(rawText: string, events: ExtractedEvent[]): Promise<V3LeadDecisionPacket> {
  const v2 = buildMinimalV2Canonical(rawText)
  const input = buildV3BridgeInput(v2, rawText, events)
  const result = await runV3Decision(input, { providerId: 'qa_captured', v2Canonical: v2 })
  return result.packet
}

beforeAll(() => {
  getDecisionRegistry().register(new CapturedModelProvider())
})

describe('PRO-001 / PRO-019: LinkedIn chrome does not change identity or eligibility', () => {
  it('strips the "View … profile" label (straight and curly apostrophes)', () => {
    expect(normalizeProspectPaste(JOHN_WITH_VIEW)).toBe(JOHN_BODY.trim())
    expect(normalizeProspectPaste(JOHN_WITH_CURLY_VIEW)).toBe(JOHN_BODY.trim())
  })

  it('extracts the clean name even when the label reaches extraction', () => {
    for (const raw of [JOHN_WITH_VIEW, JOHN_WITH_CURLY_VIEW, JOHN_BODY]) {
      const v2 = buildMinimalV2Canonical(raw)
      expect(v2.intelligence.person.fullName).toBe('John Gummadi')
      expect(v2.intelligence.company.name).toBe('Acme Labs')
      expect(v2.intelligence.person.title).toBe('Senior Director of Software Engineering')
    }
  })

  it('gives identical eligibility with and without the View line', () => {
    const eligibility = (raw: string) => {
      const v2 = buildMinimalV2Canonical(raw)
      const extracted: ExtractedLead = {
        name: v2.intelligence.person.fullName,
        title: v2.intelligence.person.title,
        titleRaw: v2.intelligence.person.title,
        company: v2.intelligence.company.name ?? 'Unknown company',
        url: null, locationRaw: null, aboutSummary: null, experienceSummary: null, recentPosts: [],
        roleCategory: 'other', marketRegion: 'unknown', signalType: 7,
        signalEvidence: deriveSignalEvidenceFallback(v2, raw),
        extractionConfidence: v2.extractionCompleteness.score,
        confidenceNotes: [], verbatimQuote: null, tags: [],
      }
      return evaluateProspectQualification({ rawText: raw, extracted, canonicalQualification: 'skip' })
    }
    // Raw (un-normalized) text too: the apostrophe in "Gummadi's" used to count as a quotation.
    const withView = eligibility(JOHN_WITH_VIEW)
    const without = eligibility(JOHN_BODY)
    expect(withView.qualificationEligibility).toBe(without.qualificationEligibility)
    expect(withView.missingCritical).toEqual(without.missingCritical)
    expect(eligibility(normalizeProspectPaste(JOHN_WITH_VIEW)).qualificationEligibility).toBe(without.qualificationEligibility)
  })
})

describe('PRO-002: role and employer are separated', () => {
  it('extracts "Technical Recruiter" at "Northstar Technologies"', () => {
    const v2 = buildMinimalV2Canonical(HIRING_ONLY)
    expect(v2.intelligence.person.fullName).toBe('Alex Morgan')
    expect(v2.intelligence.person.title).toBe('Technical Recruiter')
    expect(v2.intelligence.company.name).toBe('Northstar Technologies')
  })

  it('renders one subtitle without repeating the employer, including for already-saved titles', () => {
    expect(formatRoleLine('Technical Recruiter at Northstar Technologies', 'Northstar Technologies'))
      .toBe('Technical Recruiter · Northstar Technologies')
    expect(formatRoleLine('Technical Recruiter', 'Northstar Technologies')).toBe('Technical Recruiter · Northstar Technologies')
    expect(formatRoleLine('CTO at Other Co', 'Northstar Technologies')).toBe('CTO at Other Co · Northstar Technologies')
  })
})

describe('PRO-003: full-time hiring is not an external buyer request', () => {
  it('detects employment hiring and no external-provider request', () => {
    const facts = detectCommercialRequest(HIRING_ONLY)
    expect(facts.externalServiceRequest).toBeNull()
    expect(facts.employmentHiring?.line).toMatch(/Full-Time React Developer/)
  })

  it('caps the final decision, not only the score row', async () => {
    const packet = await decide(HIRING_ONLY, [event({
      eventType: 'HIRING',
      evidenceQuote: 'We are hiring a Full-Time React Developer to join our internal engineering team.',
      requestedAssets: ['CV'],
    })])
    expect(packet.decision.buyerRequestProbability).toBeLessThanOrEqual(0.2)
    expect(packet.decision.externalNeedProbability).toBeLessThanOrEqual(0.2)
    expect(packet.decision.relationship).not.toBe('BUYER')
    expect(packet.decision.needOwnerType).toBe('HIRING_NEED')
    expect(packet.reasons.join(' ')).not.toMatch(/Explicit buyer request detected/)
    expect(packet.buyerIntent?.buyerIntentLevel).not.toBe('HIGH')
    expect(packet.watchOut.join(' ')).toMatch(/employee hiring|not credited|no clear buyer request/i)
    expect(packet.decisionAdjustments?.some((a) => /capped at 0\.20 \(model: 0\.98\)/.test(a))).toBe(true)
  })
})

describe('PRO-004 / PRO-005: explicit agency request is the selected opportunity', () => {
  const agencyEvent = event({
    eventType: 'AGENCY_REQUEST',
    // Simulate the extractor mislabeling the need owner as hiring.
    needOwner: 'HIRING_NEED',
    evidenceQuote: 'We are looking for an external software development agency to help us build a customer portal in React.',
    requestedAssets: ['portfolio', 'project proposal'],
    applyInstructions: ['Interested development agencies should contact us with their portfolio and project proposal.'],
  })

  it('selects the AGENCY_REQUEST episode and does not spawn a synthetic hiring episode', async () => {
    const packet = await decide(EXTERNAL_AGENCY, [agencyEvent])
    const selected = packet.episodes.find((e) => e.id === packet.selectedEpisodeId)
    expect(selected?.anchorEvent.eventType).toBe('AGENCY_REQUEST')
    expect(selected?.needOwnerType).toBe('ORGANIZATION_NEED')
    expect(packet.episodes.some((e) => e.anchorEvent.id.startsWith('evt_synthetic_') && e.needOwnerType === 'HIRING_NEED')).toBe(false)
    expect(packet.decision.needOwnerType).toBe('ORGANIZATION_NEED')
    expect(packet.reasons.some((r) => /^hiring$/i.test(r))).toBe(false)
  })

  it('classifies the input as an external-service request, not HIRING_POST', () => {
    expect(classifyInput(EXTERNAL_AGENCY).classification).toBe('SERVICE_REQUEST')
    expect(classifyInput(HIRING_ONLY).classification).toBe('HIRING_POST')
  })

  it('does not read "looking for an agency" as hiring in the signal check', () => {
    const signals = extractSignals(EXTERNAL_AGENCY)
    expect(signals.intent.hiring).toBe(false)
    expect(signals.intent.seekingVendor).toBe(true)
  })

  it('keeps the guard from flipping a genuine agency request', () => {
    const decision: V3BoundedDecision = {
      relationship: 'BUYER', buyerRequestProbability: 0.98, externalNeedProbability: 0.98,
      needOwnerType: 'HIRING_NEED', fit: 'EXCELLENT', timing: 'CURRENT', access: 'DIRECT',
      messageEligible: 0.9, providerConfidence: 0.96,
    }
    const { decision: guarded } = guardBoundedDecision(decision, EXTERNAL_AGENCY, null)
    expect(guarded.buyerRequestProbability).toBe(0.98)
    expect(guarded.relationship).toBe('BUYER')
    expect(guarded.needOwnerType).toBe('ORGANIZATION_NEED')
  })

  it('raises NONE access to CONNECTION when the source invites contact', () => {
    const decision: V3BoundedDecision = {
      relationship: 'BUYER', buyerRequestProbability: 0.9, externalNeedProbability: 0.9,
      needOwnerType: 'ORGANIZATION_NEED', fit: 'MEDIUM', timing: 'CURRENT', access: 'NONE',
      messageEligible: 0.6, providerConfidence: 0.8,
    }
    const { decision: guarded, adjustments } = guardBoundedDecision(decision, EXTERNAL_AGENCY, null)
    expect(guarded.access).toBe('CONNECTION')
    expect(adjustments.some((a) => /Access NONE → CONNECTION/.test(a))).toBe(true)
    expect(guardBoundedDecision(decision, 'We are looking for an external agency.', null).decision.access).toBe('NONE')
    expect(guardBoundedDecision(decision, HIRING_ONLY, null).decision.access).toBe('NONE')
  })
})

describe('PRO-006 / PRO-007 / PRO-008: score is explainable and cites the source', () => {
  it('reads budget and start date from the source', () => {
    expect(extractStatedBudget(EXTERNAL_AGENCY)).toMatchObject({ amount: '$20,000', approved: true })
    expect(extractStatedTimeline(EXTERNAL_AGENCY)).toMatchObject({ days: 14 })
    expect(deriveCommercialReading(EXTERNAL_AGENCY).buyerTiming).toBe('NEAR_TERM')
  })

  it('serializes every step from row subtotal to the canonical score', async () => {
    const packet = await decide(EXTERNAL_AGENCY, [event({
      eventType: 'AGENCY_REQUEST',
      evidenceQuote: 'We are looking for an external software development agency to help us build a customer portal in React.',
    })])
    const calc = packet.scoreCalculation!
    expect(calc).toBeTruthy()
    const modelRows = packet.dimensions.filter((d) => d.group === 'model')
    expect(modelRows).toHaveLength(7)
    const subtotal = modelRows.reduce((sum, d) => sum + d.contribution, 0)
    expect(calc.modelSubtotal).toBeCloseTo(subtotal, 1)
    // No multipliers, no blend: the score is the rounded subtotal (plus any documented penalty).
    expect(calc.statusMultiplier).toBe(1)
    expect(calc.relationshipMultiplier).toBe(1)
    expect(calc.signalCheckTotal).toBeNull()
    expect(calc.finalScore).toBe(packet.score)
    expect(calc.finalScore).toBe(Math.round(Math.min(100, subtotal + (calc.floorApplied ?? 0))))
    expect(calc.steps.map((s) => s.label)).toEqual(expect.arrayContaining(['Dimension subtotal', 'Canonical score']))
  })

  it('cites verbatim source lines for buyer request, budget, timing and access', async () => {
    const packet = await decide(EXTERNAL_AGENCY, [event({
      eventType: 'AGENCY_REQUEST',
      evidenceQuote: 'We are looking for an external software development agency to help us build a customer portal in React.',
    })])
    const row = (key: string) => packet.dimensions.find((d) => d.key === key)!
    const quotesOf = (key: string) => (row(key).evidence ?? []).filter((e) => e.kind === 'quote').map((e) => e.text)
    expect(quotesOf('buyerIntent')[0]).toMatch(/external software development agency/)
    expect(quotesOf('buyerIntent')).toContain('Approved project budget: $20,000')
    expect(quotesOf('timing')[0]).toBe('Expected start: Within 2 weeks.')
    expect(quotesOf('access')[0]).toMatch(/should contact us/)
    for (const d of packet.dimensions) {
      for (const e of d.evidence ?? []) {
        if (e.kind === 'quote') expect(EXTERNAL_AGENCY).toContain(e.text)
      }
    }
    expect(packet.reasons.join(' ')).toMatch(/Budget stated: \$20,000 \(approved\)/)
    expect(row('timing').note).toMatch(/within 2 weeks/i)
    expect(packet.dimensions.some((d) => d.key === 'proofRelevance')).toBe(false)
  })

  it('populates the evidence ledger only with verbatim quotes', async () => {
    const packet = await decide(EXTERNAL_AGENCY, [event({
      eventType: 'AGENCY_REQUEST',
      evidenceQuote: 'We are looking for an external software development agency to help us build a customer portal in React.',
      requestedAssets: ['portfolio'],
    })])
    const verbatim = (packet.evidenceQuotes ?? []).filter((q) => q.verbatim)
    expect(verbatim.length).toBeGreaterThan(0)
    expect((packet.evidenceQuotes ?? []).find((q) => q.quote === 'Requested: portfolio')?.verbatim).toBe(false)
  })

  it('normalizes rows, groups and the calculation for display', () => {
    const rows = normalizeScoreDimensions([
      { key: 'timing', label: 'Timing', contribution: 8.8, weight: 0.1, note: 'n', group: 'model', evidence: [{ text: 'Expected start: Within 2 weeks.', kind: 'quote' }] },
      { key: 'signal_buyerIntent', label: 'Buyer Intent', contribution: 25, weight: 0.25, note: '', group: 'signals', evidence: [{ text: 'Seeking vendor/partner', kind: 'signal' }] },
      { key: 'buyerRequest', label: 'Buyer Request', contribution: 19.6, weight: 0.2, note: '' },
    ])
    expect(rows.map((r) => r.group)).toEqual(['model', 'signals', 'model'])
    expect(rows[0].evidence[0]).toEqual({ text: 'Expected start: Within 2 weeks.', kind: 'quote' })
    expect(rows[2].evidence).toEqual([])
    expect(normalizeScoreCalculation(null)).toBeNull()
    expect(normalizeScoreCalculation({ steps: [{ label: 'Model score', value: '56/100', detail: 'x' }], finalScore: 56 })?.finalScore).toBe(56)
  })
})

describe('PRO-018: saved signal evidence keeps budget and timing', () => {
  it('uses the full opportunity text, not the first 200 characters', () => {
    const v2 = buildMinimalV2Canonical(EXTERNAL_AGENCY)
    const evidence = deriveSignalEvidenceFallback(v2, EXTERNAL_AGENCY)
    expect(evidence).toMatch(/\$20,000/)
    expect(evidence).toMatch(/Within 2 weeks/)
    expect(evidence).not.toMatch(/^Alex Morgan/)
  })
})

describe('PRO-020: extraction completeness is real, not a placeholder 0', () => {
  it('reports completeness from the identity and opportunity fields found', () => {
    expect(buildMinimalV2Canonical(EXTERNAL_AGENCY).extractionCompleteness.score).toBe(100)
    const sparse = buildMinimalV2Canonical('Alex Morgan\nWe are looking for an external agency to build our app.')
    expect(sparse.extractionCompleteness.score).toBeLessThan(100)
    expect(sparse.extractionCompleteness.missingFields).toEqual(expect.arrayContaining(['title', 'company']))
  })
})

describe('PRO-010 … PRO-013: non-prospect input', () => {
  it('hard-fails generic prose as irrelevant without login wording in its reasons', () => {
    const result = evaluateProspectQualification({
      rawText: GENERIC,
      extracted: {
        name: null, title: null, titleRaw: null, company: 'Unknown company', url: null, locationRaw: null,
        aboutSummary: null, experienceSummary: null, recentPosts: [], roleCategory: 'other', marketRegion: 'unknown',
        signalType: 7, signalEvidence: GENERIC, extractionConfidence: 0, confidenceNotes: [], verbatimQuote: null, tags: [],
      },
    })
    expect(result.inputHardFail).toBe(true)
    expect(result.qualificationEligibility).toBe(false)
    expect(result.inputClassification.classification).toBe('IRRELEVANT')
    expect(result.inputClassification.reasons.join(' ')).not.toMatch(/login/i)
  })
})
