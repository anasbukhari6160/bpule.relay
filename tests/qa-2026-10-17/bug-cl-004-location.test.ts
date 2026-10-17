/** BUG-CL-004 — a stated location is extracted and reaches market-fit scoring. */
import { describe, expect, it } from 'vitest'
import { buildMinimalV2Canonical } from '@/lib/intelligence-v3/bridge'
import { extractStatedLocation } from '@/lib/intelligence-v2/extraction-pipeline'
import { mapLocationToRegion } from '@/lib/leads/targeting-pure'
import { computeScore } from '@/lib/score/rubric'
import { RULEBOOK as DEFAULT_RULEBOOK } from './helpers'
import type { ExtractedLead } from '@/lib/domain/types'

describe('BUG-CL-004 location extraction', () => {
  it('reported: "Location: Austin, Texas, USA" is extracted and scores core-market fit', () => {
    const raw = 'Sarah Lane\nCTO at Fieldnote Apps\nLocation: Austin, Texas, USA\nWe need an agency to rebuild our app.'
    const loc = buildMinimalV2Canonical(raw).intelligence.person.location
    expect(loc).toBe('Austin, Texas, USA')
    expect(mapLocationToRegion(loc)).toBe('US')
    const lead = { name: 'Sarah Lane', title: 'CTO', company: 'Fieldnote Apps', url: null, locationRaw: loc, signalType: 7, signalEvidence: 'x', verbatimQuote: null } as unknown as ExtractedLead
    const fit = computeScore(lead, DEFAULT_RULEBOOK).breakdown.find((r) => r.label === 'Core market fit')!
    expect(fit.points).toBe(2)
  })

  it.each([
    ['Location: Lahore, Pakistan', 'Lahore, Pakistan', 'outside_core'],
    ['Location: London, UK', 'London, UK', 'UK'],
    ['Location: Remote', 'Remote', 'unknown'],
    ['Location: Worldwide', 'Worldwide', 'unknown'],
    ['Job location: EU only', 'EU only', 'unknown'],
    ['Based in: Toronto, Ontario (Hybrid)', 'Toronto, Ontario (Hybrid)', 'CA'],
  ])('%s → %s (%s)', (line, value, region) => {
    const got = extractStatedLocation(`Alex Kim\nEngineering Manager\n${line}\nWe are hiring.`)
    expect(got?.value).toBe(value)
    expect(mapLocationToRegion(got?.value)).toBe(region)
  })

  it('header "City, Country" line in a profile; re-extraction is stable', () => {
    const raw = 'Maya Chen\nFounder at Tidewater\nVancouver, British Columbia, Canada\nAbout\nBuilding tools.'
    expect(buildMinimalV2Canonical(raw).intelligence.person.location).toBe('Vancouver, British Columbia, Canada')
    expect(buildMinimalV2Canonical(raw).intelligence.person.location).toBe(buildMinimalV2Canonical(raw).intelligence.person.location)
  })

  // Independent-review break attempts: header lines that look like "A, B" but aren't places.
  it.each([
    'Jordan Reyes, PhD\nCTO at Acme\nReact, Node, TypeScript\nWe are hiring.',
    'Kim Lee\nProduct, Design, Engineering\nGoogle, Meta, Amazon\nAbout\nBuilder.',
    'Ray Fox\nCTO\nCity: we are flexible, remote ok',
  ])('not a location: %#', (raw) => {
    expect(extractStatedLocation(raw)).toBeNull()
  })

  it('control: no location guessed from schools/HQ/prose; word-boundary regions', () => {
    expect(extractStatedLocation('Jo Park\nCTO at Acme\nStudied at University of London\nWe help companies in Germany, France.')).toBeNull()
    expect(mapLocationToRegion('Milwaukee, Wisconsin')).toBe('unknown')
    expect(mapLocationToRegion('Kyiv, Ukraine')).toBe('unknown')
    expect(mapLocationToRegion('Jerusalem')).toBe('unknown')
  })
})
