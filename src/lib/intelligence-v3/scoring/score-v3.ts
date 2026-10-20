/**
 * Canonical Opportunity Score — V3.2
 *
 * Scores OPPORTUNITY EPISODES, not persons. One formula, seven bounded,
 * additive dimensions, no hidden floors, no multiplicative collapse, no
 * second scorer blended in.
 *
 *   buyerIntent          0.25   verified request / canonical buyer decision
 *   commercialPotential  0.20   could this org plausibly become a customer
 *   fit                  0.15   org-level capability overlap (sender-independent)
 *   authority            0.10   decision authority of the person
 *   timing               0.10   buyer timing (60%) + activity recency (40%)
 *   access               0.10   one access authority
 *   evidenceQuality      0.10   verbatim support, completeness, corroboration
 *
 * Bounded adjustments (each documented, each visible in the trace):
 *   - CLOSED/negated episode: buyer intent and timing credit withdrawn; SKIP.
 *   - COMPETITOR relationship (model): −6 points. A direct competitor rarely
 *     buys the same services; the penalty is small so a verified request
 *     from a competitor still ranks above a passive founder.
 *
 * "Unknown" lowers confidence (separate object); it never halves the score.
 * Changing the sender never changes this score: proof relevance lives in
 * Sender Match (rankSendersForLead), not here.
 */

import type {
  V3OpportunityEpisode,
  V3BoundedDecision,
  CommercialPotentialAssessment,
  V3DimensionEvidence,
  V3DimensionGroup,
  V3ScoreCalculation,
  V3ScoreCalculationStep,
} from '../types'
import { V3_SCORING_WEIGHTS } from '../config'
import { readSourceFacts, type SourceFacts } from '../source-facts-model'
import { resolveBuyerIntentFromSource, resolveVerifiedBuyerIntent, type VerifiedBuyerIntent } from '../buyer-intent'
import {
  assessCommercialPotentialFromFacts,
  assessEvidenceQuality,
  isSoftwareServicesSeller,
  resolveAccess,
  resolveAuthorityDimension,
  resolveCapabilityFit,
  resolveTiming,
  type AccessResolution,
  type CommercialPotentialResolution,
  type FitResolution,
  type TimingResolution,
  type AuthorityResolution,
  type EvidenceQualityResolution,
} from '../dimensions'
import { qualifyCanonicalScore, type CanonicalQualification } from '@/lib/scoring/qualification'
import { detectCommercialRequest } from '../source-facts'

export interface V3ScoreInput {
  episode: V3OpportunityEpisode
  decision: V3BoundedDecision
  /** Raw source text; SourceFacts are read from it when not passed. */
  rawText?: string
  /** Pre-read SourceFacts (preferred — read once per analysis). */
  sourceFacts?: SourceFacts
  /** The canonical buyer decision; resolved from source + model claims when not passed. */
  buyerIntent?: VerifiedBuyerIntent
  /** Verbatim source quotes attached to this episode, for row evidence. */
  episodeQuotes?: string[]
  /** Organization capability set for fit (defaults to the agency's). */
  orgCapabilities?: string[]
  /** @deprecated kept for callers that pass it; ignored by the formula. */
  proofRelevance?: number
  /** @deprecated kept for callers that pass it; evidence quality is read from facts. */
  evidenceQuality?: number
  /** @deprecated ignored — commercial potential is assessed from SourceFacts. */
  commercialPotential?: CommercialPotentialAssessment
  /** @deprecated ignored — sender data never enters the opportunity score. */
  senderCapabilities?: string[]
}

export interface V3ScoreDimension {
  key: string
  label: string
  contribution: number
  raw: number
  weight: number
  note: string
  group?: V3DimensionGroup
  evidence?: V3DimensionEvidence[]
}

