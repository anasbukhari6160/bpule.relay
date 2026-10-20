/**
 * Fit evidence audit (Phase 11): what does V3's capability fit actually
 * rest on, fixture by fixture?
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/experiments/fit-audit.ts [--verbose]
 *
 * For every golden + ranking fixture: the V3 overlap tokens, which of them
 * are ambiguous (would match a non-software context), whether any token
 * comes from a past role or a repost line, and the semantic family fit the
 * v4 features resolve instead. Offline.
 */

import { GOLDEN_SET } from '../../../tests/golden/fixtures'
import { RANKING_FIXTURES } from '../../../tests/golden/fixtures-ranking'
import { runOffline } from '../../../tests/helpers/score-source'
import { readSourceFacts } from '../../../src/lib/intelligence-v3/source-facts-model'
import { resolveCapabilityFit } from '../../../src/lib/intelligence-v3/dimensions'
import { featuresFromPacket } from '../../../src/lib/scoring-v4/opportunity-features'

const REF = new Date('2026-10-20T00:00:00Z')
const AMBIGUOUS = new Set(['api', 'ai', 'ml', 'web', 'app', 'security', 'integration', 'mobile', 'go', 'automation', 'saas', 'analytics', 'dashboard', 'backend', 'frontend', 'compliance', 'rest api', 'mvp', 'web app'])
const verbose = process.argv.includes('--verbose')

async function main() {
  const fixtures = [...GOLDEN_SET, ...RANKING_FIXTURES].filter((f) => !f.id.startsWith('attack-'))
  let ambiguousOnly = 0, pastRole = 0, modelLifted = 0, nothing = 0, semanticDiffers = 0
  const lines: string[] = []
  for (const f of fixtures) {
    const p = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: REF })
    const facts = readSourceFacts(f.rawText)
    const fit = resolveCapabilityFit(facts, p.decision.fit, undefined, { relationshipRole: p.buyerIntent?.relationshipRole, verifiedBuyerRequest: p.buyerIntent?.verifiedBuyerRequest })
    const features = featuresFromPacket(p, f.rawText)!
    const amb = fit.overlap.filter((t) => AMBIGUOUS.has(t.toLowerCase()))
    const onlyAmbiguous = fit.overlap.length > 0 && amb.length === fit.overlap.length
    const past = fit.overlap.some((t) => facts.pastRoleLines.some((l) => l.toLowerCase().includes(t.toLowerCase())) && !facts.currentOrganizations.length)
    const lifted = fit.modelLevel !== null && fit.overlap.length === 0 && fit.raw >= 0.45
    if (onlyAmbiguous) ambiguousOnly++
    if (past) pastRole++
    if (lifted) modelLifted++
    if (fit.overlap.length === 0 && !facts.currentProductActivity) nothing++
    const v3Level = fit.level
    const v4Level = features.fit.level
    const order = ['NONE', 'POOR', 'UNKNOWN', 'WEAK', 'ADJACENT', 'MEDIUM', 'GOOD', 'STRONG', 'EXCELLENT', 'EXCEPTIONAL']
    if (Math.abs(order.indexOf(v3Level) - order.indexOf(v4Level)) >= 3) semanticDiffers++
    lines.push(`${f.id.padEnd(52)} v3 ${v3Level.padEnd(9)} overlap [${fit.overlap.slice(0, 5).join(', ')}]${onlyAmbiguous ? ' AMBIGUOUS-ONLY' : ''}${lifted ? ' MODEL-LIFTED' : ''}  →  v4 ${v4Level} needs [${features.fit.needs.join(', ')}] stack [${features.fit.stack.join(', ')}]`)
  }
  console.log(`\nFIT AUDIT — ${fixtures.length} distinct fixtures\n`)
  if (verbose) console.log(lines.join('\n'))
  console.log(`\nfits resting only on ambiguous tokens: ${ambiguousOnly}`)
  console.log(`fits with a token from a past-role line: ${pastRole}`)
  console.log(`fits lifted by the model with no overlap at all: ${modelLifted}`)
  console.log(`nothing to fit (no overlap, no product): ${nothing}`)
  console.log(`v3 level vs v4 semantic level differ by 3+ steps: ${semanticDiffers}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
