/**
 * Content Quality Engine
 *
 * Four hard gates every post must pass before reaching the user:
 * 1. Language Gate — no broken grammar, incomplete sentences, dangling punctuation
 * 2. Insight Gate — no generic advice older than ~2 years without fresh angle
 * 3. Specificity Gate — must contain concrete evidence, numbers, tools, or examples
 * 4. Persona Fit Gate — must be relevant to the persona's expertise/territories
 *
 * Posts that fail are either repaired or rejected for regeneration.
 */

export interface QualityScore {
  grammar: number
  specificity: number
  novelty: number
  technicalDepth: number
  credibility: number
  trendRelevance: number
  personaFit: number
  nonGenericness: number
  overall: number
  failures: string[]
}

export interface QualityCheckResult {
  passed: boolean
  score: QualityScore
  repairAttempts: number
  wasRepaired: boolean
}


const BROKEN_PATTERNS: [RegExp, string][] = [
  [/\bwe a function\b/gi, 'incomplete sentence: missing verb'],
  [/\bThe code list\b/gi, 'incomplete sentence: missing verb'],
  [/\bHere's catch\b/gi, 'missing article: "Here\'s the catch"'],
  [/\bas the unless\b/gi, 'incomplete phrase'],
  [/\b, I advocate\b/gi, 'sentence fragment: dangling comma start'],
  [/\bEvery team joined\b/gi, 'missing pronoun: "Every team I\'ve joined"'],
  [/\bwe a [a-z]+ that\b/gi, 'missing verb after "we a"'],
  [/\bThe [a-z]+ [a-z]+s to\b/gi, 'missing verb: "The X verbs to..."'],
  [/Here's\s+[a-z]+/gi, 'possible missing article after "Here\'s"'],
  [/\b, [A-Z][a-z]+ I\b/gi, 'dangling comma before capital'],
  [/\b[a-z]+ing [a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+\b/gi, 'run-on sentence'],
]

const INCOMPLETE_SENTENCE_PATTERNS = [
  /\b(we|I|they|it|the|this|that|here|there)\s+[a-z]+ed\s+(a|an|the|my|our|their)\s+[a-z]+\s*$/i,
  /\b(we|I|they|it)\s+[a-z]+\s+(a|an|the)\s+[a-z]+\s+that\s*$/i,
  /\b[a-z]+s\s+to\s+[a-z]+\s+and\s*$/i,
]


const GENERIC_PATTERNS: [RegExp, string][] = [
  [/\buse generators instead of list comprehensions\b/gi, 'generic Python tip from ~2015'],
  [/\buse list comprehensions\b/gi, 'generic Python advice'],
  [/\boptimize your code\b/gi, 'too vague'],
  [/\bbest practices\b/gi, 'generic phrase'],
  [/\bfollow these tips\b/gi, 'generic closing'],
  [/\bhere are \d+ (tips|things|ways|reasons)\b/gi, 'listicle format'],
  [/\bin today's fast-paced\b/gi, 'cliché opener'],
  [/\bcontinues to evolve\b/gi, 'filler phrase'],
  [/\bgame changer\b/gi, 'buzzword'],
  [/\bat the end of the day\b/gi, 'filler phrase'],
]


const EVIDENCE_PATTERNS = [
  /\b\d+%/,
  /\b\d+x\b/,
  /\b\d+\s*(ms|mb|gb|tb|seconds|minutes)\b/i,
  /\b\d{4}\b/,  // year
  /\b\d+\s*(users|requests|transactions|records|rows)\b/i,
  /\b(python|rust|go|typescript|react|kubernetes|docker|postgres|redis|aws|gcp)\b/i,
  /\b(we|I|our team|my team)\s+(found|discovered|noticed|measured|observed|ran)\b/i,
  /\b(in one project|in our case|at [A-Z]|in production)\b/i,
]

const VAGUE_PATTERNS = [
  /\bcan be\b/gi,
  /\bmight be\b/gi,
  /\bpossibly\b/gi,
  /\bsometimes\b/gi,
  /\bconsider using\b/gi,
  /\byou should\b/gi,
  /\bit's important to\b/gi,
]


export function checkContentQuality(
  post: string,
  options?: {
    personaRole?: string
    territories?: string[]
    expertise?: string[]
    trendGrounded?: boolean
  },
): QualityCheckResult {
  const failures: string[] = []
  let grammar = 10
  let specificity = 5
  let novelty = 5
  let technicalDepth = 5
  let credibility = 5
  const trendRelevance = options?.trendGrounded ? 5 : 3
  let personaFit = 5
  let nonGenericness = 5

  let languageFailures = 0
  for (const [pattern, msg] of BROKEN_PATTERNS) {
    if (pattern.test(post)) {
      failures.push(`LANGUAGE: ${msg}`)
      languageFailures++
      grammar -= 2
    }
  }
  for (const pattern of INCOMPLETE_SENTENCE_PATTERNS) {
    if (pattern.test(post)) {
      failures.push('LANGUAGE: incomplete sentence detected')
      languageFailures++
      grammar -= 1.5
    }
  }
  const sentences = post.split(/[.!?]+/).filter(s => s.trim().length > 5)
  for (const s of sentences) {
    const trimmed = s.trim()
    if (trimmed.length > 0 && /^[a-z]/.test(trimmed) && !/^(e\.g|i\.e|etc)/.test(trimmed)) {
      failures.push(`LANGUAGE: sentence starts lowercase: "${trimmed.slice(0, 40)}..."`)
      grammar -= 1
    }
  }
  grammar = Math.max(0, grammar)

  let genericHits = 0
  for (const [pattern, msg] of GENERIC_PATTERNS) {
    if (pattern.test(post)) {
      failures.push(`INSIGHT: ${msg}`)
      genericHits++
      novelty -= 1.5
      nonGenericness -= 2
    }
  }
  novelty = Math.max(0, novelty)
  nonGenericness = Math.max(0, nonGenericness)

  let evidenceHits = 0
  for (const pattern of EVIDENCE_PATTERNS) {
    if (pattern.test(post)) evidenceHits++
  }
  specificity = Math.min(10, evidenceHits * 2)
  if (evidenceHits < 2) {
    failures.push(`SPECIFICITY: only ${evidenceHits} evidence points (need 2+)`)
  }
  // Penalize vague language
  let vagueHits = 0
  for (const pattern of VAGUE_PATTERNS) {
    if (pattern.test(post)) vagueHits++
  }
  if (vagueHits > 2) {
    failures.push('SPECIFICITY: too many vague qualifiers')
    specificity -= 2
  }
  specificity = Math.max(0, specificity)

  const techTerms = post.match(/\b(function|class|method|api|database|query|cache|memory|cpu|thread|process|server|deploy|pipeline|test|debug|refactor|pattern|architecture|system|service|container|cluster|node|request|response|latency|throughput|bandwidth|storage|network|protocol|algorithm|data structure|optimization|benchmark|profiling)\b/gi)
  technicalDepth = Math.min(10, (techTerms?.length ?? 0) * 1.5)
  if (!techTerms || techTerms.length < 3) {
    failures.push('TECHNICAL: insufficient technical depth')
  }

  const hasFirstPerson = /\b(I|we|my|our)\b/i.test(post)
  const hasSpecificClaim = /\b\d+%|\d+x|\d+\s*(ms|mb|gb)/i.test(post)
  if (hasFirstPerson) credibility += 2
  if (hasSpecificClaim) credibility += 3
  if (!hasFirstPerson && !hasSpecificClaim) {
    failures.push('CREDIBILITY: no first-person evidence or specific claims')
    credibility -= 2
  }
  credibility = Math.max(0, Math.min(10, credibility))

  if (options?.personaRole) {
    const roleLower = options.personaRole.toLowerCase()
    const postLower = post.toLowerCase()
    const roleKeywords = roleLower.split(/[\s\/|]+/)
    const matchCount = roleKeywords.filter(kw => postLower.includes(kw)).length
    personaFit = Math.min(10, 5 + matchCount * 2)
    if (matchCount === 0 && options?.territories?.length) {
      const territoryMatch = options.territories.some(t => postLower.includes(t.toLowerCase()))
      if (territoryMatch) personaFit = 6
    }
  }

  const overall = (
    grammar * 0.25 +
    specificity * 0.2 +
    novelty * 0.15 +
    technicalDepth * 0.15 +
    credibility * 0.1 +
    nonGenericness * 0.1 +
    personaFit * 0.05
  )

  const passed = grammar >= 6 && specificity >= 4 && novelty >= 3 && failures.filter(f => f.startsWith('LANGUAGE:')).length === 0

  return {
    passed,
    score: {
      grammar,
      specificity,
      novelty,
      technicalDepth,
      credibility,
      trendRelevance,
      personaFit,
      nonGenericness,
      overall,
      failures,
    },
    repairAttempts: 0,
    wasRepaired: false,
  }
}


export function repairPost(text: string): string {
  let repaired = text

  // Fix "we a function" → "we had a function"
  repaired = repaired.replace(/\bwe a function\b/gi, 'we had a function')
  // Fix "The code list comprehensions" → "The code used list comprehensions"
  repaired = repaired.replace(/\bThe code list comprehensions\b/gi, 'The code used list comprehensions')
  // Fix "Here's catch" → "Here's the catch"
  repaired = repaired.replace(/\bHere's catch\b/gi, "Here's the catch")
  // Fix "as the unless" → "unless"
  repaired = repaired.replace(/\bas the unless\b/gi, 'unless')
  // Fix ", I advocate" → ". I advocate"
  repaired = repaired.replace(/,\s*I advocate/gi, '. I advocate')
  // Fix "Every team joined" → "Every team I've joined"
  repaired = repaired.replace(/\bEvery team joined\b/gi, "Every team I've joined")
  // Fix sentences starting with lowercase after period
  repaired = repaired.replace(/\.\s+([a-z])/g, (_, c) => `. ${c.toUpperCase()}`)

  return repaired.trim()
}