export interface V3ScoreOutput {
  score: number
  label: string
  qualification: CanonicalQualification | 'INELIGIBLE'
  reasons: string[]
  watchOut: string[]
  dimensions: V3ScoreDimension[]
  calculation?: V3ScoreCalculation
  /** Resolved dimension objects, for the packet and the decision trace. */
  resolved?: {
    access: AccessResolution
    timing: TimingResolution
    fit: FitResolution
    authority: AuthorityResolution
    commercialPotential: CommercialPotentialResolution
    evidenceQuality: EvidenceQualityResolution
  }
}

export const COMPETITOR_PENALTY = 6

/** SourceFacts for this input; read once and cached on the input. */
export function sourceFactsFor(input: V3ScoreInput): SourceFacts {
  if (!input.sourceFacts) input.sourceFacts = readSourceFacts(input.rawText ?? '')
  return input.sourceFacts
}

/** The canonical buyer decision for this input; resolved from source + model claims when not passed. */
export function buyerIntentFor(input: V3ScoreInput): VerifiedBuyerIntent {
  if (!input.buyerIntent) {
    const facts = sourceFactsFor(input)
    input.buyerIntent = resolveVerifiedBuyerIntent(facts.buyer, {
      modelBuyerProbability: input.decision.buyerRequestProbability,
      modelExternalNeedProbability: input.decision.externalNeedProbability,
      modelRelationship: input.decision.relationship,
      signalCheck: {
        explicitAsk: facts.signals.intent.explicitAsk,
        seekingVendor: facts.signals.intent.seekingVendor,
        hiring: facts.signals.intent.hiring,
        budgetMentioned: facts.signals.intent.budgetMentioned,
      },
    })
  }
  return input.buyerIntent
}

/** Kept for the decision assembler's guards. */
export function isEmploymentHiringNotPurchase(
  rawText: string | undefined,
  episode?: Pick<V3OpportunityEpisode, 'anchorEvent' | 'explicitRequest'> | null,
): boolean {
  const text = rawText ?? ''
  const facts = detectCommercialRequest(text)
  if (facts.externalServiceRequest) return false
  if (facts.employmentHiring) return true
  if (isCandidateSeeking(text)) return true
  return episode?.anchorEvent?.eventType === 'HIRING' && !episode.explicitRequest
}

