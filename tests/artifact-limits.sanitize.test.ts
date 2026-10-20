import { describe, it, expect } from 'vitest'
import { sanitizeDraft } from '@/lib/facts/sanitize'
import { enforceArtifactLimit, countFor } from '@/lib/relay/artifact-limits'
import { evaluateMessage, stageForChannel } from '@/lib/relay/message-forge'

describe('Bug 3: emoji stripping in sanitizeDraft', () => {
  it('strips emojis and reports hadEmoji', () => {
    const input = 'Now Hiring: Talent Acquisition Specialist! 💼✨ We are scaling.'
    const out = sanitizeDraft(input, [])
    expect(out.hadEmoji).toBe(true)
    expect(out.text).not.toContain('💼')
    expect(out.text).not.toContain('✨')
    expect(out.text).toContain('Now Hiring: Talent Acquisition Specialist')
  })

  it('hadEmoji is false for clean text', () => {
    const out = sanitizeDraft('No emoji in this draft at all.', [])
    expect(out.hadEmoji).toBe(false)
  })
})

describe('Bug 4: shared per-type limits', () => {
  it('hard-cap truncates over-limit text and marks it', () => {
    const longDM = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const capped = enforceArtifactLimit(longDM, 'dm')
    expect(capped.truncated).toBe(true)
    expect(countFor('words', capped.text)).toBeLessThanOrEqual(55)
  })

  it('leaves within-limit text untouched', () => {
    const fine = 'Just a short hello note for the lead.'
    const capped = enforceArtifactLimit(fine, 'dm')
    expect(capped.truncated).toBe(false)
    expect(capped.text).toBe(fine)
  })
})

describe('Bug 4: evaluateMessage enforces all five types', () => {
  it('rejects an over-length DM', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    const r = evaluateMessage(long, null, 'dm')
    expect(r.passed).toBe(false)
    expect(r.reasons.some((x) => x.includes('dm'))).toBe(true)
  })

  it('rejects an over-length upwork letter (was unchecked)', () => {
    const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
    const r = evaluateMessage(long, null, 'upwork')
    expect(r.passed).toBe(false)
    expect(r.reasons.some((x) => x.includes('upwork'))).toBe(true)
  })

  it('rejects an over-length follow-up (was unchecked)', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    const r = evaluateMessage(long, null, 'followup')
    expect(r.passed).toBe(false)
    expect(r.reasons.some((x) => x.includes('followup'))).toBe(true)
  })

  it('rejects an over-length reply (was unchecked)', () => {
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ')
    const r = evaluateMessage(long, null, 'reply')
    expect(r.passed).toBe(false)
    expect(r.reasons.some((x) => x.includes('reply'))).toBe(true)
  })

  it('accepts within-limit drafts across types', () => {
    // Each channel is judged by its own stage gates: a first DM must be at
    // least 40 chars, a connection note at least 15.
    const dm = 'Hey Sarah, is the Rails migration at Nomadz still the live constraint this quarter?'
    expect(evaluateMessage(dm, null, 'dm').passed).toBe(true)
    expect(evaluateMessage('Hi Sarah, the Rails work at Nomadz stood out.', null, 'connection').passed).toBe(true)
    expect(evaluateMessage(dm, null, 'upwork').passed).toBe(true)
    expect(evaluateMessage('Short note.', null, 'followup').passed).toBe(true)
    expect(evaluateMessage('Short note.', null, 'reply').passed).toBe(true)
  })

  it('maps each channel to its message stage when no stage is given', () => {
    expect(stageForChannel('dm')).toBe('first_dm')
    expect(stageForChannel('upwork')).toBe('first_dm')
    expect(stageForChannel('connection')).toBe('connection')
    expect(stageForChannel('followup')).toBe('follow_up')
    expect(stageForChannel('reply')).toBe('reply')

    // The inferred stage shows up as the prefix on stage-gate failures.
    expect(evaluateMessage('Hi', null, 'dm').reasons.some((r) => r.startsWith('[first_dm]'))).toBe(true)
    expect(evaluateMessage('Hi', null, 'connection').reasons.some((r) => r.startsWith('[connection]'))).toBe(true)
    expect(evaluateMessage('Just following up on my last note here.', null, 'followup').reasons.some((r) => r.startsWith('[follow_up]'))).toBe(true)
    expect(evaluateMessage('Hi', null, 'reply').reasons.some((r) => r.startsWith('[reply]'))).toBe(true)

    // An explicit stage still wins over the channel.
    expect(evaluateMessage('Hi', null, 'dm', 'reply').reasons.some((r) => r.startsWith('[reply]'))).toBe(true)
  })
})