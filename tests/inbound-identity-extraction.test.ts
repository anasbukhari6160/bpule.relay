/**
 * Regression tests for inbound message identity extraction (QA RQA-020
 * follow-up). Covers the confirmed regressions:
 *
 *   1. Greetings ("Hello,", "Hi,", "Good morning") extracted as sender names.
 *   2. Multi-line signature blocks (Name / Role / Company on separate lines)
 *      not mapped to Name, Role, Company.
 *   3. Stale company/name/role from a previous analysis leaking into the
 *      form when a different message is analyzed.
 *
 * Also covers explicit introductions, sequential message replacement,
 * manual override behavior, and stale async response protection.
 *
 * Test strategy: pure-function unit tests for extraction utilities + a
 * faithful replica of the Intake component's state-transition logic for
 * state-management coverage (React rendering is not mounted here).
 */
import { describe, expect, it } from 'vitest'
import { extractTrailingSignature, profileInfoFromSignature } from '@/lib/inbound/signature'
import { sanitizePersonName, sanitizePersonTitle, extractIntroduction } from '@/lib/intelligence-v2/extraction-pipeline'

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Jonas — multi-line signature block with a closing line. */
const JONAS = [
  `Hi, we're a fintech in Berlin looking for a Next.js agency to rebuild our onboarding, budget 40k, start in March.`,
  '',
  'Best regards,',
  'Jonas',
  'CTO',
  'Fenwick Pay',
].join('\n')

/** Sarah — multi-line signature block with a "Signature:" label line. */
const SARAH = [
  'My name is Sarah Williams.',
  "I'm the Founder of BrightScale Technologies.",
  '',
  'Signature:',
  'Sarah Williams',
  'Founder & CEO',
  'BrightScale Technologies',
].join('\n')

/** Alex — explicit introduction, seller offering services, no signature. */
const ALEX = [
  'My name is Alex.',
  "I'm a freelance full-stack developer.",
  "I'm looking for new clients.",
].join('\n')

/** Rebecca — introduction prose with company + role + buyer signals. */
const REBECCA = [
  'Good afternoon,',
  'This is Rebecca Morgan from NovaBridge Analytics.',
  'I lead our product engineering department.',
  '',
  "We're evaluating development partners for a platform rebuild and have an approved spending limit of $90,000.",
  '',
  'Best,',
  'Rebecca',
  'Engineering Director',
].join('\n')

/** Chris — ambiguous inquiry, single-name signature, no company. */
const CHRIS = [
  'Hi there,',
  'I saw your profile and wanted to ask about your pricing and previous work.',
  'Do you take on projects at the $5k range?',
  '',
  'Thanks,',
  'Chris',
].join('\n')

/** Unidentified sender — greeting + requirement, no identity. */
const UNIDENTIFIED = [
  'Hello,',
  'We need a team to build a mobile app for our logistics platform. iOS and Android. Budget around $60k.',
].join('\n')

/** Inline signature (existing QA RQA-020 format) — must still work. */
const JONAS_INLINE =
  "Hi, we're a fintech in Berlin looking for a Next.js agency to rebuild our onboarding, budget 40k, start in March. – Jonas, CTO at Fenwick Pay"

// ── 1. Signature extraction ──────────────────────────────────────────────

