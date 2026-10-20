import { readFileSync } from 'node:fs'
import { buildMinimalV2Canonical } from '../../src/lib/intelligence-v3/bridge'
import { readSourceFacts } from '../../src/lib/intelligence-v3/source-facts-model'
import { resolveAccess } from '../../src/lib/intelligence-v3/dimensions'
import { runOffline } from '../../tests/helpers/score-source'

const raw = readFileSync('/tmp/jf-profile.txt', 'utf8')
const v2 = buildMinimalV2Canonical(raw)
const facts = readSourceFacts(raw)
const access = resolveAccess(facts, 'DIRECT')
const packet = await runOffline(raw, {
  model: {
    relationship: 'BUYER',
    buyerRequestProbability: 0.8,
    externalNeedProbability: 0.7,
    fit: 'EXCELLENT',
    timing: 'URGENT',
    access: 'DIRECT',
    messageEligible: 0.8,
    confidence: 0.9,
  },
})

console.log(JSON.stringify({
  completeness: v2.extractionCompleteness,
  namePresent: Boolean(v2.intelligence.person.fullName),
  titlePresent: Boolean(v2.intelligence.person.title),
  companyPresent: Boolean(v2.intelligence.company.name),
  degree: facts.access.connectionDegree,
  canMessage: facts.access.canMessage,
  directContact: facts.access.directContactAvailable,
  hasEmail: facts.access.hasEmail,
  resolvedAccess: access.level,
  accessReasons: access.reasons,
  seller: facts.sellerActivity,
  hiring: Boolean(facts.buyer.employmentHiring),
  buyerRequest: Boolean(facts.buyerRequest),
  role: packet.buyerIntent?.relationshipRole,
  intent: packet.buyerIntent?.buyerIntentLevel,
  contradictions: packet.buyerIntent?.contradictions.length,
  score: packet.score,
  qualification: packet.qualification,
  action: packet.recommendedAction?.action,
  cp: packet.resolved?.commercialPotential,
  fit: packet.resolved?.fit,
  timing: packet.resolved?.buyerTiming,
  packetAccess: packet.resolved?.access,
}, null, 2))
