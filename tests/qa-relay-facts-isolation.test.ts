/**
 * QA open observation — test-data isolation in the facts guard.
 *
 * The approved library contained facts labelled (FAKE) and a raw internal JSON
 * project proof. Their numbers must never be approved in a production draft.
 */
import { describe, expect, it } from 'vitest'
import { isTestFact, stripUnauthorizedNumbers } from '@/lib/facts/sanitize'

describe('facts guard — test-data isolation', () => {
  it('flags labelled FAKE facts as test data', () => {
    expect(isTestFact({ label: 'Years shipping (FAKE)', value: '8 years' })).toBe(true)
    expect(isTestFact({ label: 'Review pace (FAKE)', value: 'first plan in 10 days' })).toBe(true)
  })

  it('flags a raw internal JSON proof as test data', () => {
    expect(isTestFact({
      label: 'Project proof - DeepIDV',
      value: '{"fetch_status":"fetched","permission_to_name_publicly":"not_asked"}',
    })).toBe(true)
  })

  it('does not flag a real approved fact', () => {
    expect(isTestFact({ label: 'Years shipping', value: '8 years' })).toBe(false)
    expect(isTestFact({ label: 'Client work', value: '12 projects for 3 clients' })).toBe(false)
  })

  it('does not let a FAKE fact approve a number in a draft', () => {
    const facts = [
      { label: 'Years shipping (FAKE)', value: '8 years' },
      { label: 'Real client work', value: '12 projects' },
    ] as never
    const { text } = stripUnauthorizedNumbers('We shipped in 8 years and 12 projects.', facts)
    expect(text).not.toContain('8 years')
    expect(text).toContain('12')
  })
})
