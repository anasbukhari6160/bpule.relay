import { NextResponse } from 'next/server'
import { safeErrorResponse } from '@/lib/errors'
import { createScoutStore } from '@/lib/store'
import { computeScore } from '@/lib/score/rubric'
import type { SignalId, ExtractedLead, RoleCategory, MarketRegion } from '@/lib/domain/types'
import { classifyRoleFromTitle, mapLocationToRegion } from '@/lib/leads/targeting'
import { normalizeProspectPaste } from '@/lib/prospect/paste-normalize'
import { evaluateProspectQualification } from '@/lib/prospect/qualification-gate'
import { buildV3ReuseKey } from '@/lib/intelligence-v3/decision-reuse'
import { recomputePacketFromStored, v3PacketToCanonical, buildMinimalV2Canonical } from '@/lib/intelligence-v3/bridge'
import { isPacketCurrent } from '@/lib/intelligence-v3/versions'
import { qualifyCanonicalScore, toStoredQualification, verdictForQualification } from '@/lib/scoring/qualification'
import { resolveAccessibleIdentity } from '@/lib/workspace/resolve-active-identity'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'

/**
 * Save Prospect as Lead
 *
 * Converts an ephemeral prospect check into a persisted lead.
 * Reuses already-extracted data — no re-extraction.
 *
 * Expected body: the extracted prospect data + prospect score + connection note + sender.
 */

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const company = typeof body.company === 'string' ? body.company.trim() : ''
    if (!company) {
      return NextResponse.json({ error: 'Company is required.' }, { status: 400 })
    }

    const signalTypeRaw = Number(body.signalType)
    if (!Number.isInteger(signalTypeRaw) || signalTypeRaw < 1 || signalTypeRaw > 7) {
      return NextResponse.json({ error: 'signalType is required and must be 1 to 7.' }, { status: 400 })
    }
    const signalType = signalTypeRaw as SignalId

    const signalEvidence = typeof body.signalEvidence === 'string' ? body.signalEvidence.trim() : ''
    if (!signalEvidence) {
      return NextResponse.json({ error: 'Signal evidence is required.' }, { status: 400 })
    }

    const allowPotentialDuplicate = body.allowPotentialDuplicate === true

    const linkedinUrl = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : null
    const senderProfileId = typeof body.senderProfileId === 'string' ? body.senderProfileId : null
    let revenueIdentityId: string | null = null
    if (typeof body.revenueIdentityId === 'string') {
      try {
        const workspace = await resolveAccessibleIdentity(body.revenueIdentityId)
        revenueIdentityId = workspace?.id ?? null
      } catch {
        revenueIdentityId = null
      }
    }
    const connectionNote = typeof body.connectionNote === 'string' ? body.connectionNote.trim() : null
    const prospectScore = typeof body.prospectScore === 'number' ? body.prospectScore : null
    const prospectDimensions = body.prospectDimensions && Array.isArray(body.prospectDimensions)
      ? body.prospectDimensions
      : null

    const extracted: ExtractedLead = {
      name: typeof body.contactName === 'string' && body.contactName.trim() ? body.contactName.trim() : null,
      title: typeof body.contactTitle === 'string' && body.contactTitle.trim() ? body.contactTitle.trim() : null,
      titleRaw: typeof body.titleRaw === 'string' && body.titleRaw.trim()
        ? body.titleRaw.trim()
        : typeof body.contactTitle === 'string' && body.contactTitle.trim()
          ? body.contactTitle.trim()
          : null,
      company,
      url: linkedinUrl,
      locationRaw: typeof body.locationRaw === 'string' && body.locationRaw.trim() ? body.locationRaw.trim() : null,
      aboutSummary: typeof body.aboutSummary === 'string' && body.aboutSummary.trim() ? body.aboutSummary.trim() : null,
      experienceSummary: typeof body.experienceSummary === 'string' && body.experienceSummary.trim() ? body.experienceSummary.trim() : null,
      recentPosts: Array.isArray(body.recentPosts)
        ? (body.recentPosts as Array<{ paraphrase?: unknown; verbatimQuote?: unknown }>)
            .filter((p) => typeof p?.paraphrase === 'string')
            .slice(0, 3)
            .map((p) => ({
              paraphrase: String(p.paraphrase),
              verbatimQuote: typeof p.verbatimQuote === 'string' && p.verbatimQuote.trim() ? p.verbatimQuote.trim() : null,
            }))
        : [],
      roleCategory: typeof body.roleCategory === 'string' && body.roleCategory.trim()
        ? (body.roleCategory as RoleCategory)
        : classifyRoleFromTitle(typeof body.contactTitle === 'string' ? body.contactTitle : null),
      marketRegion: typeof body.marketRegion === 'string' && body.marketRegion.trim()
        ? (body.marketRegion as MarketRegion)
        : mapLocationToRegion(typeof body.locationRaw === 'string' ? body.locationRaw : null),
      signalType,
      signalEvidence,
      extractionConfidence: typeof body.extractionConfidence === 'number'
        && Number.isFinite(body.extractionConfidence)
        ? Math.max(0, Math.min(100, Math.round(body.extractionConfidence)))
        : 50,
      confidenceNotes: Array.isArray(body.confidenceNotes)
        ? (body.confidenceNotes as unknown[]).filter((n): n is string => typeof n === 'string' && n.trim().length > 0).slice(0, 8)
        : [],
      verbatimQuote: typeof body.verbatimQuote === 'string' && body.verbatimQuote.trim() ? body.verbatimQuote.trim() : null,
      tags: Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
    }

    // Extracted early (also re-derived below for score/verdict persistence)
    // so the qualification gate can defer to canonical — see the
    // canonicalQualification doc comment on evaluateProspectQualification.
    const canonicalForGate = body.canonical && typeof body.canonical === 'object'
      ? body.canonical as Record<string, unknown>
      : null
    const canonicalQualificationForGate =
      typeof canonicalForGate?.qualification === 'string'
        ? (canonicalForGate.qualification as 'strong' | 'worth_pursuing' | 'maybe' | 'low' | 'skip')
        : null

    // Same normalization as analyze, so eligibility and the reuse key agree
    // with what was scored. The stored rawInput stays the original paste.
    const normalizedRawInput = typeof body.rawInput === 'string' ? normalizeProspectPaste(body.rawInput) : null

    const qualification = evaluateProspectQualification({
      extracted,
      rawText: normalizedRawInput,
      canonicalQualification: canonicalQualificationForGate,
    })
    if (!qualification.qualificationEligibility) {
      return NextResponse.json(
        {
          error: 'NOT ENOUGH INFORMATION. Relay needs richer person, company, and opportunity context before creating a lead.',
          qualification,
        },
        { status: 422 },
      )
    }

    let store
    try {
      store = await createScoutStore()
    } catch {
      return NextResponse.json(
        { error: 'Not signed in.' },
        { status: 401 },
      )
    }

    const rulebook = await store.getRulebook()
    if (!rulebook) {
      return NextResponse.json({ error: 'Organization rulebook not found.' }, { status: 500 })
    }

    // The client sends the canonical result it was shown. It is NOT trusted:
    // when the original research is present, the stored model decision is
    // replayed through the current deterministic layers on the server (no
    // model call), and THAT packet is what gets persisted. A client cannot
    // raise its own score, and an analysis from an older scoring version is
    // brought up to date before it is saved.
    let canonical: Record<string, unknown> | null = canonicalForGate
    let serverRecomputed = false
    const clientPacket = (canonical?.v3DecisionPacket ?? null) as V3LeadDecisionPacket | null
    if (clientPacket && normalizedRawInput && normalizedRawInput.length >= 40) {
      try {
        const replayed = await recomputePacketFromStored(normalizedRawInput, clientPacket)
        const base = (canonical as unknown as CanonicalProspectIntelligence | null) ?? buildMinimalV2Canonical(normalizedRawInput)
        canonical = v3PacketToCanonical(replayed, base) as unknown as Record<string, unknown>
        serverRecomputed = true
      } catch (err) {
        console.warn('[prospect/save] server recompute failed, persisting client canonical:', err instanceof Error ? err.message : err)
      }
    } else if (clientPacket && !isPacketCurrent(clientPacket.versions)) {
      console.warn('[prospect/save] client packet is from an older scoring version and no research was sent; persisting as-is')
    }

    const canonicalScore =
      typeof canonical?.canonicalScore === 'number'
        ? canonical.canonicalScore
        : typeof body.canonicalScore === 'number' ? body.canonicalScore : null
    if (canonical && typeof canonicalScore === 'number') {
      // Stored qualification always follows the stored score.
      canonical.qualification = toStoredQualification(qualifyCanonicalScore(canonicalScore).qualification)
    }

    // Legacy rubric score is kept only for pre-canonical surfaces; the
    // verdict follows the canonical band (one mapping, includes LOW).
    const score = computeScore(extracted, rulebook, { sourceText: normalizedRawInput ?? '', signalOrigin: 'AI_EXTRACTED' })
    const verdict = typeof canonicalScore === 'number'
      ? verdictForQualification(qualifyCanonicalScore(canonicalScore).qualification)
      : score.verdict

    const v3Packet = canonical && typeof canonical === 'object'
      ? (canonical as Record<string, unknown>).v3DecisionPacket as Record<string, unknown> | null
      : null
    const decisionProvider = v3Packet && typeof v3Packet.decisionProvider === 'string' ? v3Packet.decisionProvider : null
    const decisionModel = v3Packet && typeof v3Packet.decisionModel === 'string' ? v3Packet.decisionModel : null
    const decisionRunId = v3Packet && typeof v3Packet.decisionRunId === 'string' ? v3Packet.decisionRunId : null
    const selectedEpisodeId = v3Packet && typeof v3Packet.selectedEpisodeId === 'string' ? v3Packet.selectedEpisodeId : null

    const result = await store.createLead({
      company,
      contactName: extracted.name,
      contactTitle: extracted.title,
      url: linkedinUrl,
      rawInput: typeof body.rawInput === 'string' && body.rawInput.trim() ? body.rawInput.trim() : null,
      signalType,
      signalEvidence,
      verbatimQuote: extracted.verbatimQuote,
      tags: extracted.tags,
      score: score.total,
      verdict,
      canonicalScore,
      canonicalIntelligence: canonical,
      scoreBreakdown: (canonical?.scoreBreakdown as Record<string, unknown> | undefined) ?? null,
      scoreVersion: canonicalScore ? (typeof canonical?.scoreVersion === 'string' ? canonical.scoreVersion : 'relay_decision_v3.0.0') : null,
      scoredAt: canonicalScore ? new Date().toISOString() : null,
      titleRaw: extracted.titleRaw ?? extracted.title,
      locationRaw: extracted.locationRaw ?? null,
      roleCategory: extracted.roleCategory ?? classifyRoleFromTitle(extracted.title),
      marketRegion: extracted.marketRegion ?? mapLocationToRegion(extracted.locationRaw ?? null),
      extractionConfidence: extracted.extractionConfidence ?? 50,
      assignedProfileId: senderProfileId,
      senderProfileId,
      revenueIdentityId,
      allowPotentialDuplicate,
      extractionProfile: {
        aboutSummary: extracted.aboutSummary ?? null,
        experienceSummary: extracted.experienceSummary ?? null,
        recentPosts: extracted.recentPosts ?? [],
        confidenceNotes: extracted.confidenceNotes ?? [],
        prospectScore,
        prospectDimensions,
        connectionNote,
        source: 'prospect_check',
      },
      // Observability
      decisionProvider,
      decisionModel,
      decisionRunId,
      selectedEpisodeId,
      // Sender-independent reuse key: the same research under the same
      // versions is the same opportunity decision, whoever sends.
      v3ReuseKey: normalizedRawInput ? buildV3ReuseKey({ rawText: normalizedRawInput }) : null,
    })

    if (result.blocked) {
      const duplicateKind = result.duplicateKind ?? 'hard'
      const existingLead = result.lead
      if (existingLead) {
        return NextResponse.json(
          {
            blocked: true,
            duplicate: true,
            duplicateKind,
            reason: result.reason,
            existingOwnerName: result.existingOwnerName,
            existingLeadId: existingLead.id,
            existingLeadCompany: existingLead.company,
            canCreateSeparate: duplicateKind === 'potential',
          },
          { status: 409 },
        )
      }
      return NextResponse.json(
        {
          blocked: true,
          duplicate: true,
          duplicateKind,
          reason: result.reason,
          existingOwnerName: result.existingOwnerName,
          canCreateSeparate: duplicateKind === 'potential',
        },
        { status: 409 },
      )
    }

    const lead = result.lead!

    // BUG-22: Do NOT save the generated note as a draft message. The note is
    // already persisted in extractionProfile.connectionNote. Saving it as a
    // draft would make it appear in the timeline, and "Send Without Note"
    // would then incorrectly show as logging the generated note. The user
    // can always regenerate the note from the lead page.

    return NextResponse.json(
      {
        lead: {
          ...lead,
          score: lead.score ?? score.total,
          verdict: lead.verdict ?? verdict,
        },
        score,
        leadId: lead.id,
        serverRecomputed,
        canonicalScore,
      },
      { status: 201 },
    )
  } catch (error) {
    return safeErrorResponse(
      error,
      500,
      'Lead was not created. Please try again.',
      '/api/prospect/save',
    )
  }
}
