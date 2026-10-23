/**
 * Regression tests for buyer-intent classification on inbound messages.
 *
 * Covers delegated-buyer authority and external-partner evaluation
 * without weakening canonical buying rules or hardcoding QA fixtures.
 */
import { describe, expect, it } from 'vitest'
import { classifyLine, detectCommercialRequest } from '@/lib/intelligence-v3/source-facts'

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Delegated buyer: Jonathan was assigned to find an agency. */
const JONATHAN = [
  'Jonathan Reed',
  'Product Manager',
  'ScaleNova Technologies',
  '',
  'Our CEO approved a $120,000 project budget.',
  'We need an enterprise SaaS platform.',
  'Jonathan was assigned to find an external development agency.',
  'The CTO will review proposals.',
  'The project is planned to start next month.',
].join('\n')

/** External partner evaluation: Rebecca is evaluating development partners. */
const REBECCA = [
  'Good afternoon,',
  '',
  'This is Rebecca Morgan from NovaBridge Analytics.',
  '',
  "We're currently evaluating external software development agencies to build a customer analytics dashboard.",
  '',
  'Our management has approved spending up to $75,000.',
  '',
  'Our preferred delivery window is Q1 2027.',
  '',
  'We would like to understand your development capabilities.',
  '',
  'Kind regards,',
  'Rebecca',
  'Engineering Director',
].join('\n')

/** Negative control: Marcus is a seller offering services. */
const MARCUS = [
  'Hi,',
  '',
  'My name is Marcus Bennett.',
  "I'm a Business Development Manager at DevCore Solutions.",
  'We offer software development services and are looking for new clients.',
  '',
  'Best,',
  'Marcus',
].join('\n')

// ── 1. Delegated buyer detection ────────────────────────────────────────

describe('Delegated buyer — Jonathan', () => {
  it('classifies the "assigned to find an external development agency" line as external_request', () => {
    const line = 'Jonathan was assigned to find an external development agency.'
    expect(classifyLine(line)).toBe('external_request')
  })

  it('detects an external service request in the full message', () => {
    const result = detectCommercialRequest(JONATHAN)
    expect(result.externalServiceRequest).not.toBeNull()
  })

  it('does NOT classify the budget line as external_request (it is a budget fact)', () => {
    const line = 'Our CEO approved a $120,000 project budget.'
    // Budget line may be neutral or employment_hiring but NOT external_request
    expect(classifyLine(line)).not.toBe('external_request')
  })
})

// ── 2. External partner evaluation ──────────────────────────────────────

describe('External partner evaluation — Rebecca', () => {
  it('classifies the "evaluating development agencies" line as external_request', () => {
    const line = "We're currently evaluating external software development agencies to build a customer analytics dashboard."
    expect(classifyLine(line)).toBe('external_request')
  })

  it('detects an external service request in the full message', () => {
    const result = detectCommercialRequest(REBECCA)
    expect(result.externalServiceRequest).not.toBeNull()
  })
})

// ── 3. Seller negative control ─────────────────────────────────────────

describe('Seller negative control — Marcus', () => {
  it('does NOT classify the seller offering as external_request', () => {
    const line = 'We offer software development services and are looking for new clients.'
    expect(classifyLine(line)).not.toBe('external_request')
  })

  it('detects NO external service request in the seller message', () => {
    const result = detectCommercialRequest(MARCUS)
    expect(result.externalServiceRequest).toBeNull()
  })
})

// ── 4. Generalized procurement verbs ────────────────────────────────────

describe('Generalized procurement verb recognition', () => {
  it.each([
    'We are evaluating external development partners.',
    'We are assessing several agencies for this project.',
    'We are considering outsourcing the build.',
    'We are reviewing potential development vendors.',
    'We are sourcing an external engineering team.',
    'We need to find a development agency.',
  ])('classifies "%s" as external_request', (line) => {
    expect(classifyLine(line)).toBe('external_request')
  })

  it.each([
    'I am a freelance developer looking for clients.',
    'We offer development services to companies.',
    'Our team builds software for startups.',
    'Hire me for your next project.',
  ])('does NOT classify seller line "%s" as external_request', (line) => {
    expect(classifyLine(line)).not.toBe('external_request')
  })
})
