/**
 * V3 Score Calibration Simulation
 *
 * Uses actual V3 scoring weights from config.ts to diagnose why explicit buyers
 * may rank below latent founders, and validate calibration fixes.
 */

const WEIGHTS = {
  buyerRequestProbability: 0.20,
  commercialPotential: 0.20,
  externalNeedProbability: 0.10,
  fit: 0.20,
  timing: 0.10,
  access: 0.10,
  proofRelevance: 0.05,
  evidenceQuality: 0.05,
}

const EPISODE_STATUS = { CURRENT: 1.0, AGING: 0.8, STALE: 0.4, CLOSED: 0.0, UNKNOWN: 0.65 }
const RELATIONSHIP = { BUYER: 1.0, SERVICE_PROVIDER: 0.7, UNKNOWN: 0.85, CANDIDATE: 0.6, COMPETITOR: 0.4 }

interface LeadFixture {
  name: string
  description: string
  buyerProb: number        // LLM-assessed buyer request probability
  externalNeed: number     // LLM-assessed external need
  commercialPotential: number // 0-1 assessed commercial worth
  fit: number              // capability fit 0-1
  timing: number           // recency 0-1
  access: string           // DIRECT, CONNECTION, INDIRECT, NONE
  proofRelevance: number   // 0-1
  evidenceQuality: number  // 0-1
  episodeStatus: string    // CURRENT, AGING, STALE, UNKNOWN, CLOSED
  relationship: string     // BUYER, UNKNOWN, etc.
  isEmploymentHiring: boolean
}

const GOLDEN_SET: LeadFixture[] = [
  {
    name: 'Explicit Buyer',
    description: 'Looking for React Native dev, budget $50k, needs portfolio + rates',
    buyerProb: 0.85,
    externalNeed: 0.9,
    commercialPotential: 0.8,
    fit: 0.85,
    timing: 0.9,
    access: 'DIRECT',
    proofRelevance: 0.7,
    evidenceQuality: 0.9,
    episodeStatus: 'CURRENT',
    relationship: 'BUYER',
    isEmploymentHiring: false,
  },
  {
    name: 'Explicit Contractor',
    description: 'Need freelance developer for 3-month React+Node project',
    buyerProb: 0.7,
    externalNeed: 0.8,
    commercialPotential: 0.6,
    fit: 0.8,
    timing: 0.8,
    access: 'CONNECTION',
    proofRelevance: 0.6,
    evidenceQuality: 0.8,
    episodeStatus: 'CURRENT',
    relationship: 'BUYER',
    isEmploymentHiring: false,
  },
  {
    name: 'Abdulhakim (Active Builder)',
    description: 'Founder of multiple products, shipping features, hiring',
    buyerProb: 0.1,
    externalNeed: 0.2,
    commercialPotential: 0.85,
    fit: 0.7,
    timing: 0.9,
    access: 'CONNECTION',
    proofRelevance: 0.5,
    evidenceQuality: 0.8,
    episodeStatus: 'CURRENT',
    relationship: 'UNKNOWN',
    isEmploymentHiring: false,
  },
  {
    name: 'Ory (Founder)',
    description: 'Building AI product, launched platform, open to partnerships',
    buyerProb: 0.15,
    externalNeed: 0.2,
    commercialPotential: 0.7,
    fit: 0.6,
    timing: 0.8,
    access: 'CONNECTION',
    proofRelevance: 0.4,
    evidenceQuality: 0.7,
    episodeStatus: 'CURRENT',
    relationship: 'UNKNOWN',
    isEmploymentHiring: false,
  },
  {
    name: 'Adir (Seller)',
    description: 'Builds web apps for clients, DM for rates',
    buyerProb: 0.05,
    externalNeed: 0.1,
    commercialPotential: 0.4,
    fit: 0.3,
    timing: 0.6,
    access: 'DIRECT',
    proofRelevance: 0.2,
    evidenceQuality: 0.5,
    episodeStatus: 'CURRENT',
    relationship: 'SERVICE_PROVIDER',
    isEmploymentHiring: false,
  },
  {
    name: 'Jurica (Passive)',
    description: 'Full-stack developer, employed, not looking',
    buyerProb: 0.05,
    externalNeed: 0.05,
    commercialPotential: 0.2,
    fit: 0.4,
    timing: 0.2,
    access: 'CONNECTION',
    proofRelevance: 0.1,
    evidenceQuality: 0.3,
    episodeStatus: 'AGING',
    relationship: 'UNKNOWN',
    isEmploymentHiring: false,
  },
  {
    name: 'Recruiter',
    description: 'Hiring Senior React Developer, apply at careers page',
    buyerProb: 0.1,
    externalNeed: 0.1,
    commercialPotential: 0.3,
    fit: 0.5,
    timing: 0.7,
    access: 'CONNECTION',
    proofRelevance: 0.2,
    evidenceQuality: 0.6,
    episodeStatus: 'CURRENT',
    relationship: 'UNKNOWN',
    isEmploymentHiring: true,
  },
  {
    name: 'Service Provider + Buyer Episode',
    description: 'Builds custom software, also looking for DevOps consultant',
    buyerProb: 0.4,
    externalNeed: 0.5,
    commercialPotential: 0.6,
    fit: 0.7,
    timing: 0.8,
    access: 'CONNECTION',
    proofRelevance: 0.5,
    evidenceQuality: 0.7,
    episodeStatus: 'CURRENT',
    relationship: 'MIXED',
    isEmploymentHiring: false,
  },
]

