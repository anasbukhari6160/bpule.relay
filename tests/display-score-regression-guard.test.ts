/**
 * Display Score Distribution Regression Guard
 *
 * FAILSAFE: This test prevents accidental reintroduction of score collapse.
 *
 * Run: npx tsx tests/display-score-regression-guard.test.ts
 */

import { displayScoreFromCanonical } from '../src/lib/scoring/display-score'

let failures = 0

// Representative canonical score distribution from production
const PRODUCTION_DISTRIBUTION = [
  // Strong buyers (high canonical)
  88, 82, 78, 75,
  // Worth pursuing (mid-high)
  72, 68, 65, 62, 58, 55,
  // Maybe (mid-range) — the dangerous zone where compression happened
  52, 48, 45, 42, 38, 35,
  // Low (weak fit)
  30, 25, 22, 18, 15,
  // Skip (no fit)
  10, 8, 4, 2, 0,
]

function getQualification(canonicalScore: number): string {
  if (canonicalScore >= 75) return 'strong'
  if (canonicalScore >= 55) return 'worth_pursuing'
  if (canonicalScore >= 35) return 'maybe'
  if (canonicalScore >= 15) return 'low'
  return 'skip'
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.log(`  ❌ ${message}`)
    failures++
  } else {
    console.log(`  ✅ ${message}`)
  }
}

console.log('=== DISPLAY SCORE DISTRIBUTION REGRESSION GUARD ===\n')

// Test 1: No collapse at 5/10
const displays = PRODUCTION_DISTRIBUTION.map(score =>
  displayScoreFromCanonical({
    canonicalScore: score,
    qualification: getQualification(score) as any,
    intelligenceVersion: 'relay_decision_v3',
  })
)
const at5 = displays.filter(d => d === 5).length
const at5Pct = (at5 / displays.length) * 100
console.log(`Test 1: 5/10 collapse`)
assert(at5Pct <= 35, `5/10 dominance ${at5Pct.toFixed(0)}% ≤ 35%`)

// Test 2: No bucket >50%
const buckets = new Map<number, number>()
for (const d of displays) buckets.set(d!, (buckets.get(d!) ?? 0) + 1)
const maxBucket = Math.max(...buckets.values())
const maxPct = (maxBucket / displays.length) * 100
console.log(`\nTest 2: Max bucket dominance`)
assert(maxPct <= 50, `Max bucket ${maxPct.toFixed(0)}% ≤ 50%`)

// Test 3: Within-band resolution
const maybe35 = displayScoreFromCanonical({
  canonicalScore: 36, qualification: 'maybe' as any, intelligenceVersion: 'relay_decision_v3',
})
const maybe54 = displayScoreFromCanonical({
  canonicalScore: 54, qualification: 'maybe' as any, intelligenceVersion: 'relay_decision_v3',
})
console.log(`\nTest 3: Within-band resolution`)
assert(maybe35 !== maybe54, `MAYBE 36(${maybe35}) ≠ MAYBE 54(${maybe54})`)
assert(maybe35! >= 4, `MAYBE 36 ≥ 4 (got ${maybe35})`)
assert(maybe54! <= 6, `MAYBE 54 ≤ 6 (got ${maybe54})`)

// Test 4: Monotonic qualification mapping
console.log(`\nTest 4: Monotonic mapping`)
const skip = displayScoreFromCanonical({ canonicalScore: 5, qualification: 'skip' as any, intelligenceVersion: 'relay_decision_v3' })
const low = displayScoreFromCanonical({ canonicalScore: 25, qualification: 'low' as any, intelligenceVersion: 'relay_decision_v3' })
const maybe = displayScoreFromCanonical({ canonicalScore: 45, qualification: 'maybe' as any, intelligenceVersion: 'relay_decision_v3' })
const worthPursuing = displayScoreFromCanonical({ canonicalScore: 65, qualification: 'worth_pursuing' as any, intelligenceVersion: 'relay_decision_v3' })
const strong = displayScoreFromCanonical({ canonicalScore: 85, qualification: 'strong' as any, intelligenceVersion: 'relay_decision_v3' })

assert(skip! <= 2, `SKIP ≤ 2 (got ${skip})`)
assert(low! >= 2 && low! <= 3, `LOW 2-3 (got ${low})`)
assert(maybe! >= 4 && maybe! <= 6, `MAYBE 4-6 (got ${maybe})`)
assert(worthPursuing! >= 6 && worthPursuing! <= 7, `WORTH_PURSUING 6-7 (got ${worthPursuing})`)
assert(strong! >= 8 && strong! <= 10, `STRONG 8-10 (got ${strong})`)

// Test 5: Never zero
console.log(`\nTest 5: No zero scores`)
let zeroFound = false
for (let s = 0; s <= 100; s++) {
  const r = displayScoreFromCanonical({ canonicalScore: s, qualification: getQualification(s) as any, intelligenceVersion: 'relay_decision_v3' })
  if (r === 0 || r === null) { zeroFound = true; break }
}
assert(!zeroFound, `No score maps to 0 or null`)

console.log(`\n${failures === 0 ? '✅ PASS' : '❌ FAIL'} — ${failures} failures`)
if (failures > 0) process.exit(1)
