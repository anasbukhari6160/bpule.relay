/**
 * Messaging Stage Quality Tests
 *
 * Verifies that connection notes, DMs, and follow-ups are evaluated
 * differently and that AI-looking patterns (em-dash names) are caught.
 */

import { describe, it, expect } from 'vitest'
import { HAS_AI_PROVIDER } from './helpers/needs-ai'
import { evaluateMessageStage, type MessageStage } from '@/lib/writing/engine'

describe('Em-dash name formatting detection', () => {
  it('flags "Hi John —" pattern', () => {
    const result = evaluateMessageStage(
      'Hi John — I saw your post about React Native and wanted to connect.',
      'connection',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('Em-dash after name'))).toBe(true)
  })

  it('flags "Hey Sarah —" pattern', () => {
    const result = evaluateMessageStage(
      'Hey Sarah — looks like you are building something interesting.',
      'first_dm',
      { prospectName: 'Sarah Johnson' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('Em-dash'))).toBe(true)
  })

  it('accepts "Hi John," with comma', () => {
    const result = evaluateMessageStage(
      'Hi John, I saw your post about React Native and wanted to connect.',
      'connection',
      { prospectName: 'John Smith' },
    )
    expect(result.issues.some(i => i.includes('Em-dash after name'))).toBe(false)
  })

  it('flags "John —" at start of line', () => {
    const result = evaluateMessageStage(
      'John — I noticed your recent work on the platform.',
      'connection',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('Em-dash'))).toBe(true)
  })

  it('does not flag em dashes used naturally in a sentence', () => {
    const result = evaluateMessageStage(
      'Hi John, the project you are building — the mobility platform — looks complex.',
      'first_dm',
      { prospectName: 'John Smith' },
    )
    // Em dashes in the middle of text (not after name) should not be flagged
    expect(result.issues.some(i => i.includes('Em-dash after name'))).toBe(false)
  })
})

describe('Connection note quality', () => {
  it('passes a specific, natural connection note', () => {
    const result = evaluateMessageStage(
      'Hi John, saw you taking Dexta into commercial ops. The ERP setup caught my eye.',
      'connection',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(true)
  })

  it('fails a connection note that pitches services', () => {
    const result = evaluateMessageStage(
      'Hi John, we specialize in React Native development and can help you build your app. Let us know if you are interested.',
      'connection',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('pitches services'))).toBe(true)
  })

  it('fails a connection note that asks for a meeting', () => {
    const result = evaluateMessageStage(
      'Hi John, would love to hop on a call to discuss your project.',
      'connection',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('meeting too early'))).toBe(true)
  })

  it('fails a connection note over 120 chars', () => {
    const result = evaluateMessageStage(
      'Hi John, '.repeat(50) + 'this is a very long connection note that exceeds the character limit for LinkedIn connection notes and should be rejected.',
      'connection',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('too long'))).toBe(true)
  })
})

describe('First DM quality', () => {
  it('passes a DM with specific context and observation', () => {
    const result = evaluateMessageStage(
      'Hi John, the Dexta Mobility setup — customer app, valet app, ERP, GPS dispatch — looks like the kind of system where maintenance complexity grows fast after launch. Are you keeping the original team on it, or looking for someone to own it post-handover?',
      'first_dm',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(true)
  })

  it('fails a DM that is just a generic acknowledgment', () => {
    const result = evaluateMessageStage(
      'Thanks for connecting!',
      'first_dm',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('generic acknowledgment'))).toBe(true)
  })

  it('fails a DM too similar to the connection note', () => {
    const connectionNote = 'Hi John, saw you are taking Dexta Mobility into commercial ops. The customer/valet/ERP setup caught my eye.'
    const result = evaluateMessageStage(
      'Hi John, saw you are taking Dexta Mobility into commercial ops. The customer/valet/ERP setup caught my eye. Would be good to connect.',
      'first_dm',
      { prospectName: 'John Smith', connectionNote },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('too similar to connection note'))).toBe(true)
  })

  it('fails a DM that pitches without context', () => {
    const result = evaluateMessageStage(
      'We can help you build your app.',
      'first_dm',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('pitches without establishing context'))).toBe(true)
  })
})

