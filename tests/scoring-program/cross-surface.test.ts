/**
 * Cross-surface consistency (Phase 40): every surface derives score,
 * qualification, display, verdict and priority from the same functions, so
 * one lead cannot read 4/10 on detail, 5/10 on the pipeline and 7/10 in
 * admin. 20+ cases, plus a source-level guard against new local thresholds.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getLeadDisplayScore } from '@/lib/scoring/display-score'
import { qualifyCanonicalScore, displayScoreForCanonical, verdictForQualification, priorityForCanonicalScore, qualificationLabel, toStoredQualification, qualificationForDisplayValue } from '@/lib/scoring/qualification'
import { scoreBandOf } from '@/lib/analytics/pipeline-analytics'
import { v3PacketToCanonical, buildMinimalV2Canonical } from '@/lib/intelligence-v3/bridge'
import { runOffline } from '../helpers/score-source'
import { GOLDEN_SET } from '../golden/fixtures'

const SCORES = [0, 5, 14, 15, 22, 34, 35, 40, 44, 45, 50, 54, 55, 60, 64, 65, 70, 74, 75, 80, 82, 83, 90, 91, 92, 100]

describe('one lead, one number, everywhere', () => {
  for (const s of SCORES) {
    it(`canonical ${s}: detail, list row, JSON-string blob, analytics band and priority agree`, () => {
      const band = qualifyCanonicalScore(s)
      const detail = getLeadDisplayScore({ canonicalScore: s, canonicalIntelligence: { qualification: toStoredQualification(band.qualification), intelligenceVersion: 'relay_decision_v3.2.0' } })
      const listRow = getLeadDisplayScore({ canonicalScore: s, displayQualification: toStoredQualification(band.qualification), displayIntelligenceVersion: 'relay_decision_v3.2.0' })
      const jsonBlob = getLeadDisplayScore({ canonicalScore: s, canonicalIntelligence: JSON.stringify({ qualification: 'maybe' }) })
      const noBlob = getLeadDisplayScore({ canonicalScore: s })
      for (const d of [detail, listRow, jsonBlob, noBlob]) {
        expect(d.value).toBe(displayScoreForCanonical(s))
        expect(d.qualification).toBe(band.qualification)
        expect(d.label).toBe(band.label)
      }
      expect(scoreBandOf({ canonicalScore: s } as never)).toBe(toStoredQualification(band.qualification))
      expect(qualificationForDisplayValue(displayScoreForCanonical(s))).toBe(band.qualification)
      expect(verdictForQualification(band.qualification)).toBe(verdictForQualification(toStoredQualification(band.qualification)))
      expect(['urgent', 'high', 'medium', 'low']).toContain(priorityForCanonicalScore(s))
      expect(qualificationLabel(toStoredQualification(band.qualification))).toBe(band.label)
    })
  }

  it('a stale stored qualification never changes the number or band shown', () => {
    const d = getLeadDisplayScore({ canonicalScore: 80, displayQualification: 'skip' })
    expect(d.value).toBe(displayScoreForCanonical(80))
    expect(d.qualification).toBe('STRONG')
    expect(d.staleQualification).toBe(true)
  })

  it('the analysis response, the saved canonical blob and the lead row show the same score for a golden buyer', async () => {
    const f = GOLDEN_SET.find((x) => x.id === 'buyer-agency-react-budget-deadline')!
    const packet = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: new Date('2026-10-20T00:00:00Z') })
    const canonical = v3PacketToCanonical(packet, buildMinimalV2Canonical(f.rawText))
    const analysisDisplay = displayScoreForCanonical(packet.score)
    const row = getLeadDisplayScore({ canonicalScore: canonical.canonicalScore, canonicalIntelligence: canonical })
    expect(row.value).toBe(analysisDisplay)
    expect(row.qualification).toBe(packet.qualification)
    expect(toStoredQualification(packet.qualification)).toBe(canonical.qualification)
  })
})

describe('no surface keeps its own canonical-score thresholds', () => {
  // Any `canonicalScore >= <number>` / `canonical_score >= <number>` comparison
  // outside the qualification module is a second band table. New ones fail here.
  const ALLOWED = new Set([
    'src/lib/scoring/qualification.ts',
  ])
  const PATTERN = /\b(?:canonical_?[sS]core|opportunityScore|coldScore)\b[^\n]{0,40}?(?:>=|<=|>|<)\s*(?:[1-9]\d)\b/

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(p)
    }
    return out
  }

  it('src/ has no local canonical-score cut-offs', () => {
    const root = join(process.cwd(), 'src')
    const offenders: string[] = []
    for (const file of walk(root)) {
      const rel = file.slice(process.cwd().length + 1)
      if (ALLOWED.has(rel)) continue
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (PATTERN.test(line) && !/qualifyCanonicalScore|priorityForCanonicalScore|QUALIFICATION_BANDS|WATCH_MIN_SCORE|minScore/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders, `local thresholds found:\n${offenders.join('\n')}`).toEqual([])
  })
})
