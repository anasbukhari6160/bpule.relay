/**
 * Revenue Strategy Layer
 *
 * Sits between Intelligence and Writing. Deterministic — no model calls.
 *
 * Answers: who is this, can they buy (FIT), do they need something now (INTENT),
 * how much evidence do we actually have (CONFIDENCE), is there a right to
 * contact, what is the one job of the next message, and what may the writer say.
 *
 * Research is intelligence, not copy. The writer receives ALLOWED_NOW only.
 */

import type { CanonicalProspectIntelligence, EvidenceEntry, OpportunitySignal, CommercialRelationship, BusinessModel } from '@/lib/intelligence-v2/types'
import type { SourceFactsSummary } from '@/lib/intelligence-v3/source-facts-model'
import type { ExtractedLead, Lead, OutreachStrategy } from '@/lib/domain/types'
import { isNonBuyerRelationship } from '@/lib/intelligence-v2/subject-attribution'
import { isStrategyGroundingText } from '@/lib/intelligence-v2/commercial-reading'

export type FitLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
export type IntentLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'

export type ContactReason =
  | 'EXPLICIT_NEED'
  | 'RELEVANT_CHANGE'
  | 'DEMONSTRATED_PROBLEM'
  | 'STRONG_FIT'
  | 'RELATIONSHIP_CONTEXT'
  | 'RELATIONSHIP_VALUE'
  | 'NO_CREDIBLE_REASON'

export type ContactAction =
  | 'CONTACT_NOW'
  | 'CONNECT_OR_OBSERVE'
  | 'RESEARCH_MORE'
  | 'SKIP'

export type MessageJob =
  | 'EARN_CONNECTION'
  | 'CONFIRM_RELEVANCE'
  | 'TEST_DELIVERY_MODEL'
  | 'DISCOVER_NEED'
  | 'UNDERSTAND_SCOPE'
  | 'UNDERSTAND_TIMELINE'
  | 'RESOLVE_OBJECTION'
  | 'PROVIDE_PROOF'
  | 'MOVE_TO_CALL'
  | 'ACKNOWLEDGE_AND_HOLD'
  | 'CLARIFY_NEXT_STEP'
  | 'CLOSE_LOOP'

export type KnowledgeRelease =
  | 'AVAILABLE'
  | 'ALREADY_SHARED'
  | 'ALLOWED_NOW'
  | 'HOLD'
  | 'NEVER_CLAIM'

export type EvidenceScope =
  | 'CURRENT_COMPANY'
  | 'HISTORICAL_COMPANY'
  | 'CURRENT_ROLE'
  | 'HISTORICAL_ROLE'
  | 'CURRENT_OPPORTUNITY'
  | 'HISTORICAL_OPPORTUNITY'
  | 'UNKNOWN_TIME'

export type ConversationMove =
  | 'ASK'
  | 'ANSWER'
  | 'PROVIDE_VALUE'
  | 'PROVIDE_PROOF'
  | 'CLARIFY'
  | 'WAIT'
  | 'CALL'
  | 'PROPOSAL'
  | 'CLOSE'

export type CommercialField =
  | 'need'
  | 'problem'
  | 'authority'
  | 'scope'
  | 'timeline'
  | 'urgency'
  | 'budget'
  | 'team'
  | 'currentSolution'
  | 'deliveryOpenness'
  | 'scopeMaturity'
  | 'decisionProcess'
  | 'objection'
  | 'proofNeeded'
  | 'nextCommitment'

export type StrategyChannel = 'dm' | 'connection' | 'upwork' | 'email' | 'followup' | 'reply'
export type StrategyStage = 'first_touch' | 'followup' | 'reply' | 'warming'

export interface FitIntentConfidence {
  fit: FitLevel
  intent: IntentLevel
  confidence: ConfidenceLevel
  fitWhy: string
  intentWhy: string
  confidenceWhy: string
}

export interface ContactDecision {
  reason: ContactReason
  action: ContactAction
  why: string
  messageRecommended: boolean
  noMessageReason: string | null
}

/**
 * Canonical messaging policy (Relay hardening sprint — cross-surface
 * consistency). One explicit, self-describing value for what Relay actually
 * recommends doing about a lead RIGHT NOW ON A GIVEN CHANNEL.
 *
 * This exists because ContactAction ('CONNECT_OR_OBSERVE' in particular) was
 * being read the same way by every surface even though its actual meaning
 * depends on `messageRecommended` AND the channel the strategy was built
 * for. The same lead could correctly show CONNECT_OR_OBSERVE with a
 * recommended connection note (channel: 'connection') on one surface, and
 * CONNECT_OR_OBSERVE with no message at all (channel: 'dm') on another — both
 * individually correct, but presented with no indication they're answers to
 * different questions ("what about a connection note?" vs "what about a
 * DM?"), so they read as contradictory. See BUG_LEDGER — Daria Redkina /
 * Solsonic hardening fixture.
 *
 * Every surface displaying "what should I do about this lead" should read
 * `messagingPolicy` (or call describeMessagingPolicy) instead of
 * independently interpreting `action`/`messageRecommended`/`channel`.
 */
export type MessagingPolicy =
  | 'CONNECT_WITH_NOTE'
  | 'CONNECT_WITHOUT_NOTE'
  | 'OBSERVE'
  | 'DM'
  | 'EMAIL'
  | 'UPWORK_PROPOSAL'
  | 'FOLLOW_UP'
  | 'REPLY'
  | 'RESEARCH_MORE'
  | 'SKIP'

/**
 * Derives the canonical messaging policy for a given channel from the same
 * ContactDecision every surface already computes — this does NOT change
 * what gets decided, only how it's labeled, so it's safe to introduce
 * without altering existing behavior (messageRecommended, action, etc. are
 * unchanged and kept for backward compatibility).
 */
export function deriveMessagingPolicy(
  contact: ContactDecision,
  channel: StrategyChannel,
): MessagingPolicy {
  if (contact.action === 'SKIP') return 'SKIP'
  if (contact.action === 'RESEARCH_MORE') return 'RESEARCH_MORE'

  if (channel === 'reply') return 'REPLY'
  if (channel === 'followup') return contact.messageRecommended ? 'FOLLOW_UP' : 'OBSERVE'
  if (channel === 'email') return contact.messageRecommended ? 'EMAIL' : 'OBSERVE'
  if (channel === 'upwork') return contact.messageRecommended ? 'UPWORK_PROPOSAL' : 'OBSERVE'
  if (channel === 'dm') return contact.messageRecommended ? 'DM' : 'OBSERVE'
  // channel === 'connection'
  return contact.messageRecommended ? 'CONNECT_WITH_NOTE' : 'CONNECT_WITHOUT_NOTE'
}

/**
 * Human-readable, channel-explicit description of a messaging policy — for
 * surfaces that want one line of text rather than just the enum value.
 * Always names the channel, so two surfaces showing different policies for
 * different channels read as complementary, not contradictory.
 */
export function describeMessagingPolicy(policy: MessagingPolicy): string {
  switch (policy) {
    case 'CONNECT_WITH_NOTE': return 'Send a short connection note.'
    case 'CONNECT_WITHOUT_NOTE': return 'Send a connection request with no note — do not pitch.'
    case 'OBSERVE': return 'Observe only — no message on this channel yet.'
    case 'DM': return 'Send a direct message.'
    case 'EMAIL': return 'Send an email.'
    case 'UPWORK_PROPOSAL': return 'Send an Upwork proposal.'
    case 'FOLLOW_UP': return 'Send a follow-up.'
    case 'REPLY': return 'Reply — they wrote back.'
    case 'RESEARCH_MORE': return 'Research more before contacting.'
    case 'SKIP': return 'Skip — not a credible prospect.'
  }
}

