/**
 * Human-labelled locked set (Phase 17) — team-run.
 *
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/scoring/experiments/human-locked-set.ts [--org <id>] [--out docs/scoring-v4/experiments/human-set.json]
 *
 * Reads scoring_labels, joins each label to its lead / captured prospect
 * packet and raw source, builds OpportunityFeatures, and evaluates every
 * engine against the HUMAN ranges (never V3 expectations). Rows are split
 * train / validation / locked by the same hashed-id rule as the fixtures,
 * so the locked human set is fixed forever and cannot be tuned against.
 * Reports coverage per stratum (role, platform, language, band) so the
 * 100- and 300-label milestones can be checked honestly.
 *
 * Reads prospect text: run from a cleared account. Output holds ids,
 * hashes, numbers and enums only.
 */

import { writeFileSync } from 'node:fs'
import { createServiceSupabase } from '../../../src/lib/supabase/service'
import { parsePacket } from '../../../src/lib/relay/routing-context'
import { featuresFromPacket } from '../../../src/lib/scoring-v4/opportunity-features'
import { makeRow, toRangeLabels, BAND_ORDER_ASC, type LabelledRow } from '../../../src/lib/scoring-v4/train/dataset'
import { evaluate, macroF1, precisionRecallF1 } from '../../../src/lib/scoring-v4/metrics'
import { ENGINES, ENGINE_IDS } from '../../../src/lib/scoring-v4/engines/registry'
import type { CanonicalQualification } from '../../../src/lib/scoring/qualification'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : 'true'
}

async function main() {
  const client = createServiceSupabase()
  const org = arg('org')
  let lq = client.from('scoring_labels').select('*').order('created_at', { ascending: false }).limit(5000)
  if (org) lq = lq.eq('organization_id', org)
  const { data: labels, error } = await lq
  if (error) throw new Error(error.message)
  const rows: LabelledRow[] = []
  const strata: Record<string, Record<string, number>> = { role: {}, platform: {}, language: {}, band: {} }
  const truth = new Map<string, { role: string | null; intent: string | null; action: string | null }>()
  const v3Meta = new Map<string, { role: string; intent: string; action: string }>()
  const seen = new Set<string>()
  let skipped = 0
  for (const l of (labels ?? []) as Array<Record<string, unknown>>) {
    const key = l.opportunity_key as string
    if (seen.has(key)) continue // latest label per opportunity wins
    seen.add(key)
    const leadId = l.lead_id as string | null, prospectId = l.captured_prospect_id as string | null
    const rec = leadId
      ? (await client.from('leads').select('raw_input, canonical_intelligence').eq('id', leadId).maybeSingle()).data
      : prospectId ? (await client.from('captured_prospects').select('raw_input, canonical_intelligence').eq('id', prospectId).maybeSingle()).data : null
    const packet = rec ? parsePacket(rec.canonical_intelligence) : null
    const min = l.expected_score_min as number | null, max = l.expected_score_max as number | null
    if (!packet || !rec?.raw_input || min === null || max === null) { skipped++; continue }
    const features = featuresFromPacket(packet, rec.raw_input as string, { platform: (l.platform as 'linkedin' | 'upwork') ?? 'linkedin' })
    if (!features) { skipped++; continue }
    const row = makeRow({ id: key, category: (l.relationship_role as string) ?? 'unlabelled-role', features, v3Score: packet.score, range: [min, max] })
    rows.push(row)
    truth.set(key, { role: (l.relationship_role as string) ?? null, intent: (l.buyer_intent as string) ?? null, action: (l.expected_action as string) ?? null })
    v3Meta.set(key, { role: packet.buyerIntent?.relationshipRole ?? 'UNKNOWN', intent: packet.buyerIntent?.buyerIntentLevel ?? 'UNKNOWN', action: packet.recommendedAction?.action ?? packet.action })
    const bump = (k: string, v: string) => { strata[k][v] = (strata[k][v] ?? 0) + 1 }
    bump('role', (l.relationship_role as string) ?? 'unlabelled')
    bump('platform', (l.platform as string) ?? 'linkedin')
    bump('language', features.language)
    bump('band', row.band)
  }
  const locked = rows.filter((r) => r.split === 'locked'), validation = rows.filter((r) => r.split === 'validation'), train = rows.filter((r) => r.split === 'train')
  console.log(`\nHUMAN-LABELLED SET — ${rows.length} unique labelled opportunities (${skipped} labels skipped: no packet, source or range) · train ${train.length} · validation ${validation.length} · locked ${locked.length}`)
  console.log(`milestones: 100 labels ${rows.length >= 100 ? 'REACHED' : 'NOT REACHED'} · 300 labels ${rows.length >= 300 ? 'REACHED' : 'NOT REACHED'}`)
  for (const [k, v] of Object.entries(strata)) console.log(`  ${k.padEnd(9)} ${Object.entries(v).map(([a, b]) => `${a} ${b}`).join(' · ') || '—'}`)

  const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), rows: rows.length, train: train.length, validation: validation.length, locked: locked.length, strata, engines: {} }
  for (const engine of ENGINE_IDS) {
    const per: Record<string, unknown> = {}
    for (const [name, set] of [['locked', locked], ['validation', validation], ['all', rows]] as const) {
      if (set.length === 0) { per[name] = null; continue }
      const preds = set.map((r) => { const c = ENGINES[engine].score(r.features, { v3Score: r.v3Score }); return { id: r.id, score: c.score, band: c.qualification as CanonicalQualification, confidence: c.confidence } })
      per[name] = evaluate(preds, toRangeLabels(set), BAND_ORDER_ASC)
    }
    ;(report.engines as Record<string, unknown>)[engine] = per
    const L = per.locked as ReturnType<typeof evaluate> | null
    console.log(`  ${engine.padEnd(15)} ${L ? `locked: spearman ${L.spearman} pairwise ${L.pairwise.accuracy} ndcg10 ${L.ndcg10} top10% ${L.topDecile.precision} inRange ${L.rangeMae.inRange} band ${L.ordinal.exact}` : 'locked: no rows yet'}`)
  }
  // V3 classification against human role / intent / action.
  const withRole = rows.filter((r) => truth.get(r.id)?.role)
  const withIntent = rows.filter((r) => truth.get(r.id)?.intent)
  const withAction = rows.filter((r) => truth.get(r.id)?.action)
  if (withRole.length) report.v3Role = macroF1(withRole.map((r) => ({ predicted: v3Meta.get(r.id)!.role, actual: truth.get(r.id)!.role! })))
  if (withIntent.length) report.v3Buyer = precisionRecallF1(withIntent.map((r) => ({ predicted: ['HIGH', 'MEDIUM'].includes(v3Meta.get(r.id)!.intent), actual: ['HIGH', 'MEDIUM'].includes(truth.get(r.id)!.intent!) })))
  if (withAction.length) report.v3Action = macroF1(withAction.map((r) => ({ predicted: v3Meta.get(r.id)!.action, actual: truth.get(r.id)!.action! })))
  console.log(`  v3 vs human: role macro-F1 ${(report.v3Role as { macroF1: number } | undefined)?.macroF1 ?? '—'} · buyer F1 ${(report.v3Buyer as { f1: number } | undefined)?.f1 ?? '—'} · action accuracy ${(report.v3Action as { accuracy: number } | undefined)?.accuracy ?? '—'}`)
  const out = arg('out')
  if (out) { writeFileSync(out, JSON.stringify(report, null, 2)); console.log(`report → ${out}`) }
}

main().catch((e) => { console.error(e); process.exit(1) })
