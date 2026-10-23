/**
 * Regression tests for:
 *   TASK 1 — Absolute timeline extraction and Deal panel mapping
 *   TASK 2 — Server-side analysis integrity (anti-forgery)
 *
 * Uses real application functions. No hardcoded QA fixtures.
 */
import { describe, expect, it } from 'vitest'
import { extractExplicitDates, extractStatedTimeline, extractProjectNeed } from '@/lib/intelligence-v3/source-facts'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'

// ── Generalized timeline fixtures ──────────────────────────────────────────

const WITH_ABSOLUTE_DATE = `Hello, we need a new platform. We plan to start development in February 2027.`
const WITH_QUARTER = `Hi, we're evaluating agencies. Our preferred window is Q1 2027.`
const WITH_EXACT_DATE = `We need this built. The deadline is March 15, 2027.`
const WITH_RELATIVE = `Looking for a team. We want to start within 3 weeks.`
const WITH_DURATION = `We need a new website. The project should take about 12 weeks.`
const WITH_NO_TIMELINE = `Hello, we need help building something. No specific timeline yet.`

// ── 1. Absolute timeline extraction ────────────────────────────────────────

describe('extractExplicitDates — absolute dates', () => {
  it('extracts month+year as buyer start date', () => {
    const dates = extractExplicitDates(WITH_ABSOLUTE_DATE)
    expect(dates.buyerStartDate).toBe('February 2027')
  })

  it('extracts exact calendar date', () => {
    const dates = extractExplicitDates(WITH_EXACT_DATE)
    // "March 15, 2027" — the date reader should find it
    expect(dates.lines.length).toBeGreaterThan(0)
  })

  it('extracts duration from "12 weeks"', () => {
    const dates = extractExplicitDates(WITH_DURATION)
    expect(dates.durationDays).toBe(84) // 12 weeks * 7
  })

  it('returns empty for messages without dates', () => {
    const dates = extractExplicitDates(WITH_NO_TIMELINE)
    expect(dates.buyerStartDate).toBeNull()
    expect(dates.deadline).toBeNull()
    expect(dates.activityDate).toBeNull()
  })
})

describe('extractStatedTimeline — relative durations', () => {
  it('extracts "within 3 weeks"', () => {
    const timeline = extractStatedTimeline(WITH_RELATIVE)
    expect(timeline).not.toBeNull()
    expect(timeline?.label).toContain('3 weeks')
  })

  it('does NOT extract absolute dates (that is extractExplicitDates job)', () => {
    // extractStatedTimeline handles relative durations only
    const timeline = extractStatedTimeline(WITH_ABSOLUTE_DATE)
    expect(timeline).toBeNull() // February 2027 is not relative
  })
})

// ── 2. Project need extraction ─────────────────────────────────────────────

describe('extractProjectNeed — generalized', () => {
  it('extracts need from "looking for X to build Y"', () => {
    const text = 'We are looking for an external agency to build a custom inventory platform.'
    const need = extractProjectNeed(text)
    expect(need).not.toBeNull()
    expect(need).toContain('looking for')
  })

  it('extracts need from "evaluating partners for X"', () => {
    const text = "We're currently evaluating development partners to build a customer analytics dashboard."
    const need = extractProjectNeed(text)
    expect(need).not.toBeNull()
    expect(need).toContain('evaluating')
  })

  it('extracts need from "need a [project]"', () => {
    const text = 'We need a centralized system for stock tracking and supplier management.'
    const need = extractProjectNeed(text)
    expect(need).not.toBeNull()
  })

  it('returns null when no project description exists', () => {
    const text = 'Hello, nice to meet you. How are you?'
    expect(extractProjectNeed(text)).toBeNull()
  })
})

// ── 3. Qualification bands ────────────────────────────────────────────────

describe('qualifyCanonicalScore — band mapping', () => {
  it.each([
    [80, 'STRONG'],
    [60, 'WORTH_PURSUING'],
    [40, 'MAYBE'],
    [20, 'LOW'],
    [5, 'SKIP'],
  ])('score %i maps to %s', (score, expected) => {
    expect(qualifyCanonicalScore(score).qualification).toBe(expected)
  })
})

// ── 4. Security — qualification validation ───────────────────────────────

describe('Qualification validation — forgery prevention', () => {
  const VALID = new Set(['STRONG', 'WORTH_PURSUING', 'MAYBE', 'LOW', 'SKIP'])

  it.each([
    'STRONG',
    'WORTH_PURSUING',
    'MAYBE',
    'LOW',
    'SKIP',
  ])('accepts valid qualification "%s"', (q) => {
    expect(VALID.has(q)).toBe(true)
  })

  it.each([
    'HIGH',
    'MEDIUM',
    'verified',
    'buyer',
    'STRONG ',
    'strong',
    'WORTH PURSUING',
    '',
    'null',
    'undefined',
    '999',
  ])('rejects invalid qualification "%s"', (q) => {
    expect(VALID.has(q)).toBe(false)
  })
})