/**
 * Single source of truth for "verdict must not contradict action."
 *
 * Commercial qualification ('strong'/'worth_pursuing'/'maybe'/'skip') and
 * relationship strategy (ContactAction) answer different questions — see
 * AGENTS/BUG_LEDGER: LOW/NO buyer qualification + a valid relationship
 * action (CONNECT_OR_OBSERVE, or any non-SKIP action) is NOT a contradiction.
 * Every surface displaying a headline verdict must call this instead of
 * independently deciding whether "skip" is safe to show — otherwise a
 * qualification of 'skip' renders as "Probably skip" even when the actual
 * recommended action is a valid connect/observe/contact action, which reads
 * as an internal contradiction to the user.
 *
 * Rule: if action === 'SKIP', showing "skip" is correct and expected. If
 * action !== 'SKIP' and qualification === 'skip', the headline must say
 * something honest about the mismatch instead of a bare "skip".
 */
export function describeVerdictForDisplay(
  qualification: CanonicalProspectIntelligence['qualification'] | null | undefined,
  action: ContactAction,
  actionLabel?: string | null,
): { headline: string; contradicted: boolean } {
  const QUALIFICATION_HEADLINES: Record<NonNullable<CanonicalProspectIntelligence['qualification']>, string> = {
    strong: 'Strong opportunity',
    worth_pursuing: 'Worth pursuing',
    maybe: 'Maybe — needs more signal',
    low: 'Weak fit',
    skip: 'Probably skip',
  }

  if (!qualification) {
    return { headline: actionLabel ?? 'Awaiting analysis', contradicted: false }
  }

  if (qualification !== 'skip' || action === 'SKIP') {
    return { headline: QUALIFICATION_HEADLINES[qualification], contradicted: false }
  }

  // qualification === 'skip' but the recommended action is NOT SKIP — a
  // valid relationship action exists (connect/observe/research/contact) even
  // though there is no current buyer opportunity. Never say "skip" here.
  const label = actionLabel ?? describeContactActionLabel(action)
  return { headline: `No current buyer fit — ${label}`, contradicted: true }
}

function describeContactActionLabel(action: ContactAction): string {
  switch (action) {
    case 'CONTACT_NOW': return 'contact now'
    case 'CONNECT_OR_OBSERVE': return 'connect or observe'
    case 'RESEARCH_MORE': return 'research more'
    case 'SKIP': return 'skip'
  }
}

export interface KnowledgeItem {
  text: string
  release: KnowledgeRelease
  reason: string
  scope: EvidenceScope
}

export interface CommercialFieldState {
  value: string | null
  status: 'known' | 'unknown' | 'inferred'
}

export interface ConversationKnowledge {
  fields: Record<CommercialField, CommercialFieldState>
  newFacts: string[]
  mostValuableUncertainty: string | null
  nextMove: ConversationMove
  messageJob: MessageJob
}

export interface WordBudget {
  min: number
  max: number
  label: string
}

export interface RevenueStrategy {
  who: string
  assessment: FitIntentConfidence
  contact: ContactDecision
  /** Canonical, channel-explicit messaging policy — see deriveMessagingPolicy(). */
  messagingPolicy: MessagingPolicy
  knownFacts: string[]
  supportedInferences: string[]
  unknowns: string[]
  commercialSituation: string
  relationshipState: string
  strongestEvidence: string | null
  reasonToActNow: string | null
  primaryUncertainty: string | null
  nextMove: ConversationMove
  messageJob: MessageJob | null
  allowedNow: string[]
  evidenceToHold: string[]
  unsupportedClaims: string[]
  proofNeeded: string | null
  successCondition: string
  knowledge: KnowledgeItem[]
  nextAction: string
  uiRationale: string
  wordBudget: WordBudget
  channel: StrategyChannel
}

export interface RevenueLoopSnapshot {
  who: string
  fit: FitLevel
  intent: IntentLevel
  confidence: ConfidenceLevel
  why: string
  act: ContactAction
  reason: ContactReason
  nextAction: string
  messageRecommended: boolean
  noMessageReason: string | null
  messageJob: MessageJob | null
  /** Canonical, channel-explicit messaging policy — prefer this over act/messageRecommended when displaying "what should I do" to a user. */
  messagingPolicy: MessagingPolicy
  /** Human-readable description of messagingPolicy, always naming the channel it applies to. */
  messagingPolicyLabel: string
}

export interface StrategySource {
  name: string | null
  title: string | null
  company: string
  qualification: CanonicalProspectIntelligence['qualification'] | null
  /**
   * Canonical commercial relationship (buyer/recruiter/partner/peer/etc.),
   * threaded from NormalizedIntelligence.relationship. 'UNKNOWN' for legacy
   * leads that predate this classification — treated as "no non-buyer
   * signal", not as a buyer signal.
   */
  relationship: CommercialRelationship
  /** Canonical business model (PRODUCT/RECRUITER/UNKNOWN), for the same reason. */
  businessModel: BusinessModel
  canonicalScore: number | null
  extractionCompleteness: number | null
  opportunitySignals: OpportunitySignal[]
  urgency: 'immediate' | 'near_term' | 'future' | 'unknown'
  explicitProblems: string[]
  hiringSignals: string[]
  technicalSignals: string[]
  recentPosts: Array<{ paraphrase: string; verbatimQuote: string | null }>
  opportunityDescription: string | null
  opportunityTrigger: string | null
  probableNeed: string | null
  unknowns: string[]
  risks: string[]
  evidenceLedger: EvidenceEntry[]
  hardNegatives: string[]
  dimensionPoints: Record<string, { points: number; max: number; note: string }>
  rawText: string | null
  signalType: number | null
  signalEvidence: string | null
  verbatimQuote: string | null
  tags: string[]
  relationshipStage: StrategyStage
  channel: StrategyChannel
  alreadyShared: string[]
  thingsNotToClaim: string[]
  conversation: ConversationKnowledge | null
  priorFollowupCount: number
  /** Set only after the rep marks the invitation accepted. Unlocks the first DM. */
  connectionAccepted?: boolean
  /** Buyer evidence kinds from commercial reading — distinguishes hiring+apply from generic hiring */
  buyerEvidenceKinds?: string[]
  /** Canonical recruiter flag from the source facts — never re-derived from raw text. */
  recruiterProfile: boolean
  /** Canonical external-need flag from the source facts — never re-derived from raw text. */
  externalNeed: boolean
  /** Remote eligibility assessment — suppress outreach if INELIGIBLE */
  remoteEligibility?: {
    eligibility: string
    reason?: string
  }
}

const EMPTY_FIELD = (): CommercialFieldState => ({ value: null, status: 'unknown' })

export function emptyConversationKnowledge(): ConversationKnowledge {
  return {
    fields: {
      need: EMPTY_FIELD(),
      problem: EMPTY_FIELD(),
      authority: EMPTY_FIELD(),
      scope: EMPTY_FIELD(),
      timeline: EMPTY_FIELD(),
      urgency: EMPTY_FIELD(),
      budget: EMPTY_FIELD(),
      team: EMPTY_FIELD(),
      currentSolution: EMPTY_FIELD(),
      deliveryOpenness: EMPTY_FIELD(),
      scopeMaturity: EMPTY_FIELD(),
      decisionProcess: EMPTY_FIELD(),
      objection: EMPTY_FIELD(),
      proofNeeded: EMPTY_FIELD(),
      nextCommitment: EMPTY_FIELD(),
    },
    newFacts: [],
    mostValuableUncertainty: null,
    nextMove: 'WAIT',
    messageJob: 'DISCOVER_NEED',
  }
}

