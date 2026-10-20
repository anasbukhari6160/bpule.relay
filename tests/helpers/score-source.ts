/**
 * Offline scoring harness for tests and the golden set.
 *
 * Runs the production V3 pipeline (minimal V2 normalization → SourceFacts →
 * deterministic events → evidence graph → episodes → bounded decision →
 * canonical score → confidence → action) with NO network:
 *   - events come from the deterministic extractor unless the fixture
 *     supplies model-style events;
 *   - the bounded decision comes from the fixture's simulated model answers
 *     or, by default, from the deterministic fallback.
 *
 * Simulated model answers let fixtures test the guards: a model that claims
 * BUYER 0.9 on a seller profile must still come out UNKNOWN.
 */

import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import type { V3DecisionProvider } from '@/lib/intelligence-v3/decision/decision-provider'
import type { V3DecisionAnswers } from '@/lib/intelligence-v3/decision/bounded-questions'
import type { V3LeadDecisionPacket, V3OpportunityEpisode, V3BoundedDecision } from '@/lib/intelligence-v3/types'
import { scoreEpisode, type V3ScoreOutput } from '@/lib/intelligence-v3/scoring/score-v3'
import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { resolveVerifiedBuyerIntent } from '@/lib/intelligence-v3/buyer-intent'
import type { ExtractedEvent } from '@/lib/intelligence-v3/event-extractor'

export interface SimulatedModel extends Partial<V3DecisionAnswers> {
  /** Provider confidence 0-1 (defaults to decisiveness of buyer probability). */
  confidence?: number
}

export function stubProvider(answers: SimulatedModel, id = 'stub_model'): V3DecisionProvider {
  const full: V3DecisionAnswers = {
    relationship: answers.relationship ?? 'UNKNOWN',
    buyerRequestProbability: answers.buyerRequestProbability ?? 0.2,
    externalNeedProbability: answers.externalNeedProbability ?? 0.2,
    needOwner: answers.needOwner ?? 'UNKNOWN',
    fit: answers.fit ?? 'MEDIUM',
    timing: answers.timing ?? 'WEAK',
    access: answers.access ?? 'INDIRECT',
    messageEligible: answers.messageEligible ?? 0.3,
  }
  return {
    id,
    modelVersion: `${id}_v1`,
    isAvailable: () => true,
    decide: async () => ({
      answers: full,
      providerId: id,
      modelVersion: `${id}_v1`,
      latencyMs: 0,
      confidence: answers.confidence ?? Math.round(2 * Math.abs(full.buyerRequestProbability - 0.5) * 100) / 100,
    }),
  }
}

export interface RunOptions {
  model?: SimulatedModel | null
  events?: ExtractedEvent[]
  referenceDate?: Date
  orgCapabilities?: string[]
}

/** Full pipeline, no network. Returns the decision packet. */
export async function runOffline(rawText: string, opts: RunOptions = {}): Promise<V3LeadDecisionPacket> {
  const result = await produceV3Intelligence(rawText, {
    decisionProvider: opts.model ? stubProvider(opts.model) : null,
    deterministicOnly: !opts.model,
    events: opts.events,
    // Never call the event-extraction model from tests: events come from the
    // fixture or the deterministic extractor, so runs are reproducible offline.
    skipEventModel: true,
    referenceDate: opts.referenceDate,
    orgCapabilities: opts.orgCapabilities,
  })
  if (!result.v3Packet) throw new Error('runOffline produced no packet')
  return result.v3Packet
}

/** Synchronous single-episode score for a source, for dimension-level assertions. */
export function scoreSourceForTest(rawText: string, decision: Partial<V3BoundedDecision> = {}): V3ScoreOutput {
  const facts = readSourceFacts(rawText)
  const d: V3BoundedDecision = {
    relationship: decision.relationship ?? 'UNKNOWN',
    buyerRequestProbability: decision.buyerRequestProbability ?? 0.2,
    externalNeedProbability: decision.externalNeedProbability ?? 0.2,
    needOwnerType: decision.needOwnerType ?? 'UNKNOWN',
    fit: decision.fit ?? 'MEDIUM',
    timing: decision.timing ?? 'WEAK',
    access: decision.access ?? 'INDIRECT',
    messageEligible: decision.messageEligible ?? 0.3,
    providerConfidence: decision.providerConfidence ?? 0.5,
  }
  // A test that passes no model probability is a "no model ran" case: the
  // resolver must not see a fabricated 0.2 as a scorer that disagrees.
  const intent = resolveVerifiedBuyerIntent(facts.buyer, {
    modelBuyerProbability: decision.buyerRequestProbability ?? null,
    modelExternalNeedProbability: decision.externalNeedProbability ?? null,
    modelRelationship: decision.relationship ?? null,
    signalCheck: {
      explicitAsk: facts.signals.intent.explicitAsk,
      seekingVendor: facts.signals.intent.seekingVendor,
      hiring: facts.signals.intent.hiring,
      budgetMentioned: facts.signals.intent.budgetMentioned,
    },
  })
  const episode: V3OpportunityEpisode = {
    id: 'ep_test',
    anchorEvent: { id: 'evt_test', eventType: facts.buyerRequest ? 'PROJECT_REQUEST' : 'OTHER', personId: null, organizationId: null, organizationName: facts.currentCompany, occurredAt: null, channel: null, requestedCapability: facts.capabilityNeeds, targetAudience: 'PUBLIC', explicitness: facts.buyerRequest ? 'EXPLICIT' : 'INFERRED', applyInstructions: [], evidenceRefs: [], polarity: 'ACTIVE' },
    organizationId: null,
    organizationName: facts.currentCompany,
    needOwnerPersonId: null,
    needOwnerType: facts.buyerRequest ? 'ORGANIZATION_NEED' : 'UNKNOWN',
    explicitRequest: intent.verifiedBuyerRequest,
    requestedCapabilities: facts.capabilityNeeds,
    applicationChannels: [],
    evidenceRefs: [],
    eventRefs: [],
    status: facts.recentPostAgeDays === null ? 'UNKNOWN' : facts.recentPostAgeDays < 14 ? 'CURRENT' : facts.recentPostAgeDays < 45 ? 'AGING' : 'STALE',
    detectedAt: new Date().toISOString(),
    lastActivityAt: null,
    ageDays: facts.recentPostAgeDays,
  }
  return scoreEpisode({ episode, decision: d, rawText, sourceFacts: facts, buyerIntent: intent, episodeQuotes: facts.buyerRequest ? [facts.buyerRequest] : [] })
}
