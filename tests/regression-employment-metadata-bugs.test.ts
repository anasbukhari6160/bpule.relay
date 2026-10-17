/**
 * Regression Tests: Employment Metadata vs Buyer Intent Attribution Bugs
 *
 * Protects against three systemic LinkedIn parsing errors:
 * 1. Employment metadata ("Tencyle · Full-time") mistaken for hiring intent
 * 2. Named mutual connections ("X, Y and N other") parsed as "No mutual connections"
 * 3. Industry misattribution (edtech over cybersecurity when both keywords present)
 */

import { describe, it, expect } from 'vitest'
import { detectCommercialRequest, isEmploymentHiringOnly } from '@/lib/intelligence-v3/source-facts'
import { extractSignals } from '@/lib/scoring/signal-extractor'

// ── Bug 1: Employment metadata must NOT trigger hiring detection ──────

describe('employment metadata is not hiring intent', () => {
  const employmentMetadataLines = [
    'Tencyle · Full-time',
    'CEO · Full-time',
    'VP Engineering · Full-time',
    'Director of Engineering · Part-time',
    'Senior Developer · Permanent',
    'Founder · Contract',
    'Acme Corp · Full-time',
    'SomeCompany · Part-time',
  ]

  employmentMetadataLines.forEach((line) => {
    it(`"${line}" is NOT a hiring event`, () => {
      const facts = detectCommercialRequest(line)
      expect(facts.employmentHiring).toBeNull()
      expect(isEmploymentHiringOnly(line)).toBe(false)
    })
  })

  it('employment metadata embedded in longer text is still not hiring', () => {
    const source = `Ory
Co-Founder & CEO at Tencyle
Cybersecurity expert with 10+ years
Tencyle · Full-time
Sharon, Alankrit and 2 other mutual connections`
    const facts = detectCommercialRequest(source)
    expect(facts.employmentHiring).toBeNull()
  })

  it('actual hiring event phrases still trigger employment hiring', () => {
    const hiringEvents = [
      "We're hiring a senior developer",
      'Join our engineering team',
      'Submit your CV to careers@company.com',
      'Open role: backend engineer',
      'We are hiring',
      'Hiring for multiple positions',
    ]
    hiringEvents.forEach((line) => {
      const facts = detectCommercialRequest(line)
      expect(facts.employmentHiring).not.toBeNull()
    })
  })

  it('"Looking for a developer" is a buyer request, not hiring', () => {
    const facts = detectCommercialRequest('Looking for a developer')
    expect(facts.externalServiceRequest).not.toBeNull()
    expect(facts.employmentHiring).toBeNull()
  })

  it('legitimate "full-time" in a hiring context still works', () => {
    const facts = detectCommercialRequest("We're hiring full-time developers")
    expect(facts.employmentHiring).not.toBeNull()
  })

  it('external service request takes precedence over employment metadata', () => {
    const facts = detectCommercialRequest(
      'Tencyle · Full-time\nLooking for a development agency to build our platform'
    )
    expect(facts.externalServiceRequest).not.toBeNull()
    expect(facts.employmentHiring).toBeNull()
  })
})

// ── Bug 2: Mutual connections must parse named format ─────────────────

describe('mutual connections parsing', () => {
  it('parses "X, Y and N other mutual connections"', () => {
    const signals = extractSignals('Sharon, Alankrit and 2 other mutual connections')
    expect(signals.access.mutualConnections).toBe(4)
  })

  it('parses plain "N mutual connections"', () => {
    const signals = extractSignals('5 mutual connections')
    expect(signals.access.mutualConnections).toBe(5)
  })

  it('parses zero other named mutual connections', () => {
    const signals = extractSignals('Sharon and Alankrit and 0 other mutual connections')
    expect(signals.access.mutualConnections).toBe(2)
  })

  it('returns null when no mutual connections present', () => {
    const signals = extractSignals('Some random text with no connection info')
    expect(signals.access.mutualConnections).toBeNull()
  })

  it('canMessage is true when mutual connections found via named format', () => {
    const signals = extractSignals('Sharon, Alankrit and 3 other mutual connections')
    expect(signals.access.canMessage).toBe(true)
  })
})

// ── Bug 3: Industry detection priority ────────────────────────────────

describe('industry detection', () => {
  it('cybersecurity takes priority over edtech when both keywords present', () => {
    const signals = extractSignals(
      'Ory — Co-Founder & CEO at Tencyle\n\nCybersecurity platform for enterprise threat detection.\n\nExperience in security research and training.'
    )
    expect(signals.company.industry).toBe('cybersecurity')
  })

  it('pure cybersecurity profile gets cybersecurity', () => {
    const signals = extractSignals(
      'Ory\nCo-Founder & CEO at Tencyle\n\nBuilt a cybersecurity product. Former CTO at a security startup.'
    )
    expect(signals.company.industry).toBe('cybersecurity')
  })

  it('pure edtech profile gets edtech', () => {
    const signals = extractSignals(
      'Jane\nCEO at LearnTech\n\nBuilding an edtech platform for online education and training.'
    )
    expect(signals.company.industry).toBe('edtech')
  })
})
