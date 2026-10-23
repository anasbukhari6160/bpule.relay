/**
 * Browser-QA-driven regression tests for Inbound identity extraction.
 *
 * These tests reproduce the four confirmed browser QA failures and validate
 * the generalized fixes. They exercise the actual extraction utilities AND
 * the sanitization/post-processing layer that the API route applies.
 *
 * Each test fails against the defective code and passes after the fix.
 */
import { describe, expect, it } from 'vitest'
import { extractTrailingSignature, profileInfoFromSignature } from '@/lib/inbound/signature'
import {
  extractIntroduction,
  sanitizeCompanyName,
  sanitizeContactName,
  sanitizePersonTitle,
  preferFullName,
} from '@/lib/intelligence-v2/extraction-pipeline'

// ══════════════════════════════════════════════════════════════════════════
// SANITIZATION UNIT TESTS
// ══════════════════════════════════════════════════════════════════════════

describe('sanitizeCompanyName — greeting rejection', () => {
  it.each([
    'Hi there,',
    'Hi there',
    'Hello,',
    'Hello',
    'Hello Team,',
    'Hello Team',
    'Hey,',
    'Good morning,',
    'Good afternoon',
    'Good evening',
    'Dear all,',
    'Greetings,',
    'Dear Sir,',
  ])('rejects greeting "%s" as a company', (greeting) => {
    expect(sanitizeCompanyName(greeting)).toBeNull()
  })

  it('does NOT reject multi-word capitalized names (kept as potential companies)', () => {
    // Multi-word capitalized phrases are kept — the primary extractors decide
    // whether they are people or companies. The safety net only catches
    // clearly invalid values.
    expect(sanitizeCompanyName('Rebecca Morgan')).toBe('Rebecca Morgan')
  })

  it('keeps single-word brand-style names', () => {
    // "CometHire" and "Fenwick" are valid one-word company names and are kept.
    expect(sanitizeCompanyName('CometHire')).toBe('CometHire')
  })

  it('rejects single-word role keywords as companies', () => {
    expect(sanitizeCompanyName('CTO')).toBeNull()
    expect(sanitizeCompanyName('Engineer')).toBeNull()
    expect(sanitizeCompanyName('Founder')).toBeNull()
  })

  it('rejects trailing punctuation fragments', () => {
    expect(sanitizeCompanyName('NovaBridge Analytics I')).toBeNull()
    expect(sanitizeCompanyName('Acme.')).toBeNull()
    expect(sanitizeCompanyName('Acme!')).toBeNull()
  })

  it.each([
    'NovaBridge Analytics',
    'Acme Inc',
    'Fenwick Pay',
    'CometHire',
    'BrightScale Technologies',
    'Northstar Technologies',
  ])('accepts real company "%s"', (company) => {
    expect(sanitizeCompanyName(company)).toBe(company)
  })

  it('trims surrounding punctuation from valid companies', () => {
    expect(sanitizeCompanyName('  NovaBridge Analytics, ')).toBe('NovaBridge Analytics')
    expect(sanitizeCompanyName('NovaBridge Analytics.')).toBeNull() // trailing period rejected
  })
})

describe('sanitizeContactName — greeting rejection', () => {
  it.each([
    'Hi there,',
    'Hello,',
    'Hello Team,',
    'Hey,',
    'Good morning,',
    'Dear all,',
    'Greetings,',
  ])('rejects greeting "%s" as a person name', (greeting) => {
    expect(sanitizeContactName(greeting)).toBeNull()
  })

  it.each([
    'Alex',
    'Rebecca Morgan',
    'Chris',
    'Jonas',
    'Sarah Williams',
    "O'Brien",
    'Mary-Jane',
  ])('accepts real name "%s"', (name) => {
    expect(sanitizeContactName(name)).toBe(name)
  })
})

