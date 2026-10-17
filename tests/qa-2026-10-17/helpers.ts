import type { LeadDetail } from '@/lib/store/types'
import type { Message } from '@/lib/domain/types'
import { buildMockStore } from '@/lib/store/mock-store'

export const rep = {
  id: 'rep-hassan',
  name: 'Hassan (demo)',
  role: 'admin' as const,
  organizationId: 'org-demo',
  createdAt: '2024-01-01T00:00:00.000Z',
  timezone: 'UTC',
}

export function store() {
  return buildMockStore({ rep, mode: 'demo' })
}

export async function newLead(s: ReturnType<typeof store>, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await s.createLead({
    company: `QA Co ${Math.random().toString(36).slice(2, 8)}`,
    contactName: 'Pat Example',
    contactTitle: 'CTO',
    signalEvidence: 'Looking for an agency to rebuild the mobile app.',
    allowPotentialDuplicate: true,
    ...extra,
  } as Parameters<typeof s.createLead>[0])
  return ((created as { lead?: { id: string } }).lead ?? (created as unknown as { id: string })).id
}

let n = 0
export function msg(partial: Partial<Message>): Message {
  n++
  return {
    id: `m${n}`,
    organizationId: 'org',
    leadId: 'l1',
    repId: 'r1',
    type: 'dm',
    draftText: null,
    sentText: 'hello',
    sentAt: `2026-10-0${Math.min(9, n % 9 + 1)}T10:00:00Z`,
    modelUsed: null,
    direction: 'outbound',
    createdAt: '2026-10-01T10:00:00Z',
    ...partial,
  }
}

export function leadDetail(messages: Message[], extra: Partial<LeadDetail> = {}): LeadDetail {
  return {
    id: 'l1',
    organizationId: 'org',
    ownerRepId: 'r1',
    company: 'Acme',
    companyKey: 'acme',
    contactName: 'Sam',
    contactTitle: 'CTO',
    url: null,
    rawInput: null,
    signalType: 7,
    signalEvidence: '',
    verbatimQuote: null,
    score: 8,
    verdict: 'send',
    status: 'contacted',
    playId: null,
    tags: [],
    createdAt: '2026-10-01T00:00:00Z',
    messages,
    outcomes: [],
    followupCount: 0,
    ...extra,
  } as LeadDetail
}

import type { OrganizationRulebook } from '@/lib/domain/types'
import { SIGNALS } from '@/lib/score/signals'

/** Same default rulebook the Create Lead page uses. */
export const RULEBOOK: OrganizationRulebook = {
  organizationId: '',
  signals: SIGNALS,
  verdictThresholds: { send: { min: 10, max: 12 }, research_more: { min: 7, max: 9 }, skip: { min: 0, max: 6 } },
  maxSignalWeight: 7,
  maxCompleteness: 5,
  confidenceSendThreshold: 72,
}