function scoreLead(lead: LeadFixture): {
  canonicalScore: number
  qualification: string
  displayScore: number
  action: string
  buyerRaw: number
  externalRaw: number
  cpRaw: number
  modelSubtotal: number
  statusMult: number
  relMult: number
  finalScore: number
} {
  // Employment hiring cap
  const capBuyer = lead.isEmploymentHiring
  const buyerRaw = capBuyer ? Math.min(lead.buyerProb, 0.2) : lead.buyerProb

  // External need
  const needOwnerRelevance = buyerRaw > 0.5 ? 0.8 : 0.4
  const externalRaw = lead.externalNeed * needOwnerRelevance

  // Commercial potential
  const cpRaw = lead.commercialPotential

  // Model subtotal (weighted sum)
  const accessScore = { DIRECT: 1.0, CONNECTION: 0.7, INDIRECT: 0.3, NONE: 0.0 }[lead.access] ?? 0.3

  const modelSubtotal =
    buyerRaw * WEIGHTS.buyerRequestProbability * 100 +
    cpRaw * WEIGHTS.commercialPotential * 100 +
    externalRaw * WEIGHTS.externalNeedProbability * 100 +
    lead.fit * WEIGHTS.fit * 100 +
    lead.timing * WEIGHTS.timing * 100 +
    accessScore * WEIGHTS.access * 100 +
    lead.proofRelevance * WEIGHTS.proofRelevance * 100 +
    lead.evidenceQuality * WEIGHTS.evidenceQuality * 100

  // Episode status
  const statusMult = EPISODE_STATUS[lead.episodeStatus as keyof typeof EPISODE_STATUS] ?? 0.65

  // Relationship multiplier
  const relBase = RELATIONSHIP[lead.relationship as keyof typeof RELATIONSHIP] ?? 0.85
  const relMult = buyerRaw >= 0.5
    ? 1.0
    : relBase + (1.0 - relBase) * cpRaw * 0.7

  // Final score
  const finalScore = Math.round(Math.max(0, Math.min(100, modelSubtotal * statusMult * relMult)))

  // Qualification
  let qualification: string
  if (finalScore >= 75) qualification = 'STRONG'
  else if (finalScore >= 55) qualification = 'WORTH_PURSUING'
  else if (finalScore >= 35) qualification = 'MAYBE'
  else if (finalScore >= 15) qualification = 'LOW'
  else qualification = 'SKIP'

  // Display score
  let displayScore: number
  switch (qualification) {
    case 'STRONG': displayScore = 9; break
    case 'WORTH_PURSUING': displayScore = 7; break
    case 'MAYBE': displayScore = 5; break
    case 'LOW': displayScore = 3; break
    case 'SKIP': displayScore = 2; break
    default: displayScore = Math.round(finalScore / 10)
  }

  // Action
  let action: string
  if (finalScore < 15) action = 'SKIP'
  else if (finalScore >= 70 && buyerRaw >= 0.5) action = 'CONTACT_NOW'
  else if (finalScore >= 50) action = 'CONNECT_WITH_NOTE'
  else if (finalScore >= 35) action = 'CONNECT_WITHOUT_NOTE'
  else action = 'OBSERVE'

  return {
    canonicalScore: finalScore,
    qualification,
    displayScore,
    action,
    buyerRaw,
    externalRaw,
    cpRaw,
    modelSubtotal: Math.round(modelSubtotal),
    statusMult,
    relMult: Math.round(relMult * 100) / 100,
    finalScore,
  }
}

