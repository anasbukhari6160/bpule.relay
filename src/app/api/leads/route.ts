import { NextResponse } from 'next/server'
import { computeScore } from '@/lib/score/rubric'
import type { ExtractedLead, SignalId, Verdict } from '@/lib/domain/types'
import { createScoutStore } from '@/lib/store'
import { classifyRoleFromTitle, mapLocationToRegion } from '@/lib/leads/targeting'
import { evaluateProspectQualification } from '@/lib/prospect/qualification-gate'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import { qualifyCanonicalScore, verdictForQualification } from '@/lib/scoring/qualification'
import { resolveActiveWorkspace } from '@/lib/workspace/resolve-active-identity'
import type { WorkspaceIdentity } from '@/lib/workspace/active-identity'

/**
 * Lead Creation API
 *
 * Persists a lead with its canonical intelligence. If canonical intelligence
 * is provided, it is stored as the single source of truth. The score is
 * READ from the canonical object — never recomputed independently.
 *
 * Legacy path (no canonical intelligence) still works for backward compatibility,
 * but new leads should always include canonical intelligence from the pipeline.
 */

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const company = typeof body.company === 'string' ? body.company.trim() : ''
  if (!company) {
    return NextResponse.json(
      { error: 'Company is required.' },
      { status: 400 },
    )
  }

  const signalTypeRaw = Number(body.signalType)
  if (!Number.isInteger(signalTypeRaw) || signalTypeRaw < 1 || signalTypeRaw > 7) {
    return NextResponse.json(
      { error: 'signalType is required and must be 1 to 7.' },
      { status: 400 },
    )
  }
  const signalType = signalTypeRaw as SignalId

  const signalEvidence =
    typeof body.signalEvidence === 'string' ? body.signalEvidence.trim() : ''
  if (!signalEvidence) {
    return NextResponse.json(
      { error: 'Signal evidence is required.' },
      { status: 400 },
    )
  }

  const canonical: CanonicalProspectIntelligence | null =
    body.canonicalIntelligence && typeof body.canonicalIntelligence === 'object'
      ? body.canonicalIntelligence as CanonicalProspectIntelligence
      : null

  const extracted: ExtractedLead = {
    name:
      typeof body.contactName === 'string' && body.contactName.trim()
        ? body.contactName.trim()
        : canonical?.intelligence.person.fullName ?? null,
    title:
      typeof body.contactTitle === 'string' && body.contactTitle.trim()
        ? body.contactTitle.trim()
        : canonical?.intelligence.person.title ?? null,
    titleRaw:
      typeof body.titleRaw === 'string' && body.titleRaw.trim()
        ? body.titleRaw.trim()
        : canonical?.intelligence.person.title ?? null,
    company,
    url:
      typeof body.url === 'string' && body.url.trim()
        ? body.url.trim()
        : canonical?.rawSource.profileUrl ?? canonical?.intelligence.person.linkedinUrl ?? null,
    locationRaw:
      typeof body.locationRaw === 'string' && body.locationRaw.trim()
        ? body.locationRaw.trim()
        : canonical?.intelligence.person.location ?? null,
    aboutSummary:
      typeof body.aboutSummary === 'string' && body.aboutSummary.trim()
        ? body.aboutSummary.trim()
        : null,
    experienceSummary:
      typeof body.experienceSummary === 'string' && body.experienceSummary.trim()
        ? body.experienceSummary.trim()
        : null,
    recentPosts: Array.isArray(body.recentPosts)
      ? (body.recentPosts as Array<{ paraphrase?: unknown; verbatimQuote?: unknown }>)
          .filter((p) => typeof p?.paraphrase === 'string')
          .slice(0, 3)
          .map((p) => ({
            paraphrase: String(p.paraphrase),
            verbatimQuote:
              typeof p.verbatimQuote === 'string' && p.verbatimQuote.trim()
                ? p.verbatimQuote.trim()
                : null,
          }))
      : canonical?.intelligence.content.recentPosts.map((p) => ({
          paraphrase: p.paraphrase,
          verbatimQuote: p.verbatimQuote,
        })) ?? [],
    roleCategory:
      typeof body.roleCategory === 'string' && body.roleCategory.trim()
        ? (body.roleCategory as ExtractedLead['roleCategory'])
        : classifyRoleFromTitle(
            typeof body.contactTitle === 'string' ? body.contactTitle : null,
          ),
    // Region is derived from the location on the server, never taken from
    // the client — it feeds the market-fit score.
    marketRegion: mapLocationToRegion(
      typeof body.locationRaw === 'string' ? body.locationRaw : null,
    ),
    signalType,
    signalEvidence,
    extractionConfidence:
      typeof body.extractionConfidence === 'number' && Number.isFinite(body.extractionConfidence)
        ? Math.max(0, Math.min(100, Math.round(body.extractionConfidence)))
        : canonical?.extractionCompleteness.score ?? 50,
    confidenceNotes: Array.isArray(body.confidenceNotes)
      ? (body.confidenceNotes as unknown[])
          .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
          .slice(0, 8)
      : canonical?.scoreBreakdown.missingInfo ?? [],
    verbatimQuote:
      typeof body.verbatimQuote === 'string' && body.verbatimQuote.trim()
        ? body.verbatimQuote.trim()
        : canonical?.intelligence.content.recentPosts[0]?.verbatimQuote ?? null,
    tags: Array.isArray(body.tags)
      ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [
          ...canonical?.intelligence.content.topics ?? [],
          ...canonical?.intelligence.content.technicalSignals ?? [],
        ],
  }

  const qualification = evaluateProspectQualification({
    extracted,
    rawText:
      typeof body.rawInput === 'string' && body.rawInput.trim()
        ? body.rawInput.trim()
        : canonical?.rawSource.rawInput ?? null,
    canonicalQualification: canonical?.qualification ?? null,
  })
  if (!qualification.qualificationEligibility) {
    return NextResponse.json(
      {
        error: 'NOT ENOUGH INFORMATION. Add richer person, company, and opportunity context before saving this lead.',
        qualification,
      },
      { status: 422 },
    )
  }

  const allowPotentialDuplicate = body.allowPotentialDuplicate === true

  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json(
      { error: 'Not signed in.' },
      { status: 401 },
    )
  }

  const legacyRulebook = await store.getRulebook()
  // Score claims against the research the lead came from. No research means
  // nothing can be verified — an omitted source must not buy signal/quote points.
  const scoreSource =
    typeof body.rawInput === 'string' && body.rawInput.trim()
      ? body.rawInput
      : canonical?.rawSource.rawInput ?? ''
  const legacyScore = legacyRulebook
    ? computeScore(extracted, legacyRulebook, {
        sourceText: scoreSource,
        signalOrigin: body.signalOrigin === 'AI_EXTRACTED' ? 'AI_EXTRACTED' : 'USER_ENTERED',
      })
    : null

  const canonicalScoreValue = canonical?.canonicalScore ?? null
  // Verdict follows the canonical band of the stored score — one mapping,
  // including LOW — and only falls back to the legacy rubric without one.
  const finalVerdict: Verdict | null = canonicalScoreValue != null
    ? verdictForQualification(qualifyCanonicalScore(canonicalScoreValue).qualification)
    : legacyScore?.verdict ?? null

  let workspace: WorkspaceIdentity | null = null
  try {
    workspace = await resolveActiveWorkspace()
  } catch {
    workspace = null
  }
  const result = await store.createLead({
    company,
    contactName: extracted.name,
    contactTitle: extracted.title,
    url: extracted.url,
    rawInput:
      typeof body.rawInput === 'string' && body.rawInput.trim()
        ? body.rawInput.trim()
        : canonical?.rawSource.rawInput ?? null,
    signalType,
    signalEvidence,
    verbatimQuote: extracted.verbatimQuote,
    tags: extracted.tags,
    score: legacyScore?.total ?? null,
    verdict: finalVerdict,
    titleRaw: extracted.titleRaw ?? extracted.title,
    locationRaw: extracted.locationRaw ?? null,
    roleCategory: extracted.roleCategory ?? classifyRoleFromTitle(extracted.title),
    marketRegion: extracted.marketRegion ?? mapLocationToRegion(extracted.locationRaw ?? null),
    extractionConfidence: extracted.extractionConfidence ?? 50,
    extractionProfile: {
      aboutSummary: extracted.aboutSummary ?? null,
      experienceSummary: extracted.experienceSummary ?? null,
      recentPosts: extracted.recentPosts ?? [],
      confidenceNotes: extracted.confidenceNotes ?? [],
    },
    allowPotentialDuplicate,
    senderProfileId: typeof body.senderProfileId === 'string'
      ? body.senderProfileId
      : workspace?.profileId ?? null,
    revenueIdentityId: (await validateRevenueIdentityId(body.revenueIdentityId))
      ?? workspace?.id
      ?? null,
    // Intelligence V2 fields
    canonicalScore: canonical?.canonicalScore ?? null,
    scoreVersion: canonical?.scoreVersion ?? null,
    scoredAt: canonical?.scoredAt ?? null,
    canonicalIntelligence: (canonical ?? null) as Record<string, unknown> | null,
    rawSourceData: (canonical?.rawSource ?? null) as Record<string, unknown> | null,
    scoreBreakdown: (canonical?.scoreBreakdown ?? null) as Record<string, unknown> | null,
    remoteEligibility: (canonical?.remoteEligibility ?? null) as Record<string, unknown> | null,
    evidenceLedger: (canonical?.evidenceLedger ?? null) as unknown as Record<string, unknown> | null,
    extractionCompleteness: (canonical?.extractionCompleteness ?? null) as Record<string, unknown> | null,
  })

  if (result.blocked) {
    const duplicateKind = result.duplicateKind ?? 'hard'
    return NextResponse.json(
      {
        blocked: true,
        duplicate: true,
        duplicateKind,
        reason: result.reason,
        existingOwnerName: result.existingOwnerName,
        existingLeadId: result.lead?.id ?? null,
        existingLeadCompany: result.lead?.company ?? null,
        canCreateSeparate: duplicateKind === 'potential',
      },
      { status: 409 },
    )
  }

  const lead = result.lead!

  // Link captured prospect if one exists for this raw input
  if (store && canonical?.rawSource?.rawInput) {
    try {
      const captured = await store.listCapturedProspects()
      const match = captured.find(
        (c) => c.rawInput === (canonical.rawSource.rawInput ?? '') && c.status === 'captured',
      )
      if (match) {
        await store.updateCapturedProspectStatus(match.id, 'converted', lead.id)
      }
    } catch {
      // Non-fatal: captured prospect linking must not break lead creation
    }
  }

  return NextResponse.json(
    {
      lead: {
        ...lead,
        score: lead.score ?? legacyScore?.total ?? null,
        verdict: lead.verdict ?? finalVerdict,
        canonicalScore: lead.canonicalScore ?? canonical?.canonicalScore ?? null,
        scoreVersion: lead.scoreVersion ?? canonical?.scoreVersion ?? null,
      },
      score: {
        total: canonical?.canonicalScore ?? legacyScore?.total ?? null,
        verdict: finalVerdict,
        breakdown: canonical?.scoreBreakdown?.dimensions ?? legacyScore?.breakdown ?? [],
        label: canonical?.scoreBreakdown.label ?? null,
        qualification: canonical?.qualification ?? null,
      },
    },
    { status: 201 },
  )
}

