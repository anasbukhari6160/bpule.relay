import { NextRequest, NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { scanForSecrets } from '@/lib/ai/secrets'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { V3_CANONICAL } from '@/lib/intelligence-v3/config'
import { hasProvider } from '@/lib/ai/config'
import { extractTrailingSignature, profileInfoFromSignature } from '@/lib/inbound/signature'
import { loadSenderProfiles, parsePacket, routeLead } from '@/lib/relay/routing-context'
import { qualifyCanonicalScore, displayScoreForCanonical } from '@/lib/scoring/qualification'
import type { InboundInput } from '@/lib/domain/types'

export const maxDuration = 120

/**
 * Inbound analyze — an inbound message is a LIVE conversation, not a cold
 * profile. The canonical opportunity decision still runs on the pasted text,
 * but the recommended action is the live-reply policy, and the best sender
 * comes from the same routing engine every other surface uses.
 *
 * Response keys are camelCase (what the inbound page reads); the previous
 * snake_case keys are kept for any external consumer.
 */
export async function POST(req: NextRequest) {
  const store = await createScoutStore().catch(() => null)
  if (!store) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: InboundInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  body.source = body.source ?? 'other'

  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }

  const secretScan = scanForSecrets(body.message)
  if (secretScan.blocked) {
    return NextResponse.json({ error: 'Message contains sensitive credentials. Remove them before analysis.' }, { status: 400 })
  }

  try {
    const profiles = await store.getAssignedProfiles()
    // A trailing "– Jonas, CTO at Fenwick Pay" is the sender's identity; lift it
    // into a profile-shaped block so the reader finds the name, role and company
    // instead of collapsing the whole message into the title (QA RQA-020).
    const signature = extractTrailingSignature(typeof body.message === 'string' ? body.message : '')
    const signatureContext = signature ? profileInfoFromSignature(signature) : ''
    const rawText = [signatureContext, body.message, body.profileInfo, body.jobInfo, body.context].filter((s): s is string => typeof s === 'string' && s.trim().length > 0).join('\n\n')

    let canonical
    if (V3_CANONICAL) {
      const v3Result = await produceV3Intelligence(rawText, {})
      canonical = v3Result.intelligence
    } else {
      const canonicalResult = await produceCanonicalIntelligence(rawText, { onStatus: () => {} })
      canonical = canonicalResult.intelligence
    }

    const packet = parsePacket(canonical)
    const band = qualifyCanonicalScore(canonical.canonicalScore)
    const buyerIntent = packet?.buyerIntent

    // One sender ranking, same engine as every other surface.
    let bestProfileId: string | null = null
    let profileMatches: Array<{ id: string; label: string; matchScore: number; topProof: string | null; reasons: string[] }> = []
    try {
      const senders = await loadSenderProfiles(store.getSupabaseClient(), profiles[0]?.organizationId ?? '', store.getCurrentRepId())
      const routing = routeLead(
        { company: canonical.intelligence.company.name, contactName: canonical.intelligence.person.fullName, contactTitle: canonical.intelligence.person.title, rawInput: rawText },
        packet,
        senders,
      )
      const accessible = routing.rankings.filter((r) => r.accessibleToRep && profiles.some((p) => p.id === r.senderId))
      bestProfileId = accessible[0]?.senderId ?? profiles[0]?.id ?? null
      profileMatches = profiles.map((p) => {
        const r = routing.rankings.find((x) => x.senderId === p.id)
        return { id: p.id, label: p.label ?? p.headline ?? 'Unknown', matchScore: r?.profileMatch ?? 0, topProof: r?.primaryProof ?? null, reasons: r?.reasons ?? [] }
      })
    } catch (err) {
      console.warn('[inbound/analyze] sender routing skipped:', err instanceof Error ? err.message : err)
      bestProfileId = profiles[0]?.id ?? null
      profileMatches = profiles.map((p) => ({ id: p.id, label: p.label ?? p.headline ?? 'Unknown', matchScore: 0, topProof: null, reasons: [] }))
    }
    const bestProfile = profiles.find((p) => p.id === bestProfileId) ?? null
    const bestMatch = profileMatches.find((m) => m.id === bestProfileId) ?? null

    // An inbound message is a reply we owe: the live policy decides.
    const recommendedAction = band.qualification === 'SKIP' && !buyerIntent?.verifiedBuyerRequest ? 'research_more' : 'reply'
    const opportunityQuality: 'high' | 'medium' | 'low' = band.qualification === 'STRONG' || band.qualification === 'WORTH_PURSUING' ? 'high' : band.qualification === 'MAYBE' ? 'medium' : 'low'

    const intelligence = {
      wants: canonical.intelligence.opportunity.description
        ?? canonical.intelligence.opportunityTrigger
        ?? packet?.sourceFacts?.buyerRequest
        ?? 'Not specified — ask clarifying questions',
      // The label names what the message is, never just "unknown" when the
      // readers found something. A verified request is a buyer; a stated
      // request that the intent model did not verify is still a request to
      // check; a first-person freelancer or job seeker is a seller, not a
      // buyer, however well their skills fit.
      intent: buyerIntent?.buyerIntentLevel === 'HIGH'
        ? 'Explicit buyer request (verified)'
        : buyerIntent?.buyerIntentLevel === 'MEDIUM'
          ? 'Buyer request (verified)'
          : packet?.sourceFacts?.candidateSeeking || packet?.sourceFacts?.sellerActivity
            ? 'Offering services / seeking work — a seller or job seeker, not a buyer'
            : buyerIntent?.verifiedHiringNeed
              ? 'Hiring employees — not a request for services'
              : packet?.sourceFacts?.buyerRequest
                ? 'Request for services stated — verify budget and who owns the need'
                : canonical.intelligence.opportunityTrigger ?? 'Unknown — needs research',
      fitScore: canonical.canonicalScore,
      displayScore: displayScoreForCanonical(canonical.canonicalScore),
      fitRelevance: band.label,
      opportunityQuality,
      recommendedIdentity: bestProfile,
      identityFitReason: bestMatch
        ? bestMatch.reasons[0] ?? (bestMatch.topProof ? `Best proof match: ${bestMatch.topProof}` : 'Best available sender for this channel')
        : 'No profiles available',
      matchingSkills: [...new Set([...(packet?.sourceFacts?.capabilityNeeds ?? []), ...(canonical.intelligence.content.technicalSignals ?? [])])].slice(0, 6),
      strongestProof: [],
      missingInfo: canonical.scoreBreakdown.missingInfo,
      recommendedAction,
      canGenerateResume: (canonical.intelligence.content.technicalSignals ?? []).length >= 2 || (packet?.sourceFacts?.capabilityNeeds.length ?? 0) >= 2,
      // Legacy snake_case keys.
      fit_score: canonical.canonicalScore,
      fit_relevance: band.label,
      opportunity_quality: opportunityQuality,
      recommended_profile_index: bestProfile ? profiles.indexOf(bestProfile) : 0,
      identity_fit_reason: bestMatch?.reasons[0] ?? 'No profiles available',
      matching_skills: (canonical.intelligence.content.technicalSignals ?? []).slice(0, 5),
      strongest_proof_indexes: [],
      missing_info: canonical.scoreBreakdown.missingInfo,
      recommended_action: recommendedAction,
      can_generate_resume: (canonical.intelligence.content.technicalSignals ?? []).length >= 2,
      extracted_company: canonical.intelligence.company.name,
      extracted_contact: canonical.intelligence.person.fullName,
      extracted_title: canonical.intelligence.person.title,
      extracted_url: canonical.intelligence.person.linkedinUrl ?? canonical.rawSource.sourceUrl,
    }

    return NextResponse.json({
      intelligence,
      extracted: {
        company: canonical.intelligence.company.name,
        contactName: canonical.intelligence.person.fullName,
        contactTitle: canonical.intelligence.person.title,
        url: canonical.intelligence.person.linkedinUrl ?? canonical.rawSource.sourceUrl,
      },
      canonical,
      buyerIntent: buyerIntent ?? null,
      qualification: band.qualification,
      versions: packet?.versions ?? null,
      profiles: profileMatches,
      bestProfileId,
      demoMode: !hasProvider(),
    })
  } catch (err) {
    console.error('[inbound/analyze] failed:', err)
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 })
  }
}