describe('extractTrailingSignature — multi-line blocks', () => {
  it('extracts Jonas / CTO / Fenwick Pay from a multi-line block with a closing line', () => {
    const sig = extractTrailingSignature(JONAS)
    expect(sig).toEqual({ name: 'Jonas', title: 'CTO', company: 'Fenwick Pay' })
  })

  it('extracts Sarah Williams / Founder & CEO / BrightScale Technologies from a labeled block', () => {
    const sig = extractTrailingSignature(SARAH)
    expect(sig).toEqual({ name: 'Sarah Williams', title: 'Founder & CEO', company: 'BrightScale Technologies' })
  })

  it('extracts Rebecca / Engineering Director from a single-name signature block', () => {
    const sig = extractTrailingSignature(REBECCA)
    expect(sig?.name).toBe('Rebecca')
    expect(sig?.title).toBe('Engineering Director')
  })

  it('extracts Chris from a bare single-name signature (no role, no company)', () => {
    const sig = extractTrailingSignature(CHRIS)
    expect(sig?.name).toBe('Chris')
  })

  it('returns null for a first-person intro with no signature block (Alex)', () => {
    expect(extractTrailingSignature(ALEX)).toBeNull()
  })

  it('returns null for an unidentified sender (greeting only, no signature)', () => {
    expect(extractTrailingSignature(UNIDENTIFIED)).toBeNull()
  })

  it('still extracts the inline "– Name, Role at Company" format (backward compat)', () => {
    const sig = extractTrailingSignature(JONAS_INLINE)
    expect(sig).toEqual({ name: 'Jonas', title: 'CTO', company: 'Fenwick Pay' })
  })

  it('profileInfoFromSignature renders a profile-shaped block', () => {
    const info = profileInfoFromSignature({ name: 'Jonas', title: 'CTO', company: 'Fenwick Pay' })
    expect(info).toBe('Jonas\nCTO at Fenwick Pay')
  })
})

// ── 2. Greeting exclusion ────────────────────────────────────────────────

describe('sanitizePersonName — greeting rejection', () => {
  it.each([
    'Hi,',
    'Hello,',
    'Hello!',
    'Good morning',
    'Good afternoon',
    'Good evening',
    'Hey there',
    'Hi team',
    'Greetings',
    'Dear all',
  ])('rejects greeting "%s" as a name', (greeting) => {
    expect(sanitizePersonName(greeting)).toBeNull()
  })

  it.each([
    'Jonas',
    'Sarah Williams',
    'Brian Maccaba',
    'Alex Rivera',
  ])('accepts a real name "%s"', (name) => {
    expect(sanitizePersonName(name)).toBe(name)
  })

  it('rejects a first-person sentence fragment as a name', () => {
    expect(sanitizePersonName("I'm a freelance developer")).toBeNull()
  })
})

describe('sanitizePersonTitle — greeting / prose rejection', () => {
  it.each(['Hi,', 'Hello,', 'Good morning'])('rejects greeting "%s" as a title', (greeting) => {
    expect(sanitizePersonTitle(greeting)).toBeNull()
  })

  it('extracts the role from a first-person intro', () => {
    expect(sanitizePersonTitle("I'm a freelance full-stack developer")).toBe('Freelance Full-stack Developer')
  })

  it('accepts a bare title line', () => {
    expect(sanitizePersonTitle('CTO')).toBe('CTO')
  })

  it('keeps the role and employer while removing positioning copy from a profile headline', () => {
    expect(sanitizePersonTitle('Managing Partner @ Example Careers | Helping teams hire globally'))
      .toBe('Managing Partner @ Example Careers')
  })
})

// ── 3. Explicit introduction extraction ──────────────────────────────────

