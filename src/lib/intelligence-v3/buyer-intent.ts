/**
 * Canonical buyer-intent authority.
 *
 * ONE function decides whether a prospect is asking to buy:
 * resolveVerifiedBuyerIntent(sourceFacts, attributionAudit).
 *
 *  - sourceFacts: what the pasted source itself states, read once, line by
 *    line, with seller ownership and career history already separated out.
 *  - attributionAudit: what each scorer CLAIMS (the opportunity model's
 *    probabilities, the deterministic signal check's raw matches).
 *
 * Scorers, action policy, strategy and UI consume the returned object; none
 * may infer buyer intent from raw text on its own. A claim the source does
 * not support is never credited, and two scorers that disagree fail closed
 * to UNKNOWN with the contradiction recorded for the debug trace.
 */

import {
  classifyLine,
  detectSellerOwnership,
  isRecruiterProfile,
  detectTerminalState,
  isInstructionLine,
  type SourceLine,
} from './source-facts'
import { splitCurrentAndPastLines } from './current-org'
import { classifyTemporalProvenance, isHistoricalYear, verifyBudgetProvenance, verifyHiringProvenance } from '@/lib/scoring/signal-attribution'
import { parseHiringCount } from '@/lib/evidence/provenance'
import { ML_CANDIDATE_SEEKING, ML_FOUNDER_ROLE, ML_PAST_PHRASE, mlMatches } from './multilingual'

/** Bump when buyer-intent rules change; part of the V3 decision reuse key. */
export const BUYER_INTENT_VERSION = 'buyer_intent_v5'

export type BuyerIntentLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
export type RelationshipRole = 'BUYER' | 'BUYER_AND_SELLER' | 'SELLER' | 'BUILDER' | 'RECRUITER' | 'CANDIDATE' | 'UNKNOWN'

/** A verified buy keeps buyer scoring. Selling as well does not remove it. */
export function isBuyerRelationship(role: RelationshipRole | null | undefined): boolean {
  return role === 'BUYER' || role === 'BUYER_AND_SELLER'
}

/**
 * WRONG_SELLER is a buyer label with seller activity and no separate
 * verified request. A verified buy, including BUYER_AND_SELLER, is not an error.
 */
export function isWrongSellerClassification(role: string | null | undefined, sellerActivity: boolean, independentBuyerEvidence: boolean): boolean {
  return role === 'BUYER' && sellerActivity && !independentBuyerEvidence
}

export interface BuyerBudgetFact {
  line: string
  /** Amount when the line states one ("$5k/month"); null for "Budget approved for Q1". */
  amount: string | null
  approved: boolean
}

export interface BuyerSourceFacts {
  /** A current, prospect-owned request to an external provider. */
  externalServiceRequest: SourceLine | null
  /** The prospect asking for help in their own words ("we need outside help"). */
  helpRequest: SourceLine | null
  /** Current employee hiring at the prospect's own organization. */
  employmentHiring: SourceLine | null
  hiringUrgent: boolean
  /** Budget line that passed provenance (current, not an example, metric or seller pricing). */
  statedBudget: BuyerBudgetFact | null
  sellerLines: string[]
  recruiter: boolean
  candidateSeeking: boolean
  founderOrBuilder: boolean
  /** The newest explicit terminal state: do-not-contact, filled, completed. */
  terminalState: { kind: 'DO_NOT_CONTACT' | 'CLOSED' | 'COMPLETED' | 'PARTNER_SELECTED'; line: string; index: number } | null
}

export interface BuyerAttributionAudit {
  /** Opportunity model buyer-request probability (0-1), when a model ran. */
  modelBuyerProbability?: number | null
  modelExternalNeedProbability?: number | null
  modelRelationship?: string | null
  /** Deterministic signal check's raw claims, when it ran. */
  signalCheck?: {
    explicitAsk?: boolean
    seekingVendor?: boolean
    hiring?: boolean
    budgetMentioned?: boolean
  } | null
}

export interface BuyerIntentEvidence {
  kind: 'buyer_request' | 'hiring' | 'budget' | 'seller_offering' | 'recruiter' | 'contradiction'
  text: string
}

