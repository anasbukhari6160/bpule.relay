/**
 * RELAY — P0 data integrity: stable opportunity key + dedupe.
 *
 * The key must be stable across whitespace and LinkedIn UI chrome so a lead and
 * the captured prospect it came from collapse to one opportunity.
 */
import { describe, expect, it } from 'vitest'
import { opportunityKey } from '@/lib/scoring-v4/opportunity-key'

const PROFILE = `Hannah Blake
· 2nd

CEO at NorthPeak Logistics

Chicago, Illinois, United States

About
I lead operations at NorthPeak Logistics.

We need a software development agency to rebuild our TMS. We have $45,000 approved for the project and plan to start in November 2026. The build should take about 8 weeks.

Contact info`

describe('opportunityKey — one canonical key', () => {
  it('is stable across whitespace changes', () => {
    const a = opportunityKey(PROFILE)
    const b = opportunityKey(PROFILE.replace(/\n/g, '\n\n').replace(/  +/g, '  '))
    expect(a).toBeTruthy()
    expect(b).toBe(a)
  })

  it('is stable across LinkedIn UI chrome', () => {
    const withChrome = `${PROFILE}\n\n500+ connections\nMessage\nFollow\nMore`
    expect(opportunityKey(withChrome)).toBe(opportunityKey(PROFILE))
  })

  it('is the same for a lead and the prospect it was saved from', () => {
    expect(opportunityKey(PROFILE)).toBe(opportunityKey(PROFILE))
  })

  it('differs for a different person/company', () => {
    const other = PROFILE.replace('NorthPeak Logistics', 'Acme Corp').replace('Hannah Blake', 'John Doe')
    expect(opportunityKey(other)).not.toBe(opportunityKey(PROFILE))
  })

  it('returns null for a source too short to identify', () => {
    expect(opportunityKey('Hi')).toBeNull()
    expect(opportunityKey(null)).toBeNull()
  })
})

describe('Scoring QA dedupe — latest decision per opportunity', () => {
  function dedupe<T extends { opportunityKey: string | null; createdAt: string; id: string }>(rows: T[]): T[] {
    const seen = new Set<string>()
    const out: T[] = []
    for (const r of rows) {
      const k = r.opportunityKey ?? r.id
      if (seen.has(k)) continue
      seen.add(k)
      out.push(r)
    }
    return out
  }

  it('counts 3 analyses of one opportunity as 1 in the latest view', () => {
    const rows = [
      { id: 'a', opportunityKey: 'k1', createdAt: '2026-10-21T10:00:00Z' },
      { id: 'b', opportunityKey: 'k1', createdAt: '2026-10-21T11:00:00Z' },
      { id: 'c', opportunityKey: 'k1', createdAt: '2026-10-21T12:00:00Z' },
      { id: 'd', opportunityKey: 'k2', createdAt: '2026-10-21T12:00:00Z' },
    ]
    // Newest first, as loadRecentDecisions returns them.
    const latest = dedupe([...rows].reverse())
    expect(latest).toHaveLength(2)
    expect(latest[0].id).toBe('d') // k2, newest
    expect(latest[1].id).toBe('c') // k1, newest (a and b are history)
  })

  it('keeps history when latestOnly is false', () => {
    const rows = [
      { id: 'a', opportunityKey: 'k1', createdAt: '2026-10-21T10:00:00Z' },
      { id: 'b', opportunityKey: 'k1', createdAt: '2026-10-21T11:00:00Z' },
    ]
    expect(dedupe(rows)).toHaveLength(1)
    expect(rows).toHaveLength(2) // history preserved
  })
})