export function sourceFromCanonical(
  canonical: CanonicalProspectIntelligence,
  opts: {
    channel: StrategyChannel
    /** Canonical source facts, when the caller has them. */
    facts?: SourceFactsSummary | null
    relationshipStage?: StrategyStage
    alreadyShared?: string[]
    conversation?: ConversationKnowledge | null
    priorFollowupCount?: number
    connectionAccepted?: boolean
  },
): StrategySource {
  const intel = canonical.intelligence
  return {
    name: intel.person.fullName,
    title: intel.person.title,
    company: intel.company.name ?? 'Unknown company',
    qualification: canonical.qualification,
    relationship: intel.relationship,
    businessModel: intel.businessModel,
    recruiterProfile: intel.relationship === 'RECRUITER' || Boolean(opts.facts?.recruiterProfile),
    externalNeed: Boolean(opts.facts?.buyer.externalServiceRequest) || intel.commercialReading?.externalEngineeringNeed === 'EXPLICIT',
    canonicalScore: canonical.canonicalScore,
    extractionCompleteness: canonical.extractionCompleteness.score,
    opportunitySignals: intel.opportunity.signals,
    urgency: intel.opportunity.urgency,
    explicitProblems: intel.content.explicitProblems,
    hiringSignals: intel.content.hiringSignals,
    technicalSignals: intel.content.technicalSignals,
    recentPosts: intel.content.recentPosts.map((p) => ({
      paraphrase: p.paraphrase,
      verbatimQuote: p.verbatimQuote,
    })),
    opportunityDescription: intel.opportunity.description,
    opportunityTrigger: intel.opportunityTrigger,
    probableNeed: intel.probableNeed,
    unknowns: intel.unknowns,
    risks: intel.risks,
    evidenceLedger: canonical.evidenceLedger,
    hardNegatives: canonical.scoreBreakdown.hardNegatives,
    dimensionPoints: Object.fromEntries(
      canonical.scoreBreakdown.dimensions.map((d) => [d.key, { points: d.points, max: d.max, note: d.note }]),
    ),
    rawText: canonical.rawSource.rawInput,
    signalType: mapSignalsToLegacyType(intel.opportunity.signals),
    signalEvidence: intel.opportunity.description ?? intel.opportunityTrigger,
    verbatimQuote: intel.content.recentPosts.find((p) => p.verbatimQuote)?.verbatimQuote ?? null,
    tags: [...intel.content.topics, ...intel.content.technicalSignals],
    relationshipStage: opts.relationshipStage ?? 'first_touch',
    channel: opts.channel,
    alreadyShared: opts.alreadyShared ?? [],
    thingsNotToClaim: canonical.outreachContext?.thingsNotToClaim ?? [],
    conversation: opts.conversation ?? null,
    priorFollowupCount: opts.priorFollowupCount ?? 0,
    connectionAccepted: opts.connectionAccepted ?? false,
    buyerEvidenceKinds: canonical.intelligence.commercialReading?.buyerEvidenceKinds,
    remoteEligibility: canonical.remoteEligibility ? {
      eligibility: canonical.remoteEligibility.eligibility,
      reason: canonical.remoteEligibility.reason,
    } : undefined,
  }
}

export function sourceFromLead(
  lead: Lead,
  extracted: ExtractedLead | null,
  opts: {
    channel: StrategyChannel
    /** Canonical source facts, when the caller has them. */
    facts?: SourceFactsSummary | null
    relationshipStage?: StrategyStage
    alreadyShared?: string[]
    conversation?: ConversationKnowledge | null
    priorFollowupCount?: number
    connectionAccepted?: boolean
  },
): StrategySource {
  const canonical = asCanonical(lead.canonicalIntelligence)
  if (canonical) {
    return sourceFromCanonical(canonical, opts)
  }

  const ledger = Array.isArray(lead.evidenceLedger)
    ? (lead.evidenceLedger as EvidenceEntry[])
    : []

  return {
    name: extracted?.name ?? lead.contactName,
    title: extracted?.title ?? lead.contactTitle,
    company: extracted?.company ?? lead.company,
    qualification: null,
    // Legacy leads (no canonical intelligence) predate relationship
    // classification — 'UNKNOWN' correctly means "no non-buyer signal",
    // not "buyer confirmed".
    relationship: 'UNKNOWN',
    businessModel: 'UNKNOWN',
    recruiterProfile: Boolean(opts.facts?.recruiterProfile),
    externalNeed: Boolean(opts.facts?.buyer.externalServiceRequest),
    canonicalScore: lead.canonicalScore ?? null,
    extractionCompleteness: extracted?.extractionConfidence ?? lead.extractionConfidence ?? null,
    opportunitySignals: inferSignalsFromLegacy(lead.signalType, lead.signalEvidence ?? extracted?.signalEvidence),
    urgency: 'unknown',
    explicitProblems: [],
    hiringSignals: hiringHints(lead.signalEvidence ?? extracted?.signalEvidence),
    technicalSignals: extracted?.tags ?? lead.tags ?? [],
    recentPosts: extracted?.recentPosts ?? [],
    opportunityDescription: lead.signalEvidence ?? extracted?.signalEvidence ?? null,
    opportunityTrigger: lead.signalEvidence ?? extracted?.signalEvidence ?? null,
    probableNeed: null,
    unknowns: extracted?.confidenceNotes ?? [],
    risks: [],
    evidenceLedger: ledger,
    hardNegatives: [],
    dimensionPoints: {},
    rawText: lead.rawInput,
    signalType: extracted?.signalType ?? lead.signalType,
    signalEvidence: extracted?.signalEvidence ?? lead.signalEvidence,
    verbatimQuote: extracted?.verbatimQuote ?? lead.verbatimQuote,
    tags: extracted?.tags ?? lead.tags ?? [],
    relationshipStage: opts.relationshipStage ?? 'first_touch',
    channel: opts.channel,
    alreadyShared: opts.alreadyShared ?? [],
    thingsNotToClaim: [],
    conversation: opts.conversation ?? null,
    priorFollowupCount: opts.priorFollowupCount ?? 0,
    connectionAccepted: opts.connectionAccepted ?? false,
  }
}

export function buildRevenueStrategy(source: StrategySource): RevenueStrategy {
  const scoped = scopeEvidence(source)
  const assessment = assessFitIntentConfidence(source, scoped)
  const contact = decideContact(source, assessment, scoped)
  const conversation = source.conversation
  const messageJob = selectMessageJob(source, contact, conversation)
  const knowledge = releaseKnowledge(source, scoped, contact, messageJob)
  const allowedNow = knowledge.filter((k) => k.release === 'ALLOWED_NOW').map((k) => k.text)
  const evidenceToHold = knowledge.filter((k) => k.release === 'HOLD').map((k) => k.text)
  const unsupportedClaims = unique([
    ...knowledge.filter((k) => k.release === 'NEVER_CLAIM').map((k) => k.text),
    ...source.thingsNotToClaim,
  ])
  const knownFacts = scoped.filter((s) => s.kind === 'FACT' && s.scope.startsWith('CURRENT')).map((s) => s.text)
  const supportedInferences = scoped.filter((s) => s.kind === 'INFERENCE').map((s) => s.text)
  const unknowns = buildUnknowns(source, conversation)
  const strongest = pickStrongestCurrentEvidence(scoped, source)
  const reasonToActNow = contact.messageRecommended
    ? contact.why
    : null
  const primaryUncertainty = conversation?.mostValuableUncertainty ?? unknowns[0] ?? null
  const nextMove = conversation?.nextMove ?? defaultNextMove(contact, messageJob)
  const wordBudget = wordBudgetFor(source.channel, messageJob)
  const nextAction = describeNextAction(contact, messageJob, source)
  const who = [source.name, source.title, source.company].filter(Boolean).join(' · ') || source.company
  const uiRationale = buildUiRationale(assessment, contact, strongest, nextAction, source.company)

  return {
    who,
    assessment,
    contact,
    messagingPolicy: deriveMessagingPolicy(contact, source.channel),
    knownFacts: unique(knownFacts).slice(0, 6),
    supportedInferences: unique(supportedInferences).slice(0, 4),
    unknowns: unique(unknowns).slice(0, 6),
    commercialSituation: describeCommercialSituation(assessment, source, strongest),
    relationshipState: describeRelationship(source),
    strongestEvidence: strongest,
    reasonToActNow,
    primaryUncertainty,
    nextMove,
    messageJob,
    allowedNow: unique(allowedNow).slice(0, 2),
    evidenceToHold: unique(evidenceToHold).slice(0, 8),
    unsupportedClaims: unique(unsupportedClaims).slice(0, 8),
    proofNeeded: conversation?.fields.proofNeeded.value ?? null,
    successCondition: successConditionFor(messageJob, contact),
    knowledge,
    nextAction,
    uiRationale,
    wordBudget,
    channel: source.channel,
  }
}

