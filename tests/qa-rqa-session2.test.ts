/**
 * QA RELAY — Session 2 regressions (RQA-012).
 *
 * A connection-note request that cannot derive a strategy must end with a
 * terminal event, never a silent blank stream.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { streamDraft } from '@/lib/ai/draft-stream'
import { rankSendersForLead, type SenderProfile } from '@/lib/relay/sender-routing-engine'
import { analyzeReply } from '@/lib/relay/conversation-engine'
import { extractTrailingSignature, profileInfoFromSignature } from '@/lib/inbound/signature'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('RQA-012 — a missing strategy ends the draft stream terminally', () => {
  it('emits needs_rescoring then done (no silent blank)', async () => {
    const events: Array<{ type: string; reason?: string }> = []
    const input = {
      leadId: 'lead-1',
      lead: {
        id: 'lead-1',
        company: 'Acme',
        contactName: 'Jo',
        contactTitle: 'CTO',
        status: 'new',
        messages: [],
        connectionAcceptedAt: null,
      },
      extracted: { name: 'Jo', title: 'CTO', company: 'Acme', signalEvidence: 'We need an agency' },
      score: { total: 70, verdict: 'send' },
      type: 'connection',
      styleCard: null,
      facts: [],
      plays: [],
      history: [],
      profile: null,
      strategy: null,
    }
    const result = await streamDraft(input as never, (e) => events.push(e as never), null, null)

    expect(events.some((e) => e.type === 'needs_rescoring')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(result.draftText).toBe('')
  })
})

describe('RQA-009/010/011 — the lead surfaces sender match and mismatch actions', () => {
  const sender = (over: Partial<SenderProfile>): SenderProfile => ({
    id: 'p1',
    name: 'Aneeb',
    role: 'Full-stack Developer',
    platform: 'linkedin',
    skills: ['react', 'node.js'],
    industries: ['saas'],
    proof: [],
    holders: [{ repId: 'rep-2', name: 'Aneeb' }],
    accessibleToRep: false,
    ...over,
  })

  it('ranking carries the holder rep ids the help action needs', () => {
    const result = rankSendersForLead(
      { capabilities: ['react', 'node.js'], industries: ['saas'], buyerRequestProbability: 0.8, fitLevel: 'STRONG', rawTerms: ['Acme', 'CTO'], platform: 'linkedin' },
      [sender({ id: 'p1' }), sender({ id: 'p2', name: 'Fizza', accessibleToRep: true })],
      'p2',
    )
    const best = result.rankings.find((r) => r.senderId === result.bestSenderId)
    expect(best?.holderRepIds).toContain('rep-2')
  })

  it('the decision card renders Keep Current Owner and Ask for Help', () => {
    const src = readFileSync(join(ROOT, 'src/components/lead-decision-context-card.tsx'), 'utf8')
    expect(src).toContain('Keep Current Owner')
    expect(src).toContain('Ask for Help')
    expect(src).toContain('data-testid="sender-match-card"')
  })
})

describe('RQA-019 — manual archive and restore', () => {
  it('the archive route supports both actions', () => {
    const src = readFileSync(join(ROOT, 'src/app/api/leads/[id]/archive/route.ts'), 'utf8')
    expect(src).toContain("action === 'archive'")
    expect(src).toContain("action === 'restore'")
    expect(src).toContain('archived: true')
    expect(src).toContain('archived: false')
  })

  it('the archive page lists archived leads with a Restore control', () => {
    const page = readFileSync(join(ROOT, 'src/app/(app)/archive/page.tsx'), 'utf8')
    const list = readFileSync(join(ROOT, 'src/components/leads/archived-leads-list.tsx'), 'utf8')
    expect(page).toContain('ArchivedLeadsList')
    expect(list).toContain("'restore'")
    expect(list).toContain('Restore')
  })
})

describe('RQA-013 — an explicit positive buyer reply is engaged, not neutral', () => {
  const ctx = {
    leadId: 'lead-1',
    leadCompany: 'Acme',
    contactName: 'Sophia',
    priorMessages: [],
    conversationStage: 'replied' as const,
    senderProfileId: null,
  }

  it('budget confirmed + discovery call reads as interested/positive', () => {
    const result = analyzeReply(
      "Thanks — we've confirmed the £85k budget and would like to proceed with your agency. Can we set up a discovery call next week?",
      { ...ctx, replyText: 'confirmed budget' },
    )
    expect(result.intent).toBe('interested')
    expect(result.sentiment).toBe('positive')
    expect(result.buyingSignal).toBe(true)
  })

  it('a plain pricing question still reads as pricing', () => {
    expect(analyzeReply('How much do you charge for a project like this?', { ...ctx, replyText: 'pricing' }).intent).toBe('pricing')
  })

  it('a call request still reads as meeting_request', () => {
    const result = analyzeReply('Can we jump on a call next week to discuss?', { ...ctx, replyText: 'call' })
    expect(result.intent).toBe('meeting_request')
    expect(result.sentiment).toBe('positive')
  })
})

describe('RQA-015 — the Won outcome appears in History', () => {
  it('the lead carries the won/lost timestamp from conversation state', () => {
    const src = readFileSync(join(ROOT, 'src/lib/store/supabase-store.ts'), 'utf8')
    expect(src).toContain('won_at, lost_at')
    expect(src).toContain('wonAt: convState?.won_at ?? null')
  })

  it('the History tab renders an Outcome row', () => {
    const src = readFileSync(join(ROOT, 'src/components/lead-workspace-simple.tsx'), 'utf8')
    expect(src).toContain('outcomeEntry')
    expect(src).toContain('Opportunity won')
    expect(src).toContain('>Outcome</span>')
  })
})

describe('RQA-017/018 — manual lead creation and one canonical state', () => {
  it('manual creation bypasses the signal-evidence requirement', () => {
    const src = readFileSync(join(ROOT, 'src/app/api/leads/route.ts'), 'utf8')
    expect(src).toContain('body.manual === true')
    expect(src).toContain('if (!signalEvidence && !isManual)')
    expect(src).toContain('if (!isManual && !qualification.qualificationEligibility)')
  })

  it('manual research is scored through the canonical pipeline, not the legacy split', () => {
    const src = readFileSync(join(ROOT, 'src/app/api/leads/route.ts'), 'utf8')
    expect(src).toContain('produceV3Intelligence')
    expect(src).toContain('deterministicOnly: true')
    // A manual lead with no research must not get an invented legacy score.
    expect(src).toContain('legacyRulebook && scoreSource')
  })
})

describe('RQA-020 — an inbound signature yields name, role and company', () => {
  const JONAS = `Hi, we're a fintech in Berlin looking for a Next.js agency to rebuild our onboarding, budget 40k, start in March. – Jonas, CTO at Fenwick Pay`

  it('extracts the trailing "– Name, Role at Company"', () => {
    expect(extractTrailingSignature(JONAS)).toEqual({ name: 'Jonas', title: 'CTO', company: 'Fenwick Pay' })
    expect(profileInfoFromSignature({ name: 'Jonas', title: 'CTO', company: 'Fenwick Pay' })).toBe('Jonas\nCTO at Fenwick Pay')
  })

  it('the reader finds Jonas / CTO / Fenwick Pay and a HIGH buyer', async () => {
    const sig = extractTrailingSignature(JONAS)!
    const raw = [profileInfoFromSignature(sig), JONAS].join('\n\n')
    const v3 = await produceV3Intelligence(raw, { deterministicOnly: true })
    expect(v3.intelligence.intelligence.person.fullName).toBe('Jonas')
    expect(v3.intelligence.intelligence.person.title).toBe('CTO')
    expect(v3.intelligence.intelligence.company.name).toBe('Fenwick Pay')
    expect(v3.v3Packet?.buyerIntent?.buyerIntentLevel).toBe('HIGH')
  })
})