console.log('=== V3 SCORE CALIBRATION — CURRENT WEIGHTS ===')
console.log(`Weights: buyer=${WEIGHTS.buyerRequestProbability} commercial=${WEIGHTS.commercialPotential} fit=${WEIGHTS.fit} timing=${WEIGHTS.timing} access=${WEIGHTS.access}`)
console.log()

const results = GOLDEN_SET.map(lead => ({
  lead,
  score: scoreLead(lead),
}))

// Print results
for (const { lead, score } of results) {
  console.log(`${lead.name}: ${score.finalScore}/100 → ${score.displayScore}/10 (${score.qualification}) | Action: ${score.action}`)
  console.log(`  Buyer: ${score.buyerRaw.toFixed(2)} | CP: ${score.cpRaw.toFixed(2)} | External: ${score.externalRaw.toFixed(2)}`)
  console.log(`  Model: ${score.modelSubtotal} × Status: ${score.statusMult} × Rel: ${score.relMult} = ${score.finalScore}`)
  console.log()
}

// Distribution
const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
for (const { score } of results) {
  const bucket = Math.min(9, Math.floor(score.displayScore))
  buckets[bucket]++
}

console.log('=== DISPLAY DISTRIBUTION (CURRENT) ===')
for (let i = 0; i <= 9; i++) {
  if (buckets[i] > 0) {
    console.log(`  ${i}/10: ${buckets[i]} ${'█'.repeat(buckets[i] * 3)}`)
  }
}

// Check invariants
console.log('\n=== INVARIANT CHECKS ===')
const explicitBuyer = results.find(r => r.lead.name === 'Explicit Buyer')!
const contractor = results.find(r => r.lead.name === 'Explicit Contractor')!
const abdulhakim = results.find(r => r.lead.name === 'Abdulhakim (Active Builder)')!
  const ory = results.find(r => r.lead.name === 'Ory (Founder)')!
  const adir = results.find(r => r.lead.name === 'Adir (Seller)')!
  const jurica = results.find(r => r.lead.name === 'Jurica (Passive)')!
  const recruiter = results.find(r => r.lead.name === 'Recruiter')!

const checks = [
  { name: 'Explicit buyer >= latent founders', pass: canonicalScore(explicitBuyer) >= canonicalScore(abdulhakim) && canonicalScore(explicitBuyer) >= canonicalScore(ory) },
  { name: 'Explicit contractor not LOW', pass: contractor.score.qualification !== 'LOW' && contractor.score.qualification !== 'SKIP' },
  { name: 'Abdulhakim CONNECT (not OBSERVE/SKIP)', pass: abdulhakim.score.action === 'CONNECT_WITH_NOTE' || abdulhakim.score.action === 'CONNECT_WITHOUT_NOTE' },
  { name: 'Adir stays low (seller)', pass: adir.score.displayScore <= 4 },
  { name: 'Jurica stays low-mid (passive)', pass: jurica.score.displayScore <= 5 },
  { name: 'Recruiter stays low (no buyer episode)', pass: recruiter.score.displayScore <= 4 },
]

for (const check of checks) {
  console.log(`  ${check.pass ? '✅' : '❌'} ${check.name}`)
}

function canonicalScore(r: { score: { finalScore: number } }): number {
  return r.score.finalScore
}