describe('preferFullName', () => {
  it('prefers fuller name when it contains the partial', () => {
    expect(preferFullName('Rebecca', 'Rebecca Morgan')).toBe('Rebecca Morgan')
  })

  it('prefers fuller name when partial contains the fuller', () => {
    expect(preferFullName('Rebecca Morgan', 'Rebecca')).toBe('Rebecca Morgan')
  })

  it('prefers longer name when neither contains the other', () => {
    expect(preferFullName('Alex', 'Alexander')).toBe('Alexander')
  })

  it('returns whichever is non-null when one is null', () => {
    expect(preferFullName(null, 'Alex')).toBe('Alex')
    expect(preferFullName('Alex', null)).toBe('Alex')
    expect(preferFullName(null, null)).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// INTEGRATION: simulate the route's identity resolution
// ══════════════════════════════════════════════════════════════════════════

interface ResolvedIdentity {
  name: string | null
  company: string | null
  role: string | null
}

/**
 * Replicates the route's identity resolution logic:
 *   rawName = signature?.name ?? introduction?.name ?? canonicalName
 *   resolvedName = sanitizeContactName(preferFullName(rawName, introduction?.name))
 *   extractedCompany = sanitizeCompanyName(signature?.company ?? introduction?.company ?? canonicalCompany)
 *   extractedRole = signature?.title ?? introduction?.role ?? canonicalTitle
 */
function resolveIdentity(params: {
  signatureName?: string | null
  signatureCompany?: string | null
  signatureRole?: string | null
  introductionName?: string | null
  introductionCompany?: string | null
  introductionRole?: string | null
  canonicalName?: string | null
  canonicalCompany?: string | null
  canonicalRole?: string | null
}): ResolvedIdentity {
  const sig = { name: params.signatureName ?? null, company: params.signatureCompany ?? null, title: params.signatureRole ?? null }
  const intro = { name: params.introductionName ?? null, company: params.introductionCompany ?? null, role: params.introductionRole ?? null }
  const rawName = sig.name ?? intro.name ?? params.canonicalName ?? null
  const resolvedName = sanitizeContactName(preferFullName(rawName, intro.name ?? null))
  const company = sanitizeCompanyName(sig.company ?? intro.company ?? params.canonicalCompany ?? null)
  const role = sig.title ?? intro.role ?? params.canonicalRole ?? null
  return { name: resolvedName, company, role }
}

// ══════════════════════════════════════════════════════════════════════════
// BROWSER QA REGRESSIONS
// ══════════════════════════════════════════════════════════════════════════

describe('TEST A — Freelance Seller (Alex)', () => {
  const message = [
    'Hi there,',
    '',
    'My name is Alex.',
    '',
    "I'm a freelance full-stack developer specializing in React, Node.js, and PostgreSQL.",
    '',
    "I'm looking for freelance projects and clients.",
    '',
    'Thanks,',
    'Alex',
  ].join('\n')

  it('signature extraction does not extract a company from greeting', () => {
    const sig = extractTrailingSignature(message)
    expect(sig).toEqual({ name: 'Alex', title: null, company: null })
  })

  it('introduction extraction finds the name', () => {
    const intro = extractIntroduction(message)
    expect(intro?.name).toBe('Alex')
  })

  it('route identity resolution: no greeting as company', () => {
    // Simulate: AI model returns greeting as canonical company (the bug)
    const result = resolveIdentity({
      signatureName: 'Alex',
      signatureCompany: null,
      signatureRole: null,
      introductionName: 'Alex',
      introductionCompany: null,
      introductionRole: null,
      canonicalName: 'Alex',
      canonicalCompany: 'Hi there,', // AI model bug
      canonicalRole: null,
    })
    expect(result.name).toBe('Alex')
    expect(result.company).toBeNull() // greeting sanitized away
  })
})

describe('TEST B — Buyer with Introduction (Rebecca)', () => {
  const message = [
    'Good afternoon,',
    '',
    'This is Rebecca Morgan from NovaBridge Analytics.',
    '',
    'I lead our product engineering department.',
    '',
    "We're currently evaluating external software development agencies to build a customer analytics dashboard.",
    '',
    'Our management has approved $75,000.',
    '',
    'We plan to start in January 2027.',
    '',
    'Kind regards,',
    'Rebecca',
    'Engineering Director',
  ].join('\n')

  it('signature extracts Rebecca + Engineering Director', () => {
    const sig = extractTrailingSignature(message)
    expect(sig?.name).toBe('Rebecca')
    expect(sig?.title).toBe('Engineering Director')
  })

  it('introduction extracts Rebecca Morgan + company', () => {
    const intro = extractIntroduction(message)
    expect(intro?.name).toBe('Rebecca Morgan')
    expect(intro?.company).toBe('NovaBridge Analytics')
  })

  it('route identity resolution: fuller name preferred, no trailing "I" in company', () => {
    // Simulate: AI returns "NovaBridge Analytics I" (trailing fragment bug)
    const result = resolveIdentity({
      signatureName: 'Rebecca',
      signatureCompany: null,
      signatureRole: 'Engineering Director',
      introductionName: 'Rebecca Morgan',
      introductionCompany: 'NovaBridge Analytics',
      introductionRole: null,
      canonicalName: 'Rebecca',
      canonicalCompany: 'NovaBridge Analytics I', // AI model bug
      canonicalRole: 'Engineering Director',
    })
    expect(result.name).toBe('Rebecca Morgan') // fuller name preferred
    expect(result.company).toBe('NovaBridge Analytics') // clean, no trailing "I"
    expect(result.role).toBe('Engineering Director')
  })
})

describe('TEST C — Ambiguous Inquiry (Chris)', () => {
  const message = [
    'Hello,',
    '',
    'I recently came across your software development company and wanted to learn more.',
    '',
    'Could you share pricing and previous projects?',
    '',
    'Nothing has been finalized yet.',
    '',
    'Thanks,',
    'Chris',
  ].join('\n')

  it('signature extracts Chris only', () => {
    const sig = extractTrailingSignature(message)
    expect(sig?.name).toBe('Chris')
    expect(sig?.company).toBeNull()
  })

  it('route identity resolution: no greeting as company', () => {
    const result = resolveIdentity({
      signatureName: 'Chris',
      canonicalName: 'Chris',
      canonicalCompany: 'Hello,', // AI model bug
    })
    expect(result.name).toBe('Chris')
    expect(result.company).toBeNull() // greeting sanitized away
  })
})

describe('TEST D — No Identifiable Sender', () => {
  const message = [
    'Hello Team,',
    '',
    'We are exploring an inventory system rebuild.',
    '',
    'Our budget and timeline are not finalized.',
    '',
    'Please share your services and pricing.',
    '',
    'Thank you.',
  ].join('\n')

  it('signature returns null for greeting-only message', () => {
    expect(extractTrailingSignature(message)).toBeNull()
  })

  it('route identity resolution: greeting not extracted as name', () => {
    const result = resolveIdentity({
      canonicalName: 'Hello Team,', // AI model bug
      canonicalCompany: null,
    })
    expect(result.name).toBeNull() // greeting sanitized away
    expect(result.company).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// SYNTHETIC FIXTURES — unseen identities and structures
// ══════════════════════════════════════════════════════════════════════════

describe('Synthetic — varied greeting rejection as company', () => {
  it.each([
    'Good morning,',
    'Good evening,',
    'Hey there,',
    'Dear team,',
    'Hi folks,',
    'Greetings everyone',
    'Good day,',
  ])('rejects "%s" as company', (greeting) => {
    expect(sanitizeCompanyName(greeting)).toBeNull()
  })
})

describe('Synthetic — introduction patterns with unseen names', () => {
  it('extracts "My name is Priya Sharma"', () => {
    expect(extractIntroduction('My name is Priya Sharma.')).toEqual({ name: 'Priya Sharma', role: null, company: null })
  })

  it('extracts "I am Daniel O\'Brien from Vertex Solutions"', () => {
    const result = extractIntroduction("I am Daniel O'Brien from Vertex Solutions.")
    expect(result?.name).toBe("Daniel O'Brien")
    expect(result?.company).toBe('Vertex Solutions')
  })

  it('extracts "This is Marcus Chen from Helix Dynamics"', () => {
    const result = extractIntroduction('This is Marcus Chen from Helix Dynamics.')
    expect(result?.name).toBe('Marcus Chen')
    expect(result?.company).toBe('Helix Dynamics')
  })

  it('extracts "Myself Jennifer Lopez"', () => {
    expect(extractIntroduction('Myself Jennifer Lopez')).toEqual({ name: 'Jennifer Lopez', role: null, company: null })
  })

  it('extracts "I oversee the data science team at Quantum Labs"', () => {
    const result = extractIntroduction('I oversee the data science team at Quantum Labs.')
    expect(result?.name).toBeNull()
    expect(result?.role).toBe('Data Science Team')
    expect(result?.company).toBe('Quantum Labs')
  })

  it('extracts role from self-description: "I am a machine learning engineer at DeepMind"', () => {
    const result = extractIntroduction('I work as a machine learning engineer at DeepMind.')
    expect(result?.name).toBeNull()
    expect(result?.role).toBe('Machine Learning Engineer')
    expect(result?.company).toBe('DeepMind')
  })
})

describe('Synthetic — multi-line signatures with unseen identities', () => {
  it('extracts "Yuki Tanaka / CTO / Sakura Tech"', () => {
    const msg = "We need a new website.\n\nBest,\nYuki Tanaka\nCTO\nSakura Tech"
    expect(extractTrailingSignature(msg)).toEqual({ name: 'Yuki Tanaka', title: 'CTO', company: 'Sakura Tech' })
  })

  it('extracts single-name signature "Mateo"', () => {
    const msg = "Interested in your services.\n\nThanks,\nMateo"
    const sig = extractTrailingSignature(msg)
    expect(sig?.name).toBe('Mateo')
  })

  it('extracts "Aisha Patel / Engineering Director" without company', () => {
    const msg = "We have a project.\n\nRegards,\nAisha Patel\nEngineering Director"
    const sig = extractTrailingSignature(msg)
    expect(sig?.name).toBe('Aisha Patel')
    expect(sig?.title).toBe('Engineering Director')
    expect(sig?.company).toBeNull()
  })

  it('does not extract company from prose line containing role keyword', () => {
    // A line like "I'm a freelance developer" should not yield "Developer" as company
    const sig = extractTrailingSignature("Hi,\n\nI'm a freelance developer.\n\nThanks,\nSam")
    expect(sig?.name).toBe('Sam')
    expect(sig?.company).toBeNull()
  })
})

describe('Synthetic — company boundary detection', () => {
  it('rejects company with trailing sentence fragment', () => {
    // "Acme I" where "I" starts the next sentence
    expect(sanitizeCompanyName('Acme I')).toBeNull()
    expect(sanitizeCompanyName('NovaBridge Analytics I')).toBeNull()
    expect(sanitizeCompanyName('Fenwick Pay We')).toBeNull()
  })

  it('accepts multi-word companies with connectors', () => {
    expect(sanitizeCompanyName('Acme & Co')).toBe('Acme & Co')
    expect(sanitizeCompanyName('Northstar Technologies')).toBe('Northstar Technologies')
  })
})

describe('Synthetic — name vs company disambiguation', () => {
  it('accepts companies with legal suffixes', () => {
    expect(sanitizeCompanyName('Acme Inc')).toBe('Acme Inc')
    expect(sanitizeCompanyName('Fenwick Pay Ltd')).toBe('Fenwick Pay Ltd')
    expect(sanitizeCompanyName('Acme LLC')).toBe('Acme LLC')
  })
})

describe('Synthetic — role extraction from prose', () => {
  it('sanitizePersonTitle extracts role from "I am a data scientist"', () => {
    expect(sanitizePersonTitle("I'm a data scientist")).toBe('Data Scientist')
  })

  it('sanitizePersonTitle rejects greetings', () => {
    expect(sanitizePersonTitle('Hello')).toBeNull()
    expect(sanitizePersonTitle('Hi there')).toBeNull()
  })
})
