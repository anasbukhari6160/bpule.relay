import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'

export const maxDuration = 30

/**
 * POST /api/leads/[id]/refresh-intelligence
 *
 * Controlled signal refresh — not a continuous stream.
 * Runs only when lead is high-value, stale, or force-refreshed.
 * Reuses existing V3 intelligence pipeline. No AI calls on the happy path.
 *
 * Cost gates:
 * - High-value leads (score >= 70): eligible
 * - Stale leads (no intelligence or >7 days old): eligible
 * - Force refresh (x-force-refresh header): always eligible
 * - Fresh intelligence (<3 days, not force): skipped
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params
  const store = createServiceSupabase()
  const { data: auth } = await store.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: rep } = await store
    .from('reps')
    .select('id, organization_id')
    .eq('user_id', auth.user.id)
    .single()

  if (!rep) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })

  const { data: lead } = await store
    .from('leads')
    .select('id, org_id, company, contact_name, contact_title, raw_input, canonical_score, canonical_intelligence, created_at, updated_at, verdict')
    .eq('id', leadId)
    .eq('organization_id', rep.organization_id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  const now = Date.now()
  const lastUpdated = lead.updated_at
    ? new Date(lead.updated_at).getTime()
    : new Date(lead.created_at).getTime()
  const daysSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60 * 24)

  const { qualifyCanonicalScore: bandOf } = await import('@/lib/scoring/qualification')
  const isHighValue = lead.canonical_score != null && ['STRONG', 'WORTH_PURSUING'].includes(bandOf(lead.canonical_score).qualification)
  const isStale = daysSinceUpdate >= 7 || lead.canonical_intelligence == null
  const forceRefresh = req.headers.get('x-force-refresh') === 'true'

  if (!isHighValue && !isStale && !forceRefresh) {
    return NextResponse.json({
      refreshed: false,
      reason: 'Lead does not qualify for refresh',
      scoreChanged: false,
    })
  }

  const hasFreshIntelligence = lead.canonical_intelligence != null && daysSinceUpdate < 3
  if (hasFreshIntelligence && !forceRefresh) {
    return NextResponse.json({
      refreshed: false,
      reason: 'Intelligence is fresh (< 3 days)',
      scoreChanged: false,
    })
  }

  // Refresh intelligence using existing V3 pipeline
  try {
    const { produceV3Intelligence } = await import('@/lib/intelligence-v3/bridge')
    const { normalizeProspectPaste } = await import('@/lib/prospect/paste-normalize')
    const { qualifyCanonicalScore, verdictForQualification } = await import('@/lib/scoring/qualification')

    // Re-analysis runs on the ORIGINAL research, never on a stub built from
    // the company name and title — a stub has no evidence and would only
    // ever lower or invent a score.
    const existingIntel = lead.canonical_intelligence as Record<string, unknown> | null
    const storedRaw = typeof lead.raw_input === 'string' && lead.raw_input.trim()
      ? lead.raw_input
      : (((existingIntel?.rawSource as Record<string, unknown> | undefined)?.rawInput as string | undefined) ?? '')
    const rawText = normalizeProspectPaste(storedRaw)

    if (rawText.length < 80) {
      return NextResponse.json({
        refreshed: false,
        reason: 'No stored research to re-analyze — paste the profile again to refresh',
        scoreChanged: false,
      })
    }

    const result = await produceV3Intelligence(rawText, {
      forceReanalyze: true,
      trace: { leadId, organizationId: rep.organization_id, repId: rep.id },
    })

    if (result?.intelligence) {
      const newScore = result.intelligence.canonicalScore ?? lead.canonical_score
      const previousScore = lead.canonical_score ?? 0

      // Do not overwrite stronger prior intelligence with degraded source
      // If new score is significantly lower (>10pts), keep prior unless force-refresh
      const forceRefresh = req.headers.get('x-force-refresh') === 'true'
      const degraded = previousScore > 0 && newScore < (previousScore - 10)

      if (degraded && !forceRefresh) {
        return NextResponse.json({
          refreshed: false,
          reason: 'Refresh would degrade score — kept prior intelligence',
          previousScore,
          attemptedScore: newScore,
          scoreChanged: false,
        })
      }

      await store
        .from('leads')
        .update({
          canonical_score: newScore,
          canonical_intelligence: result.intelligence,
          score_breakdown: result.intelligence.scoreBreakdown ?? null,
          score_version: result.intelligence.scoreVersion ?? null,
          scored_at: new Date().toISOString(),
          verdict: verdictForQualification(qualifyCanonicalScore(newScore).qualification),
        })
        .eq('id', leadId)

      const scoreChanged = newScore !== previousScore

      return NextResponse.json({
        refreshed: true,
        scoreChanged,
        newScore,
        previousScore,
        v3Canonical: result.v3Canonical,
      })
    }

    return NextResponse.json({
      refreshed: false,
      reason: 'Intelligence pipeline returned no result',
      scoreChanged: false,
    })
  } catch (err) {
    console.error('[refresh-intelligence] pipeline failed:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({
      refreshed: false,
      reason: 'Intelligence refresh failed',
      scoreChanged: false,
    }, { status: 500 })
  }
}
