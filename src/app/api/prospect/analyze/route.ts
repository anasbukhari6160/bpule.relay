import { hasProvider } from '@/lib/ai/config'
import { scanForSecrets } from '@/lib/ai/secrets'
import { deduplicated } from '@/lib/ai/dedup'
import { createScoutStore } from '@/lib/store'
import { sseStream } from '@/lib/sse/sse'
import { buildProfileIntelligence, matchProofToLead } from '@/lib/relay/profile-intelligence'
import type { SenderSuggestion } from '@/lib/relay/sender-suggestion'
import { loadSenderProfiles, routeLead } from '@/lib/relay/routing-context'
import type { RoutingResult } from '@/lib/relay/sender-routing-engine'
import { deriveRecommendedAction, ROUTING_MISMATCH_DELTA, type DeriveActionOutput, type RecommendedAction } from '@/lib/intelligence-v3/action/recommended-action'
import { opportunityVersionTag } from '@/lib/intelligence-v3/versions'
import { qualifyCanonicalScore, displayScoreForCanonical } from '@/lib/scoring/qualification'
import { getAuthContext } from '@/lib/auth/organization'
import { resolveAccessibleIdentity } from '@/lib/workspace/resolve-active-identity'
import { createServiceSupabase } from '@/lib/supabase/service'
import { createOutreachStrategy } from '@/lib/relay/outreach-strategy'
import { streamDraft } from '@/lib/ai/draft-stream'
import { type DraftMessageType } from '@/lib/ai/draft'
import { selectFewShotExamples } from '@/lib/ai/few-shot'
import { mergeProofMatches } from '@/lib/ai/proof-match'
import { classifyLeadFact } from '@/lib/relay/profile-intelligence'
import { buildConnectionNoteStrategy } from '@/lib/prospect/strategy'
import { validateAndRepair, normalizeGreeting, CONNECTION_NOTE_MAX_CHARS } from '@/lib/prospect/connection-note'
import { evaluateProspectQualification } from '@/lib/prospect/qualification-gate'
import { normalizeProspectPaste } from '@/lib/prospect/paste-normalize'
import { classifyRoleFromTitle } from '@/lib/leads/targeting-pure'
import { isLinkedInChromeText } from '@/lib/intelligence-v2/role-signals'
import type { ExtractedLead, Profile, MatchedProof } from '@/lib/domain/types'
import { produceCanonicalIntelligence, getDisplayScore, deriveSignalEvidenceFallback, isClientCanonicalStillValid } from '@/lib/intelligence-v2/orchestrator'
import { normalizeScoreDimensions } from '@/lib/scoring/display-score'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { V3_CANONICAL } from '@/lib/intelligence-v3/config'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import { resolveBuyerIntentFromSource, type VerifiedBuyerIntent } from '@/lib/intelligence-v3/buyer-intent'
import { resolveCurrentOrgContext } from '@/lib/intelligence-v3/current-org'
import { resolveTimezoneFromLocation } from '@/lib/timezone/resolve'
import {
  applyRevenueStrategyToOutreach,
  buildRevenueStrategy,
  describeMessagingPolicy,
  mapSignalsToLegacyType,
  sourceFromCanonical,
  toUiSnapshot,
  type MessagingPolicy,
} from '@/lib/relay/revenue-strategy'

/**
 * Messaging policies that actually involve writing/sending a pitch message.
 * CONNECT_WITHOUT_NOTE, OBSERVE, SKIP, RESEARCH_MORE carry no pitch and must
 * never trigger sender/proof selection or "Best sender" UI — see Bug 4
 * (Revenue Identity / proof gating tied to numeric qualification instead of
 * to whether the action requires a pitch).
 */
const PITCHING_MESSAGING_POLICIES: ReadonlySet<MessagingPolicy> = new Set([
  'DM', 'EMAIL', 'CONNECT_WITH_NOTE', 'UPWORK_PROPOSAL', 'FOLLOW_UP', 'REPLY',
])

function isPitchingPolicy(policy: MessagingPolicy): boolean {
  return PITCHING_MESSAGING_POLICIES.has(policy)
}

/**
 * Project the ONE recommended action onto the connection-channel messaging
 * policy and the legacy ContactAction the prospect page renders. The action
 * is decided by deriveRecommendedAction; this only relabels it.
 */
function messagingPolicyFor(action: RecommendedAction): MessagingPolicy {
  switch (action) {
    case 'CONTACT_NOW':
    case 'CONNECT_WITH_NOTE':
    case 'REPLY_NOW':
    case 'FOLLOW_UP':
      return 'CONNECT_WITH_NOTE'
    case 'CONNECT_WITHOUT_NOTE': return 'CONNECT_WITHOUT_NOTE'
    case 'OBSERVE': return 'OBSERVE'
    case 'RESEARCH_MORE':
    case 'WAIT':
    case 'DEFER':
    case 'REFER':
    case 'ASK_FOR_HELP':
      return 'RESEARCH_MORE'
    case 'CLOSE':
    default:
      return 'SKIP'
  }
}

function contactActionFor(action: RecommendedAction): 'CONTACT_NOW' | 'CONNECT_OR_OBSERVE' | 'RESEARCH_MORE' | 'SKIP' {
  switch (action) {
    case 'CONTACT_NOW':
    case 'REPLY_NOW':
    case 'FOLLOW_UP':
      return 'CONTACT_NOW'
    case 'CONNECT_WITH_NOTE':
    case 'CONNECT_WITHOUT_NOTE':
    case 'OBSERVE':
      return 'CONNECT_OR_OBSERVE'
    case 'RESEARCH_MORE':
    case 'WAIT':
    case 'DEFER':
    case 'REFER':
    case 'ASK_FOR_HELP':
      return 'RESEARCH_MORE'
    case 'CLOSE':
    default:
      return 'SKIP'
  }
}

function fitLabelFor(level: string | null | undefined): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  switch (level) {
    case 'EXCELLENT':
    case 'STRONG':
    case 'HIGH':
      return 'HIGH'
    case 'MEDIUM': return 'MEDIUM'
    case 'WEAK':
    case 'POOR':
    case 'LOW':
      return 'LOW'
    default: return 'UNKNOWN'
  }
}

/**
 * Prospect Analyze API — Intelligence V2
 *
 * Pipeline: paste → canonical intelligence (multi-pass extraction → completeness gate → canonical score) → match sender → connection note.
 *
 * Ephemeral by default. Nothing is persisted unless the client explicitly
 * calls POST /api/leads with the extracted data (via the "Save as Lead" flow).
 *
 * The canonical score is produced ONCE and never independently recomputed.
 */

