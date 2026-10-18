/**
 * Reply Generation Hallucination Guard
 *
 * Ensures generated replies only use entities that exist in:
 * - sender profile
 * - proof library
 * - selected offer
 * - prospect source
 * - known organization context
 *
 * Rejects any reply that introduces unknown named entities.
 */

export interface HallucinationGuardInput {
  generatedReply: string
  senderProfile: {
    fullName: string
    title: string
    organizationName: string
    capabilities: string[]
  }
  proofLibrary: Array<{
    title: string
    clientName: string | null
    capabilities: string[]
  }>
  prospectContext: {
    company: string
    contactName: string
    industry: string | null
    sourceEvidence: string[]
  }
  knownEntities?: string[]
}

export interface HallucinationGuardResult {
  passed: boolean
  violations: string[]
  sanitizedReply: string | null
}

// Common hallucinated patterns to reject
const HALLUCINATION_PATTERNS = [
  /\b[A-Z][a-z]+Me\b/,           // "FayndMe" pattern
  /\b[A-Z][a-z]{2,8}ify\b/,      // "Xify" invented names
  /\b[A-Z][a-z]+Hub\b/,          // "XHub" invented names
  /\b[A-Z][a-z]+Lab\b/,          // "XLab" invented names
  /\b[A-Z][a-z]+Flow\b/,         // "XFlow" invented names
  /\b[A-Z][a-z]+Pad\b/,          // "XPad" invented names
  /\b[A-Z][a-z]+App\b/,          // "XApp" (unless known)
  /\b[A-Z][a-z]+OS\b/,           // "XOS" invented names
]

/**
 * Validate a generated reply against known context.
 * Returns pass/fail with violations.
 */
export function validateReply(input: HallucinationGuardInput): HallucinationGuardResult {
  const violations: string[] = []
  const knownNames = buildKnownEntitySet(input)

  // 1. Check for hallucinated name patterns
  for (const pattern of HALLUCINATION_PATTERNS) {
    const match = input.generatedReply.match(pattern)
    if (match && !knownNames.has(match[0].toLowerCase())) {
      violations.push(`Hallucinated entity: "${match[0]}" not found in sender profile, proof, or prospect context`)
    }
  }

  // 2. Extract all proper nouns (capitalized words that aren't sentence starts)
  const properNouns = extractProperNouns(input.generatedReply)

  for (const noun of properNouns) {
    if (!knownNames.has(noun.toLowerCase()) && isLikelyEntityName(noun)) {
      violations.push(`Unknown proper noun: "${noun}" — not in known context`)
    }
  }

  // 3. Check for invented product/service claims
  const inventedClaims = detectInventedClaims(input.generatedReply, input.senderProfile)
  violations.push(...inventedClaims)

  return {
    passed: violations.length === 0,
    violations,
    sanitizedReply: violations.length === 0 ? input.generatedReply : null,
  }
}

function buildKnownEntitySet(input: HallucinationGuardInput): Set<string> {
  const known = new Set<string>()

  // Sender entities
  known.add(input.senderProfile.fullName.toLowerCase())
  known.add(input.senderProfile.organizationName.toLowerCase())
  input.senderProfile.capabilities.forEach(c => known.add(c.toLowerCase()))

  // Proof entities
  input.proofLibrary.forEach(p => {
    known.add(p.title.toLowerCase())
    if (p.clientName) {
      known.add(p.clientName.toLowerCase())
      // Also add individual words from multi-word names
      p.clientName.split(/\s+/).forEach(w => {
        if (w.length > 2) known.add(w.toLowerCase())
      })
    }
    p.capabilities.forEach(c => known.add(c.toLowerCase()))
  })

  // Prospect entities
  known.add(input.prospectContext.company.toLowerCase())
  if (input.prospectContext.contactName) known.add(input.prospectContext.contactName.toLowerCase())
  if (input.prospectContext.industry) known.add(input.prospectContext.industry.toLowerCase())

  // Evidence from prospect source
  input.prospectContext.sourceEvidence.forEach(e => {
    // Extract proper nouns from evidence
    const words = e.split(/\s+/)
    for (const word of words) {
      if (/^[A-Z]/.test(word) && word.length > 2) {
        known.add(word.toLowerCase())
      }
    }
  })

  // Explicitly known entities
  ;(input.knownEntities ?? []).forEach(e => known.add(e.toLowerCase()))

  return known
}

function extractProperNouns(text: string): string[] {
  const nouns: string[] = []
  const words = text.split(/\s+/)

  for (let i = 0; i < words.length; i++) {
    // Keep hyphenated words together, strip only trailing punctuation
    const word = words[i].replace(/[.,;:!?()]$/, '')
    if (!word) continue

    // Skip sentence-start words (after period or start of text)
    const isSentenceStart = i === 0 || /[.!?]$/.test(words[i - 1] ?? '')
    if (isSentenceStart) continue

    // Skip common lowercase words and short words
    if (word.length < 3) continue

    // Skip hyphenated compound words that are clearly not entities (e.g., "AI-powered")
    if (word.includes('-')) continue

    // Capitalized word in the middle of a sentence = likely proper noun
    if (/^[A-Z]/.test(word) && word.length > 2) {
      nouns.push(word)
    }
  }

  return [...new Set(nouns)]
}

function isLikelyEntityName(word: string): boolean {
  // Skip common words that happen to be capitalized
  const commonWords = new Set(['i', 'we', 'our', 'my', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up', 'down', 'that', 'this', 'these', 'those', 'it', 'its', 'us', 'him', 'her', 'them', 'his', 'he', 'she', 'me'])

  if (commonWords.has(word.toLowerCase())) return false
  if (word.length < 3) return false

  // Skip common business suffixes that aren't entities on their own
  const suffixes = new Set(['inc', 'inc.', 'ltd', 'ltd.', 'llc', 'gmbh', 'corp', 'corp.', 'co', 'co.', 'company', 'group', 'team', 'studio', 'labs', 'tech', 'io', 'ai', 'saas'])
  if (suffixes.has(word.toLowerCase())) return false

  return true
}

function detectInventedClaims(reply: string, senderProfile: {
  fullName: string
  title: string
  organizationName: string
  capabilities: string[]
}): string[] {
  const violations: string[] = []

  // Check for claims about capabilities not in sender profile
  const capabilityClaims = reply.match(/we (?:specialize in|offer|provide|build|develop|create)\s+([^.]+)/gi)
  if (capabilityClaims) {
    for (const claim of capabilityClaims) {
      const claimed = claim.toLowerCase()
      const knownCaps = senderProfile.capabilities.map(c => c.toLowerCase())

      // If the claim mentions something not in known capabilities
      const unknownClaim = !knownCaps.some(tc => claimed.includes(tc))
      if (unknownClaim && /ai|ml|blockchain|web3|metaverse/i.test(claimed)) {
        violations.push(`Claimed capability not in sender profile: "${claim}"`)
      }
    }
  }

  return violations
}