export interface VerifiedBuyerIntent {
  version: string
  buyerIntentLevel: BuyerIntentLevel
  verifiedBuyerRequest: boolean
  verifiedHiringNeed: boolean
  verifiedBudget: boolean
  verifiedExternalNeed: boolean
  /** The prospect asks for help in their own words, alongside a verified request. */
  askingForHelp: boolean
  /** Hiring need stated with urgency ("immediately", "ASAP"). */
  hiringUrgent: boolean
  /** The source also promotes what the prospect sells. */
  sellerSideContent: boolean
  relationshipRole: RelationshipRole
  evidence: BuyerIntentEvidence[]
  /** 0-1: how sure the canonical decision is. */
  confidence: number
  /** Scorer disagreements; any entry forces buyerIntentLevel UNKNOWN. */
  contradictions: string[]
  /** Buyer-request probability every scorer must use instead of the model's raw value. */
  effectiveBuyerProbability: number
  /** External-need probability every scorer must use instead of the model's raw value. */
  effectiveExternalNeedProbability: number
  /** What the scorers claimed, kept for the debug trace only — never for display. */
  claims: {
    modelBuyerProbability: number | null
    modelExternalNeedProbability: number | null
    modelRelationship: string | null
    signalCheck: BuyerAttributionAudit['signalCheck']
  }
  /** The newest explicit terminal state, when the source closed the opportunity. */
  terminalState: { kind: 'DO_NOT_CONTACT' | 'CLOSED' | 'COMPLETED' | 'PARTNER_SELECTED'; line: string; index: number } | null
}

