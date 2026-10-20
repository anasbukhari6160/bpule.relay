/**
 * Sender routing v1 vs v2 (Phase 12), on synthetic senders — no real
 * profile data.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/experiments/routing-compare.ts [--verbose]
 *
 * Four fictional identities with distinct capability sets and proof. For
 * every golden + ranking fixture: v1 (token overlap) and v2 (capability
 * families + verified proof) best sender, top-1 agreement, and how often
 * each engine picks a sender with no coverage of a stated need.
 */

import { GOLDEN_SET } from '../../../tests/golden/fixtures'
import { RANKING_FIXTURES } from '../../../tests/golden/fixtures-ranking'
import { runOffline } from '../../../tests/helpers/score-source'
import { featuresFromPacket } from '../../../src/lib/scoring-v4/opportunity-features'
import { buildSenderCapabilityProfile } from '../../../src/lib/scoring-v4/sender-capability-profile'
import { rankSendersV2 } from '../../../src/lib/scoring-v4/sender-ranker'
import { routeLead } from '../../../src/lib/relay/routing-context'
import type { SenderProfile } from '../../../src/lib/relay/sender-routing-engine'

const REF = new Date('2026-10-20T00:00:00Z')
const verbose = process.argv.includes('--verbose')

const SENDERS: SenderProfile[] = [
  { id: 'web-fullstack', name: 'Web full-stack', role: 'Engineer', platform: 'linkedin', skills: ['React', 'Next.js', 'Node', 'TypeScript', 'PostgreSQL', 'AWS'], industries: ['fintech', 'ecommerce'], proof: [{ text: 'Rebuilt a React/Node customer portal on AWS for a payments company', tags: ['react', 'node', 'aws', 'stripe'], strong: true, verified: true }], holders: [{ repId: 'r1', name: 'Rep One' }], accessibleToRep: true },
  { id: 'ai-data', name: 'AI & data', role: 'Engineer', platform: 'linkedin', skills: ['Python', 'LLM', 'RAG', 'Airflow', 'Spark', 'GCP', 'dashboards'], industries: ['healthcare', 'agtech'], proof: [{ text: 'Productionised ML pipelines and a RAG assistant for a healthtech SaaS', tags: ['rag', 'ml', 'airflow', 'gcp'], strong: true, verified: true }], holders: [{ repId: 'r2', name: 'Rep Two' }], accessibleToRep: true },
  { id: 'mobile', name: 'Mobile', role: 'Engineer', platform: 'linkedin', skills: ['React Native', 'Flutter', 'iOS', 'Android', 'Firebase'], industries: ['logistics'], proof: [{ text: 'Driver app in React Native for a last-mile carrier', tags: ['react native', 'mobile'], strong: true, verified: false }], holders: [{ repId: 'r3', name: 'Rep Three' }], accessibleToRep: true },
  { id: 'generalist', name: 'Generalist', role: 'Engineer', platform: 'linkedin', skills: ['PHP', 'Laravel', 'WordPress', 'Shopify', 'JavaScript'], industries: [], proof: [], holders: [{ repId: 'r4', name: 'Rep Four' }], accessibleToRep: true },
]

async function main() {
  const fixtures = [...GOLDEN_SET, ...RANKING_FIXTURES].filter((f) => !f.id.startsWith('attack-'))
  const v2Senders = SENDERS.map(buildSenderCapabilityProfile)
  let agree = 0, v1NoCoverage = 0, v2NoCoverage = 0, withNeeds = 0, v2Verified = 0
  const picks: Record<string, Record<string, number>> = { v1: {}, v2: {} }
  for (const f of fixtures) {
    const p = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: REF })
    const features = featuresFromPacket(p, f.rawText)!
    const v1 = routeLead({ rawInput: f.rawText, company: null, contactName: null, senderProfileId: null }, p, SENDERS, 'linkedin')
    const v2 = rankSendersV2(features, v2Senders)
    const b1 = v1.bestSenderId ?? 'none', b2 = v2.bestSenderId ?? 'none'
    picks.v1[b1] = (picks.v1[b1] ?? 0) + 1
    picks.v2[b2] = (picks.v2[b2] ?? 0) + 1
    if (b1 === b2) agree++
    if (features.fit.needs.length > 0) {
      withNeeds++
      const cover = (id: string) => { const s = v2Senders.find((x) => x.identityId === id); return s ? features.fit.needs.some((n) => s.capabilities.includes(n)) : false }
      if (!cover(b1)) v1NoCoverage++
      if (!cover(b2)) v2NoCoverage++
      if (v2.rankings[0]?.proofMatch === 'VERIFIED') v2Verified++
    }
    if (verbose) console.log(`${f.id.padEnd(52)} v1 ${b1.padEnd(14)} ${String(v1.bestSenderMatch ?? 0).padStart(3)}  v2 ${b2.padEnd(14)} ${String(v2.bestSenderMatch ?? 0).padStart(3)} ${v2.rankings[0]?.proofMatch ?? ''}  needs [${features.fit.needs.join(', ')}]`)
  }
  console.log(`\nROUTING v1 vs v2 — ${fixtures.length} fixtures, 4 synthetic senders\n`)
  console.log(`top-1 agreement: ${agree}/${fixtures.length}`)
  console.log(`fixtures with explicit needs: ${withNeeds} · v1 picked a sender with no coverage of a stated need: ${v1NoCoverage} · v2: ${v2NoCoverage} · v2 top pick backed by verified proof: ${v2Verified}`)
  console.log(`v1 picks: ${JSON.stringify(picks.v1)}`)
  console.log(`v2 picks: ${JSON.stringify(picks.v2)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
