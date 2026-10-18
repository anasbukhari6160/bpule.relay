/**
 * Golden Set + Distribution Validation
 */

import { displayScoreFromCanonical } from '../src/lib/scoring/display-score'
import { isCandidateSeeking } from '../src/lib/intelligence-v3/scoring/score-v3'
import { extractCompanyFromHeadline } from '../src/lib/relay/commercial-episodes'

console.log('=== DISPLAY SCORE MAPPING ===')
const displayTests = [
  { canonical: 88, qualification: 'strong', expected: 9 },
  { canonical: 76, qualification: 'worth_pursuing', expected: 7 },
  { canonical: 66, qualification: 'worth_pursuing', expected: 7 },
  { canonical: 56, qualification: 'worth_pursuing', expected: 6 },
  { canonical: 52, qualification: 'maybe', expected: 6 },
  { canonical: 45, qualification: 'maybe', expected: 5 },
  { canonical: 38, qualification: 'maybe', expected: 4 },
  { canonical: 25, qualification: 'low', expected: 3 },
  { canonical: 18, qualification: 'low', expected: 3 },
  { canonical: 10, qualification: 'skip', expected: 2 },
  { canonical: 4, qualification: 'skip', expected: 1 },
]

let displayPass = true
for (const t of displayTests) {
  const result = displayScoreFromCanonical({
    canonicalScore: t.canonical,
    qualification: t.qualification as any,
    intelligenceVersion: 'relay_decision_v3',
  })
  const pass = result === t.expected
  if (!pass) displayPass = false
  console.log(`  ${pass ? '✅' : '❌'} ${t.qualification}(${t.canonical}) → ${result}/10 (expected ${t.expected})`)
}

console.log(`\nDisplay mapping: ${displayPass ? '✅ PASS' : '❌ FAIL'}`)

console.log('\n=== CANDIDATE SEEKING GUARD ===')
const candidateTests = [
  { text: "I'm open to remote, contract and full-time opportunities", expected: true },
  { text: "If you're hiring for React, let's connect", expected: true },
  { text: "I'm looking for my next role", expected: true },
  { text: "We are hiring a Senior React Developer, apply at our careers page", expected: false },
  { text: "Looking for a freelance developer for our project, budget $50k", expected: false },
]

let candidatePass = true
for (const t of candidateTests) {
  const result = isCandidateSeeking(t.text)
  const pass = result === t.expected
  if (!pass) candidatePass = false
  console.log(`  ${pass ? '✅' : '❌'} "${t.text.slice(0, 50)}..." → ${result} (expected ${t.expected})`)
}

console.log(`\nCandidate guard: ${candidatePass ? '✅ PASS' : '❌ FAIL'}`)

console.log('\n=== COMPANY EXTRACTION ===')
const companyTests = [
  { headline: 'Co-Founder & COO @ Docyrus, Inc.', expected: 'Docyrus, Inc.' },
  { headline: 'Founder @ Odana Corp LTD', expected: 'Odana Corp LTD' },
  { headline: 'Engineer at Acme LLC', expected: 'Acme LLC' },
  { headline: 'CTO @ Foo GmbH', expected: 'Foo GmbH' },
  { headline: 'Director @ EGOTECHWORLD (PVT) LTD', expected: 'EGOTECHWORLD (PVT) LTD' },
  { headline: 'Self-employed', expected: null },
]

let companyPass = true
for (const t of companyTests) {
  const result = extractCompanyFromHeadline(t.headline)
  const pass = result === t.expected
  if (!pass) companyPass = false
  console.log(`  ${pass ? '✅' : '❌'} "${t.headline}" → "${result}" (expected: ${t.expected})`)
}

console.log(`\nCompany extraction: ${companyPass ? '✅ PASS' : '❌ FAIL'}`)

console.log('\n=== DISTRIBUTION SIMULATION ===')
// Simulate 20 leads with varying scores
const simulatedScores = [85, 78, 72, 68, 62, 58, 52, 48, 45, 42, 38, 35, 30, 28, 25, 18, 15, 10, 8, 3]
const buckets: Record<number, number> = {}

for (const score of simulatedScores) {
  let qualification: string
  if (score >= 75) qualification = 'strong'
  else if (score >= 55) qualification = 'worth_pursuing'
  else if (score >= 35) qualification = 'maybe'
  else if (score >= 15) qualification = 'low'
  else qualification = 'skip'

  const display = displayScoreFromCanonical({
    canonicalScore: score,
    qualification: qualification as any,
    intelligenceVersion: 'relay_decision_v3',
  })
  buckets[display!] = (buckets[display!] || 0) + 1
}

console.log('Display distribution:')
for (const [score, count] of Object.entries(buckets).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  ${score}/10: ${count} ${'█'.repeat(count * 3)}`)
}

const maxBucket = Math.max(...Object.values(buckets))
const maxPct = (maxBucket / simulatedScores.length) * 100
const at5 = buckets[5] || 0
const at5Pct = (at5 / simulatedScores.length) * 100

console.log(`\n  5/10 dominance: ${at5Pct.toFixed(0)}% ${at5Pct > 35 ? '❌ FAIL (<35%)' : '✅ PASS'}`)
console.log(`  Max bucket: ${maxPct.toFixed(0)}% ${maxPct > 50 ? '❌ FAIL (<50%)' : '✅ PASS'}`)

const allPass = displayPass && candidatePass && companyPass && at5Pct <= 35 && maxPct <= 50
console.log(`\n=== FINAL VERDICT: ${allPass ? '✅ PASS' : '❌ FAIL'} ===`)