const HIRING_URGENT = /\b(?:immediately|asap|urgent(?:ly)?|right\s+now|this\s+week|starting\s+now)\b/i
const CANDIDATE = /\b(?:i(?:'|’)?m|i\s+am)\s+(?:open\s+to|looking\s+for|seeking|available\s+for)\s+(?:my\s+|a\s+|new\s+){0,2}(?:contract|full[- ]time|part[- ]time|freelance|work|opportunities|opportunity|roles?|positions?|next\s+(?:role|opportunity|position|challenge))\b|\bopen\s+to\s+work\b|#opentowork\b|\bavailable\s+for\s+(?:contract|freelance)\s+(?:work|projects)\b|\blooking\s+for\s+my\s+next\s+(?:role|opportunity|position|challenge)\b|\b(?:seeking|looking\s+for)\s+(?:a\s+)?(?:cto|vp|head|senior|staff|lead)\s+(?:\w+\s+){0,2}?(?:position|role)\b|\bmy\s+role\s+was\s+affected\b/i
const FOUNDER = /\b(?:founder|co-?founder|ceo|cto|owner|building)\b/i
/** A request told as a story ("we started looking for an agency") is past, not a current ask. */
const PAST_NARRATIVE = /\b(?:started|began|were|was)\s+(?:looking|searching)\s+for\b|\bwe\s+(?:looked|searched)\s+for\b|\bback\s+then\b/i
const HYPOTHETICAL = /\b(?:thinking\s+about|considering|might|could|would\s+love\s+to|hope\s+to|someday|one\s+day|eventually|if\s+(?:we|i)\s+(?:ever|could|had)|imagine|say\s+you|suppose|pro\s+tip|would\s+you\s+know)\b/i
/** Someone else's post shared by the prospect. Applies to its own block of lines. */
const REPOST = /\b(?:repost(?:ed|ing)?|via\s+@\w+|shared\s+from|originally\s+posted\s+by|courtesy\s+of|great\s+(?:post|thread|insight|advice)\s+from|for\s+a\s+friend)\b/i
const HELP_REQUEST = /\b(?:(?:we|i)\s+(?:really\s+|urgently\s+|also\s+)?need\s+(?:\w+\s+){0,2}help|help\s+us\s+(?:build|ship|scale|fix|automate|rebuild|migrate|launch))\b/i
const BUDGET_LINE = /\b(?:budget(?:ed)?|funded|allocated|fixed\s+price|project\s+value|approved)\b/i
const PRODUCT_METRIC = /\b(?:cpi|ltv|roi|roas|arpu|cac|mrr|arr|revenue|profit|burn\s+rate|runway|churn)\b/i
const MONEY = /(?:[$€£]\s?\d[\d,.]*\s*(?:k|m|million|thousand)?(?:\s*\/\s*(?:month|mo|hour|hr|week))?|\b\d[\d,.]*\s*(?:k|m)?\s*(?:usd|eur|gbp|dollars)\b)/i

/** UNVERIFIED claims are capped here; seller/recruiter/contradicted claims lower still. */
const UNVERIFIED_CAP = 0.35
const NON_BUYER_CAP = 0.2

/** Read every buyer-relevant fact from the source once. Pure, no AI. */
export function readBuyerSourceFacts(rawText: string): BuyerSourceFacts {
  const text = rawText ?? ''
  const all = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const pastLines = new Set(splitCurrentAndPastLines(text).pastLines)
  const seller = detectSellerOwnership(text)
  const sellerSet = new Set(seller.lines)

  const inRepostBlock = (idx: number) => all.slice(Math.max(0, idx - 3), idx + 1).some((l) => REPOST.test(l))
  const usable = (line: string, idx: number) =>
    !pastLines.has(line)
    && classifyTemporalProvenance(line) !== 'HISTORICAL'
    && !isHistoricalYear(line)
    && !PAST_NARRATIVE.test(line)
    && !ML_PAST_PHRASE.test(line)
    && !HYPOTHETICAL.test(line)
    && !isInstructionLine(line)
    && !inRepostBlock(idx)

  let helpRequest: SourceLine | null = null
  let statedBudget: BuyerBudgetFact | null = null
  const requestCandidates: Array<{ line: string; idx: number }> = []
  const hiringCandidates: Array<{ line: string; idx: number }> = []

  all.forEach((line, idx) => {
    const kind = classifyLine(line)
    // A line the prospect owns as a sales pitch is not a request to buy.
    if (kind === 'external_request' && usable(line, idx) && !sellerSet.has(line)) requestCandidates.push({ line, idx })
    if (kind === 'employment_hiring' && usable(line, idx) && verifyHiringProvenance(line).valid) hiringCandidates.push({ line, idx })
    if (!helpRequest && !sellerSet.has(line) && HELP_REQUEST.test(line) && usable(line, idx)) helpRequest = { line }
    if (!statedBudget && BUDGET_LINE.test(line) && !sellerSet.has(line) && !PRODUCT_METRIC.test(line)
      && usable(line, idx) && verifyBudgetProvenance(line).valid) {
      statedBudget = {
        line,
        amount: line.match(MONEY)?.[0].replace(/\s+/g, ' ').replace(/[.,]+$/, '').trim() ?? null,
        approved: /\b(?:approved|allocated|confirmed|secured|signed[- ]off)\b/i.test(line),
      }
    }
  })

  // Latest explicit state wins (QA BUG-PRO-022): a terminal line that appears
  // after the request overrides historical buying intent; a request that
  // appears after the terminal is the current one.
  const terminal = detectTerminalState(text)
  const pickCurrent = (candidates: Array<{ line: string; idx: number }>): SourceLine | null => {
    if (candidates.length === 0) return null
    if (!terminal) return { line: candidates[0].line }
    const after = candidates.filter((c) => c.idx > terminal.index)
    if (after.length > 0) return { line: after[after.length - 1].line }
    return null
  }
  const externalServiceRequest = pickCurrent(requestCandidates)

  // A stated opening ("We have 6 open positions") is a hiring fact too, under
  // the same provenance rules (current, own organization, not a repost).
  let employmentHiring = pickCurrent(hiringCandidates)
  if (!employmentHiring) {
    const counted = parseHiringCount(text)?.sourceQuote?.trim()
    const idx = counted ? all.findIndex((l) => l.includes(counted) || counted.includes(l)) : -1
    if (idx >= 0 && usable(all[idx], idx) && !sellerSet.has(all[idx]) && verifyHiringProvenance(all[idx]).valid) employmentHiring = { line: all[idx] }
  }

  // A request that appears after the terminal state means the opportunity was
  // reopened: the closure no longer governs.
  const reopened = Boolean(
    (externalServiceRequest && terminal && all.indexOf(externalServiceRequest.line) > terminal.index)
    || (employmentHiring && terminal && all.indexOf(employmentHiring.line) > terminal.index),
  )
  const effectiveTerminal = reopened ? null : terminal
  const verifiedBudget = externalServiceRequest && !effectiveTerminal ? statedBudget : null

  const hiring = employmentHiring as SourceLine | null
  const header = all.slice(0, 8).join('\n')
  return {
    externalServiceRequest,
    helpRequest,
    employmentHiring,
    hiringUrgent: Boolean(hiring && HIRING_URGENT.test(hiring.line)),
    statedBudget: verifiedBudget,
    sellerLines: seller.lines,
    recruiter: isRecruiterProfile(text),
    candidateSeeking: CANDIDATE.test(text) || mlMatches(ML_CANDIDATE_SEEKING, text),
    founderOrBuilder: FOUNDER.test(header) || ML_FOUNDER_ROLE.test(header),
    terminalState: effectiveTerminal,
  }
}

/**
 * The canonical buyer decision. Every scorer and surface reads this object;
 * nothing else may decide buyer intent.
 */
export function resolveVerifiedBuyerIntent(
  facts: BuyerSourceFacts,
  audit: BuyerAttributionAudit = {},
): VerifiedBuyerIntent {
  const evidence: BuyerIntentEvidence[] = []
  const contradictions: string[] = []
  const model = typeof audit.modelBuyerProbability === 'number' ? audit.modelBuyerProbability : null
  const modelExternal = typeof audit.modelExternalNeedProbability === 'number' ? audit.modelExternalNeedProbability : null
  const signal = audit.signalCheck ?? null

  // Candidates are never buyers. A recruiter is not a buyer when filling an
  // employer's roles, but a recruiter-titled poster asking for an external
  // agency in their own words is.
  const recruiterOnly = facts.recruiter && facts.externalServiceRequest === null
  const nonBuyerRole = recruiterOnly || facts.candidateSeeking
  // A terminal state (do-not-contact, filled, completed) overrides any request.
  const terminal = facts.terminalState ?? null
  const terminalBlocksBuyer = terminal !== null
  const verifiedBuyerRequest = !nonBuyerRole && !terminalBlocksBuyer && facts.externalServiceRequest !== null
  const verifiedHiringNeed = !facts.candidateSeeking && !facts.recruiter && facts.employmentHiring !== null
  const verifiedBudget = verifiedBuyerRequest && facts.statedBudget !== null
  const verifiedExternalNeed = verifiedBuyerRequest

  if (verifiedBuyerRequest) evidence.push({ kind: 'buyer_request', text: facts.externalServiceRequest!.line })
  if (verifiedHiringNeed) evidence.push({ kind: 'hiring', text: facts.employmentHiring!.line })
  if (verifiedBudget) evidence.push({ kind: 'budget', text: facts.statedBudget!.line })
  if (verifiedBuyerRequest && facts.helpRequest) evidence.push({ kind: 'buyer_request', text: facts.helpRequest.line })
  for (const line of facts.sellerLines.slice(0, 3)) evidence.push({ kind: 'seller_offering', text: line })
  if (recruiterOnly) evidence.push({ kind: 'recruiter', text: 'Recruits for other organizations' })
  if (terminal) evidence.push({ kind: 'contradiction', text: `${terminal.kind.replace(/_/g, ' ').toLowerCase()}: ${terminal.line}` })

  // ── Contradiction guard ────────────────────────────────────────────────
  // The deterministic source reading is the AUTHORITY. A scorer that denies a
  // source-verified request is recorded for audit but does not erase it: QA
  // BUG-PRO-021 requires an explicit buyer request never to resolve to
  // UNKNOWN/LOW/SKIP because the model scored it low. Only a source-side
  // problem (seller-owned, historical, negated, terminal) fails closed.
  const modelSaysBuyer = model !== null && model >= 0.6
  const modelSaysNoBuyer = model !== null && model < 0.3
  const signalSaysBuyer = Boolean(signal && (signal.explicitAsk || signal.seekingVendor))

  const hardContradiction = (signalSaysBuyer && modelSaysNoBuyer) || (verifiedBuyerRequest && modelSaysNoBuyer)
  if (signalSaysBuyer && modelSaysNoBuyer) {
    contradictions.push(`Signal check reported an explicit buyer request, opportunity model scored buyer request ${model!.toFixed(2)}.`)
  }
  if (verifiedBuyerRequest && modelSaysNoBuyer) {
    contradictions.push(`Source states a request for outside help, opportunity model scored buyer request ${model!.toFixed(2)}.`)
  }
  // Unsupported claims: a scorer asserts buyer intent the source does not state.
  if (modelSaysBuyer && !verifiedBuyerRequest) {
    contradictions.push(`Opportunity model scored buyer request ${model!.toFixed(2)}, but no current request for outside help is in the source${facts.sellerLines.length > 0 ? ' (the source is seller-side promotion)' : ''}.`)
  }
  if (signalSaysBuyer && !verifiedBuyerRequest) {
    contradictions.push(`Signal check matched request wording, but no prospect-owned request for outside help is in the source${facts.sellerLines.length > 0 ? ' (seller-owned lines)' : ''}.`)
  }
  for (const c of contradictions) evidence.push({ kind: 'contradiction', text: c })

  // ── Level ──────────────────────────────────────────────────────────────
  // A source-verified request is HIGH: the source states it, the deterministic
  // reader confirmed it is current, prospect-owned and not negated. The model's
  // agreement is not required (it is an auditor, not the authority).
  let buyerIntentLevel: BuyerIntentLevel = 'UNKNOWN'
  if (verifiedBuyerRequest) buyerIntentLevel = 'HIGH'

  // ── Role ───────────────────────────────────────────────────────────────
  // BUYER requires a request that survived the source-side guards. Seller
  // activity, founder authority, or a model claim never confer it. A prospect
  // may sell and buy when the buy is a separate, prospect-owned request.
  // That case is BUYER_AND_SELLER: the buy stays verified and is not capped.
  const buyingNeedSurvived = verifiedBuyerRequest && buyerIntentLevel !== 'UNKNOWN'
  const independentSellerLines = facts.sellerLines.filter((line) => line !== facts.externalServiceRequest?.line)
  let relationshipRole: RelationshipRole = 'UNKNOWN'
  if (facts.candidateSeeking) relationshipRole = 'CANDIDATE'
  else if (buyingNeedSurvived && independentSellerLines.length > 0) relationshipRole = 'BUYER_AND_SELLER'
  else if (buyingNeedSurvived) relationshipRole = 'BUYER'
  else if (facts.recruiter) relationshipRole = 'RECRUITER'
  else if (facts.sellerLines.length > 0) relationshipRole = 'SELLER'
  else if (facts.founderOrBuilder) relationshipRole = 'BUILDER'

  // ── Effective probabilities every scorer must use ───────────────────────
  const nonBuyerCap = nonBuyerRole || relationshipRole === 'SELLER' || (hardContradiction && !verifiedBuyerRequest)
  const cap = verifiedBuyerRequest ? 1 : nonBuyerCap ? NON_BUYER_CAP : UNVERIFIED_CAP
  // A verified request is credited even when the model scored it low; the
  // model's value only matters when it is higher.
  const effectiveBuyerProbability = verifiedBuyerRequest
    ? Math.max(model ?? 0, 0.7)
    : Math.min(model ?? 0, cap)
  // External need is the model's own judgement unless the prospect is on the
  // supply side (seller, recruiter, candidate) or the scorers contradict.
  const effectiveExternalNeedProbability = Math.min(modelExternal ?? 0, verifiedExternalNeed ? 1 : nonBuyerCap ? NON_BUYER_CAP : 1)

  // ── Confidence ─────────────────────────────────────────────────────────
  let confidence = buyerIntentLevel === 'HIGH' ? 0.85 : verifiedBuyerRequest ? 0.6 : 0.5
  if (relationshipRole === 'SELLER' || relationshipRole === 'RECRUITER' || relationshipRole === 'CANDIDATE') confidence = Math.max(confidence, 0.7)
  confidence -= 0.15 * Math.min(2, contradictions.length)
  confidence = Math.round(Math.max(0.1, Math.min(1, confidence)) * 100) / 100

  return {
    version: BUYER_INTENT_VERSION,
    buyerIntentLevel,
    verifiedBuyerRequest,
    verifiedHiringNeed,
    verifiedBudget,
    verifiedExternalNeed,
    askingForHelp: verifiedBuyerRequest && facts.helpRequest !== null,
    hiringUrgent: verifiedHiringNeed && facts.hiringUrgent,
    sellerSideContent: facts.sellerLines.length > 0,
    relationshipRole,
    evidence,
    confidence,
    contradictions,
    effectiveBuyerProbability: Math.round(effectiveBuyerProbability * 100) / 100,
    effectiveExternalNeedProbability: Math.round(effectiveExternalNeedProbability * 100) / 100,
    terminalState: terminal,
    claims: {
      modelBuyerProbability: model,
      modelExternalNeedProbability: modelExternal,
      modelRelationship: audit.modelRelationship ?? null,
      signalCheck: signal,
    },
  }
}

/** Convenience: facts + resolution from raw text, for callers without a model. */
export function resolveBuyerIntentFromSource(rawText: string, audit: BuyerAttributionAudit = {}): VerifiedBuyerIntent {
  return resolveVerifiedBuyerIntent(readBuyerSourceFacts(rawText), audit)
}