export function toUiSnapshot(strategy: RevenueStrategy): RevenueLoopSnapshot {
  return {
    who: strategy.who,
    fit: strategy.assessment.fit,
    intent: strategy.assessment.intent,
    confidence: strategy.assessment.confidence,
    why: strategy.uiRationale,
    act: strategy.contact.action,
    reason: strategy.contact.reason,
    nextAction: strategy.nextAction,
    messageRecommended: strategy.contact.messageRecommended,
    noMessageReason: strategy.contact.noMessageReason,
    messageJob: strategy.messageJob,
    messagingPolicy: strategy.messagingPolicy,
    messagingPolicyLabel: describeMessagingPolicy(strategy.messagingPolicy),
  }
}

export function shouldWriteMessage(strategy: RevenueStrategy): boolean {
  return strategy.contact.messageRecommended && strategy.messageJob !== null
}

export function wordBudgetFor(channel: StrategyChannel, job: MessageJob | null): WordBudget {
  if (channel === 'connection' || job === 'EARN_CONNECTION') {
    return { min: 15, max: 35, label: 'connection' }
  }
  if (channel === 'followup') {
    return { min: 15, max: 45, label: 'follow-up' }
  }
  if (channel === 'reply') {
    if (job === 'PROVIDE_PROOF' || job === 'MOVE_TO_CALL' || job === 'CLARIFY_NEXT_STEP') {
      return { min: 30, max: 70, label: 'interested reply' }
    }
    return { min: 20, max: 55, label: 'reply' }
  }
  if (channel === 'upwork') {
    return { min: 40, max: 120, label: 'upwork' }
  }
  return { min: 20, max: 55, label: 'first DM' }
}

export function revenueStrategyToPromptBlock(strategy: RevenueStrategy): string {
  const parts = [
    '## Revenue strategy (writer constraints)',
    '',
    `**One job:** ${strategy.messageJob ?? 'NONE — do not write a message'}`,
    `**Word budget:** ${strategy.wordBudget.min}–${strategy.wordBudget.max} words. Stop early if fewer words do the job.`,
    `**Tone:** truthful curiosity. One observation maximum. One question or CTA maximum.`,
    '',
    '### You may use ONLY this evidence (ALLOWED_NOW):',
    strategy.allowedNow.length > 0
      ? strategy.allowedNow.map((item) => `- ${item}`).join('\n')
      : '- (none — if you cannot name one current, specific fact, do not write)',
  ]

  if (strategy.evidenceToHold.length > 0) {
    parts.push('', '### HOLD — know this, do not say it:', ...strategy.evidenceToHold.slice(0, 6).map((item) => `- ${item}`))
  }
  if (strategy.unsupportedClaims.length > 0) {
    parts.push('', '### NEVER claim:', ...strategy.unsupportedClaims.slice(0, 6).map((item) => `- ${item}`))
  }

  parts.push(
    '',
    `**Success:** ${strategy.successCondition}`,
    `**Primary uncertainty:** ${strategy.primaryUncertainty ?? 'none named'}`,
    '',
    'Hard writing rules:',
    '- Do not dump research, biography, credentials, or BPulse positioning.',
    '- Do not invent need, pain, budget, or technical insight.',
    '- Do not open with "saw your post", "congrats", "this caught my eye", or "over the past N years".',
    '- Never echo a prospect quote in first person. If they said "we are hiring", do not write "we are hiring".',
    '- Do not offer a free analysis, read, or audit unless they asked.',
    '- Historical company or role facts must never be treated as a current opportunity.',
    '- If silence would be better, return an empty draft.',
  )

  return parts.join('\n')
}

export function applyRevenueStrategyToOutreach(
  outreach: OutreachStrategy,
  revenue: RevenueStrategy,
): OutreachStrategy {
  return {
    ...outreach,
    messageGoal: revenue.messageJob
      ? `${revenue.messageJob}: ${revenue.successCondition}`
      : 'Do not write — no credible reason to contact',
    ctaStrategy: oneCtaFor(revenue.messageJob),
    risk: [
      outreach.risk !== 'low' ? outreach.risk : null,
      revenue.contact.noMessageReason,
      revenue.unsupportedClaims.length > 0 ? `Never claim: ${revenue.unsupportedClaims.slice(0, 3).join('; ')}` : null,
    ].filter(Boolean).join('; ') || 'low',
    assessment: revenue.assessment,
    contact: revenue.contact,
    messageJob: revenue.messageJob,
    allowedNow: revenue.allowedNow,
    hold: revenue.evidenceToHold,
    neverClaim: revenue.unsupportedClaims,
    wordBudget: revenue.wordBudget,
    uiRationale: revenue.uiRationale,
  }
}

export function mapSignalsToLegacyType(signals: OpportunitySignal[]): number {
  if (signals.includes('hiring') || signals.includes('hiring_pressure')) return 1
  if (signals.includes('freelance_project_need')) return 2
  if (signals.includes('growth_signal') || signals.includes('launch')) return 3
  if (signals.includes('technical_problem') || signals.includes('rebuild') || signals.includes('migration')) return 6
  if (signals.includes('explicit_ask')) return 7
  return 7
}

