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
    // Milwaukee is not the UK; Wisconsin is a US state.
    expect(mapLocationToRegion('Milwaukee, Wisconsin')).toBe('US')
    // Ukraine is not the UK; it is outside the core markets.
    expect(mapLocationToRegion('Kyiv, Ukraine')).toBe('outside_core')
    expect(mapLocationToRegion('Jerusalem')).toBe('unknown')
  })
})

// Fourth review: metro areas and US states are places; lists of countries and team names are not.
describe('BUG-CL-004 header location shapes', () => {
  it.each([
    ['Dana Fox\nCTO at Lumen Apps\nSan Francisco Bay Area', 'San Francisco Bay Area', 'US'],
    ['Dana Fox\nCTO at Lumen Apps\nGreater London Area', 'Greater London Area', 'UK'],
    ['Dana Fox\nCTO at Lumen Apps\nAtlanta, Georgia', 'Atlanta, Georgia', 'US'],
    ['Dana Fox\nCTO at Lumen Apps\nLondon, Ontario, Canada', 'London, Ontario, Canada', 'CA'],
    ['Dana Fox\nCTO at Lumen Apps\nTbilisi, Georgia', 'Tbilisi, Georgia', 'outside_core'],
  ])('%s → %s', (raw, value, region) => {
    expect(extractStatedLocation(raw)?.value).toBe(value)
    expect(mapLocationToRegion(value)).toBe(region)
  })

  it.each([
    'Dana Fox\nSports fan\nWashington Commanders, Texas Rangers',
    'Dana Fox\nDelivery lead\nIndia, Germany, UK',
    'Dana Fox\nCTO at Lumen Apps\nReact, Node, TypeScript',
  ])('not a location: %s', (raw) => {
    expect(extractStatedLocation(raw)).toBeNull()
  })
})
