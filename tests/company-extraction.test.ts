import { describe, expect, it } from 'vitest'
import { HAS_AI_PROVIDER } from './helpers/needs-ai'
import { runIntelligencePipeline } from '@/lib/intelligence-v2/extraction-pipeline'

/**
 * Regression coverage for upstream company/entity extraction gaps found
 * during the Relay team bug bash while investigating "Create Lead does
 * nothing" (relay.bpulse.dev/prospect). Per explicit instruction: these
 * fixes broaden EXTRACTION, never weaken the downstream qualification gate
 * (hasKnownCompany) — a lead whose company genuinely cannot be established
 * should still be correctly blocked; these tests exist to prove the
 * extractor recognizes company names that ARE actually present in the
 * source, in phrasings beyond the original "Title at Company" pattern.
 *
 * Every new pattern here was verified against a battery of ordinary prose
 * to confirm it does NOT fabricate a company from generic text ("for Q3
 * this year", "at scale", "with Passion and dedication", etc.) — a company
 * must never be invented merely to make Save/Create Lead work.
 */
describe('Company extraction — beyond "Title at Company"', () => {
  it('extracts company from a comma-separated headline ("CEO, CometHire")', async () => {
    const result = await runIntelligencePipeline(
      `Bakary Sanou
CEO, CometHire
Building the future of recruiting.

CometHire is hiring across engineering and sales.`,
      {},
    )
    expect(result.intelligence.company.name).toBe('CometHire')
  })

  it('does NOT misread a dual-title comma headline as a company ("CEO, Founder")', async () => {
    const result = await runIntelligencePipeline(
      `Jane Doe
CEO, Founder
No company name anywhere in this text at all.`,
      {},
    )
    expect(result.intelligence.company.name).not.toBe('Founder')
  })

  it('does NOT misread a department/team as a company ("Senior Engineer, Backend Team")', async () => {
    const result = await runIntelligencePipeline(
      `John Smith
Senior Engineer, Backend Team
Some unrelated bio text with no real company mentioned.`,
      {},
    )
    expect(result.intelligence.company.name).not.toBe('Backend Team')
  })

  it('extracts company from "works for X" prose without a Title-at-Company headline', async () => {
    const result = await runIntelligencePipeline(
      `Alex Rivera
Recruiter

About
I work for CometHire as their lead recruiter, sourcing top engineering talent.`,
      {},
    )
    expect(result.intelligence.company.name).toBe('CometHire')
  })

  it('extracts company from "Company is building/builds/provides/runs/helps" prose (pre-existing pattern, still works)', async () => {
    const result = await runIntelligencePipeline(
      `Someone
Some Title

CometHire is building the future of recruiting technology.`,
      {},
    )
    expect(result.intelligence.company.name).toBe('CometHire')
  })

  it('does not fabricate a company from ordinary prose containing "for/at/with + capitalized word" with no real company present', async () => {
    const noise = [
      'We shipped a huge release for Q3 this year.',
      'I work at scale every day, solving hard problems.',
      'Looking for A players to join our team.',
      'Thanks for Everything this year — could not have done it without the team.',
      'I built this with Passion and dedication over many years.',
    ]
    for (const text of noise) {
      const result = await runIntelligencePipeline(`Someone\nSome Title\n\n${text}`, {})
      // None of these contain a real company name — extraction must stay
      // null/Unknown rather than invent one from generic capitalized words.
      expect(result.intelligence.company.name).toBeNull()
    }
  })

  it('keeps an IT recruiter title and uses the employer on the next line', async () => {
    const result = await runIntelligencePipeline(
      `Michał Walasek
Rekruter IT
B2Bnetwork
Warsaw, Poland`,
      {},
    )
    expect(result.intelligence.person.title).toMatch(/rekruter it/i)
    expect(result.intelligence.company.name).toBe('B2Bnetwork')
  })

  it('reads the employer from "IT Recruiter at B2Bnetwork"', async () => {
    const result = await runIntelligencePipeline(
      `Michał Walasek
IT Recruiter at B2Bnetwork
Warsaw, Poland`,
      {},
    )
    expect(result.intelligence.person.title).toMatch(/it recruiter/i)
    expect(result.intelligence.company.name).toBe('B2Bnetwork')
  })

  // Only the live extraction pass reads the company out of a "for X, a …
  // startup" connector phrase; the deterministic fallback returns null.
  it.skipIf(!HAS_AI_PROVIDER)('reads the employer from a connector phrase ("lead recruiting operations for X, a ... startup")', async () => {
    const result = await runIntelligencePipeline(
      `Alex Rivera
Recruiter

About
I lead recruiting operations for CometHire, a fast-growing HR tech startup.`,
      {},
    )
    // This used to document an accepted gap (expected null). The extractor
    // now reads a capitalized organization after "for" when the sentence
    // goes on to describe it as a company, which is correct here. The guard
    // below keeps the broader reading from inventing a company out of a
    // lower-case object ("for fast-growing startups").
    expect(result.intelligence.company.name).toBe('CometHire')
  })

  it('does not invent a company from a lower-case "for ..." object', async () => {
    const result = await runIntelligencePipeline(
      `Alex Rivera
Recruiter

About
I lead recruiting operations for fast-growing startups across Europe.`,
      {},
    )
    expect(result.intelligence.company.name).toBeNull()
  })
})
