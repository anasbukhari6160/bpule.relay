import { hasProvider } from '@/lib/ai/config'
import { scanForSecrets } from '@/lib/ai/secrets'
import { deduplicated } from '@/lib/ai/dedup'
import { createScoutStore } from '@/lib/store'
import { sseStream } from '@/lib/sse/sse'
import { buildProfileIntelligence, matchProofToLead } from '@/lib/relay/profile-intelligence'
import { loadSenderCandidates, pickSuggestion, type SenderSuggestion } from '@/lib/relay/sender-suggestion'
import { getAuthContext } from '@/lib/auth/organization'
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
import { classifyRoleFromTitle } from '@/lib/leads/targeting-pure'
import { isLinkedInChromeText } from '@/lib/intelligence-v2/role-signals'
import type { ExtractedLead, Profile, MatchedProof } from '@/lib/domain/types'
import { produceCanonicalIntelligence, getDisplayScore, deriveSignalEvidenceFallback, isClientCanonicalStillValid } from '@/lib/intelligence-v2/orchestrator'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { V3_CANONICAL } from '@/lib/intelligence-v3/config'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import { resolveTimezoneFromLocation } from '@/lib/timezone/resolve'
import {
  applyRevenueStrategyToOutreach,
  buildRevenueStrategy,
  mapSignalsToLegacyType,
  shouldWriteMessage,
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
 * Map V3 action to revenue-strategy MessagingPolicy.
 * V3 actions are richer than V2 verdicts — collapse to policy for gating.
 */
function mapV3ActionToMessagingPolicy(v3Action: string): MessagingPolicy {
  switch (v3Action) {
    case 'CONTACT_NOW': return 'CONNECT_WITH_NOTE'
    case 'CONNECT_WITH_NOTE': return 'CONNECT_WITH_NOTE'
    case 'CONNECT_WITHOUT_NOTE': return 'CONNECT_WITHOUT_NOTE'
    case 'OBSERVE': return 'OBSERVE'
    case 'WAIT': return 'RESEARCH_MORE'
    case 'HUMAN_REVIEW': return 'SKIP'
    case 'SKIP': return 'SKIP'
    default: return 'SKIP'
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
  return `${rawText.slice(0, 200).toLowerCase().replace(/\s+/g, ' ').trim()}:${rawText.length}:${profileId ?? ''}:${generateNote ? 'note' : 'analyze'}`
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
  }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rawText = body.rawText?.trim()
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
      const isIrrelevant = precheck.inputClassification.classification === 'IRRELEVANT'
      emit({
        type: 'status',
        message: isIrrelevant
          ? 'Couldn\'t identify a prospect — this looks like a login/product page rather than a person, company, job, or business opportunity.'
          : 'Not enough context for a reliable qualification score.',
      })
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

    const v3Action = v3Packet ? (v3Packet as { action: string }).action : null
    const v3MessageEligible = v3Packet ? (v3Packet as { messageEligible: boolean }).messageEligible : null

    if (V3_CANONICAL && v3Packet) {
      // V3 is the single source of truth for MOST display fields, but the
      // revenue strategy's messageRecommended can override for connection
      // notes to founders/builders (high commercial potential, no explicit
      // buyer request). The revenue strategy has channel context that V3 lacks.
      const v3Fit = (v3Packet as { decision?: { fit?: string } })?.decision?.fit || 'MEDIUM'
      const v3Intent = (v3Packet as { decision?: { buyerRequestProbability?: number } })?.decision?.buyerRequestProbability || 0
      const v3Confidence = (v3Packet as { confidence?: number })?.confidence || 0.5
      const isConnectionNote = revenue.messagingPolicy === 'CONNECT_WITH_NOTE'
        || (revenue.contact.action === 'CONNECT_OR_OBSERVE' && revenue.contact.messageRecommended)

      ;(loop as { fit: string }).fit = v3Fit
      ;(loop as { intent: string }).intent = v3Intent > 0.4 ? 'HIGH' : v3Intent > 0.2 ? 'MEDIUM' : 'UNKNOWN'
      ;(loop as { confidence: string }).confidence = v3Confidence > 0.6 ? 'HIGH' : v3Confidence > 0.3 ? 'MEDIUM' : 'LOW'

      // V3 lacks channel context, so its OBSERVE action shouldn't block
      // relationship-building connection notes.
      if (isConnectionNote && revenue.contact.messageRecommended && v3MessageEligible === false) {
        ;(loop as { act: string }).act = 'CONNECT_OR_OBSERVE'
        ;(loop as { messageRecommended: boolean }).messageRecommended = true
        ;(loop as { messagingPolicy: string }).messagingPolicy = 'CONNECT_WITH_NOTE'
      } else {
        ;(loop as { act: string }).act = v3Action!
        ;(loop as { messageRecommended: boolean }).messageRecommended = v3MessageEligible!
        ;(loop as { messagingPolicy: string }).messagingPolicy = mapV3ActionToMessagingPolicy(v3Action!)
      }

      // V3 overrides messageRecommended but NOT messageJob — sync them so the
      // draft route does not throw STRATEGY_REQUIRED when V3 says "eligible".
      if (v3MessageEligible === true) {
        const v3Channel = 'connection'
        const v3HasHiring = (v3Packet as { reasons?: string[] })?.reasons?.some((r: string) => /hiring|urgently/i.test(r)) ?? false
        if (v3HasHiring) {
          ;(loop as { messageJob: string }).messageJob = 'TEST_DELIVERY_MODEL'
        } else {
          ;(loop as { messageJob: string }).messageJob = 'EARN_CONNECTION'
        }
        revenue.messageJob = loop.messageJob as typeof revenue.messageJob
      }

      // Override V2 text with V3 reasoning
      const v3Reasons = (v3Packet as { reasons?: string[] })?.reasons || []
      const v3WatchOut = (v3Packet as { watchOut?: string[] })?.watchOut || []
      const v3Latent = (v3Packet as { latentPotential?: string | null })?.latentPotential
      const v3LatentSignals = (v3Packet as { latentSignals?: string[] })?.latentSignals || []

      if (v3Latent) {
        ;(loop as { why: string }).why = `Current intent: UNKNOWN. Latent commercial potential: ${v3Latent}. ${v3LatentSignals.join(', ')}`
        ;(loop as { nextAction: string }).nextAction = `${v3Latent} latent potential detected. ${v3Action === 'CONNECT_WITHOUT_NOTE' ? 'Send a connection request — no pitch.' : v3Action === 'OBSERVE' ? 'Add to observation list.' : 'No outreach recommended.'}`
      } else if (v3Reasons.length > 0) {
        ;(loop as { why: string }).why = v3Reasons.join('. ')
      }

      if (v3WatchOut.length > 0) {
        ;(loop as { reason: string }).reason = v3WatchOut.join('. ')
      }

      if (v3MessageEligible === true) {
        revenue.contact.messageRecommended = true
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
          dimensions: canonical.scoreBreakdown.dimensions,
          missingInfo: canonical.scoreBreakdown.missingInfo,
        },
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
        // V3 telemetry
        decisionVersion: V3_CANONICAL ? 'decision_v3' : 'relay_qualification_v2',
        scoreVersion: V3_CANONICAL ? 'score_v3' : (canonical as CanonicalProspectIntelligence).scoreVersion,
        decisionProvider: V3_CANONICAL ? (v3Packet as { decisionProvider?: string })?.decisionProvider ?? 'openai' : undefined,
        decisionModel: V3_CANONICAL ? (v3Packet as { decisionModel?: string })?.decisionModel : undefined,
        selectedEpisodeId: V3_CANONICAL ? (v3Packet as { selectedEpisodeId?: string | null })?.selectedEpisodeId : undefined,
        v3Action: V3_CANONICAL ? (v3Packet as { action: string }).action : undefined,
        messageEligible: V3_CANONICAL ? (v3Packet as { messageEligible: boolean }).messageEligible : undefined,
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

    // Score each assigned profile and pick the best match
    const tagsForMatching = [
      ...canonical.intelligence.content.topics,
      ...canonical.intelligence.content.technicalSignals,
      ...(canonical.intelligence.company.industry ? [canonical.intelligence.company.industry] : []),
    ]

    // Channel authorization (Bug 5a): the recommended channel here is a
    // LinkedIn connection note. A Revenue Identity whose platform is
    // 'upwork' is not authorized to send a LinkedIn connection request no
    // matter how strong its technical-skill/proof match score is — sender
    // selection must never pick a channel-incompatible identity just
    // because it scores well on content relevance. Filter to
    // channel-authorized profiles BEFORE ranking by proof-match score.
    const RECOMMENDED_CHANNEL_PLATFORM: Profile['platform'] = 'linkedin'
    const channelAuthorizedProfiles = profiles.filter((p) => p.platform === RECOMMENDED_CHANNEL_PLATFORM)

    const profileMatches: Array<{ profile: Profile; matchedProof: MatchedProof[]; totalScore: number }> = []
    for (const profile of channelAuthorizedProfiles) {
      const intelligence = buildProfileIntelligence(profile, [])
      const matched = matchProofToLead(intelligence, tagsForMatching, 3)
      const totalScore = matched.reduce((s, m) => s + m.relevanceScore, 0)
      profileMatches.push({ profile, matchedProof: matched, totalScore })
    }
    profileMatches.sort((a, b) => b.totalScore - a.totalScore)

    const explicitMatch = explicitProfileId
      ? profileMatches.find((pm) => pm.profile.id === explicitProfileId) ?? null
      : null
    const bestMatch = explicitMatch ?? profileMatches[0] ?? null
    const bestSender = bestMatch?.profile ?? null
    const bestSenderProof = bestMatch?.matchedProof ?? []

    // V3 Profile Match: evaluate opportunity quality independent of assigned profile
    let v3ProfileMatch: {
      currentProfileId: string | null
      currentScore: number
      bestProfileId: string | null
      bestScore: number
      bestProfileName: string | null
      improvement: number
      matches: Array<{ profileId: string; identityName: string; score: number; reason: string }>
    } | null = null

    if (V3_CANONICAL && v3Packet && profiles.length > 0) {
      const v3Episodes = (v3Packet as { episodes?: Array<Record<string, unknown>> }).episodes || []
      const allCaps = new Set<string>()
      for (const ep of v3Episodes) {
        const caps = ep.requestedCapabilities as string[] || []
        caps.forEach(c => allCaps.add(c))
      }

      if (allCaps.size > 0) {
        const { rankProfilesForOpportunity } = await import('@/lib/profile-match')
        const ranked = rankProfilesForOpportunity(
          { opportunityCapabilities: [...allCaps], opportunityIndustries: [], opportunityType: 'lead' },
          profiles.map(p => ({
            profileId: p.id,
            identityName: p.displayName || p.fullName || p.label || 'Unknown',
            skills: [...(p.primarySkills || []), ...(p.secondarySkills || [])],
            technologies: p.technologies || [],
            expertise: p.serviceCapabilities || [],
            industries: p.industries || [],
            allowedClaims: p.differentiators || [],
          })),
        )

        const currentProfile = ranked.find(r => r.profileId === bestSender?.id) || null
        const bestProfile = ranked[0] || null

        v3ProfileMatch = {
          currentProfileId: bestSender?.id || null,
          currentScore: currentProfile?.matchScore || 0,
          bestProfileId: bestProfile?.profileId || null,
          bestScore: bestProfile?.matchScore || 0,
          bestProfileName: bestProfile?.identityName || null,
          improvement: bestProfile && currentProfile ? bestProfile.matchScore - currentProfile.matchScore : 0,
          matches: ranked.slice(0, 5).map(r => ({
            profileId: r.profileId,
            identityName: r.identityName,
            score: r.matchScore,
            reason: r.reason,
          })),
        }
      }
    }

    // Org-wide: is there a profile this rep doesn't hold with clearly stronger
    // proof for this lead? Read-only suggestion; never blocks analysis.
    let senderSuggestion: SenderSuggestion | null = null
    try {
      const auth = await getAuthContext()
      if (auth) {
        const candidates = await loadSenderCandidates(createServiceSupabase(), auth.orgId, auth.repId)
        senderSuggestion = pickSuggestion(candidates, [
          ...tagsForMatching,
          ...(extracted.title ? [extracted.title] : []),
        ], { platform: RECOMMENDED_CHANNEL_PLATFORM, currentProfileId: bestSender?.id ?? null })
      }
    } catch (err) {
      console.warn('[prospect/analyze] sender suggestion skipped:', err instanceof Error ? err.message : err)
    }

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
          revenueIdentityId: bestSender ? (bestSender as Profile & { revenueIdentityId?: string | null }).revenueIdentityId ?? null : null,
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

    if (explicitProfileId && !explicitMatch && profiles.length > 0) {
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
          wordBudget: { min: 15, max: 35, label: 'connection' },
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
          `- Max ${CONNECTION_NOTE_MAX_CHARS} characters for LinkedIn connection notes`,
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
        dimensions: canonical.scoreBreakdown.dimensions,
        missingInfo: canonical.scoreBreakdown.missingInfo,
      },
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
      alternativeSenders: profileMatches
        .filter((pm) => pm.profile.id !== bestSender?.id)
        .slice(0, 3)
        .map((pm) => ({
          profile: pm.profile,
          matchScore: pm.totalScore,
          topProof: pm.matchedProof[0]?.safeClaim ?? null,
        })),
      v3ProfileMatch: V3_CANONICAL ? v3ProfileMatch : undefined,
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

function emitInsufficientDone(
  emit: (event: object) => void,
  extracted: ExtractedLead,
  qualification: ReturnType<typeof evaluateProspectQualification>,
): void {
  const isIrrelevant = qualification.inputClassification.classification === 'IRRELEVANT'
  emit({
    type: 'done',
    extracted,
    canonical: null,
    revenue: {
      who: extracted.name ?? extracted.company,
      fit: 'LOW',
      intent: 'UNKNOWN',
      confidence: 'LOW',
      why: isIrrelevant
        ? 'This is not a prospect. No message.'
        : 'Not enough evidence to decide.',
      act: isIrrelevant ? 'SKIP' : 'RESEARCH_MORE',
      reason: 'NO_CREDIBLE_REASON',
      nextAction: isIrrelevant ? 'Skip — paste a real profile' : 'Add more context',
      messageRecommended: false,
      noMessageReason: isIrrelevant
        ? 'Login or product UI is not a reason to contact anyone.'
        : 'Insufficient evidence.',
      messageJob: null,
    },
    score: isIrrelevant ? 'N/A' : null,
    scoreNA: isIrrelevant,
    scoreReason: isIrrelevant
      ? 'Couldn\'t identify a prospect. This looks like a login/product page rather than a person, company, job, or business opportunity. Paste a LinkedIn profile, company page, job post, conversation, or other prospect information.'
      : null,
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