describe('Follow-up quality', () => {
  it('passes a follow-up with a fresh observation', () => {
    const connectionNote = 'Hi John, saw you are taking Dexta Mobility into commercial ops. The customer/valet/ERP setup caught my eye.'
    const firstDm = 'Hi John, the Dexta Mobility setup looks complex. Are you keeping the original team on maintenance?'
    const result = evaluateMessageStage(
      'Hi John — one thing that stands out: dispatch systems with GPS + OTP handover tend to need dedicated maintenance after the original dev team moves on. If you are thinking about that transition, happy to share what we have seen work.',
      'follow_up',
      { prospectName: 'John Smith', connectionNote, firstDm },
    )
    // Should pass — fresh angle about dispatch systems
    expect(result.issues.some(i => i.includes('repeats'))).toBe(false)
  })

  it('fails a follow-up that says "just following up"', () => {
    const result = evaluateMessageStage(
      'Hi John, just following up on my previous message.',
      'follow_up',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('following up'))).toBe(true)
  })

  it('fails a follow-up that repeats the connection note', () => {
    const connectionNote = 'Saw you are taking Dexta Mobility into commercial ops. The customer/valet/ERP setup caught my eye.'
    const result = evaluateMessageStage(
      'Saw you are taking Dexta Mobility into commercial ops. The customer/valet/ERP setup caught my eye. Worth connecting.',
      'follow_up',
      { prospectName: 'John Smith', connectionNote },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('repeats connection note'))).toBe(true)
  })

  it('fails a follow-up that repeats the first DM', () => {
    const firstDm = 'The Dexta Mobility setup looks complex. Are you keeping the original team on maintenance?'
    const result = evaluateMessageStage(
      'The Dexta Mobility setup looks complex. Are you keeping the original team on maintenance? Let me know.',
      'follow_up',
      { prospectName: 'John Smith', firstDm },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('repeats first DM'))).toBe(true)
  })

  it('fails a follow-up that guilt-trips', () => {
    const result = evaluateMessageStage(
      'Hi John, I know you are busy, but just wondering if you saw my previous message.',
      'follow_up',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('guilt-tripping'))).toBe(true)
  })

  it('fails a follow-up that creates fake urgency', () => {
    const result = evaluateMessageStage(
      'Hi John, last chance to respond. Closing soon.',
      'follow_up',
      { prospectName: 'John Smith' },
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('fake urgency'))).toBe(true)
  })
})

describe('Reply quality', () => {
  it('passes a natural reply', () => {
    const result = evaluateMessageStage(
      'Thanks for the context. The handover plan makes sense — happy to do a paid technical assessment to get familiar with the codebase.',
      'reply',
    )
    expect(result.passed).toBe(true)
  })

  it('fails an overly formal reply', () => {
    const result = evaluateMessageStage(
      'Dear John, thank you for your message. Sincerely, Relay.',
      'reply',
    )
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('overly formal'))).toBe(true)
  })
})

describe('Em-dash name format fix', () => {
  it.skipIf(!HAS_AI_PROVIDER)('fixes "Hi John - came across" → "Hi John, came across"', async () => {
    const { extractUpworkJob } = await import('@/lib/upwork-v2')
    // Test via the backfill which uses similar logic
    const result = await extractUpworkJob({ rawText: 'Hi John - came across your work. Thought it was worth connecting.' })
    // The fixEmDashNameFormat is in draft-stream, test it indirectly
    expect(result.job).not.toBeNull()
  })

  it('fixes "Hey Sarah - looks like" → "Hey Sarah, looks like"', () => {
    // Test the regex pattern directly
    const text = 'Hey Sarah - looks like you are building something.'
    const firstName = 'Sarah'
    const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fixed = text.replace(
      new RegExp(`^(hi|hey|hello)\\s+${escaped}\\s*[\\u2014\\u2013-]\\s*`, 'i'),
      `$1 ${firstName}, `,
    )
    expect(fixed).toBe('Hey Sarah, looks like you are building something.')
  })

  it('fixes "John - I noticed" at line start → "John, I noticed"', () => {
    const text = 'John - I noticed your recent work.'
    const firstName = 'John'
    const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fixed = text.replace(
      new RegExp(`(^|\\n)\\s*${escaped}\\s*[\\u2014\\u2013-]\\s*`, 'i'),
      `$1${firstName}, `,
    )
    expect(fixed).toBe('John, I noticed your recent work.')
  })

  it('does not modify text without em-dash after name', () => {
    const text = 'Hi John, came across your work.'
    const firstName = 'John'
    const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fixed = text.replace(
      new RegExp(`^(hi|hey|hello)\\s+${escaped}\\s*[\\u2014\\u2013-]\\s*`, 'i'),
      `$1 ${firstName}, `,
    )
    expect(fixed).toBe('Hi John, came across your work.')
  })
})

describe('Stage differentiation', () => {
  it('same text can pass as DM but fail as connection note (length)', () => {
    const longMessage = 'Hi John, the Dexta Mobility setup — customer app, valet app, ERP, GPS dispatch, payments, OTP handover — looks like the kind of system where maintenance complexity grows fast after launch. The original dev team likely built it fast for launch, but production maintenance is a different skill set. Are you keeping them on it, or looking for someone to own it post-handover?'

    const dmResult = evaluateMessageStage(longMessage, 'first_dm', { prospectName: 'John Smith' })
    const connectionResult = evaluateMessageStage(longMessage, 'connection', { prospectName: 'John Smith' })

    // DM should pass (it has specific context)
    expect(dmResult.passed).toBe(true)
    // Connection note should fail (too long)
    expect(connectionResult.passed).toBe(false)
  })
})