/**
 * Validates that a revenue identity ID from client input is:
 * 1. Belongs to the authenticated user's organization
 * 2. Assigned to the current rep (for non-admin users)
 * Returns the validated ID or null.
 */
async function validateRevenueIdentityId(
  rawId: unknown,
): Promise<string | null> {
  if (typeof rawId !== 'string' || !rawId) return null

  // Use the centralized auth helper which validates org + assignment
  try {
    const { isRevenueIdentityAssignedToRep } = await import('@/lib/auth/workspace')
    const user = await import('@/lib/auth/current').then((m) => m.getCurrentUser())
    if (!user) return null

    // Admins/owners can use any identity in their org — resolve via auth context, not reps.role
    const { getAuthContext } = await import('@/lib/auth/organization')
    const authCtx = await getAuthContext()
    if (authCtx?.isOwner || authCtx?.isAdmin) {
      const supabase = await import('@/lib/supabase/server').then((m) => m.createServerSupabase())
      const { data: identity } = await supabase
        .from('revenue_identities')
        .select('id')
        .eq('id', rawId)
        .eq('organization_id', user.organization.id)
        .maybeSingle()
      return identity?.id ?? null
    }

    // Reps can only use identities assigned to them
    const isAssigned = await isRevenueIdentityAssignedToRep(user.rep.id, rawId)
    return isAssigned ? rawId : null
  } catch {
    return null
  }
}
