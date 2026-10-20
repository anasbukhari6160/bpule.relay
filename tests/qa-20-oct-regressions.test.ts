import { describe, it, expect } from 'vitest'
import { sanitizePersonName, sanitizePersonTitle } from '@/lib/intelligence-v2/extraction-pipeline'
import { hasUnfilledValues } from '@/lib/relay/message-forge'
import { mostRecentPostAgeDays } from '@/lib/intelligence-v3/source-facts-model'

// Regressions from the 20 Oct 2026 manual QA report (REL-QA-005, -011, -018, -019).

describe('REL-QA-018: inbox contact fields never hold a greeting or a sentence fragment', () => {
  it('drops a greeting used as a name', () => {
    expect(sanitizePersonName('Hi,')).toBeNull()
    expect(sanitizePersonName('Hello')).toBeNull()
    expect(sanitizePersonName('Hi there')).toBeNull()
  })

  it('keeps a real name', () => {
    expect(sanitizePersonName('Jonas Weber')).toBe('Jonas Weber')
    expect(sanitizePersonName('Ephraim (Effy) Gittler')).toBe('Ephraim (Effy) Gittler')
    expect(sanitizePersonName('Katrin Vogel,')).toBe('Katrin Vogel')
  })

  it('reduces a first-person fragment to the role it names', () => {
    expect(sanitizePersonTitle("I'm a freelance React developer with")).toBe('Freelance React Developer')
    expect(sanitizePersonTitle("Hi, I'm a freelance React developer with 6 years")).toBe('Freelance React Developer')
  })

  it('keeps a headline title', () => {
    expect(sanitizePersonTitle('CTO at Fenwick Pay')).toBe('CTO at Fenwick Pay')
    expect(sanitizePersonTitle('Geschäftsführerin')).toBe('Geschäftsführerin')
  })
})

describe('REL-QA-011: a draft with unfilled values fails the quality gate', () => {
  it('flags a missing number before a unit and an empty separator', () => {
    expect(hasUnfilledValues("Hey Felix, I see you're offering a -month free trial with / support.")).toBe(true)
  })
  it('flags template tokens', () => {
    expect(hasUnfilledValues('Hi {{first_name}}, saw your post')).toBe(true)
    expect(hasUnfilledValues('Hi [Name], saw your post')).toBe(true)
  })
  it('passes a complete note', () => {
    expect(hasUnfilledValues("Hey Felix, I see you're offering a 3-month free trial with 24/7 support.")).toBe(false)
    expect(hasUnfilledValues('Saw you are rebuilding onboarding in Next.js. Happy to compare notes.')).toBe(false)
  })
})

describe('REL-QA-005: German relative ages are read as activity dates', () => {
  it('reads "vor 5 Tagen" and "5 Tage •"', () => {
    expect(mostRecentPostAgeDays('Katrin Vogel\nGeschäftsführerin\nvor 5 Tagen\nWir suchen eine Agentur.')).toBe(5)
    expect(mostRecentPostAgeDays('Katrin Vogel • 5 Tage •\nWir suchen eine Agentur.')).toBe(5)
  })
  it('does not read a tenure duration inside prose as an activity date', () => {
    expect(mostRecentPostAgeDays('Seit 2 Jahre 3 Monate bei Nordlicht GmbH tätig und zufrieden.')).toBeNull()
  })
})
