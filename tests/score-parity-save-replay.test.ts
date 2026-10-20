import { describe, it, expect } from 'vitest'
import { runOffline } from './helpers/score-source'
import { recomputePacketFromStored } from '@/lib/intelligence-v3/bridge'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'

// REL-QA-007 (S1): the score shown on Prospect must be the score saved on the
// lead. Save replays the stored packet through the deterministic layers; the
// replay must land on exactly the same canonical score, display band,
// qualification, action, buyer intent, timing and access.

const BUYER = `Maya Lindqvist
Founder & CEO at Northwind Analytics
Stockholm, Sweden

About
We build analytics tooling for mid-market logistics companies.

Posts
Maya Lindqvist • 3d •
We are looking for an agency to rebuild our customer onboarding in Next.js. Budget approved at $45,000, kickoff in January. DM me if you have done this before.`

const SELLER = `Aisha Rahman
Freelance React Developer
Lahore, Pakistan

About
I'm a freelance React and Next.js developer with 6 years of experience. Currently looking for freelance projects or full-time employment. Open to contract work.

Posts
Aisha Rahman • 1w •
Just shipped a dashboard for a fintech client. Available for new projects from next month.`

const RECRUITER = `Daniel Okoro
Senior Technical Recruiter at TalentBridge
Austin, Texas

About
I help growing startups hire engineers. Send me your resume if you are a React or Node developer looking for your next role.

Posts
Daniel Okoro • 2d •
Hiring: Senior Frontend Engineer for a Series B client, remote, US hours. DM me.`

const GERMAN = `Katrin Vogel
Geschäftsführerin bei Nordlicht Digital GmbH
Hamburg, Deutschland

Info
Wir sind ein Softwarehaus für mittelständische Kunden.

Beiträge
Katrin Vogel • vor 5 Tagen •
Wir suchen eine Agentur für den Relaunch unseres Kundenportals in Next.js. Budget ist freigegeben, Start im Februar. Gerne per Nachricht melden.`

const CASES: Array<{ name: string; text: string; model: Parameters<typeof runOffline>[1]['model'] }> = [
  { name: 'buyer', text: BUYER, model: { relationship: 'BUYER', buyerRequestProbability: 0.9, externalNeedProbability: 0.85, needOwner: 'SELF_NEED', fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT', messageEligible: 0.9 } },
  { name: 'seller', text: SELLER, model: { relationship: 'SERVICE_PROVIDER', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, needOwner: 'SERVICE_OFFERING', fit: 'WEAK', timing: 'WEAK', access: 'INDIRECT', messageEligible: 0.2 } },
  { name: 'recruiter', text: RECRUITER, model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.15, externalNeedProbability: 0.1, needOwner: 'HIRING_NEED', fit: 'WEAK', timing: 'WEAK', access: 'DIRECT', messageEligible: 0.2 } },
  { name: 'german buyer', text: GERMAN, model: { relationship: 'BUYER', buyerRequestProbability: 0.85, externalNeedProbability: 0.8, needOwner: 'SELF_NEED', fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT', messageEligible: 0.85 } },
]

// Episode ids carry a per-run suffix, so parity is checked on the values a
// rep sees and on the episode count, not on the generated id.
function parityView(p: V3LeadDecisionPacket) {
  return {
    score: p.score,
    qualification: p.qualification,
    action: p.action,
    buyerIntent: p.buyerIntent?.buyerIntentLevel ?? null,
    timing: p.decision.timing,
    access: p.decision.access,
    episodeCount: p.episodes.length,
  }
}

describe('score parity: analyze -> save replay -> reopen', () => {
  for (const c of CASES) {
    it(`${c.name}: the replayed packet equals the shown packet`, async () => {
      const shown = await runOffline(c.text, { model: c.model, referenceDate: new Date('2026-10-20T12:00:00Z') })
      // The packet carries its own events and date, so save can replay them.
      expect(Array.isArray(shown.events)).toBe(true)
      expect(shown.decidedAt).toBe('2026-10-20T12:00:00.000Z')

      // What a client would send back: the stored packet, JSON round-tripped.
      const stored = JSON.parse(JSON.stringify(shown)) as V3LeadDecisionPacket
      const replayed = await recomputePacketFromStored(c.text, stored)

      expect(parityView(replayed)).toEqual(parityView(shown))
      // Display band derives from the canonical score, so equal scores mean equal bands.
      expect(Math.round(replayed.score / 10)).toBe(Math.round(shown.score / 10))
    })
  }

  it('a packet saved before events were persisted still replays (fallback path)', async () => {
    const shown = await runOffline(BUYER, { model: CASES[0].model })
    const legacy = JSON.parse(JSON.stringify(shown)) as V3LeadDecisionPacket
    delete legacy.events
    delete legacy.decidedAt
    const replayed = await recomputePacketFromStored(BUYER, legacy)
    expect(Number.isFinite(replayed.score)).toBe(true)
    expect(replayed.score).toBeGreaterThanOrEqual(0)
    expect(replayed.score).toBeLessThanOrEqual(100)
  })
})
