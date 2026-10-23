import { NextRequest, NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { scanForSecrets } from '@/lib/ai/secrets'
import { isDemoMode } from '@/lib/ai/config'
import { extractTrailingSignature } from '@/lib/inbound/signature'
import { extractIntroduction, sanitizeCompanyName, sanitizeContactName, preferFullName } from '@/lib/intelligence-v2/extraction-pipeline'
import { loadSenderProfiles, parsePacket, routeLead } from '@/lib/relay/routing-context'
import { qualifyCanonicalScore, displayScoreForCanonical } from '@/lib/scoring/qualification'
import { analyzeInboundInput, buildInboundSensitiveText } from '@/lib/inbound/analysis'
import { validateInboundAnalysisBody } from '@/lib/inbound/validation'

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

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const validated = validateInboundAnalysisBody(rawBody)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }
  const body = validated.value

  const secretScan = scanForSecrets(buildInboundSensitiveText(body))
  if (secretScan.blocked) {
    return NextResponse.json({ error: 'Message contains sensitive credentials. Remove them before analysis.' }, { status: 400 })
  }

  try {
    const profiles = await store.getAssignedProfiles()
    const signature = extractTrailingSignature(typeof body.message === 'string' ? body.message : '')
    const analysis = await analyzeInboundInput(body)
    const canonical = analysis.canonical
    const rawText = analysis.rawText

    const packet = parsePacket(canonical)
    const band = qualifyCanonicalScore(canonical.canonicalScore)
    const buyerIntent = analysis.buyerIntent ?? packet?.buyerIntent

    // One sender ranking, same engine as every other surface.
    let bestProfileId: string | null = profiles[0]?.id ?? null
    let profileMatches = profiles.map((p) => ({ id: p.id, label: p.label ?? p.headline ?? 'Unknown', matchScore: 0, topProof: null as string | null, reasons: [] as string[] }))
    if (!isDemoMode()) {
      try {
        const senders = await loadSenderProfiles(store.getSupabaseClient(), store.organizationId, store.getCurrentRepId())
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
      }
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

    // Identity priority: trailing signature > introduction prose > canonical
    // intelligence. The signature is the sender's explicit identity claim.
    // Explicit introduction patterns can identify the sender inside prose.
    // are explicit self-identifications in prose. The canonical intelligence is
    // the pipeline's heuristic scan, which is least reliable for identity.
    //
    // NAME RESOLUTION: prefer the fuller name. If the introduction gives
    // If the introduction has a full name and the signature has only the same
    // first name, the fuller form is more useful.
    const introduction = extractIntroduction(typeof body.message === 'string' ? body.message : '')
    const rawName = signature?.name ?? introduction?.name ?? canonical.intelligence.person.fullName
    const resolvedName = preferFullName(rawName, introduction?.name ?? null)
    const extractedContactName = sanitizeContactName(resolvedName)
    const extractedContactTitle = signature?.title ?? introduction?.role ?? canonical.intelligence.person.title
    // Company: prefer signature, then introduction, then canonical — but ALWAYS
    // sanitize the result. The AI model may return a greeting or person name as
    // the company, so this guard is the final safety net.
    const extractedCompany = sanitizeCompanyName(
      signature?.company ?? introduction?.company ?? canonical.intelligence.company.name,
    )

    return NextResponse.json({
      intelligence,
      extracted: {
        company: extractedCompany,
        contactName: extractedContactName,
        contactTitle: extractedContactTitle,
        url: canonical.intelligence.person.linkedinUrl ?? canonical.rawSource.sourceUrl,
      },
      canonical: analysis.canonicalIntelligence,
      buyerIntent: buyerIntent ?? null,
      qualification: band.qualification,
      scoreVersion: analysis.scoreVersion,
      scoredAt: analysis.scoredAt,
      scoreBreakdown: analysis.scoreBreakdown,
      versions: packet?.versions ?? null,
      profiles: profileMatches,
      bestProfileId,
      demoMode: isDemoMode(),
    })
  } catch (err) {
    console.error('[inbound/analyze] failed:', err)
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 })
  }
}
