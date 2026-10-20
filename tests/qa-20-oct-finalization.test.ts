import { describe, it, expect } from 'vitest'
import { leadClosedForOutreach } from '@/lib/relay/queue-engine'
import { deriveNextLeadAction } from '@/lib/relay/lead-state-machine'
import { selectSenderProfile } from '@/lib/workspace/select-sender-profile'
import { mergeExtractedFields, type ExtractedFields } from '@/lib/leads/extraction-merge'
import { readSourceFacts, summarizeSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { hasUnfilledValues } from '@/lib/relay/unfilled-values'
import { runOffline } from './helpers/score-source'
import type { LeadDetail } from '@/lib/store/types'
import type { Message } from '@/lib/domain/types'

// Oct 20 regression finalization: REL-QA-014, -015, -013, -005, -011.

function msg(partial: Partial<Message> & { direction: Message['direction']; sentText: string; sentAt: string }): Message {
  return { id: `m-${partial.sentAt}`, leadId: 'lead-1', type: 'reply', draftText: partial.sentText, ...partial } as Message
}

describe('REL-QA-014: a declined or closed lead gets no reply or follow-up task', () => {
  const declined = [
    msg({ direction: 'outbound', type: 'dm', sentText: 'Hi Pete, happy to show you the portal work.', sentAt: '2026-10-19T09:00:00Z' }),
    msg({ direction: 'inbound', sentText: "I'm not interested in your services. Please don't follow up with me.", sentAt: '2026-10-19T10:00:00Z' }),
  ]

  it('status replied + client decline is closed for outreach', () => {
    expect(leadClosedForOutreach({ status: 'replied' }, declined)).toBe(true)
  })
  it('terminal statuses are closed regardless of thread', () => {
    for (const status of ['lost', 'won', 'dead', 'no'] as const) expect(leadClosedForOutreach({ status }, [])).toBe(true)
  })
  it('an open thread with a neutral client reply is not closed', () => {
    const open = [msg({ direction: 'inbound', sentText: 'Thanks, can you send a few examples of portals you built?', sentAt: '2026-10-19T10:00:00Z' })]
    expect(leadClosedForOutreach({ status: 'replied' }, open)).toBe(false)
  })
  it('a later genuine buying message reopens the thread', () => {
    const reopened = [
      ...declined,
      msg({ direction: 'inbound', sentText: 'Actually, we do need help with the customer portal now. Can we set up a call next week? Budget is around 30000.', sentAt: '2026-10-20T08:00:00Z' }),
    ]
    expect(leadClosedForOutreach({ status: 'replied' }, reopened)).toBe(false)
  })
  it('the lead workspace shows the decline as closed, not as a reply due', () => {
    const lead = { id: 'lead-1', company: 'Meltzer Co', contactName: 'Pete', status: 'replied', messages: declined, outcomes: [], createdAt: '2026-10-18T00:00:00Z' } as unknown as LeadDetail
    const action = deriveNextLeadAction(lead, new Date('2026-10-20T12:00:00Z').getTime())
    expect(action.action).toBe('CLOSED')
    expect(action.closedReason).toBe('client_declined')
    expect(action.requiresAction).toBe(false)
  })
})

describe('REL-QA-015: the draft is written from the selected sender, never the workspace owner', () => {
  const A = { id: 'profile-a', revenueIdentityId: 'identity-a', name: 'Aneeb' }
  const B = { id: 'profile-b', revenueIdentityId: 'identity-b', name: 'Fizza' }
  const C = { id: 'profile-c', revenueIdentityId: 'identity-c', name: 'Zaira' }
  const profiles = [A, B, C]

  it('workspace A, sender B, best sender C: signs as B', () => {
    const r = selectSenderProfile(profiles, { senderProfileId: B.id, revenueIdentityId: 'identity-a' })
    expect(r.profile?.name).toBe('Fizza')
    expect(r.source).toBe('lead_sender')
  })
  it('an explicit pick wins over the stored sender and the workspace', () => {
    const r = selectSenderProfile(profiles, { senderProfileId: B.id, revenueIdentityId: 'identity-a' }, C.id)
    expect(r.profile?.name).toBe('Zaira')
    expect(r.source).toBe('explicit')
    expect(r.crossWorkspace).toBe(true)
  })
  it('the workspace identity is used only when the lead has no sender', () => {
    const r = selectSenderProfile(profiles, { senderProfileId: null, revenueIdentityId: 'identity-a' })
    expect(r.profile?.name).toBe('Aneeb')
    expect(r.source).toBe('workspace_identity')
  })
  it('repeat with the two senders swapped: still the stored sender', () => {
    expect(selectSenderProfile(profiles, { senderProfileId: A.id, revenueIdentityId: 'identity-b' }).profile?.name).toBe('Aneeb')
    expect(selectSenderProfile(profiles, { senderProfileId: C.id, revenueIdentityId: 'identity-b' }).profile?.name).toBe('Zaira')
  })
  it('a stored sender the rep cannot use falls through to the workspace, then first available', () => {
    expect(selectSenderProfile(profiles, { senderProfileId: 'gone', revenueIdentityId: 'identity-c' }).profile?.name).toBe('Zaira')
    expect(selectSenderProfile(profiles, { senderProfileId: 'gone', revenueIdentityId: 'identity-none' }).source).toBe('first_available')
    expect(selectSenderProfile([], { senderProfileId: null, revenueIdentityId: null }).profile).toBeNull()
  })
})

describe('REL-QA-013: re-extracting a different source replaces the old source fields', () => {
  const empty: ExtractedFields = { company: '', contactName: '', contactTitle: '', titleRaw: '', locationRaw: '', aboutSummary: '', experienceSummary: '', url: '', verbatimQuote: '' }
  const A: ExtractedFields = { ...empty, company: 'BrightPath Systems', contactName: 'Alex Morgan', contactTitle: 'Operations Manager', titleRaw: 'Operations Manager', locationRaw: 'Austin' }
  const B: ExtractedFields = { ...empty, company: 'BluePeak Digital', contactName: 'Jordan Lee', contactTitle: '', titleRaw: '', locationRaw: '' }

  it('fields from A are replaced by B, including fields B leaves empty', () => {
    const afterA = mergeExtractedFields(empty, A, null)
    const afterB = mergeExtractedFields(afterA, B, A)
    expect(afterB.company).toBe('BluePeak Digital')
    expect(afterB.contactName).toBe('Jordan Lee')
    expect(afterB.contactTitle).toBe('')
    expect(afterB.locationRaw).toBe('')
  })
  it('a field the rep edited after A is kept', () => {
    const afterA = mergeExtractedFields(empty, A, null)
    const edited = { ...afterA, locationRaw: 'Austin, TX (confirmed by phone)' }
    const afterB = mergeExtractedFields(edited, B, A)
    expect(afterB.locationRaw).toBe('Austin, TX (confirmed by phone)')
    expect(afterB.company).toBe('BluePeak Digital')
  })
  it('no mixed company/name/location remains after the swap', () => {
    const afterB = mergeExtractedFields(mergeExtractedFields(empty, A, null), B, A)
    expect(Object.values(afterB).some((v) => /BrightPath|Alex Morgan|Austin|Operations Manager/.test(v))).toBe(false)
  })
})

describe('REL-QA-005: German role, age and message access', () => {
  const text = (title: string) => `Katrin Vogel
${title} bei Nordlicht Digital GmbH
Hamburg, Deutschland

Beiträge
Katrin Vogel • vor 5 Tagen •
Wir suchen eine Agentur für den Relaunch unseres Kundenportals in Next.js. Budget ist freigegeben. Gerne per Nachricht melden.`

  it('Geschäftsführerin is executive authority', () => {
    const s = summarizeSourceFacts(readSourceFacts(text('Geschäftsführerin')))
    expect(s.authority).toBe('EXECUTIVE')
  })
  it('Gründerin and Inhaberin are founder authority', () => {
    expect(summarizeSourceFacts(readSourceFacts(text('Gründerin'))).authority).toBe('FOUNDER')
    expect(summarizeSourceFacts(readSourceFacts(text('Inhaberin'))).authority).toBe('FOUNDER')
  })
  it('"vor 5 Tagen" and "5 Tage" read as a 5-day-old post', () => {
    expect(summarizeSourceFacts(readSourceFacts(text('Geschäftsführerin'))).recentPostAgeDays).toBe(5)
    expect(summarizeSourceFacts(readSourceFacts(text('Geschäftsführerin').replace('vor 5 Tagen', '5 Tage'))).recentPostAgeDays).toBe(5)
  })
  it('"gerne per Nachricht melden" is a message route', () => {
    expect(summarizeSourceFacts(readSourceFacts(text('Geschäftsführerin'))).access.canMessage).toBe(true)
  })
  it('score and action stay coherent for the German request', async () => {
    const packet = await runOffline(text('Geschäftsführerin'), {
      model: { relationship: 'BUYER', buyerRequestProbability: 0.85, externalNeedProbability: 0.8, needOwner: 'SELF_NEED', fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT', messageEligible: 0.85 },
    })
    expect(Number.isFinite(packet.score)).toBe(true)
    expect(packet.score).toBeGreaterThanOrEqual(0)
    expect(packet.score).toBeLessThanOrEqual(100)
    expect(packet.qualification).not.toBe('INELIGIBLE')
    expect(packet.action).not.toBe('SKIP')
  })
})

describe('REL-QA-011: every placeholder shape is caught', () => {
  it.each([
    ['missing month', "I see you're offering a -month free trial."],
    ['missing amount', 'Happy to do it for $ per month.'],
    ['unresolved braces', 'Hi {{first_name}}, saw your post about {topic}.'],
    ['bracket token', 'Hi [Name], congrats on the launch at [Company].'],
    ['broken slash', 'You offer support with / coverage on weekends.'],
  ])('%s', (_label, text) => {
    expect(hasUnfilledValues(text)).toBe(true)
  })
  it('a complete message passes', () => {
    expect(hasUnfilledValues("You're offering a 3-month trial with 24/7 support for $40 a month. Nice.")).toBe(false)
  })
})
