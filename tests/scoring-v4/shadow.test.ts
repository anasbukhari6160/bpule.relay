import { describe, expect, it } from 'vitest'
import { GOLDEN_SET } from '../golden/fixtures'
import { runOffline } from '../helpers/score-source'
import { computeShadowCandidates, recordShadowDecisions } from '@/lib/scoring-v4/shadow'
import { v3PacketToCanonical, buildMinimalV2Canonical } from '@/lib/intelligence-v3/bridge'
import type { SupabaseClient } from '@supabase/supabase-js'

const REF = new Date('2026-10-20T00:00:00Z')

function fakeClient(sink: Array<Record<string, unknown>>, fail = false): SupabaseClient {
  return {
    from: (table: string) => ({
      insert: async (rows: Array<Record<string, unknown>>) => {
        if (fail) return { error: { message: 'boom' } }
        for (const r of rows) sink.push({ table, ...r })
        return { error: null }
      },
    }),
  } as unknown as SupabaseClient
}

describe('shadow mode (Phase 27)', () => {
  it('computes every requested candidate with an action and never touches the packet', async () => {
    const fx = GOLDEN_SET.find((x) => x.id === 'buyer-agency-react-budget-deadline')!
    const packet = await runOffline(fx.rawText, { model: fx.model ?? null, referenceDate: REF })
    const before = JSON.stringify(packet)
    const { features, rows } = computeShadowCandidates(packet, fx.rawText, { engines: ['calibrated_v4', 'ordinal_logit'] })
    expect(features).not.toBeNull()
    expect(rows.map((r) => r.engine)).toEqual(['calibrated_v4', 'ordinal_logit'])
    for (const r of rows) {
      expect(r.candidate.score).toBeGreaterThanOrEqual(0)
      expect(typeof r.candidateAction).toBe('string')
    }
    expect(JSON.stringify(packet)).toBe(before)
  })

  it('writes one row per shadow engine with production and candidate columns, and nothing when shadow is off', async () => {
    const fx = GOLDEN_SET.find((x) => x.id === 'buyer-agency-react-budget-deadline')!
    const packet = await runOffline(fx.rawText, { model: fx.model ?? null, referenceDate: REF })
    const canonical = v3PacketToCanonical(packet, buildMinimalV2Canonical(fx.rawText))
    const sink: Array<Record<string, unknown>> = []
    const n = await recordShadowDecisions({ client: fakeClient(sink), organizationId: 'org-1', leadId: 'lead-1', rawText: fx.rawText, canonicalIntelligence: canonical, productionSenderId: 'p-1', env: { SCORING_SHADOW_ENGINES: 'calibrated_v4,knn_features' } })
    expect(n).toBe(2)
    expect(sink).toHaveLength(2)
    const row = sink[0]
    expect(row.table).toBe('scoring_shadow_decisions')
    expect(row.production_engine).toBe('v3')
    expect(row.production_score).toBe(packet.score)
    expect(row.candidate_engine).toBe('calibrated_v4')
    expect(typeof row.candidate_score).toBe('number')
    expect(row.opportunity_key).toMatch(/^[a-f0-9]{64}$/)
    expect(row.features_version).toBe('opportunity_features_v1')
    // No raw text in the stored features.
    expect(JSON.stringify(row.features)).not.toContain(fx.rawText.slice(0, 40))

    const off = await recordShadowDecisions({ client: fakeClient([]), organizationId: 'org-1', rawText: fx.rawText, canonicalIntelligence: canonical, env: {} })
    expect(off).toBe(0)
  })

  it('swallows database failures (a shadow write never breaks a save)', async () => {
    const fx = GOLDEN_SET.find((x) => x.id === 'buyer-agency-react-budget-deadline')!
    const packet = await runOffline(fx.rawText, { model: fx.model ?? null, referenceDate: REF })
    const canonical = v3PacketToCanonical(packet, buildMinimalV2Canonical(fx.rawText))
    const n = await recordShadowDecisions({ client: fakeClient([], true), organizationId: 'org-1', rawText: fx.rawText, canonicalIntelligence: canonical, env: { SCORING_SHADOW_ENGINES: 'calibrated_v4' } })
    expect(n).toBe(0)
  })
})
