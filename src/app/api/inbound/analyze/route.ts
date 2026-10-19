import { NextRequest, NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { scanForSecrets } from '@/lib/ai/secrets'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { V3_CANONICAL } from '@/lib/intelligence-v3/config'
import { buildProfileIntelligence, matchProofToLead } from '@/lib/relay/profile-intelligence'
import { hasProvider } from '@/lib/ai/config'
import type { InboundInput } from '@/lib/domain/types'

export const maxDuration = 120

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
    const [profiles, proofItems] = await Promise.all([
      store.getAssignedProfiles(),
      store.listAllProofItems(),
    ])

    let canonical
    if (V3_CANONICAL) {
      const v3Result = await produceV3Intelligence(body.message, {})
      canonical = v3Result.intelligence
    } else {
      const canonicalResult = await produceCanonicalIntelligence(body.message, {
        onStatus: () => {},
      })
      canonical = canonicalResult.intelligence
    }

    const tagsForMatching = [
      ...canonical.intelligence.content.topics,
      ...canonical.intelligence.content.technicalSignals,
      ...(canonical.intelligence.company.industry ? [canonical.intelligence.company.industry] : []),
    ]

    const profileMatches: Array<{ profile: (typeof profiles)[0]; matchedProof: ReturnType<typeof matchProofToLead>; totalScore: number }> = []
    for (const profile of profiles) {
      const intelligence = buildProfileIntelligence(profile, proofItems)
      const matched = matchProofToLead(intelligence, tagsForMatching, 3)
      const totalScore = matched.reduce((s, m) => s + m.relevanceScore, 0)
      profileMatches.push({ profile, matchedProof: matched, totalScore })
    }
    profileMatches.sort((a, b) => b.totalScore - a.totalScore)

    const bestMatch = profileMatches[0] ?? null

    const v3Packet = (canonical as unknown as { v3DecisionPacket?: { decision?: Record<string, unknown>; buyerIntent?: { buyerIntentLevel: string; verifiedExternalNeed: boolean } } }).v3DecisionPacket
    const v3Decision = v3Packet?.decision as Record<string, unknown> | undefined
    // Intent label comes from the canonical buyer decision only.
    const buyerIntent = v3Packet?.buyerIntent

    const intelligence = {
      wants: canonical.intelligence.opportunity.description
        ?? (v3Decision?.commercialReading as Record<string, unknown>)?.probableNeed as string
        ?? canonical.intelligence.opportunityTrigger
        ?? 'Not specified — ask clarifying questions',
      intent: buyerIntent?.buyerIntentLevel === 'HIGH'
        ? 'Explicit buyer request'
        : buyerIntent?.verifiedExternalNeed
          ? 'External need detected'
          : canonical.intelligence.opportunityTrigger ?? 'Unknown — needs research',
      fit_score: canonical.canonicalScore,
      fit_relevance: canonical.qualification,
      opportunity_quality: canonical.canonicalScore >= 70 ? 'high' as const : canonical.canonicalScore >= 50 ? 'medium' as const : 'low' as const,
      recommended_profile_index: bestMatch ? profiles.indexOf(bestMatch.profile) : 0,
      identity_fit_reason: bestMatch
        ? `Best proof match: ${bestMatch.matchedProof[0]?.safeClaim ?? 'General capability'}`
        : 'No profiles available',
      matching_skills: (canonical.intelligence.content.technicalSignals ?? []).slice(0, 5),
      strongest_proof_indexes: bestMatch?.matchedProof.map((_, i) => i) ?? [],
      missing_info: canonical.scoreBreakdown.missingInfo,
      recommended_action: canonical.canonicalScore >= 70 ? 'reply' : canonical.canonicalScore >= 50 ? 'research_more' : 'skip',
      can_generate_resume: canonical.intelligence.content.technicalSignals.length >= 2,
      extracted_company: canonical.intelligence.company.name,
      extracted_contact: canonical.intelligence.person.fullName,
      extracted_title: canonical.intelligence.person.title,
      extracted_url: canonical.intelligence.person.linkedinUrl ?? canonical.rawSource.sourceUrl,
    }

    return NextResponse.json({
      intelligence,
      extracted: {
        company: intelligence.extracted_company,
        contactName: intelligence.extracted_contact,
        contactTitle: intelligence.extracted_title,
        url: intelligence.extracted_url,
      },
      canonical,
      profiles: profiles.map((p) => ({
        id: p.id,
        label: p.label ?? p.headline ?? 'Unknown',
        matchScore: profileMatches.find((pm) => pm.profile.id === p.id)?.totalScore ?? 0,
        topProof: profileMatches.find((pm) => pm.profile.id === p.id)?.matchedProof[0]?.safeClaim ?? null,
      })),
      bestProfileId: bestMatch?.profile.id ?? null,
      demoMode: !hasProvider(),
    })
  } catch (err) {
    console.error('[inbound/analyze] failed:', err)
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 })
  }
}
