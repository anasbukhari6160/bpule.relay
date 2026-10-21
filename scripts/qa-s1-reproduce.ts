/**
 * Reproduce QA S1 bugs from the 21 Oct report.
 * Run: npx tsx scripts/qa-s1-reproduce.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([\w.-]+)=(.*)/)
    if (match) process.env[match[1]] = match[2].trim()
  }
} catch {}

import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { resolveVerifiedBuyerIntent } from '@/lib/intelligence-v3/buyer-intent'
import { classifyLine, detectSellerOwnership } from '@/lib/intelligence-v3/source-facts'

// Reconstructed from QA report descriptions
const FIXTURES = {
  hannahBlake: `Hannah Blake
· 2nd

CEO at NorthPeak Logistics

Chicago, Illinois, United States

About
I lead operations at NorthPeak Logistics.

We need a software development agency to rebuild our TMS. We have $45,000 approved for the project and plan to start in November 2026. The build should take about 8 weeks.

Contact info`,

  emmaCollins: `Emma Collins
· 1st

Founder at BrightPath Education

Austin, Texas, United States

About
I'm the founder of BrightPath Education.

We're looking for a SaaS development agency to build our student platform. $35,000 budget approved. Start in November. 8 week project.

Contact info`,

  ethanCole: `Ethan Cole
· 3rd

Head of Engineering at CloudNine Systems

July 2026
Looking for an agency to help migrate our infrastructure. Budget is available.

October 2026
We selected a partner and the project is complete. Please do not contact us with agency offers.`,

  oliviaBennett: `Olivia Bennett
· 2nd

Product Manager at FinEdge

About
Looking for a development team to help build our new dashboard. Budget approved for Q4.`,

  danielBrooks: `Daniel Brooks
· 1st

Freelance Full Stack Developer

I'm a freelance developer. Contact me if your company needs a developer.
Looking for React and Node projects.`,

  sellerOffer: `Daniel Brooks
Freelance Full Stack Developer
Contact me if your company needs a developer.`,
}

for (const [name, raw] of Object.entries(FIXTURES)) {
  console.log(`\n=== ${name} ===`)
  const facts = readSourceFacts(raw)
  const seller = detectSellerOwnership(raw)
  const intent = resolveVerifiedBuyerIntent(facts.buyer, {
    modelBuyerProbability: 0.2,
    modelExternalNeedProbability: 0.2,
    modelRelationship: 'BUYER',
    signalCheck: {
      explicitAsk: facts.signals.intent.explicitAsk,
      seekingVendor: facts.signals.intent.seekingVendor,
      hiring: facts.signals.intent.hiring,
      budgetMentioned: facts.signals.intent.budgetMentioned,
    },
  })

  console.log('  buyerRequest:', facts.buyerRequest)
  console.log('  employmentHiring:', facts.currentHiringActivity)
  console.log('  sellerActivity:', facts.sellerActivity, seller.lines.slice(0, 2))
  console.log('  recruiter:', facts.recruiterProfile)
  console.log('  budget:', facts.budgetEvidence?.amount ?? null)
  console.log('  buyerIntentLevel:', intent.buyerIntentLevel)
  console.log('  verifiedBuyerRequest:', intent.verifiedBuyerRequest)
  console.log('  relationshipRole:', intent.relationshipRole)
  console.log('  effectiveProb:', intent.effectiveBuyerProbability)
  console.log('  contradictions:', intent.contradictions)
}