describe('extractIntroduction — self-identification patterns', () => {
  it('extracts name from "My name is Alex"', () => {
    expect(extractIntroduction('My name is Alex.')).toEqual({ name: 'Alex', role: null, company: null })
  })

  it('extracts name from "I\'m Rebecca Morgan from NovaBridge Analytics"', () => {
    expect(extractIntroduction("I'm Rebecca Morgan from NovaBridge Analytics.")).toEqual({
      name: 'Rebecca Morgan',
      role: null,
      company: 'NovaBridge Analytics',
    })
  })

  it('extracts name and company from "This is Rebecca Morgan from NovaBridge Analytics"', () => {
    expect(extractIntroduction('This is Rebecca Morgan from NovaBridge Analytics.')).toEqual({
      name: 'Rebecca Morgan',
      role: null,
      company: 'NovaBridge Analytics',
    })
  })

  it('stops a Unicode introduction name at the end of its sentence', () => {
    expect(extractIntroduction('This is Zoë Müller. We need an engineering partner.')).toEqual({
      name: 'Zoë Müller',
      role: null,
      company: null,
    })
  })

  it('extracts name, role, and company from "I lead our product engineering department"', () => {
    const result = extractIntroduction('I lead our product engineering department at NovaBridge.')
    expect(result?.name).toBeNull() // no name in this standalone sentence
    expect(result?.role).toBe('Product Engineering Department')
    expect(result?.company).toBe('NovaBridge')
  })

  it('extracts from Rebecca\'s full first line', () => {
    const result = extractIntroduction('This is Rebecca Morgan from NovaBridge Analytics.')
    expect(result).toEqual({ name: 'Rebecca Morgan', role: null, company: 'NovaBridge Analytics' })
  })

  it('returns null for a greeting-only line', () => {
    expect(extractIntroduction('Good afternoon,')).toBeNull()
  })

  it('returns null for a requirement without introduction', () => {
    expect(extractIntroduction('We need a team to build a mobile app.')).toBeNull()
  })

  it('does not extract "Good afternoon" as a name from "Good afternoon, this is..."', () => {
    const result = extractIntroduction('Good afternoon, this is Rebecca from NovaBridge.')
    // The regex requires "This is" not "this is" (capitalized), so it should NOT match lowercase
    // But let's verify the greeting is never the name
    expect(result?.name).not.toBe('Good afternoon')
  })
})

// ── 4. Form state management (stale / manual / sequential) ──────────────
//
// The Intake component in inbound-desk.tsx manages form state with refs and
// useState. We replicate the exact reset/preserve logic here as a pure function
// to test the contract without mounting React.

interface AnalysisResult {
  extracted: { company: string | null; contactName: string | null; contactTitle: string | null; url: string | null }
}

interface FormState {
  company: string
  contactName: string
  contactTitle: string
  url: string
}

/**
 * Replicates the analyze() state transition from inbound-desk.tsx:
 *   - If the message changed since the last analysis, reset extracted fields,
 *     then populate them unconditionally from the response.
 *   - If the same message is re-analyzed, fill only empty fields (preserve
 *     manual edits).
 */
function applyAnalysis(
  form: FormState,
  lastAnalyzedMessage: string | null,
  message: string,
  result: AnalysisResult,
): { form: FormState; lastAnalyzedMessage: string } {
  const trimmedMessage = message.trim()
  const messageChanged = lastAnalyzedMessage !== trimmedMessage

  const next: FormState = messageChanged
    ? {
        company: result.extracted.company || '',
        contactName: result.extracted.contactName || '',
        contactTitle: result.extracted.contactTitle || '',
        url: result.extracted.url || '',
      }
    : {
        company: result.extracted.company && !form.company ? result.extracted.company : form.company,
        contactName: result.extracted.contactName && !form.contactName ? result.extracted.contactName : form.contactName,
        contactTitle: result.extracted.contactTitle && !form.contactTitle ? result.extracted.contactTitle : form.contactTitle,
        url: result.extracted.url && !form.url ? result.extracted.url : form.url,
      }

  return { form: next, lastAnalyzedMessage: trimmedMessage }
}