export function scopeEvidenceText(text: string): EvidenceScope {
  const lower = text.toLowerCase()
  if (/\b(formerly|former|previously|ex-|used to|years? ago|back in \d{4}|when (i|they|he|she) (was|were) at)\b/i.test(lower)) {
    if (/\b(role|title|engineer|manager|director|lead)\b/i.test(lower)) return 'HISTORICAL_ROLE'
    if (/\b(hiring|role|job|opportunity|onsite|on-site|must be)\b/i.test(lower)) return 'HISTORICAL_OPPORTUNITY'
    return 'HISTORICAL_COMPANY'
  }
  if (/\b(currently|current|now hiring|we('re| are) (hiring|looking|building)|this quarter|this week|open role)\b/i.test(lower)) {
    if (/\b(hiring|looking for|need|open role|freelance|contract)\b/i.test(lower)) return 'CURRENT_OPPORTUNITY'
    if (/\b(i am|i'm|title|role)\b/i.test(lower)) return 'CURRENT_ROLE'
    return 'CURRENT_COMPANY'
  }
  if (/\b(now hiring|we(?:'re| are) hiring|hiring (a |an )|open role|looking for (a |an )?(engineer|developer|designer))\b/i.test(lower)) {
    return 'CURRENT_OPPORTUNITY'
  }
  return 'UNKNOWN_TIME'
}

interface ScopedItem {
  text: string
  scope: EvidenceScope
  kind: 'FACT' | 'INFERENCE'
  safeToMention: boolean
}

function scopeEvidence(source: StrategySource): ScopedItem[] {
  const items: ScopedItem[] = []

  for (const entry of source.evidenceLedger) {
    const text = (entry.verbatimQuote ?? entry.signal).trim()
    if (!text) continue
    const scope = inferScope(entry, text, source)
    const safeToMention = entry.safeForOutreach && scope.startsWith('CURRENT')
    items.push({
      text: clip(text, 180),
      scope,
      kind: entry.evidenceType === 'FACT' ? 'FACT' : 'INFERENCE',
      safeToMention,
    })
  }

  if (source.verbatimQuote) {
    items.push({
      text: clip(source.verbatimQuote, 180),
      scope: scopeEvidenceText(source.verbatimQuote),
      kind: 'FACT',
      safeToMention: scopeEvidenceText(source.verbatimQuote).startsWith('CURRENT'),
    })
  }

  if (source.signalEvidence && source.signalEvidence.length > 8) {
    const scope = scopeEvidenceText(source.signalEvidence)
    items.push({
      text: clip(source.signalEvidence, 180),
      scope,
      kind: source.verbatimQuote ? 'INFERENCE' : 'FACT',
      safeToMention: scope.startsWith('CURRENT') || scope === 'UNKNOWN_TIME',
    })
  }

  for (const problem of source.explicitProblems) {
    items.push({
      text: clip(problem, 180),
      scope: 'CURRENT_OPPORTUNITY',
      kind: 'FACT',
      safeToMention: true,
    })
  }

  for (const hire of source.hiringSignals) {
    items.push({
      text: clip(hire, 180),
      scope: scopeEvidenceText(hire),
      kind: 'FACT',
      safeToMention: scopeEvidenceText(hire) !== 'HISTORICAL_OPPORTUNITY',
    })
  }

  return dedupeScoped(items)
}

function inferScope(entry: EvidenceEntry, text: string, source: StrategySource): EvidenceScope {
  // Honor explicit temporal scope from evidence when set
  if (entry.temporalScope === 'CURRENT') return 'CURRENT_OPPORTUNITY'
  if (entry.temporalScope === 'HISTORICAL') return 'HISTORICAL_OPPORTUNITY'
  if (entry.temporalScope === 'FUTURE') return 'CURRENT_OPPORTUNITY'
  if (entry.temporalScope === 'RECENT') return 'CURRENT_OPPORTUNITY'
  const fromText = scopeEvidenceText(text)
  if (fromText !== 'UNKNOWN_TIME') return fromText
  if (entry.ownership === 'HIRING_INTENT' || entry.ownership === 'BUYER_INTENT' || entry.ownership === 'JOB_REQUIREMENT') {
    return 'CURRENT_OPPORTUNITY'
  }
  if (entry.ownership === 'PERSON_PREFERENCE') return 'CURRENT_ROLE'
  if (entry.ownership === 'COMPANY_ATTRIBUTE') return 'CURRENT_COMPANY'
  if (source.opportunitySignals.length > 0) return 'CURRENT_OPPORTUNITY'
  return 'UNKNOWN_TIME'
}

function assessFitIntentConfidence(source: StrategySource, scoped: ScopedItem[]): FitIntentConfidence {
  const currentOpportunity = scoped.filter((s) => s.scope === 'CURRENT_OPPORTUNITY')
  const hasIdentity = Boolean(source.name || source.title) && source.company !== 'Unknown company'
  const completeness = source.extractionCompleteness ?? 0
  const oppFit = source.dimensionPoints.opportunityFit
  const needIntent = source.dimensionPoints.needIntent
  const hardSkip = source.hardNegatives.length > 0 || source.qualification === 'skip'
  // 'hiring' is NOT a strong need signal — it means hiring for own team.
  // Only explicit asks, freelance needs, and technical problems are strong.
  const strongNeedSignals = source.opportunitySignals.some((s) =>
    ['freelance_project_need', 'explicit_ask', 'technical_problem'].includes(s),
  )
  const currentStrongNeed = strongNeedSignals && currentOpportunity.length > 0

  let fit: FitLevel = 'UNKNOWN'
  let fitWhy = 'Not enough evidence to judge whether they could buy.'

  // Non-buyer relationship (recruiter/partner/peer) is determined upstream by
  // subject-attribution's deriveRelationship() — read it directly rather than
  // pattern-matching hardNegatives text (which is fragile: it breaks the
  // moment a hard-negative reason string is reworded, and it can't
  // distinguish "not a buyer, but a valid contact" from "not a credible
  // contact at all"). Other hard-negative categories (irrelevant input,
  // clinician, student, competitor) still fall back to the hardNegatives scan
  // — subject-attribution does not model those.
  const nonBuyerRelationship = isNonBuyerRelationship(source.relationship)
  const otherNonBuyerHardNegative = hardSkip && /clinician|irrelevant|student|competitor/i.test(source.hardNegatives.join(' '))
  if (nonBuyerRelationship || otherNonBuyerHardNegative) {
    fit = 'LOW'
    fitWhy = 'Profile is not a software-delivery buyer.'
  } else if (!hasIdentity && completeness < 30) {
    fit = 'UNKNOWN'
    fitWhy = 'Person or company is too thin to judge fit.'
  } else if ((oppFit && oppFit.points >= 14) || currentStrongNeed) {
    fit = 'HIGH'
    fitWhy = currentStrongNeed
      ? 'Current opportunity signal matches delivery work we can own.'
      : oppFit?.note ?? 'Opportunity fit is strong on available evidence.'
  } else if ((oppFit && oppFit.points >= 8) || source.opportunitySignals.length > 0 || (hasIdentity && /founder|cto|ceo|head|director/i.test(source.title ?? ''))) {
    fit = 'MEDIUM'
    fitWhy = 'Plausible buyer, but the commercial situation is incomplete.'
  } else if (hasIdentity) {
    fit = 'MEDIUM'
    fitWhy = 'Named company and role exist; buying fit is unproven.'
  }

  let intent: IntentLevel = 'UNKNOWN'
  let intentWhy = 'No current intent evidence. Using UNKNOWN, not a guess.'

  if (source.conversation?.fields.need.status === 'known' && /not (interested|looking)|already hired|no thanks/i.test(source.conversation.fields.need.value ?? '')) {
    intent = 'LOW'
    intentWhy = source.conversation.fields.need.value ?? 'They declined or already hired.'
  } else if (
    source.opportunitySignals.includes('explicit_ask')
    || source.urgency === 'immediate'
    || source.opportunitySignals.includes('freelance_project_need')
    || (source.buyerEvidenceKinds ?? []).includes('BUYER_REQUEST')
  ) {
    intent = 'HIGH'
    intentWhy = 'Current, explicit need or active project ask.'
  } else if (
    source.opportunitySignals.includes('technical_problem')
    || source.opportunitySignals.includes('hiring_pressure')
    || source.urgency === 'near_term'
    || source.explicitProblems.length > 0
  ) {
    intent = 'MEDIUM'
    intentWhy = 'A demonstrated problem or near-term pressure exists, not a direct ask.'
  } else if (source.urgency === 'future') {
    intent = 'UNKNOWN'
    intentWhy = 'Timing is future or vague. Not treating that as current intent.'
  } else if (needIntent && needIntent.points < 8 && source.opportunitySignals.length === 0) {
    intent = 'UNKNOWN'
    intentWhy = 'No need signal in the evidence. Not inventing one.'
  }

  let confidence: ConfidenceLevel = 'LOW'
  let confidenceWhy = 'Thin or inferred-only evidence.'
  const factCount = scoped.filter((s) => s.kind === 'FACT').length
  if (completeness >= 70 && (source.verbatimQuote || factCount >= 2)) {
    confidence = 'HIGH'
    confidenceWhy = 'Extraction is complete enough and facts are sourced.'
  } else if (completeness >= 40 || factCount >= 1 || hasIdentity) {
    confidence = 'MEDIUM'
    confidenceWhy = 'Some reliable facts exist; several commercially important fields are still unknown.'
  }

  const recruiterProfile = source.recruiterProfile
  const externalPurchase = source.externalNeed || source.opportunitySignals.includes('explicit_ask')
  if (recruiterProfile && !externalPurchase && intent !== 'LOW') {
    intent = 'UNKNOWN'
    intentWhy = 'Buying intent is unproven. This is employer hiring, not a request to buy services. Research before treating them as a buyer.'
  }

  if (source.qualification === 'skip' && source.hardNegatives.includes('IRRELEVANT_OR_INSUFFICIENT_INPUT')) {
    fit = 'LOW'
    intent = 'UNKNOWN'
    confidence = 'LOW'
    fitWhy = 'Input is not a prospect.'
    intentWhy = 'No prospect, so intent is unknown.'
    confidenceWhy = 'Login/UI or empty input — no reliable evidence.'
  }

  return { fit, intent, confidence, fitWhy, intentWhy, confidenceWhy }
}

function decideContact(
  source: StrategySource,
  assessment: FitIntentConfidence,
  scoped: ScopedItem[],
): ContactDecision {
  const currentOpportunity = scoped.filter((s) => s.scope === 'CURRENT_OPPORTUNITY' && s.kind === 'FACT')
  const historicalOnlyNeed = source.opportunitySignals.length > 0
    && currentOpportunity.length === 0
    && scoped.some((s) => s.scope.startsWith('HISTORICAL'))
  const genericPostsOnly = source.recentPosts.length > 0
    && source.opportunitySignals.length === 0
    && source.explicitProblems.length === 0
    && source.hiringSignals.length === 0
  const thin = (source.extractionCompleteness ?? 0) < 35
    && !source.verbatimQuote
    && currentOpportunity.length === 0
  const irrelevant = source.hardNegatives.includes('IRRELEVANT_OR_INSUFFICIENT_INPUT')
    || /irrelevant/i.test(source.hardNegatives.join(' '))

  if (source.relationshipStage === 'reply') {
    return {
      reason: 'RELATIONSHIP_CONTEXT',
      action: 'CONTACT_NOW',
      why: 'They wrote back. First-party evidence now outranks the original scrape.',
      messageRecommended: true,
      noMessageReason: null,
    }
  }

  // A cold DM is still blocked below ("do not force a DM"). Acceptance is
  // different: the connection already happened, and the next step is the
  // first message. Irrelevant profiles stay silent.
  if (
    source.connectionAccepted
    && (source.channel === 'dm' || source.channel === 'followup')
    && !irrelevant
  ) {
    return {
      reason: 'RELATIONSHIP_CONTEXT',
      action: 'CONTACT_NOW',
      why: 'They accepted the connection. Write the next message. Do not pitch.',
      messageRecommended: true,
      noMessageReason: null,
    }
  }

  // A recruiter/partner who is ALSO actively seeking help (e.g., "looking for
  // development partners") should get CONTACT_NOW, not CONNECT_OR_OBSERVE.
  const hasBuyerRequest = (source.buyerEvidenceKinds ?? []).includes('BUYER_REQUEST')
    || source.opportunitySignals.includes('explicit_ask')
    || source.opportunitySignals.includes('freelance_project_need')

  if (hasBuyerRequest && !irrelevant) {
    return {
      reason: 'EXPLICIT_NEED',
      action: 'CONTACT_NOW',
      why: 'There is a current, explicit need — a project ask or a public request for help.',
      messageRecommended: true,
      noMessageReason: null,
    }
  }

  // Non-buyer relationship (recruiter/partner/peer): LOW commercial fit is
  // correct and must stand (see assessFitIntentConfidence), but it must NOT
  // by itself force SKIP. A recruiter, partner, or peer with genuine
  // relationship-worthy activity — active business development, conference/
  // roadshow participation, "open to partnerships" language, an audience-
  // facing service, a named identity — is a legitimate CONNECT_OR_OBSERVE
  // outcome with no pitch. Only a genuinely empty/irrelevant profile (no
  // identity, no activity, no content at all) reaches SKIP.
  const nonBuyerRelationship = isNonBuyerRelationship(source.relationship)
  if (nonBuyerRelationship && !irrelevant) {
    // A real name AND a real title is meaningful identity evidence on its
    // own — it must not be invalidated just because company-name extraction
    // separately failed to parse a company out of an unusual title format
    // (e.g. "Founder & CEO · Merget" with a middle-dot separator). Requiring
    // BOTH person fields AND a successfully-parsed company name made a
    // clearly-identified real person (name + title) fall through to SKIP
    // whenever company extraction had a parsing gap — an extraction-layer
    // weakness should not manufacture a false "no credible contact" result.
    const hasIdentitySignal = Boolean(source.name && source.title) || (source.company !== 'Unknown company' && Boolean(source.name || source.title))
    const hasActivitySignal = source.recentPosts.length > 0
      || source.explicitProblems.length > 0
      || source.hiringSignals.length > 0
      || source.opportunitySignals.length > 0
      || Boolean(source.verbatimQuote)
    if (hasIdentitySignal || hasActivitySignal) {
      return {
        reason: 'RELATIONSHIP_VALUE',
        action: 'CONNECT_OR_OBSERVE',
        why: 'Not a software-delivery buyer, but a valid relationship contact (recruiter/partner/peer) with genuine identity or activity — worth connecting with or observing, not pitching.',
        messageRecommended: false,
        noMessageReason: 'No buying need to pitch. Connect or observe only — do not force a sales message.',
      }
    }
    return {
      reason: 'NO_CREDIBLE_REASON',
      action: 'SKIP',
      why: 'Non-buyer relationship with no identity or activity evidence — not a credible contact.',
      messageRecommended: false,
      noMessageReason: 'No credible reason to contact. Silence is the correct result.',
    }
  }

  if (irrelevant || assessment.fit === 'LOW' && assessment.confidence === 'LOW' && source.qualification === 'skip') {
    return {
      reason: 'NO_CREDIBLE_REASON',
      action: 'SKIP',
      why: 'Not a credible prospect on available evidence.',
      messageRecommended: false,
      noMessageReason: 'No credible reason to contact. Silence is the correct result.',
    }
  }

  if (historicalOnlyNeed) {
    return {
      reason: 'NO_CREDIBLE_REASON',
      action: 'RESEARCH_MORE',
      why: 'The only need evidence is historical. It must not be treated as a current opportunity.',
      messageRecommended: false,
      noMessageReason: 'Historical company or role evidence is not a current reason to write.',
    }
  }

  // Hiring + buyer request (apply instructions) = genuine buyer signal
  if (
    source.opportunitySignals.includes('hiring') &&
    currentOpportunity.length > 0 &&
    (source.buyerEvidenceKinds ?? []).includes('BUYER_REQUEST')
  ) {
    return {
      reason: 'EXPLICIT_NEED',
      action: 'CONTACT_NOW',
      why: 'Hiring with explicit apply instructions — they are actively seeking help.',
      messageRecommended: true,
      noMessageReason: null,
    }
  }

  if (
    source.opportunitySignals.includes('explicit_ask')
    || source.opportunitySignals.includes('freelance_project_need')
    || (source.buyerEvidenceKinds ?? []).includes('BUYER_REQUEST')
  ) {
    return {
      reason: 'EXPLICIT_NEED',
      action: 'CONTACT_NOW',
      why: 'There is a current, explicit need — a project ask or a public request for help.',
      messageRecommended: true,
      noMessageReason: null,
    }
  }

  // Hiring for own team — NOT a strong buyer signal. Connect without pitching.
  if (source.opportunitySignals.includes('hiring') && currentOpportunity.length > 0) {
    return {
      reason: 'RELEVANT_CHANGE',
      action: 'CONNECT_OR_OBSERVE',
      why: 'They are hiring for their own team — not a clear need for outside services. Connect without pitching.',
      messageRecommended: false,
      noMessageReason: 'Hiring for own team is not a clear signal they need outside services. Do not pitch.',
    }
  }

  // Remote barrier: if eligibility is INELIBIBLE, suppress all outreach
  if (source.remoteEligibility?.eligibility === 'INELIGIBLE') {
    return {
      reason: 'NO_CREDIBLE_REASON',
      action: 'SKIP',
      why: `Remote barrier: ${source.remoteEligibility.reason ?? 'not compatible with Pakistan-based remote work'}.`,
      messageRecommended: false,
      noMessageReason: 'Remote eligibility barrier. Do not contact.',
    }
  }

  if (source.opportunitySignals.includes('technical_problem') || source.explicitProblems.length > 0) {
    return {
      reason: 'DEMONSTRATED_PROBLEM',
      action: 'CONTACT_NOW',
      why: 'A current problem is in evidence. Confirm relevance; do not diagnose from scrape.',
      messageRecommended: true,
      noMessageReason: null,
    }
  }

  if (source.opportunitySignals.some((s) => ['launch', 'migration', 'rebuild', 'growth_signal'].includes(s))) {
    return {
      reason: 'RELEVANT_CHANGE',
      action: source.channel === 'connection' ? 'CONNECT_OR_OBSERVE' : 'CONNECT_OR_OBSERVE',
      why: 'A relevant change exists, but they have not asked for help.',
      messageRecommended: source.channel === 'connection',
      noMessageReason: source.channel === 'connection'
        ? null
        : 'Change is not an invitation. Connect or observe; do not force a DM.',
    }
  }

  // Founder/CEO/CTO/product builder with high commercial potential on LinkedIn
  // connection: send a relationship-building connection note even without
  // explicit buyer intent. Connection notes earn access — they don't pitch.
  const isHighPotentialBuilder = (
    source.channel === 'connection'
    && !irrelevant
    && !nonBuyerRelationship
    && !hasBuyerRequest
  ) && (
    // Founder/CEO/CTO role signals
    (source.title && /\b(ceo|cto|cfo|founder|co[- ]?founder|owner|president|managing director)\b/i.test(source.title))
    // OR active product/company building signals
    || (source.company !== 'Unknown company' && (source.opportunitySignals.includes('launch') || source.explicitProblems.length > 0 || source.recentPosts.length > 0))
  )

  if (isHighPotentialBuilder) {
    return {
      reason: 'RELATIONSHIP_VALUE',
      action: 'CONNECT_OR_OBSERVE',
      why: 'Active founder/builder with no explicit buyer request. Connection note earns access — do not pitch.',
      messageRecommended: true,
      noMessageReason: null,
    }
  }

  if (thin) {
    return {
      reason: 'NO_CREDIBLE_REASON',
      action: 'RESEARCH_MORE',
      why: 'Identity may exist, but evidence is too thin to justify contact.',
      messageRecommended: false,
      noMessageReason: 'Insufficient evidence. Research more or skip — do not invent intent.',
    }
  }

  if (assessment.fit === 'HIGH' && assessment.intent === 'UNKNOWN') {
    return {
      reason: 'STRONG_FIT',
      action: 'CONNECT_OR_OBSERVE',
      why: 'High fit, unknown intent. That is not a bad lead — it is also not a reason to pitch.',
      messageRecommended: false,
      noMessageReason: 'No current need. Observe or connect with no note. Do not invent intent.',
    }
  }

  if (genericPostsOnly) {
    return {
      reason: 'NO_CREDIBLE_REASON',
      action: assessment.fit === 'HIGH' || assessment.fit === 'MEDIUM' ? 'CONNECT_OR_OBSERVE' : 'SKIP',
      why: 'Only generic posts. Referencing them would only prove we scraped.',
      messageRecommended: false,
      noMessageReason: 'Generic posts are not a reason to write. Do not personalize from them.',
    }
  }

  if (assessment.fit === 'LOW') {
    return {
      reason: 'NO_CREDIBLE_REASON',
      action: 'SKIP',
      why: 'Weak or irrelevant fit. Attention is better spent elsewhere.',
      messageRecommended: false,
      noMessageReason: 'No credible commercial reason to contact.',
    }
  }

  return {
    reason: assessment.fit === 'HIGH' || assessment.fit === 'MEDIUM' ? 'STRONG_FIT' : 'NO_CREDIBLE_REASON',
    action: 'CONNECT_OR_OBSERVE',
    why: 'Plausible fit without current intent. Observe or connect; do not invent a need.',
    messageRecommended: false,
    noMessageReason: 'No current reason to message. Connect or wait.',
  }
}

function selectMessageJob(
  source: StrategySource,
  contact: ContactDecision,
  conversation: ConversationKnowledge | null,
): MessageJob | null {
  if (!contact.messageRecommended && source.relationshipStage !== 'reply') return null
  if (conversation) return conversation.messageJob

  if (source.channel === 'followup' || source.relationshipStage === 'followup') {
    // A lead can now receive up to MAX_FOLLOWUPS_PER_LEAD (3, see
    // src/lib/relay/message-eligibility.ts) follow-ups across its life —
    return source.priorFollowupCount >= 3 ? null : 'CLOSE_LOOP'
  }
  if (source.channel === 'connection' || contact.action === 'CONNECT_OR_OBSERVE') {
    return 'EARN_CONNECTION'
  }
  if (contact.reason === 'EXPLICIT_NEED' && source.opportunitySignals.includes('hiring')) {
    return 'TEST_DELIVERY_MODEL'
  }
  if (contact.reason === 'EXPLICIT_NEED') return 'CONFIRM_RELEVANCE'
  if (contact.reason === 'DEMONSTRATED_PROBLEM') return 'CONFIRM_RELEVANCE'
  if (contact.reason === 'RELEVANT_CHANGE') return 'EARN_CONNECTION'
  return 'DISCOVER_NEED'
}

function releaseKnowledge(
  source: StrategySource,
  scoped: ScopedItem[],
  contact: ContactDecision,
  job: MessageJob | null,
): KnowledgeItem[] {
  const items: KnowledgeItem[] = []
  const already = new Set(source.alreadyShared.map((s) => s.toLowerCase()))

  for (const fact of scoped) {
    if (fact.scope.startsWith('HISTORICAL')) {
      items.push({
        text: fact.text,
        release: 'NEVER_CLAIM',
        reason: 'Historical evidence must not be used as a current opportunity.',
        scope: fact.scope,
      })
      continue
    }
    if (already.has(fact.text.toLowerCase())) {
      items.push({ text: fact.text, release: 'ALREADY_SHARED', reason: 'Already used in a prior message.', scope: fact.scope })
      continue
    }
    if (!fact.safeToMention || !isStrategyGroundingText(fact.text)) {
      items.push({ text: fact.text, release: 'HOLD', reason: 'Not safe for outreach.', scope: fact.scope })
      continue
    }
    items.push({
      text: fact.text,
      release: 'AVAILABLE',
      reason: 'Current and sourced.',
      scope: fact.scope,
    })
  }

  items.push({
    text: 'BPulse takes ownership of defined software outcomes without adding another engineering organization to manage.',
    release: job === 'PROVIDE_PROOF' || source.relationshipStage === 'reply' ? 'HOLD' : 'HOLD',
    reason: 'Positioning is intelligence. Do not dump it into cold copy.',
    scope: 'UNKNOWN_TIME',
  })
  items.push({
    text: 'Sender biography, years of experience, or a capability list.',
    release: 'HOLD',
    reason: 'Credentials are not the job of a first message.',
    scope: 'UNKNOWN_TIME',
  })

  const allowedCandidates = items.filter((i) => i.release === 'AVAILABLE' && i.scope === 'CURRENT_OPPORTUNITY')
  const fallback = items.filter((i) => i.release === 'AVAILABLE')
  const pick = (allowedCandidates[0] ?? fallback[0]) ?? null

  if (pick && contact.messageRecommended && job) {
    pick.release = 'ALLOWED_NOW'
    pick.text = toWriterSafeFact(pick.text, source.company)
    pick.reason = 'The single fact the writer may use — as intelligence, not as copy to paste.'
  }

  return items
}

function buildUnknowns(source: StrategySource, conversation: ConversationKnowledge | null): string[] {
  const unknowns = [...source.unknowns]
  const fields: CommercialField[] = ['need', 'scope', 'timeline', 'budget', 'authority', 'currentSolution']
  for (const field of fields) {
    const state = conversation?.fields[field]
    if (!state || state.status === 'unknown') unknowns.push(field)
  }
  if (source.opportunitySignals.length === 0) unknowns.push('current commercial need')
  return unknowns
}

function pickStrongestCurrentEvidence(scoped: ScopedItem[], source: StrategySource): string | null {
  const current = scoped.find((s) => s.scope === 'CURRENT_OPPORTUNITY' && s.kind === 'FACT' && isStrategyGroundingText(s.text))
  if (current) return current.text
  if (source.verbatimQuote && isStrategyGroundingText(source.verbatimQuote) && scopeEvidenceText(source.verbatimQuote).startsWith('CURRENT')) return clip(source.verbatimQuote, 160)
  const anyCurrent = scoped.find((s) => s.scope.startsWith('CURRENT') && isStrategyGroundingText(s.text))
  return anyCurrent?.text ?? null
}

function defaultNextMove(contact: ContactDecision, job: MessageJob | null): ConversationMove {
  if (!job || !contact.messageRecommended) return 'WAIT'
  if (job === 'CLOSE_LOOP') return 'CLOSE'
  if (job === 'PROVIDE_PROOF') return 'PROVIDE_PROOF'
  if (job === 'MOVE_TO_CALL') return 'CALL'
  if (job === 'RESOLVE_OBJECTION') return 'CLARIFY'
  return 'ASK'
}

function describeNextAction(contact: ContactDecision, job: MessageJob | null, source: StrategySource): string {
  if (source.relationshipStage === 'reply') return job ? `Reply with job ${job}` : 'Reply using the new first-party evidence'
  if (contact.action === 'SKIP') return 'Skip — no credible reason to contact'
  if (contact.action === 'RESEARCH_MORE') return 'Research more before writing'
  if (contact.action === 'CONNECT_OR_OBSERVE' && !contact.messageRecommended) return 'Observe or send a connection with no pitch'
  if (job === 'EARN_CONNECTION') return 'Send a short connection note — earn access only'
  if (job === 'TEST_DELIVERY_MODEL') return 'Ask whether they are set on hiring or open to owned delivery'
  if (job === 'CONFIRM_RELEVANCE') return 'Ask one question that confirms the current need'
  if (job === 'CLOSE_LOOP') return 'Add one new reason to reply, or close gracefully'
  if (contact.action === 'CONTACT_NOW') return 'Contact now with one job and one question'
  return 'Do not write yet'
}

function describeCommercialSituation(
  assessment: FitIntentConfidence,
  source: StrategySource,
  strongest: string | null,
): string {
  const fitLine = `${assessment.fit} fit · ${assessment.intent} intent · ${assessment.confidence} confidence`
  if (!strongest) return `${fitLine}. Commercial need is not in evidence.`
  return `${fitLine}. Strongest current evidence: ${strongest}`
}

function describeRelationship(source: StrategySource): string {
  if (source.relationshipStage === 'reply') return 'They replied — first-party conversation'
  if (source.connectionAccepted) return 'They accepted the connection'
  if (source.relationshipStage === 'followup') return 'Waiting after first touch'
  if (source.relationshipStage === 'warming') return 'Warming'
  return 'No relationship yet'
}

function buildUiRationale(
  assessment: FitIntentConfidence,
  contact: ContactDecision,
  strongest: string | null,
  nextAction: string,
  company?: string | null,
): string {
  const bits = [
    `${assessment.fit} fit, ${assessment.intent} intent, ${assessment.confidence} confidence.`,
    contact.why,
    strongest && contact.messageRecommended ? `Use: ${clip(toWriterSafeFact(strongest, company), 90)}.` : null,
    nextAction,
  ]
  return bits.filter(Boolean).join(' ')
}

function successConditionFor(job: MessageJob | null, contact: ContactDecision): string {
  if (!job || !contact.messageRecommended) return 'No message. Do not force contact.'
  switch (job) {
    case 'EARN_CONNECTION':
      return 'They accept the connection without feeling pitched.'
    case 'CONFIRM_RELEVANCE':
      return 'They confirm or correct the need in one reply.'
    case 'TEST_DELIVERY_MODEL':
      return 'They answer whether hiring is fixed or delivery ownership is open.'
    case 'DISCOVER_NEED':
      return 'One new first-party fact about what they actually need.'
    case 'UNDERSTAND_SCOPE':
      return 'They name what is in or out of scope.'
    case 'UNDERSTAND_TIMELINE':
      return 'They name when this matters.'
    case 'RESOLVE_OBJECTION':
      return 'The named objection is addressed honestly.'
    case 'PROVIDE_PROOF':
      return 'The specific credibility concern is answered.'
    case 'MOVE_TO_CALL':
      return 'A call is offered only because a sync is more efficient than another message.'
    case 'ACKNOWLEDGE_AND_HOLD':
      return 'They feel heard, not pitched. Door stays open for future contact.'
    case 'CLARIFY_NEXT_STEP':
      return 'One next step is agreed.'
    case 'CLOSE_LOOP':
      return 'They reply, or the thread ends cleanly with no chase.'
  }
}

function oneCtaFor(job: MessageJob | null): string {
  switch (job) {
    case 'EARN_CONNECTION':
      return 'No pitch. Presence is the CTA.'
    case 'TEST_DELIVERY_MODEL':
      return 'One either/or question about hiring vs owned delivery.'
    case 'CONFIRM_RELEVANCE':
    case 'DISCOVER_NEED':
    case 'UNDERSTAND_SCOPE':
    case 'UNDERSTAND_TIMELINE':
      return 'One specific question they can answer in a sentence.'
    case 'PROVIDE_PROOF':
      return 'Answer the ask. No extra ask unless needed to scope the proof.'
    case 'CLOSE_LOOP':
      return 'One new reason to reply, or an easy "not now".'
    case 'MOVE_TO_CALL':
      return 'Offer a call only if the thread now needs a sync.'
    case null:
      return 'None. Do not write.'
    default:
      return 'One question or none.'
  }
}

function asCanonical(value: Record<string, unknown> | null | undefined): CanonicalProspectIntelligence | null {
  if (!value || value.version !== 'relay_qualification_v2') return null
  return value as unknown as CanonicalProspectIntelligence
}

function inferSignalsFromLegacy(signalType: number | null, evidence: string | null | undefined): OpportunitySignal[] {
  const text = evidence ?? ''
  const signals: OpportunitySignal[] = []
  if (signalType === 1 || /\b(we(?:'re| are) hiring|hiring (a |an )|open role|looking for (a |an )?(engineer|developer))\b/i.test(text)) signals.push('hiring')
  if (/\bfreelance|contractor|project need\b/i.test(text)) signals.push('freelance_project_need')
  if (signalType === 6 || /\b(latency|outage|rewrite|rebuild|migration|bug|debt)\b/i.test(text)) signals.push('technical_problem')
  if (/\bneed help|looking for (help|someone)\b/i.test(text)) signals.push('explicit_ask')
  return unique(signals)
}

function hiringHints(evidence: string | null | undefined): string[] {
  if (!evidence) return []
  return /\bhiring|open role|we're looking for\b/i.test(evidence) ? [clip(evidence, 160)] : []
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trim()}…`
}

/**
 * Convert a prospect quote into a writer-safe observation.
 * First-person hiring copy must never be pasted as if the sender is hiring.
 */
export function toWriterSafeFact(text: string, company?: string | null): string {
  let t = text.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '')
  t = t.replace(/^(we(?:'re| are)|i(?:'m| am))\s+hiring\b/i, 'hiring')
  t = t.replace(/^(we(?:'re| are)|i(?:'m| am))\s+/i, '')
  t = t.replace(/[.]+$/g, '')

  const role = inferRoleLabel(t)
  if (/\bhiring\b/i.test(t) && role) {
    // Preserve any organization already named in the evidence (e.g. "Tayo360 is hiring").
    const existingOrg = extractOrgName(t)
    if (existingOrg) return `${existingOrg} is hiring for a ${role}`
    const named = company && company !== 'Unknown company' ? company : null
    return named ? `${named} is hiring for a ${role}` : `hiring for a ${role}`
  }
  return clip(t, 120)
}

function extractOrgName(text: string): string | null {
  // Match patterns like "OrgName is hiring", "OrgName hiring", "OrgName needs"
  const match = text.match(/^([A-Z][A-Za-z0-9\s&]+?)\s+(?:is\s+)?(?:hiring|looking\s+for|needs?|seeking)\b/i)
  return match?.[1]?.trim() || null
}

function inferRoleLabel(text: string): string | null {
  if (/\bfull[- ]stack\b/i.test(text)) return 'full-stack role'
  if (/\bfrontend|front-end|react\b/i.test(text)) return 'frontend role'
  if (/\bbackend|back-end|rails|node\b/i.test(text)) return 'backend role'
  if (/\bmobile|ios|android\b/i.test(text)) return 'mobile role'
  if (/\bdevops|sre|infra\b/i.test(text)) return 'infra role'
  if (/\bsenior\b/i.test(text)) return 'senior role'
  if (/\b(engineer|developer|designer)\b/i.test(text)) return 'role'
  return null
}

function dedupeScoped(items: ScopedItem[]): ScopedItem[] {
  const seen = new Set<string>()
  const out: ScopedItem[] = []
  for (const item of items) {
    const key = item.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
