/** BUG-CL-001 — one validation message, decided before any request. */
import { describe, expect, it } from 'vitest'
import { pasteGuard } from '@/lib/prospect/paste-guard'

describe('BUG-CL-001 paste validation', () => {
  it('reported: empty research → exactly one message', () => {
    expect(pasteGuard('', 'Paste some raw research first.')).toBe('Paste some raw research first.')
  })
  it.each([
    ['   \n\n  ', 'Paste some raw research first.'],
    ['https://linkedin.com/in/someone', /just a URL/],
    ['too short', /too short/],
  ])('%j → single message', (raw, expected) => {
    const m = pasteGuard(raw, 'Paste some raw research first.')
    expect(typeof m).toBe('string')
    if (expected instanceof RegExp) expect(m).toMatch(expected); else expect(m).toBe(expected)
  })
  it('control: a real paste passes', () => {
    expect(pasteGuard('Jane Doe\nCTO at Acme\nWe are looking for an agency to rebuild our app.')).toBeNull()
  })
})