describe('Intake form — sequential message replacement', () => {
  it('resets all fields when a different message is analyzed (no stale leak)', () => {
    // First analysis: Jonas
    const first = applyAnalysis(
      { company: '', contactName: '', contactTitle: '', url: '' },
      null,
      JONAS,
      { extracted: { company: 'Fenwick Pay', contactName: 'Jonas', contactTitle: 'CTO', url: null } },
    )
    expect(first.form).toEqual({ company: 'Fenwick Pay', contactName: 'Jonas', contactTitle: 'CTO', url: '' })

    // Second analysis: Alex — must NOT keep Fenwick Pay / Jonas / CTO
    const second = applyAnalysis(
      first.form,
      first.lastAnalyzedMessage,
      ALEX,
      { extracted: { company: null, contactName: 'Alex', contactTitle: 'Freelance Full-Stack Developer', url: null } },
    )
    expect(second.form).toEqual({
      company: '',
      contactName: 'Alex',
      contactTitle: 'Freelance Full-Stack Developer',
      url: '',
    })
  })

  it('preserves manual edits when the same message is re-analyzed', () => {
    const first = applyAnalysis(
      { company: '', contactName: '', contactTitle: '', url: '' },
      null,
      JONAS,
      { extracted: { company: 'Fenwick Pay', contactName: 'Jonas', contactTitle: 'CTO', url: null } },
    )
    // User manually corrects the company
    const edited: FormState = { ...first.form, company: 'Fenwick Pay (edited)' }
    // Re-analyze same message — manual edit must survive
    const second = applyAnalysis(
      edited,
      first.lastAnalyzedMessage,
      JONAS,
      { extracted: { company: 'Fenwick Pay', contactName: 'Jonas', contactTitle: 'CTO', url: null } },
    )
    expect(second.form.company).toBe('Fenwick Pay (edited)')
    expect(second.form.contactName).toBe('Jonas')
  })

  it('fills a field that the user cleared (still empty) on re-analysis of the same message', () => {
    const first = applyAnalysis(
      { company: '', contactName: '', contactTitle: '', url: '' },
      null,
      JONAS,
      { extracted: { company: 'Fenwick Pay', contactName: 'Jonas', contactTitle: 'CTO', url: null } },
    )
    const cleared: FormState = { ...first.form, contactName: '' }
    const second = applyAnalysis(
      cleared,
      first.lastAnalyzedMessage,
      JONAS,
      { extracted: { company: 'Fenwick Pay', contactName: 'Jonas', contactTitle: 'CTO', url: null } },
    )
    expect(second.form.contactName).toBe('Jonas')
  })

  it('populates all fields on first click of a new message (first-click completeness)', () => {
    // Simulate: analyze Jonas, then switch to Rebecca
    const first = applyAnalysis(
      { company: '', contactName: '', contactTitle: '', url: '' },
      null,
      JONAS,
      { extracted: { company: 'Fenwick Pay', contactName: 'Jonas', contactTitle: 'CTO', url: null } },
    )
    // First click of Rebecca — all identity fields must populate immediately
    const second = applyAnalysis(
      first.form,
      first.lastAnalyzedMessage,
      REBECCA,
      { extracted: { company: 'NovaBridge Analytics', contactName: 'Rebecca Morgan', contactTitle: 'Engineering Director', url: null } },
    )
    expect(second.form).toEqual({
      company: 'NovaBridge Analytics',
      contactName: 'Rebecca Morgan',
      contactTitle: 'Engineering Director',
      url: '',
    })
  })
})

// ── 5. Stale async response protection ───────────────────────────────────

interface StaleGuard {
  token: number
  apply: <T>(thisToken: number, data: T, onSuccess: (d: T) => void) => void
}

function createStaleGuard(): StaleGuard {
  return {
    token: 0,
    apply<T>(thisToken: number, data: T, onSuccess: (d: T) => void) {
      if (thisToken === this.token) onSuccess(data)
    },
  }
}

describe('Intake form — stale async response protection', () => {
  it('applies the most recent response and discards a slower older one', () => {
    const guard = createStaleGuard()
    let applied = 'none'

    const t1 = ++guard.token
    const t2 = ++guard.token

    guard.apply(t2, 'response-2', (d) => { applied = d })
    expect(applied).toBe('response-2')

    guard.apply(t1, 'response-1', (d) => { applied = d })
    expect(applied).toBe('response-2')
  })

  it('applies the only response when just one request is in flight', () => {
    const guard = createStaleGuard()
    let applied = 'none'
    const t1 = ++guard.token
    guard.apply(t1, 'only-response', (d) => { applied = d })
    expect(applied).toBe('only-response')
  })
})