export function isCandidateSeeking(text: string): boolean {
  const lower = text.toLowerCase()
  if (/i'?m\s+(?:open\s+to|looking\s+for|seeking|available\s+for)\s+.{0,30}?(?:contract|full[- ]time|part[- ]time|freelance|work|opportunities|roles|positions|gigs|projects)/i.test(lower)) return true
  if (/if\s+you(?:'|')?re\s+(?:hiring|looking|seeking)\b[^.]*(?:let'?s?\s+(?:connect|talk|chat)|dm\s+(?:me|us)|reach\s+(?:out|me)|contact\s+(?:me|us)|know\s+(?:great|good|awesome))/i.test(lower)) return true
  if (/i\s+(?:am|m)\s+(?:open|available|interested)\s+to\s+(?:new\s+)?(?:opportunities|work|roles|projects)/i.test(lower)) return true
  if (/looking\s+for\s+(?:my\s+)?(?:next\s+(?:role|position|opportunity|gig|project))/i.test(lower)) return true
  return false
}

function quote(line: string | null | undefined): V3DimensionEvidence[] {
  return line ? [{ text: line, kind: 'quote' }] : []
}

function fmt(n: number, digits = 2): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits)
}

/**
 * A request ages. Within a quarter it is current; by six months it is
 * aging; after a year it is history that supports credibility, not a
 * current buying signal.
 */
export function requestAgeFactor(ageDays: number | null): number {
  if (ageDays === null) return 1
  if (ageDays <= 90) return 1
  if (ageDays <= 180) return 0.8
  if (ageDays <= 365) return 0.6
  return 0.35
}

/** Buyer-intent dimension value from the canonical decision only. */
export function buyerIntentRaw(intent: VerifiedBuyerIntent, requestAgeDays: number | null = null): number {
  const age = requestAgeFactor(requestAgeDays)
  if (intent.buyerIntentLevel === 'HIGH') return Math.min(1, 0.9 + (intent.verifiedBudget ? 0.1 : 0)) * age
  if (intent.buyerIntentLevel === 'MEDIUM') return Math.min(1, 0.65 + (intent.verifiedBudget ? 0.1 : 0) + (intent.askingForHelp ? 0.05 : 0)) * age
  // UNKNOWN: a verified request that scorers contradicted keeps some credit;
  // otherwise the capped effective probability (≤0.25 unverified, ≤0.2
  // non-buyer). Unknown is not negative — but it is never evidence either.
  if (intent.verifiedBuyerRequest) return 0.4 * age
  return Math.min(0.25, intent.effectiveBuyerProbability)
}

export function scoreEpisode(input: V3ScoreInput): V3ScoreOutput {
  const { episode, decision } = input
  const facts = sourceFactsFor(input)
  const intent = buyerIntentFor(input)
  const reasons: string[] = []
  const watchOut: string[] = []
  const dimensions: V3ScoreDimension[] = []
  const steps: V3ScoreCalculationStep[] = []
  const W = V3_SCORING_WEIGHTS

  const closed = episode.status === 'CLOSED'
  const requestLine = intent.evidence.find((e) => e.kind === 'buyer_request')?.text ?? null
  const hiringLine = intent.evidence.find((e) => e.kind === 'hiring')?.text ?? null
  const budgetLine = intent.verifiedBudget ? intent.evidence.find((e) => e.kind === 'budget')?.text ?? null : null
  const episodeQuotes = (input.episodeQuotes ?? []).filter(Boolean)

  // ── 1. Buyer intent ───────────────────────────────────────────────────
  const requestAge = facts.buyerRequestAgeDays ?? (intent.verifiedBuyerRequest ? episode.ageDays : null)
  const biRaw = closed ? 0 : Math.round(buyerIntentRaw(intent, requestAge) * 100) / 100
  const ageNote = intent.verifiedBuyerRequest && requestAge !== null && requestAge > 90 ? ` — request is ${requestAge}d old` : ''
  dimensions.push({
    key: 'buyerIntent',
    label: 'Buyer Intent',
    contribution: biRaw * W.buyerIntent * 100,
    raw: biRaw,
    weight: W.buyerIntent,
    group: 'model',
    note: closed
      ? 'Episode closed or negated — no current request'
      : intent.contradictions.length > 0
        ? 'Buyer signals disagree — treated as unknown'
        : intent.buyerIntentLevel === 'HIGH'
          ? `Explicit request to an external provider (verified)${intent.verifiedBudget ? ', budget stated' : ''}${ageNote}`
          : intent.buyerIntentLevel === 'MEDIUM'
            ? `Verified request; scorer agreement partial${ageNote}`
            : intent.relationshipRole === 'SELLER'
              ? 'Seller-side content — no request to buy'
              : intent.relationshipRole === 'RECRUITER'
                ? 'Recruiter — hiring for clients, not buying services'
                : intent.relationshipRole === 'CANDIDATE'
                  ? 'Candidate seeking work — not a buyer'
                  : intent.verifiedHiringNeed
                    ? 'Hiring employees — not a request for outside services'
                    : 'No request for outside help in the source',
    evidence: requestLine
      ? [...quote(requestLine), ...quote(budgetLine)]
      : hiringLine
        ? quote(hiringLine)
        : episodeQuotes.length > 0
          ? episodeQuotes.slice(0, 1).map((text) => ({ text, kind: 'quote' as const }))
          : [{ text: 'No request for outside help in the source', kind: 'inference' }],
  })
  if (intent.buyerIntentLevel === 'HIGH') reasons.push('Explicit buyer request detected (verified)')
  else if (intent.buyerIntentLevel === 'MEDIUM') reasons.push('Buyer request verified in the source')
  if (intent.verifiedBuyerRequest && requestAge !== null && requestAge > 180) watchOut.push(`The request is ${requestAge} days old — confirm it is still open`)
  if (budgetLine) reasons.push(`Budget stated: ${facts.budgetEvidence?.amount ?? 'stated'}${facts.budgetEvidence?.approved ? ' (approved)' : ''}`)
  if (intent.contradictions.length > 0) watchOut.push('Buyer signals disagree — intent treated as UNKNOWN')
  if (!intent.verifiedBuyerRequest && (intent.claims.modelBuyerProbability ?? 0) >= 0.7) watchOut.push('Model claimed buyer intent the source does not state — not credited')
  if (intent.verifiedHiringNeed && !intent.verifiedBuyerRequest) watchOut.push('Employee hiring is not a request to buy services')
  if (biRaw < 0.3 && !closed) watchOut.push('No clear buyer request signal')

  // ── 2. Commercial potential ───────────────────────────────────────────
  const cp = assessCommercialPotentialFromFacts(facts, intent)
  dimensions.push({
    key: 'commercialPotential',
    label: 'Commercial Potential',
    contribution: cp.raw * W.commercialPotential * 100,
    raw: cp.raw,
    weight: W.commercialPotential,
    group: 'model',
    note: cp.note,
    evidence: cp.evidence,
  })
  const cpHigh = cp.overallPotential === 'HIGH' || cp.overallPotential === 'VERY_HIGH'
  if (cpHigh && biRaw < 0.4) reasons.push('High commercial potential despite no explicit buyer request')
  else if (cpHigh) reasons.push('Strong commercial potential')

  // ── 3. Fit ────────────────────────────────────────────────────────────
  const fit = resolveCapabilityFit(facts, decision.fit, input.orgCapabilities, { relationshipRole: intent.relationshipRole, verifiedBuyerRequest: intent.verifiedBuyerRequest })
  dimensions.push({
    key: 'fit',
    label: 'Capability Fit',
    contribution: fit.raw * W.fit * 100,
    raw: fit.raw,
    weight: W.fit,
    group: 'model',
    note: `Fit: ${fit.level.toLowerCase()} — ${fit.note}`,
    evidence: fit.evidence,
  })
  if (fit.raw >= 0.7) reasons.push('Strong capability fit')
  if (fit.level === 'UNKNOWN') watchOut.push('Capability fit unverified — no stack or need named')

  // ── 4. Authority ──────────────────────────────────────────────────────
  const authority = resolveAuthorityDimension(facts, intent)
  dimensions.push({
    key: 'authority',
    label: 'Authority',
    contribution: authority.raw * W.authority * 100,
    raw: authority.raw,
    weight: W.authority,
    group: 'model',
    note: authority.note,
    evidence: authority.evidence,
  })
  if (authority.raw >= 0.75) reasons.push('Decision-maker role')

  // ── 5. Timing ─────────────────────────────────────────────────────────
  const timing = resolveTiming(facts, intent, episode, decision.timing)
  const timingRaw = closed ? Math.min(timing.raw, 0.15) : timing.raw
  dimensions.push({
    key: 'timing',
    label: 'Timing',
    contribution: timingRaw * W.timing * 100,
    raw: timingRaw,
    weight: W.timing,
    group: 'model',
    note: closed ? 'Episode closed — timing credit withdrawn' : timing.note,
    evidence: timing.evidence,
  })
  if (timing.buyerTiming === 'URGENT') reasons.push(`Start or deadline stated: ${facts.timelineEvidence?.label ?? 'soon'}`)
  else if (timing.buyerTiming === 'CURRENT') reasons.push('Current buyer timing')
  if (timing.urgencyRejected) watchOut.push('Urgent timing claimed by the model — not verified against source dates')
  if (timing.activityRecency === 'STALE') watchOut.push('Most recent activity is stale')
  if (timing.activityRecency === 'UNKNOWN') watchOut.push('No post date or start date in the source')

  // ── 6. Access ─────────────────────────────────────────────────────────
  const access = resolveAccess(facts, decision.access, { relationshipRole: intent.relationshipRole, verifiedBuyerRequest: intent.verifiedBuyerRequest })
  dimensions.push({
    key: 'access',
    label: 'Access',
    contribution: access.raw * W.access * 100,
    raw: access.raw,
    weight: W.access,
    group: 'model',
    note: `Access: ${access.level} — ${access.reasons[0] ?? ''}`,
    evidence: access.evidence,
  })
  if (access.level === 'DIRECT') reasons.push('Direct access available')

  // ── 7. Evidence quality ───────────────────────────────────────────────
  const eq = assessEvidenceQuality(facts, intent, { evidenceCount: episode.evidenceRefs.length, verbatimCount: episodeQuotes.length })
  dimensions.push({
    key: 'evidenceQuality',
    label: 'Evidence Quality',
    contribution: eq.raw * W.evidenceQuality * 100,
    raw: eq.raw,
    weight: W.evidenceQuality,
    group: 'model',
    note: eq.note,
    evidence: eq.evidence,
  })
  if (eq.raw < 0.4) watchOut.push('Limited evidence — research before acting')

  // ── Aggregate ─────────────────────────────────────────────────────────
  const subtotal = dimensions.reduce((sum, d) => sum + d.contribution, 0)
  steps.push({ label: 'Dimension subtotal', value: `${fmt(subtotal)}/100`, detail: 'Sum of the seven weighted dimensions. No multipliers.' })

  let adjusted = subtotal
  let penaltyApplied: number | null = null
  const competitor = !intent.verifiedBuyerRequest
    && (decision.relationship === 'COMPETITOR' || (intent.relationshipRole === 'SELLER' && isSoftwareServicesSeller(facts)))
  if (competitor) {
    adjusted -= COMPETITOR_PENALTY
    penaltyApplied = -COMPETITOR_PENALTY
    steps.push({ label: 'Competitor context', value: `−${COMPETITOR_PENALTY}`, detail: 'Sells software delivery or consulting themselves and has no verified request to buy.' })
    watchOut.push('Sells the same services — treat as a competitor unless they ask for help')
  }

  const score = Math.round(Math.max(0, Math.min(100, adjusted)))
  steps.push({ label: 'Canonical score', value: `${score}/100`, detail: 'Rounded, bounded 0-100.' })

  const band = qualifyCanonicalScore(score)
  let qualification: V3ScoreOutput['qualification'] = band.qualification
  let finalReasons = reasons
  if (closed && qualification !== 'SKIP') {
    qualification = 'SKIP'
    finalReasons = ['Episode closed — not resurrected']
    steps.push({ label: 'Closed episode', value: 'SKIP', detail: 'A closed or negated episode is never qualified.' })
  }

  return {
    score,
    label: closed ? 'Closed episode' : band.label,
    qualification,
    reasons: [...new Set(finalReasons)],
    watchOut: [...new Set(watchOut)],
    dimensions,
    calculation: {
      modelSubtotal: Math.round(subtotal * 100) / 100,
      statusMultiplier: 1,
      relationshipMultiplier: 1,
      modelScore: score,
      signalCheckTotal: null,
      modelWeight: 1,
      floorApplied: penaltyApplied,
      finalScore: score,
      steps,
    },
    resolved: { access, timing, fit, authority, commercialPotential: cp, evidenceQuality: eq },
  }
}

/** Convenience for callers without a model: score a source with the deterministic decision. */
export function scoreSourceWithoutModel(rawText: string, episode: V3OpportunityEpisode, decision: V3BoundedDecision): V3ScoreOutput {
  const facts = readSourceFacts(rawText)
  return scoreEpisode({ episode, decision, rawText, sourceFacts: facts, buyerIntent: resolveBuyerIntentFromSource(rawText) })
}
