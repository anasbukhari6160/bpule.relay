/**
 * Candidate B — calibrated deterministic engine.
 *
 * Structure (Phase 9/10/11): intent and account value are computed as two
 * independent 0-1 quantities, then mixed with fit, authority, access, timing
 * and evidence. Unknown intent contributes ZERO to the mix — it is the
 * account value, fit and authority that separate an excellent unknown-intent
 * account from a mediocre one. The mix weights are fitted offline against
 * labelled ranges (see models/calibrated-v4.params.ts); nothing here is
 * tuned by hand against a single lead.
 */

import { qualifyCanonicalScore } from '@/lib/scoring/qualification'
import type { OpportunityFeatures } from '../opportunity-features'
import { requestAgeFactor } from '../opportunity-features'
import { CALIBRATED_V4_PARAMS, type CalibratedV4Params } from '../models/calibrated-v4.params'
import { applyGuards } from './guards'
import type { CandidateScore, OpportunityScorer } from './types'

const MATURITY: Record<OpportunityFeatures['accountValue']['companyMaturity'], number> = { UNKNOWN: 0.1, PRE_PRODUCT: 0.25, EARLY: 0.45, GROWING: 0.7, ESTABLISHED: 0.85, ENTERPRISE: 1 }
const BUILD: Record<OpportunityFeatures['accountValue']['buildIntensity'], number> = { NONE: 0, LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8, VERY_HIGH: 1 }
const COMPLEXITY: Record<OpportunityFeatures['accountValue']['technicalComplexity'], number> = { NONE: 0, LOW: 0.33, MODERATE: 0.66, HIGH: 1 }
const TIMING: Record<OpportunityFeatures['buyerTiming'], number> = { NONE: 0, WEAK: 0.35, CURRENT: 0.8, URGENT: 1 }
const RECENCY: Record<OpportunityFeatures['activityRecency'], number> = { FRESH: 1, RECENT: 0.75, AGING: 0.45, STALE: 0.15, UNKNOWN: 0.4 }

export function intentValue(f: OpportunityFeatures, p: CalibratedV4Params = CALIBRATED_V4_PARAMS): number {
  if (f.episodeClosed) return 0
  let v = f.intent.verifiedRequest ? p.intentRaw[f.intent.level] : 0
  // A verified request that scorers contradicted keeps partial credit.
  if (f.intent.verifiedRequest && f.intent.level === 'UNKNOWN') v = 0.4
  if (v > 0 && f.intent.verifiedBudget) v = Math.min(1, v + p.budgetBonus)
  return v * (f.intent.verifiedRequest ? requestAgeFactor(f.intent.requestAgeDays) : 1)
}

export function accountValue(f: OpportunityFeatures, p: CalibratedV4Params = CALIBRATED_V4_PARAMS): number {
  const a = f.accountValue
  const w = p.account
  let v = w.maturity * MATURITY[a.companyMaturity]
    + w.build * BUILD[a.buildIntensity]
    + w.complexity * COMPLEXITY[a.technicalComplexity]
    + w.outsourcing * a.outsourcingPlausibility
    + w.hiring * (a.hiringCurrent ? Math.min(1, 0.6 + a.hiringCount * 0.1) : 0)
    + w.funding * (a.fundingSignal ? 1 : 0)
    + w.product * (a.currentProductActivity ? 1 : 0)
  if (f.relationshipRole === 'CANDIDATE') v = Math.min(v, 0.2)
  if (f.relationshipRole === 'RECRUITER' && !f.intent.verifiedRequest) v = Math.min(v, 0.25)
  return Math.max(0, Math.min(1, v))
}

export function scoreCalibratedV4(f: OpportunityFeatures, p: CalibratedV4Params = CALIBRATED_V4_PARAMS): CandidateScore {
  const intent = intentValue(f, p)
  const account = accountValue(f, p)
  const fit = p.fitRaw[f.fit.level]
  const authority = f.relationshipRole === 'CANDIDATE' ? Math.min(f.authority.decisionAuthority, 0.15)
    : f.relationshipRole === 'RECRUITER' && !f.intent.verifiedRequest ? Math.min(f.authority.decisionAuthority, 0.2)
      : f.authority.decisionAuthority
  const access = f.access.raw
  const timing = f.intent.verifiedRequest ? TIMING[f.buyerTiming] * 0.6 + RECENCY[f.activityRecency] * 0.4 : RECENCY[f.activityRecency] * 0.4
  const evidence = f.evidenceQuality

  const w = p.weights
  const mix = w.intent * intent + w.account * account + w.fit * fit + w.authority * authority + w.access * access + w.timing * timing + w.evidence * evidence
  const raw = p.rescale.a + p.rescale.b * mix
  const { score, guards } = applyGuards(raw, f)

  const reasons: string[] = []
  if (intent >= 0.6) reasons.push('Verified request to buy outside services')
  else if (intent > 0) reasons.push('Request in the source, partially verified')
  if (account >= 0.6) reasons.push('High account value: active, maturing organisation likely to need outside delivery')
  else if (account >= 0.4) reasons.push('Moderate account value')
  if (fit >= 0.65) reasons.push(`Capability fit ${f.fit.level.toLowerCase()}`)
  if (authority >= 0.75) reasons.push('Decision-maker')
  if (intent === 0 && account >= 0.5 && fit >= 0.45) reasons.push('Unknown intent but a valuable account — relationship target')

  // Confidence in the band: distance from the nearest band edge, shrunk by
  // thin sources, contradictions and fallbacks.
  const q = qualifyCanonicalScore(score)
  const edge = Math.min(score - q.min, q.max - score)
  let confidence = Math.min(1, 0.45 + edge / 20)
  confidence *= 0.6 + 0.4 * (f.sourceCompleteness / 100)
  if (f.contradictions > 0) confidence *= 0.7
  if (f.fallbackUsed) confidence *= 0.8
  if (f.activityRecency === 'UNKNOWN') confidence *= 0.85

  return {
    engine: 'calibrated_v4',
    version: p.version,
    score,
    rawScore: Math.round(raw),
    qualification: q.qualification,
    accountValue: Math.round(account * 100),
    intentValue: Math.round(intent * 100),
    confidence: Math.round(confidence * 100) / 100,
    guards,
    reasons,
  }
}

export const calibratedV4Engine: OpportunityScorer = {
  id: 'calibrated_v4',
  version: CALIBRATED_V4_PARAMS.version,
  score: (f) => scoreCalibratedV4(f),
}
