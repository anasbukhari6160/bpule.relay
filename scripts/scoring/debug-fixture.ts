/** Print the full decision for one or more golden fixture ids: npx tsx --tsconfig tsconfig.json scripts/scoring/debug-fixture.ts <id> [id...] */
import { GOLDEN_SET } from '../../tests/golden/fixtures'
import { runOffline } from '../../tests/helpers/score-source'

async function main() {
  for (const id of process.argv.slice(2)) {
    const f = GOLDEN_SET.find((x) => x.id === id)
    if (!f) { console.log(`no fixture ${id}`); continue }
    const p = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: new Date('2026-10-20T00:00:00Z') })
    console.log(`\n=== ${id} :: score=${p.score} q=${p.qualification} label=${p.label} action=${p.recommendedAction?.action} conf=${p.confidenceDetail?.label}`)
    console.log('intent:', p.buyerIntent?.buyerIntentLevel, 'role:', p.buyerIntent?.relationshipRole, 'verifiedReq:', p.buyerIntent?.verifiedBuyerRequest, 'contradictions:', p.buyerIntent?.contradictions)
    console.log('resolved:', JSON.stringify(p.resolved))
    console.log('episodes:', p.episodes.map((e) => `${e.id}:${e.anchorEvent.eventType}:${e.status}:age=${e.ageDays}`).join(' | '), 'selected:', p.selectedEpisodeId)
    console.log('dims:', p.dimensions.map((d) => `${d.key}=${d.raw.toFixed(2)}→${d.contribution.toFixed(1)}`).join('  '))
    console.log('reasons:', p.reasons)
    console.log('watchOut:', p.watchOut)
    console.log('adjustments:', p.decisionAdjustments)
    console.log('seller lines:', p.sourceFacts?.rejectedSignals.filter((r) => /seller/.test(r.reason)).map((r) => r.sourceLine).slice(0, 3))
    console.log('facts: industry=', p.sourceFacts?.currentIndustry, 'product=', p.sourceFacts?.currentProductActivity, 'seller=', p.sourceFacts?.sellerActivity, 'recency=', p.sourceFacts?.activityRecency, p.sourceFacts?.recentPostAgeDays, 'buyerRequest=', p.sourceFacts?.buyerRequest)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