// TEAM-006 (Relay team bug bash): high-scoring leads (canonicalScore/legacy
// >= 70) route drafting through DEEP_WRITING (30s timeout PLUS a mandatory
// corrective retry attempt on escalation — see isHighValue in
// draft-stream.ts/draft.ts), which can legitimately take longer than a
// platform function's default timeout. Every sibling route that can invoke
// the same expensive extraction+drafting work already sets this explicitly
// (leads/extract, leads/[id]/draft, inbound/analyze all use 120) — this
// route was the one gap, and is architecturally the MOST likely to hit a
// long-running high-value draft (it's the only route that both extracts
// AND drafts in one request). Not present locally in `next dev` (no
// enforced timeout), so this would only manifest in a real deployment —
// consistent with a reported production-only symptom.
export const maxDuration = 120

// In-memory cache: content hash → analyze result. Avoids re-running the
// full AI pipeline when the same paste is analyzed twice (common during
// "Try Another Angle" or page refresh). TTL 5 minutes.
const analyzeCache = new Map<string, { data: Record<string, unknown>; ts: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

function cacheKey(rawText: string, profileId: string | null, generateNote: boolean = false): string {
  // Every opportunity version is in the key so a deploy never serves a
  // decision computed under older scoring rules.
  return `${opportunityVersionTag()}:${rawText.slice(0, 200).toLowerCase().replace(/\s+/g, ' ').trim()}:${rawText.length}:${profileId ?? ''}:${generateNote ? 'note' : 'analyze'}`
}

// Periodic cache cleanup to prevent memory leaks
function cleanupCache() {
  const now = Date.now()
  for (const [k, v] of analyzeCache) {
    if (now - v.ts > CACHE_TTL_MS) analyzeCache.delete(k)
  }
}

export async function POST(request: Request) {
  let body: {
    rawText?: string
    profileId?: string
    forceReanalyze?: boolean
    generateNote?: boolean
    /**
     * "Try Another Angle" support (Relay team bug bash — TEAM-005). The
     * client already holds the canonical intelligence result from the
     * initial Analyze call. When it sends that SAME result back here
     * unchanged (verified by input hash below, not merely trusted), the
     * route skips produceCanonicalIntelligence entirely — no fresh
     * extraction, no fresh scoring — and only reruns sender-matching +
     * connection-note generation. This is what makes "Try Another Angle"
     * produce a new MESSAGE/STRATEGY angle without ever being able to
     * change canonical evidence, score, qualification, or action, even
     * before the lead has been saved (reuseIfUnchanged alone can't help
     * here — it only matches against ALREADY-SAVED leads, and this button
     * is used before that point).
     */
    existingCanonical?: CanonicalProspectIntelligence
    revenueIdentityId?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // LinkedIn button/link labels are not prospect evidence; strip them once
  // here so extraction, eligibility, caching and reuse all see the same text.
  const rawText = typeof body.rawText === 'string' ? normalizeProspectPaste(body.rawText) : ''
  const generateNote = body.generateNote === true
  if (!rawText) {
    return new Response(JSON.stringify({ error: 'Paste some profile text first.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (rawText.length > 30_000) {
    return new Response(JSON.stringify({ error: 'Paste is too long. Try a single profile at a time.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const explicitProfileId = body.profileId ?? null
  let requestedWorkspaceId: string | null = null
  if (typeof body.revenueIdentityId === 'string') {
    try {
      const workspace = await resolveAccessibleIdentity(body.revenueIdentityId)
      requestedWorkspaceId = workspace?.id ?? null
    } catch {
      requestedWorkspaceId = null
    }
  }

  const minimumExtracted: ExtractedLead = {
    name: null,
    title: null,
    titleRaw: null,
    company: 'Unknown company',
    url: null,
    locationRaw: null,
    aboutSummary: null,
    experienceSummary: null,
    recentPosts: [],
    roleCategory: 'other',
    marketRegion: 'unknown',
    signalType: 7,
    signalEvidence: rawText,
    extractionConfidence: 0,
    confidenceNotes: [],
    verbatimQuote: null,
    tags: [],
  }
  const precheck = evaluateProspectQualification({ rawText, extracted: minimumExtracted })

  // Cache check: same content already analyzed recently.
  // BUG-17: generateNote requests always bypass cache — the cached analyze
  // result has no connection note, so returning it would show an empty note.
  cleanupCache()
  const ck = cacheKey(rawText, typeof body.profileId === 'string' ? body.profileId : null, false)
  if (!generateNote) {
    const cached = analyzeCache.get(ck)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return sseStream(async (emit) => {
        emit({ type: 'status', message: 'Using cached analysis' })
        emit({ type: 'done', ...cached.data })
      })
    }
  }

  return sseStream(async (emit) => {
    if (precheck.inputHardFail) {
      emit({ type: 'status', message: describeUnscorableInput(precheck).status })
      emitInsufficientDone(emit, minimumExtracted, precheck)
      return
    }

    let store = null
    try {
      store = await createScoutStore()
    } catch {
      store = null
    }

    emit({ type: 'status', message: 'Scanning the paste' })
    const scanned = scanForSecrets(rawText)
    if (scanned.blocked) {
      emit({ type: 'error', message: scanned.reason })
      return
    }

    // "Try Another Angle": if the client sent back its already-held
    // canonical result AND its recorded input hash still matches this exact
    // rawText under the CURRENT pipeline/score versions, reuse it directly —
    // skip extraction and scoring entirely. Verified server-side (hash +
    // version equality), never merely trusted from the client, so a client
    // cannot use this to smuggle a stale or tampered canonical result past
    // real analysis.
    let canonicalResult: Awaited<ReturnType<typeof produceCanonicalIntelligence>>
    const clientCanonicalValid = isClientCanonicalStillValid(body.existingCanonical, rawText, body.forceReanalyze === true)

    if (clientCanonicalValid) {
      const clientCanonical = body.existingCanonical!
      emit({ type: 'status', message: `Reusing existing intelligence — score ${clientCanonical.canonicalScore}/100 (${clientCanonical.scoreBreakdown.label})` })
      canonicalResult = {
        intelligence: clientCanonical,
        gatePassed: true,
        gateNotes: ['Reused client-held canonical intelligence for a new angle — unchanged input, same versions.'],
        repairAttempted: false,
        repairImproved: false,
        reused: true,
      }
    } else {
      emit({ type: 'status', message: 'Extracting prospect intelligence' })
      try {
        const dedupKey = `analyze:${rawText.slice(0, 200)}`

        if (V3_CANONICAL) {
          // V3 is canonical: V3 bridge runs its own extraction + decision pipeline
          const senderCaps: string[] = []
          const profileId = typeof body.profileId === 'string' ? body.profileId : null
          const v3Result = await produceV3Intelligence(rawText, {
            senderCapabilities: senderCaps,
            onStatus: (msg) => emit({ type: 'status', message: msg }),
            profileId,
            reuseIfUnchanged: store
              ? async (reuseKey) => {
                  const existing = await store!.findLeadByV3ReuseKey(reuseKey)
                  const packet = existing?.canonicalIntelligence as Record<string, unknown> | null | undefined
                  const v3Packet = packet?.v3DecisionPacket as V3LeadDecisionPacket | null | undefined
                  return v3Packet ?? null
                }
              : undefined,
          })
          canonicalResult = {
            intelligence: v3Result.intelligence,
            gatePassed: true,
            gateNotes: v3Result.v2Fallback ? ['V3 failed, V2 fallback'] : [],
            repairAttempted: false,
            repairImproved: false,
            reused: false,
          }
        } else {
          // Legacy V2 path
          canonicalResult = await deduplicated(dedupKey, () =>
            produceCanonicalIntelligence(rawText, {
              onStatus: (msg) => emit({ type: 'status', message: msg }),
              forceReanalyze: body.forceReanalyze === true,
              reuseIfUnchanged: store
                ? async (hash) => {
                    const existing = await store!.findLeadByIntelligenceInputHash(hash)
                    const canonical = existing?.canonicalIntelligence as CanonicalProspectIntelligence | null | undefined
                    return canonical ?? null
                  }
                : undefined,
            }),
          )
        }
      } catch {
        emit({ type: 'error', message: 'Intelligence extraction failed.' })
        return
      }
    }

    const canonical = canonicalResult.intelligence
    const v3Packet = (canonical as CanonicalProspectIntelligence & { v3DecisionPacket?: unknown }).v3DecisionPacket ?? null
    // Current-organization context: the industry is the CURRENT company's,
    // never a past role's — it replaces whatever extraction stored.
    const packetOrg = (v3Packet as V3LeadDecisionPacket | null)?.orgContext
    const orgContext = packetOrg ?? (() => {
      const c = resolveCurrentOrgContext(rawText)
      return { currentIndustry: c.currentIndustry, currentIndustryLine: c.currentIndustryLine, currentProductActivity: c.currentProductActivity }
    })()
    if (orgContext.currentIndustry) {
      canonical.intelligence.company = { ...canonical.intelligence.company, industry: orgContext.currentIndustry }
    }
    const extracted: ExtractedLead = {
      name: canonical.intelligence.person.fullName,
      title: canonical.intelligence.person.title,
      titleRaw: canonical.intelligence.person.title,
      company: canonical.intelligence.company.name ?? 'Unknown company',
      url: canonical.intelligence.person.linkedinUrl ?? canonical.rawSource.sourceUrl,
      locationRaw: canonical.intelligence.person.location,
      aboutSummary: null,
      experienceSummary: null,
      recentPosts: canonical.intelligence.content.recentPosts
        .filter((p) => !isLinkedInChromeText(p.paraphrase) && !isLinkedInChromeText(p.verbatimQuote))
        .map((p) => ({
          paraphrase: p.paraphrase,
          verbatimQuote: p.verbatimQuote,
        })),
      roleCategory: classifyRoleFromTitle(canonical.intelligence.person.title),
      marketRegion: 'unknown',
      signalType: mapSignalsToLegacyType(canonical.intelligence.opportunity.signals),
      signalEvidence: deriveSignalEvidenceFallback(canonical, rawText),
      extractionConfidence: canonical.extractionCompleteness.score,
      confidenceNotes: canonical.scoreBreakdown.missingInfo,
      verbatimQuote: canonical.intelligence.content.recentPosts.find((p) => !isLinkedInChromeText(p.verbatimQuote))?.verbatimQuote ?? null,
      tags: [
        ...canonical.intelligence.content.topics,
        ...canonical.intelligence.content.technicalSignals,
        ...(canonical.intelligence.company.industry ? [canonical.intelligence.company.industry] : []),
      ],
    }

    // (score, qualification, relationship) from the canonical blob.
    const revenue = buildRevenueStrategy(sourceFromCanonical(canonical, { channel: 'connection' }))
    const loop = toUiSnapshot(revenue)

    // The ONE buyer decision. V3 packets carry it; the V2 path resolves it
    // from source the same way. The UI's intent comes from here only.
    const buyerIntent: VerifiedBuyerIntent = (v3Packet as V3LeadDecisionPacket | null)?.buyerIntent
      ?? resolveBuyerIntentFromSource(rawText)
    ;(loop as { intent: string }).intent = buyerIntent.buyerIntentLevel

    // The ONE recommended action. The packet already carries the cold
    // decision from deriveRecommendedAction (opportunity + confidence); the
    // revenue strategy only supplies the message job and channel copy.
    const packet = v3Packet as V3LeadDecisionPacket | null
    const recommended: DeriveActionOutput | null = packet?.recommendedAction ?? null
    const v3Action = recommended?.action ?? (packet ? packet.action : null)
    const v3MessageEligible = recommended?.messageEligible ?? (packet ? packet.messageEligible : null)

    if (V3_CANONICAL && packet && recommended) {
      ;(loop as { fit: string }).fit = fitLabelFor(packet.resolved?.fit ?? packet.decision.fit)
      ;(loop as { confidence: string }).confidence = packet.confidenceDetail?.label ?? 'LOW'
      ;(loop as { act: string }).act = contactActionFor(recommended.action)
      ;(loop as { messageRecommended: boolean }).messageRecommended = recommended.messageEligible
      const policy = messagingPolicyFor(recommended.action)
      ;(loop as { messagingPolicy: string }).messagingPolicy = policy
      ;(loop as { messagingPolicyLabel: string }).messagingPolicyLabel = describeMessagingPolicy(policy)

      // Message job: a verified request is a scope conversation; a
      // relationship touch earns the connection first.
      if (recommended.messageEligible) {
        ;(loop as { messageJob: string }).messageJob = buyerIntent.verifiedBuyerRequest
          ? 'UNDERSTAND_SCOPE'
          : buyerIntent.verifiedHiringNeed ? 'TEST_DELIVERY_MODEL' : 'EARN_CONNECTION'
        revenue.messageJob = loop.messageJob as typeof revenue.messageJob
        revenue.contact.messageRecommended = true
      } else {
        ;(loop as { messageJob: string | null }).messageJob = null
        revenue.contact.messageRecommended = false
      }

      const cp = packet.resolved?.commercialPotential ?? packet.latentPotential ?? null
      const why = [
        `Intent: ${buyerIntent.buyerIntentLevel}${buyerIntent.verifiedBuyerRequest ? ' (verified request)' : ''}.`,
        cp ? `Commercial potential: ${cp.toLowerCase().replace('_', ' ')}.` : null,
        packet.reasons.length > 0 ? packet.reasons.slice(0, 3).join('. ') + '.' : null,
      ].filter(Boolean).join(' ')
      ;(loop as { why: string }).why = why
      ;(loop as { nextAction: string }).nextAction = recommended.reason
      ;(loop as { noMessageReason: string | null }).noMessageReason = recommended.messageEligible ? null : recommended.reason
      if (packet.watchOut.length > 0) {
        ;(loop as { reason: string }).reason = packet.watchOut.join('. ')
      }
    }

    if (store) {
      try {
        await store.emitRelayEvent({
          eventType: 'PROSPECT_ANALYZED',
          entityType: 'prospect',
          // No entity UUID exists pre-capture — the source URL/company
          // identify this prospect via payload + sourceEventId instead.
          actorType: 'system',
          payload: {
            company: extracted.company,
            sourceUrl: extracted.url ?? null,
            qualification: canonical.qualification,
            fit: loop.fit,
            intent: loop.intent,
            confidence: loop.confidence,
            contactAction: loop.act,
            messageRecommended: loop.messageRecommended,
          },
          source: 'app',
          sourceEventId: `prospect_analyzed:${extracted.url ?? extracted.company}:${canonical.scoredAt}`,
        })
      } catch {
        // Event emission must never block analyze
      }
    }

    if (store && loop.messageRecommended) {
      try {
        await store.emitRelayEvent({
          eventType: 'LEAD_QUALIFIED',
          entityType: 'prospect',
          actorType: 'system',
          payload: {
            company: extracted.company,
            sourceUrl: extracted.url ?? null,
            reason: loop.reason,
            action: loop.act,
            fit: loop.fit,
            intent: loop.intent,
            confidence: loop.confidence,
          },
          source: 'app',
          sourceEventId: `lead_qualified:${extracted.url ?? extracted.company}:${canonical.scoredAt}`,
        })
      } catch {
        // Qualification telemetry must never block analysis.
      }
    }

    // Gate sender/proof selection off whether the recommended messaging
    // policy actually involves a pitch — NOT off qualification/action==='SKIP'
    // alone. A non-skip-qualification prospect with a legitimate
    // CONNECT_WITHOUT_NOTE or OBSERVE action has nothing to pitch and must
    // not go through full sender/proof selection or show "Best sender" UI.
    if (!isPitchingPolicy(loop.messagingPolicy)) {
      emit({
        type: 'done',
        extracted,
        canonical,
        revenue: loop,
        score: {
          total: canonical.canonicalScore,
          displayScore: getDisplayScore(canonical),
          label: canonical.scoreBreakdown.label,
          qualification: canonical.qualification,
          reasons: canonical.scoreBreakdown.reasons,
          watchOut: rewordWatchOutForNoOutreach(canonical.scoreBreakdown.watchOut),
          dimensions: normalizeScoreDimensions(canonical.scoreBreakdown.dimensions),
          missingInfo: canonical.scoreBreakdown.missingInfo,
          ...scoreTrace(canonical),
        },
        buyerIntent,
        orgContext,
        remoteEligibility: canonical.remoteEligibility,
        evidenceLedger: canonical.evidenceLedger,
        sources: {
          rawSource: canonical.rawSource,
          urls: canonical.extractionCompleteness.urlsPreserved,
          sourceUrlsFound: canonical.extractionCompleteness.sourceUrlsFound,
        },
        extractionCompleteness: canonical.extractionCompleteness,
        bestSender: null,
        bestSenderProof: [],
        connectionNote: '',
        charCount: 0,
        maxChars: CONNECTION_NOTE_MAX_CHARS,
        quality: { passed: true, failures: [], wasRepaired: false },
        strategy: {
          whyConnect: '',
          relevantObservation: '',
          forbidden: [],
          candidateAngles: [],
        },
        draftFailed: false,
        demoMode: !hasProvider(),
        alternativeSenders: [],
        qualification: evaluateProspectQualification({
          rawText,
          extracted,
          canonicalQualification: canonical.qualification,
        }),
        gateNotes: canonicalResult.gateNotes,
        repairAttempted: canonicalResult.repairAttempted,
        repairImproved: canonicalResult.repairImproved,
        reused: canonicalResult.reused,
        // Canonical decision context
        recommendedAction: recommended,
        versions: packet?.versions ?? null,
        resolved: packet?.resolved ?? null,
        confidenceDetail: packet?.confidenceDetail ?? null,
        rejectedSignals: packet?.sourceFacts?.rejectedSignals ?? [],
        decisionRunId: packet?.decisionRunId ?? null,
        senderRouting: null,
        routingRecommendation: null,
        // V3 telemetry
        decisionVersion: V3_CANONICAL ? 'decision_v3' : 'relay_qualification_v2',
        scoreVersion: V3_CANONICAL ? (packet?.scoreVersion ?? 'score_v3') : (canonical as CanonicalProspectIntelligence).scoreVersion,
        decisionProvider: V3_CANONICAL ? packet?.decisionProvider ?? 'openai' : undefined,
        decisionModel: V3_CANONICAL ? packet?.decisionModel : undefined,
        selectedEpisodeId: V3_CANONICAL ? packet?.selectedEpisodeId : undefined,
        v3Action: V3_CANONICAL ? v3Action ?? undefined : undefined,
        messageEligible: V3_CANONICAL ? v3MessageEligible ?? undefined : undefined,
      })
      return
    }

    emit({ type: 'status', message: 'Matching sender profiles' })
    let profiles: Profile[] = []
    let fewShotPool: Array<{ id: string; messageId: string; leadId: string; playId: string | null; signalType: number | null; sentText: string; company: string; signalEvidence: string | null; tags: string[]; createdAt: string }> = []
    try {
      if (store) {
        const [p, fs] = await Promise.all([
          store.listProfiles(),
          store.listFewShotWins(50),
        ])
        profiles = p
        fewShotPool = fs
      }
    } catch {
      // Profiles/ephemeral — continue without them
    }

    // Tags still feed proof-card matching for the note writer.
    const tagsForMatching = [
      ...canonical.intelligence.content.topics,
      ...canonical.intelligence.content.technicalSignals,
      ...(canonical.intelligence.company.industry ? [canonical.intelligence.company.industry] : []),
    ]

    // ONE sender ranking (rankSendersForLead through routing-context) — the
    // same engine and inputs the lead page and the admin routing panel use.
    // Channel authorization: the recommended channel is a LinkedIn
    // connection note, so only LinkedIn profiles are eligible senders.
    const RECOMMENDED_CHANNEL_PLATFORM: Profile['platform'] = 'linkedin'
    const channelAuthorizedProfiles = profiles.filter((p) => p.platform === RECOMMENDED_CHANNEL_PLATFORM)
    const profileById = new Map(profiles.map((p) => [p.id, p]))

    let senderRouting: RoutingResult | null = null
    try {
      const auth = await getAuthContext()
      if (auth) {
        const senders = await loadSenderProfiles(createServiceSupabase(), auth.orgId, auth.repId)
        senderRouting = routeLead(
          { company: extracted.company, contactName: extracted.name, contactTitle: extracted.title, rawInput: rawText, senderProfileId: explicitProfileId },
          packet,
          senders,
          RECOMMENDED_CHANNEL_PLATFORM,
        )
      }
    } catch (err) {
      console.warn('[prospect/analyze] sender routing skipped:', err instanceof Error ? err.message : err)
    }

    // Best sender = the top-ranked sender this rep can actually use (or the
    // explicitly requested one). Falls back to the first LinkedIn profile
    // only when routing was unavailable.
    const accessibleRanked = (senderRouting?.rankings ?? []).filter((r) => r.accessibleToRep && profileById.has(r.senderId))
    const explicitProfile = explicitProfileId ? channelAuthorizedProfiles.find((p) => p.id === explicitProfileId) ?? null : null
    const bestSender: Profile | null = explicitProfile
      ?? (accessibleRanked[0] ? profileById.get(accessibleRanked[0].senderId) ?? null : null)
      ?? channelAuthorizedProfiles[0]
      ?? null
    const bestSenderProof: MatchedProof[] = bestSender
      ? matchProofToLead(buildProfileIntelligence(bestSender, []), tagsForMatching, 3)
      : []

    // Routing mismatch: a sender the rep does not hold ranks clearly above
    // the rep's best → surface as a suggestion with who holds it. Same
    // threshold as the lead page and the admin panel.
    let senderSuggestion: SenderSuggestion | null = null
    if (senderRouting) {
      const current = bestSender ? senderRouting.rankings.find((r) => r.senderId === bestSender.id) ?? null : null
      const top = senderRouting.rankings.find((r) => !r.accessibleToRep) ?? null
      const currentMatch = current?.profileMatch ?? 0
      if (top && top.profileMatch - currentMatch >= ROUTING_MISMATCH_DELTA) {
        senderSuggestion = {
          profileId: top.senderId,
          name: top.name,
          role: top.role,
          platform: top.platform,
          score: top.profileMatch,
          currentBestScore: currentMatch,
          matchedTerms: top.reasons,
          topProof: top.primaryProof,
          holders: top.holders,
          reason: `${top.name ?? 'Another profile'} matches this lead at ${top.profileMatch}% vs your best ${currentMatch}% (${top.reasons[0] ?? 'stronger proof'}). Ask ${top.holders.length > 0 ? top.holders.join(', ') : 'an admin'} to send it, or ask for access.`,
        }
      }
    }

    // Sender overlay on the recommended action (REFER / ASSIGN / ASK_FOR_HELP).
    const routingOverlay = recommended && senderRouting
      ? deriveRecommendedAction({
          opportunity: {
            score: packet!.score,
            qualification: packet!.qualification,
            buyerIntentLevel: buyerIntent.buyerIntentLevel,
            verifiedBuyerRequest: buyerIntent.verifiedBuyerRequest,
            relationshipRole: buyerIntent.relationshipRole,
            access: packet!.resolved?.access ?? 'CONNECTION',
            buyerTiming: packet!.resolved?.buyerTiming ?? 'NONE',
            activityRecency: packet!.resolved?.activityRecency ?? 'UNKNOWN',
            commercialPotential: packet!.resolved?.commercialPotential ?? 'LOW',
            episodeClosed: false,
          },
          confidence: { label: packet!.confidenceDetail?.label ?? 'LOW', researchMore: packet!.confidenceDetail?.researchMore ?? false },
          sender: {
            currentSenderMatch: bestSender ? senderRouting.rankings.find((r) => r.senderId === bestSender.id)?.profileMatch ?? null : null,
            bestSenderMatch: senderRouting.bestSenderMatch,
            bestSenderId: senderRouting.bestSenderId,
            currentSenderId: bestSender?.id ?? null,
            bestSenderAccessible: senderRouting.rankings[0]?.accessibleToRep ?? false,
          },
          channel: 'linkedin',
        }).routing
      : null

    if (store) {
      try {
        const captured = await store.captureProspect({
          rawInput: rawText,
          extractedName: canonical.intelligence.person.fullName,
          extractedCompany: canonical.intelligence.company.name ?? null,
          extractedTitle: canonical.intelligence.person.title,
          extractedLocation: canonical.intelligence.person.location,
          linkedinUrl: canonical.intelligence.person.linkedinUrl ?? canonical.rawSource.sourceUrl ?? null,
          companyUrl: canonical.rawSource.companyUrl ?? null,
          canonicalScore: canonical.canonicalScore,
          canonicalIntelligence: canonical as unknown as Record<string, unknown>,
          scoreBreakdown: canonical.scoreBreakdown as unknown as Record<string, unknown>,
          revenueIdentityId: requestedWorkspaceId
            ?? (bestSender ? (bestSender as Profile & { revenueIdentityId?: string | null }).revenueIdentityId ?? null : null),
          senderProfileId: bestSender?.id ?? null,
        })
        await store.emitRelayEvent({
          eventType: 'PROSPECT_CAPTURED',
          entityType: 'captured_prospect',
          entityId: captured.id,
          actorType: 'rep',
          actorId: store.getCurrentRepId(),
          revenueIdentityId: captured.revenueIdentityId,
          source: 'app',
          sourceEventId: `prospect_captured:${captured.id}`,
          payload: {
            company: captured.extractedCompany,
            score: captured.canonicalScore,
          },
        })
        // Credit toward the rep's daily "prospects captured" target — only
        // on a genuine new capture, never on a reuse/cache hit for input
        // already analyzed, so re-analyzing the same paste can't be farmed
        if (captured.isNewCapture) {
          await store.recordProspectExtracted(captured.revenueIdentityId)
        }
      } catch {
        // Non-fatal: captured prospect must not block analysis
      }
    }

    if (explicitProfileId && !explicitProfile && profiles.length > 0) {
      emit({ type: 'status', message: 'Requested profile unavailable, using best match.' })
    }

    const connectionStrategy = buildConnectionNoteStrategy(
      extracted,
      bestSender,
      bestSenderProof,
    )

    // Connection note generation only runs when explicitly requested
    // (BUG-06: Analyze = intelligence only; Generate = outreach copy).
    let draftText = ''
    let draftFailed = false
    let qualityResult: ReturnType<typeof validateAndRepair> | null = null

    if (generateNote) {
      emit({ type: 'status', message: 'Drafting the connection note' })

      const safeFact = classifyLeadFact(
        extracted.signalEvidence ?? '',
        extracted.signalEvidence ?? '',
        extracted.signalType ?? null,
      )

      let outreachStrategy: ReturnType<typeof createOutreachStrategy> | null = null
      if (bestSender) {
        outreachStrategy = applyRevenueStrategyToOutreach(
          createOutreachStrategy({
            leadCompany: extracted.company,
            contactName: extracted.name,
            contactTitle: extracted.title,
            signalType: extracted.signalType,
            signalEvidence: extracted.signalEvidence,
            verbatimQuote: extracted.verbatimQuote,
            tags: extracted.tags ?? [],
            safeFacts: [safeFact],
            senderProfile: bestSender,
            matchedProof: bestSenderProof,
            channel: 'connection',
            relationshipStage: 'first_touch',
          }),
          revenue,
        )
      } else if (revenue.messageJob) {
        outreachStrategy = {
          leadContext: `${extracted.company} — ${extracted.title ?? extracted.name}`,
          safeTrigger: extracted.signalEvidence?.slice(0, 120) ?? 'Shared interest area',
          probableNeed: revenue.commercialSituation ?? 'Potential fit',
          sender: 'Our team',
          relevantProof: [],
          messageGoal: 'Earn connection',
          relationshipStage: 'first_touch',
          channel: 'connection',
          tone: 'Warm, specific, low-pressure',
          risk: 'Low',
          ctaStrategy: 'Brief, no-commitment connection',
          mode: 'warm_conversational',
          assessment: revenue.assessment,
          messageJob: revenue.messageJob,
          wordBudget: { min: 14, max: 22, label: 'connection' },
        }
      }

      let conversationContext: string | null = null
      if (connectionStrategy.candidateAngles.length > 0) {
        const angle = connectionStrategy.candidateAngles[0]
        conversationContext = [
          `## Connection Note Strategy`,
          ``,
          `**Goal:** ${angle.label} — ${angle.approach}`,
          `**Tone:** ${connectionStrategy.tone}`,
          connectionStrategy.strongestSafeSignal ? `**Relevant signal:** ${connectionStrategy.strongestSafeSignal}` : null,
          connectionStrategy.forbidden.length > 0 ? `**DO NOT mention:** ${connectionStrategy.forbidden.join('; ')}` : null,
          ``,
          `**Direction:** ${angle.systemDirective}`,
          ``,
          `**Hard rules:**`,
          `- 100 to ${CONNECTION_NOTE_MAX_CHARS} characters. Never exceed ${CONNECTION_NOTE_MAX_CHARS}.`,
          `- Specific observation + genuine overlap + simple reason to connect`,
          `- NO questions. NO "curious about", "how do you", "would love to learn"`,
          `- NO pitch. NO service description. NO "I can help", "we build"`,
          `- NO praise. NO "impressive", "caught my attention"`,
          `- Must sound natural if spoken aloud. Zero effort to respond to.`,
        ].filter(Boolean).join('\n')
      }

      // Few-shot selection
      let fewShotSelection: { examples: Array<{ company: string; signalEvidence: string; sentText: string }> } = { examples: [] }
      try {
        const leadForFewShot = {
          id: 'prospect-ephemeral',
          organizationId: '',
          ownerRepId: null,
          company: extracted.company,
          companyKey: extracted.company.toLowerCase().replace(/[^a-z0-9]/g, ''),
          contactName: extracted.name,
          contactTitle: extracted.title,
          url: extracted.url,
          rawInput: null,
          signalType: extracted.signalType,
          signalEvidence: extracted.signalEvidence,
          verbatimQuote: extracted.verbatimQuote,
          score: getDisplayScore(canonical) ?? 5,
          verdict: canonical.qualification === 'strong' || canonical.qualification === 'worth_pursuing' ? 'send' as const : canonical.qualification === 'maybe' ? 'research_more' as const : 'skip' as const,
          status: 'new' as const,
          playId: null,
          tags: extracted.tags ?? [],
          createdAt: new Date().toISOString(),
        }
        const fewShotResult = selectFewShotExamples(fewShotPool as Parameters<typeof selectFewShotExamples>[0], {
          leadId: 'prospect-ephemeral',
          lead: leadForFewShot,
          extracted,
          score: { total: canonical.canonicalScore, verdict: canonical.qualification === 'strong' || canonical.qualification === 'worth_pursuing' ? 'send' as const : 'research_more' as const, breakdown: canonical.scoreBreakdown.dimensions as unknown as { category: string; label: string; points: number; max: number; note: string }[] },
          type: 'connection' as DraftMessageType,
          styleCard: null,
          facts: [],
          plays: [],
          history: [],
          profile: bestSender,
          matchedProof: null,
        }, [])
        fewShotSelection = {
          examples: fewShotResult.examples.map((e) => ({
            company: e.company,
            signalEvidence: e.signalEvidence ?? '',
            sentText: e.sentText,
          })),
        }
      } catch {
        // Few-shot is optional
      }

      // Proof matching for draft
      let matchedProofItem: import('@/lib/domain/types').ProofItem | null = null
      try {
        if (store) {
          const tagMatches = await store.matchProofItems(tagsForMatching, 5, bestSender?.id ?? null)
          const leadEmbedding = await embedTextSafe(`${extracted.company} ${extracted.signalEvidence} ${tagsForMatching.join(' ')}`)
          let semanticMatches: Array<{ item: Parameters<typeof mergeProofMatches>[1][0]; similarity: number }> = []
          if (leadEmbedding) {
            semanticMatches = await store.matchProofItemsByEmbedding(leadEmbedding, 5, bestSender?.id ?? null) as typeof semanticMatches
          }
          const merged = mergeProofMatches(semanticMatches, tagMatches, 5)
          matchedProofItem = merged[0] ?? null
        }
      } catch {
        // Proof matching optional
      }

      try {
        const draftResult = await streamDraft(
          {
            leadId: 'prospect-ephemeral',
            lead: {
              id: 'prospect-ephemeral',
              organizationId: '',
              ownerRepId: null,
              company: extracted.company,
              companyKey: extracted.company.toLowerCase().replace(/[^a-z0-9]/g, ''),
              contactName: extracted.name,
              contactTitle: extracted.title,
              url: extracted.url,
              rawInput: null,
              signalType: extracted.signalType,
              signalEvidence: extracted.signalEvidence,
              verbatimQuote: extracted.verbatimQuote,
              score: getDisplayScore(canonical) ?? 5,
              verdict: canonical.qualification === 'strong' || canonical.qualification === 'worth_pursuing' ? 'send' as const : 'research_more' as const,
              status: 'new' as const,
              playId: null,
              tags: extracted.tags ?? [],
              createdAt: new Date().toISOString(),
            },
            extracted,
            score: { total: canonical.canonicalScore, verdict: canonical.qualification === 'strong' || canonical.qualification === 'worth_pursuing' ? 'send' as const : 'research_more' as const, breakdown: canonical.scoreBreakdown.dimensions as unknown as { category: string; label: string; points: number; max: number; note: string }[] },
            canonicalScore: canonical.canonicalScore,
            type: 'connection' as DraftMessageType,
            styleCard: null,
            facts: [],
            plays: [],
            history: [],
            profile: bestSender,
            matchedProof: matchedProofItem,
            fewShotExamples: fewShotSelection.examples,
            strategy: outreachStrategy,
            safeFacts: [classifyLeadFact(extracted.signalEvidence ?? '', extracted.signalEvidence ?? '', extracted.signalType ?? null)],
            matchedProofCards: bestSenderProof,
            conversationContext: conversationContext ?? undefined,
          },
          emit,
          matchedProofItem,
          bestSender,
        )
        draftText = draftResult.draftText
      } catch {
        draftFailed = true
      }

      // Quality gate for connection notes — never invent a fallback pitch
      qualityResult = draftText
        ? validateAndRepair({
            text: draftText,
            profile: bestSender,
            prospectName: extracted.name,
            prospectCompany: extracted.company,
            matchedProof: bestSenderProof,
          })
        : {
            text: '',
            charCount: 0,
            maxChars: CONNECTION_NOTE_MAX_CHARS,
            withinLimit: true,
            passed: false,
            failures: ['empty_draft'],
            repaired: null,
          }

      if (qualityResult.text) {
        qualityResult = {
          ...qualityResult,
          text: normalizeGreeting(qualityResult.text, extracted.name),
          charCount: normalizeGreeting(qualityResult.text, extracted.name).length,
        }
      }

      // Post-generation consistency check: a candidate note that fails the
      // quality gate after repair is withheld rather than shown as final.
      // BUT: if we have a repaired version or a fallback, use that instead of
      // returning empty. An empty note with CONNECT_WITH_NOTE is worse than
      // a note that needs light editing.
      if (!qualityResult.passed) {
        const repairedText = qualityResult.repaired?.trim()
        if (repairedText && repairedText.length >= 10) {
          qualityResult = {
            ...qualityResult,
            text: repairedText,
            charCount: repairedText.length,
            passed: true,
            failures: qualityResult.failures.filter((f) => !f.includes('withheld')),
          }
        } else {
          const withheldReason = qualityResult.text.trim().length === 0
            ? 'No safe connection note could be generated for this prospect.'
            : `Generated note failed quality checks (${qualityResult.failures.join('; ') || 'unspecified'}) and was withheld.`
          qualityResult = {
            ...qualityResult,
            text: '',
            charCount: 0,
            withinLimit: true,
            failures: [...new Set([...qualityResult.failures, withheldReason])],
          }
        }
      }
    } else {
      emit({ type: 'status', message: 'Analysis complete' })
      qualityResult = {
        text: '',
        charCount: 0,
        maxChars: CONNECTION_NOTE_MAX_CHARS,
        withinLimit: true,
        passed: true,
        failures: [],
        repaired: null,
      }
    }

    const finalResult = {
      extracted,
      canonical,
      revenue: loop,
      score: {
        total: canonical.canonicalScore,
        displayScore: getDisplayScore(canonical),
        label: canonical.scoreBreakdown.label,
        qualification: canonical.qualification,
        reasons: canonical.scoreBreakdown.reasons,
        watchOut: canonical.scoreBreakdown.watchOut,
        dimensions: normalizeScoreDimensions(canonical.scoreBreakdown.dimensions),
        missingInfo: canonical.scoreBreakdown.missingInfo,
        ...scoreTrace(canonical),
      },
      buyerIntent,
      orgContext,
      remoteEligibility: canonical.remoteEligibility,
      evidenceLedger: canonical.evidenceLedger,
      sources: {
        rawSource: canonical.rawSource,
        urls: canonical.extractionCompleteness.urlsPreserved,
        sourceUrlsFound: canonical.extractionCompleteness.sourceUrlsFound,
      },
      extractionCompleteness: canonical.extractionCompleteness,
      bestSender,
      bestSenderProof,
      connectionNote: qualityResult.text,
      charCount: qualityResult.charCount,
      maxChars: CONNECTION_NOTE_MAX_CHARS,
      quality: {
        passed: qualityResult.passed,
        failures: qualityResult.failures,
        wasRepaired: qualityResult.repaired !== null,
      },
      strategy: {
        whyConnect: connectionStrategy.whyConnect,
        relevantObservation: connectionStrategy.relevantObservation,
        forbidden: connectionStrategy.forbidden,
        candidateAngles: connectionStrategy.candidateAngles.map((a) => a.label),
      },
      draftFailed,
      demoMode: !hasProvider(),
      senderSuggestion,
      alternativeSenders: accessibleRanked
        .filter((r) => r.senderId !== bestSender?.id)
        .slice(0, 3)
        .map((r) => ({
          profile: profileById.get(r.senderId)!,
          matchScore: r.profileMatch,
          topProof: r.primaryProof,
        })),
      senderRouting,
      routingRecommendation: routingOverlay,
      recommendedAction: recommended,
      versions: packet?.versions ?? null,
      resolved: packet?.resolved ?? null,
      confidenceDetail: packet?.confidenceDetail ?? null,
      rejectedSignals: packet?.sourceFacts?.rejectedSignals ?? [],
      decisionRunId: packet?.decisionRunId ?? null,
      qualification: evaluateProspectQualification({ rawText, extracted, canonicalQualification: canonical.qualification }),
      gateNotes: canonicalResult.gateNotes,
      repairAttempted: canonicalResult.repairAttempted,
      repairImproved: canonicalResult.repairImproved,
      reused: canonicalResult.reused,
    }

    // Cache & emit
    analyzeCache.set(ck, { data: finalResult as unknown as Record<string, unknown>, ts: Date.now() })
    emit({ type: 'done', ...finalResult })
  })
}

/** The score calculation trace and decision guards, when the canonical result carries them. */
function scoreTrace(canonical: CanonicalProspectIntelligence): { calculation: unknown; decisionAdjustments: string[] } {
  const breakdown = canonical.scoreBreakdown as unknown as { calculation?: unknown; decisionAdjustments?: unknown }
  return {
    calculation: breakdown.calculation ?? null,
    decisionAdjustments: Array.isArray(breakdown.decisionAdjustments) ? breakdown.decisionAdjustments.map(String) : [],
  }
}

/**
 * Copy for input that cannot be scored. Only the login/product-UI case
 * mentions login UI; everything else names what is actually missing.
 */
function describeUnscorableInput(qualification: ReturnType<typeof evaluateProspectQualification>): {
  inputStatus: 'not_prospect' | 'insufficient'
  headline: string
  status: string
  noMessageReason: string
  nextAction: string
} {
  const classification = qualification.inputClassification
  const isIrrelevant = classification.classification === 'IRRELEVANT'
  const looksLikeUi = isIrrelevant && classification.reasons.some((r) => /login|authentication|ui\/navigation/i.test(r))
  if (looksLikeUi) {
    return {
      inputStatus: 'not_prospect',
      headline: 'Not a prospect',
      status: 'Couldn\'t identify a prospect — this looks like a login or product page, not a person, company, job, or opportunity.',
      noMessageReason: 'The paste is a login or product screen, not information about a person or company.',
      nextAction: 'Paste a LinkedIn profile, company page, job post, or conversation.',
    }
  }
  if (isIrrelevant) {
    return {
      inputStatus: 'not_prospect',
      headline: 'Not a prospect',
      status: 'Couldn\'t identify a prospect — no person, employer, or commercial opportunity in the paste.',
      noMessageReason: 'No identifiable person, employer, or commercial opportunity in the pasted text.',
      nextAction: 'Add identifying and opportunity details to continue.',
    }
  }
  return {
    inputStatus: 'insufficient',
    headline: 'Insufficient profile information',
    status: 'Not enough context for a reliable qualification score.',
    noMessageReason: 'Not enough verified information about the person, employer, or opportunity.',
    nextAction: 'Add identifying and opportunity details to continue.',
  }
}

function emitInsufficientDone(
  emit: (event: object) => void,
  extracted: ExtractedLead,
  qualification: ReturnType<typeof evaluateProspectQualification>,
): void {
  const copy = describeUnscorableInput(qualification)
  const isNotProspect = copy.inputStatus === 'not_prospect'
  emit({
    type: 'done',
    extracted,
    canonical: null,
    revenue: {
      who: extracted.name ?? extracted.company,
      fit: 'LOW',
      intent: 'UNKNOWN',
      confidence: 'LOW',
      why: isNotProspect ? 'This is not a prospect. No message.' : 'Not enough evidence to decide.',
      act: isNotProspect ? 'SKIP' : 'RESEARCH_MORE',
      reason: 'NO_CREDIBLE_REASON',
      nextAction: copy.nextAction,
      messageRecommended: false,
      noMessageReason: copy.noMessageReason,
      messageJob: null,
    },
    // No valid prospect means no score — never a numeric 0 that reads as
    // "a prospect that scored zero".
    score: null,
    scoreNA: true,
    inputStatus: copy.inputStatus,
    inputHeadline: copy.headline,
    scoreReason: copy.noMessageReason,
    remoteEligibility: null,
    evidenceLedger: [],
    sources: null,
    extractionCompleteness: null,
    bestSender: null,
    bestSenderProof: [],
    connectionNote: '',
    charCount: 0,
    maxChars: CONNECTION_NOTE_MAX_CHARS,
    quality: {
      passed: false,
      failures: ['qualification_blocked'],
      wasRepaired: false,
    },
    strategy: {
      whyConnect: '',
      relevantObservation: '',
      forbidden: [],
      candidateAngles: [],
    },
    draftFailed: false,
    demoMode: !hasProvider(),
    alternativeSenders: [],
    qualification,
    gateNotes: [],
    repairAttempted: false,
    repairImproved: false,
  })
}

async function embedTextSafe(text: string): Promise<number[] | null> {
  try {
    const { embedText } = await import('@/lib/ai/embed')
    return await embedText(text)
  } catch {
    return null
  }
}

/**
 * Reword the always-present "No Revenue Identity identified for this
 * opportunity." watchOut for surfaces where no outreach message is planned
 * (see Bug 4). That phrasing carries urgency appropriate to a pitching
 * action; when the recommended action is CONNECT_WITHOUT_NOTE/OBSERVE/SKIP,
 * it reads as an unaddressed problem on a profile where nothing was ever
 * going to be pitched. Only touches this specific string — every other
 * watchOut passes through unchanged.
 */
function rewordWatchOutForNoOutreach(watchOut: string[]): string[] {
  return watchOut.map((w) =>
    /no revenue identity identified for this opportunity/i.test(w)
      ? 'Revenue Identity not required — no outreach message planned.'
      : w,
  )
}
