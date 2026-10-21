/**
 * GET /api/admin/scoring-integrity
 *
 * Read-only data-integrity metrics for the Scoring QA / data pipeline.
 * No AI calls. Production-only (admin/owner/manager).
 *
 * Reports the concepts the audit must not mix:
 * raw decisions, unique opportunities, duplicate rate, test records,
 * incomplete samples, shadow coverage, label coverage, proof coverage,
 * and current-version coverage.
 */
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { SCORING_VERSION } from '@/lib/intelligence-v3/versions'
import { BUYER_INTENT_VERSION } from '@/lib/intelligence-v3/buyer-intent'

export const dynamic = 'force-dynamic'

async function exactCount(
  client: ReturnType<typeof createServiceSupabase>,
  table: string,
  orgId: string,
  extra = '',
): Promise<number> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=id&organization_id=eq.${orgId}${extra}`
  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  })
  const range = res.headers.get('content-range') ?? ''
  const total = Number(range.split('/')[1] ?? 0)
  return Number.isFinite(total) ? total : 0
}

export async function GET() {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) {
    return NextResponse.json({ error: 'Admin or owner access required.' }, { status: 403 })
  }

  const client = createServiceSupabase()
  const orgId = auth.orgId

  const [
    rawDecisions,
    uniqueOpportunities,
    testRecords,
    incompleteSamples,
    shadowRows,
    shadowOpportunities,
    labelCount,
    proofCount,
    currentVersion,
  ] = await Promise.all([
    exactCount(client, 'captured_prospects', orgId, '&status=eq.captured'),
    exactCount(client, 'captured_prospects', orgId, '&status=eq.captured&opportunity_key=not.is.null'),
    exactCount(client, 'captured_prospects', orgId, '&status=eq.captured&is_test=eq.true'),
    exactCount(client, 'intelligence_samples', orgId, '&qualification=is.null'),
    exactCount(client, 'scoring_shadow_decisions', orgId),
    exactCount(client, 'scoring_shadow_decisions', orgId, '&opportunity_key=not.is.null'),
    exactCount(client, 'scoring_labels', orgId),
    exactCount(client, 'proof_items', orgId),
    exactCount(client, 'captured_prospects', orgId, '&status=eq.captured&canonical_intelligence->>scoringVersion=eq.' + SCORING_VERSION),
  ])

  const duplicateRate = rawDecisions === 0 ? 0 : Math.round(((rawDecisions - uniqueOpportunities) / rawDecisions) * 1000) / 10

  return NextResponse.json({
    organizationId: orgId,
    scoringVersion: SCORING_VERSION,
    buyerIntentVersion: BUYER_INTENT_VERSION,
    rawDecisions,
    uniqueOpportunities,
    duplicateRate,
    reanalyses: Math.max(0, rawDecisions - uniqueOpportunities),
    testRecords,
    incompleteSamples,
    shadowRows,
    shadowCoverage: shadowOpportunities === 0 ? 0 : Math.round((shadowRows / (shadowOpportunities * 4)) * 1000) / 10,
    labelCoverage: labelCount,
    proofCoverage: proofCount,
    currentVersionCoverage: rawDecisions === 0 ? 0 : Math.round((currentVersion / rawDecisions) * 1000) / 10,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
