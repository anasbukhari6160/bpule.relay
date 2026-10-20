/**
 * Premium Writing Engine — shared writing-quality layer.
 *
 * This module is the single source of truth for writing quality rules,
 * anti-AI patterns, style controls, and quality gates across ALL generation
 * paths: BD outreach (DMs, proposals, follow-ups), content Studio (LinkedIn, X),
 * and Forge. Task-specific generators reuse these shared rules instead of
 * duplicating prompts.
 */


export const BANNED_PHRASES = [
  'unpopular opinion:',
  "here's the thing",
  'let that sink in',
  "here's why",
  'thread 🧵',
  'thread 🧵👇',
  '👇',
  '💡',
  'let me tell you',
  'the truth is',
  'nobody talks about this',
  'i wish i knew this sooner',
  'stop scrolling',
  'read that again',
  "here's what nobody tells you",
  "here's the truth",
  'the real truth',
  'let that marinate',
  'pause for a second',
  'think about it',
  'mind blown',
  'game changer',
  'game-changing',
  'in today\'s world',
  'in today\'s',
  'i learned something',
  'i learned a valuable',
  'it\'s not just about',
  "it's not x, it's y",
  'most people don\'t',
  'most people think',
  'most people believe',
  'agree?',
  'thoughts?',
  'who else?',
  'am i right?',
  'right?',
  'let that sink',
  'nobody talks about',
  'the secret is',
  'the key is',
  'the biggest mistake',
  'wake up',
  'sheeeep',
  'this is huge',
  'huge opportunity',
  'massive potential',
  'i came across your',
  'i was immediately excited',
  'with [x]+ years of experience',
  'i am confident',
  'i\'d love the opportunity',
  'i would love the opportunity',
  'just following up',
  'checking in',
  'bumping this',
  'saw your post',
  'this caught my eye',
  'we specialize in',
  'i can write a quick analysis',
  'would that be useful',
  'over the past 8 years',
  'over the past few years',
  'did you see my',
  'hope this finds you well',
  'i hope you\'re doing well',
  'i hope this message finds you',
  'i hope you are doing well',
  'i wanted to reach out',
  'i wanted to take a moment',
  'first and foremost',
  'at the end of the day',
  'going forward',
  'moving forward',
  'in order to',
  'as we all know',
  'needless to say',
  'it goes without saying',
] as const

export const BANNED_HOOK_PATTERNS = [
  /^(are|is|do|does|can|could|would|will|have|has|did)\s.+\?$/i,
  /^(unpopular\s+opinion|the\s+truth\s+about|nobody\s+talks\s+about|here's\s+what\s+nobody)/i,
  /^(i\s+think|i\s+believe|i\s+feel)\s/i,
  /^(have\s+you\s+ever|did\s+you\s+know)/i,
] as const

export const AI_TELL_PHRASES = [
  'delve into',
  'in the realm of',
  'it\'s important to note',
  'it\'s worth noting',
  'it should be noted',
  'as a matter of fact',
  'in conclusion',
  'to summarize',
  'to sum up',
  'all things considered',
  'when all is said and done',
  'at the end of the day',
  'in today\'s fast-paced',
  'in this day and age',
  'in the world of',
  'navigate the complexities',
  'leverage the power',
  'unlock the potential',
  'drive innovation',
  'push the boundaries',
  'break the mold',
  'think outside the box',
  'synergy',
  'holistic approach',
  'robust solution',
  'seamless integration',
  'cutting-edge',
  'state-of-the-art',
  'best-in-class',
  'world-class',
  'industry-leading',
  'mission-critical',
  'pain point',
  'bandwidth',
  'circle back',
  'touch base',
  'deep dive',
  'low-hanging fruit',
  'moving the needle',
  'move the needle',
  'paradigm shift',
] as const


export interface VoiceRules {
  emoji: 'none' | 'light' | 'moderate'
  emDashes: 'none' | 'rare'
  oneLineParagraphs: 'varied' | 'structured'
  endingStyle: 'natural' | 'question' | 'cta' | 'none'
  sentenceRhythm: 'varied' | 'short' | 'measured'
}

export const DEFAULT_VOICE_RULES: VoiceRules = {
  emoji: 'none',
  emDashes: 'none',
  oneLineParagraphs: 'varied',
  endingStyle: 'natural',
  sentenceRhythm: 'varied',
}

export function buildVoiceRulesPrompt(rules: VoiceRules): string {
  const lines: string[] = []

  if (rules.emoji === 'none') {
    lines.push('No emojis. None. Do not use emoji as decoration, bullets, or emphasis.')
  }

  if (rules.emDashes === 'none') {
    lines.push('No em dashes. If you feel the urge to use an em dash, rewrite the sentence as two plain sentences or use a period. Do not replace em dashes mechanically with semicolons — write naturally.')
  }

  if (rules.oneLineParagraphs === 'varied') {
    lines.push('Vary paragraph length. Not every paragraph should be one line. Some ideas deserve a single line. Others need three or four sentences to land.')
  }

  if (rules.endingStyle === 'natural') {
    lines.push('Do not end with a generic call to action like "Thoughts?" or "Agree?" or "What do you think?" End on the idea itself. The last line should earn its place.')
  }

  if (rules.sentenceRhythm === 'varied') {
    lines.push('Vary sentence length. Follow a long sentence with a short one. Then a medium one. Uniform rhythm sounds generated.')
  }

  return lines.join('\n')
}


export type ContentStructure =
  | 'observation'
  | 'story_to_realization'
  | 'mistake_to_lesson'
  | 'technical_breakdown'
  | 'contrarian_argument'
  | 'decision_with_reasoning'
  | 'before_after'
  | 'short_insight'
  | 'mini_case_study'
  | 'field_note'
  | 'misconception_correction'
  | 'practical_framework'
  | 'narrative'
  | 'teardown'
  | 'opinion_with_evidence'
  | 'unexpected_result'
  | 'direct_teaching'

export interface StructureSelection {
  structure: ContentStructure
  reason: string
}

/**
 * Select a structure for the content based on the material and what's been
 * used recently. Avoids forcing every post into the same hook→story→bullets→lesson→CTA pattern.
 */
export function selectStructure(
  sourceMaterial: string,
  recentStructures: ContentStructure[],
  mode: 'personal' | 'opinion',
): StructureSelection {
  const lower = sourceMaterial.toLowerCase()
  const wordCount = sourceMaterial.split(/\s+/).length

  // Count how many times each structure was used recently
  const usage = new Map<ContentStructure, number>()
  for (const s of recentStructures) {
    usage.set(s, (usage.get(s) ?? 0) + 1)
  }

  // Score each structure by fit, penalizing overuse
  const candidates: Array<{ structure: ContentStructure; score: number; reason: string }> = []

  // Personal experience with a clear mistake/lesson
  if (mode === 'personal' && (lower.includes('mistake') || lower.includes('wrong') || lower.includes('failed') || lower.includes('broke') || lower.includes('debugged'))) {
    candidates.push({ structure: 'mistake_to_lesson', score: 3 - (usage.get('mistake_to_lesson') ?? 0), reason: 'Personal mistake material suits a mistake→diagnosis→lesson arc' })
    candidates.push({ structure: 'story_to_realization', score: 2.5 - (usage.get('story_to_realization') ?? 0), reason: 'Personal story with a realization fits naturally' })
  }

  // Technical content
  if (lower.includes('how to') || lower.includes('how i') || lower.includes('built') || lower.includes('implemented') || lower.includes('configured') || lower.includes('deployed')) {
    candidates.push({ structure: 'technical_breakdown', score: 2.5 - (usage.get('technical_breakdown') ?? 0), reason: 'Technical how-to material' })
    candidates.push({ structure: 'field_note', score: 2 - (usage.get('field_note') ?? 0), reason: 'Technical field note fits' })
  }

  // Contrarian / opinion content
  if (mode === 'opinion' || lower.includes('wrong') || lower.includes('overrated') || lower.includes('underrated') || lower.includes('most people') || lower.includes('should') || lower.includes('shouldn\'t')) {
    candidates.push({ structure: 'contrarian_argument', score: 3 - (usage.get('contrarian_argument') ?? 0), reason: 'Opinion material with a contrarian angle' })
    candidates.push({ structure: 'misconception_correction', score: 2.5 - (usage.get('misconception_correction') ?? 0), reason: 'Correcting a common misconception' })
  }

  // Decision/reasoning content
  if (lower.includes('chose') || lower.includes('decided') || lower.includes('why we') || lower.includes('reason') || lower.includes('tradeoff') || lower.includes('trade-off')) {
    candidates.push({ structure: 'decision_with_reasoning', score: 2.5 - (usage.get('decision_with_reasoning') ?? 0), reason: 'Decision with reasoning' })
  }

  // Before/after content
  if (lower.includes('before') || lower.includes('after') || lower.includes('used to') || lower.includes('now') || lower.includes('switched') || lower.includes('migrated')) {
    candidates.push({ structure: 'before_after', score: 2.5 - (usage.get('before_after') ?? 0), reason: 'Before/after transformation' })
  }

  // General fallbacks
  candidates.push({ structure: 'observation', score: 1.5 - (usage.get('observation') ?? 0), reason: 'Sharp observation' })
  candidates.push({ structure: 'short_insight', score: 1.5 - (usage.get('short_insight') ?? 0), reason: 'Short insight for concise material' })
  candidates.push({ structure: 'direct_teaching', score: 1 - (usage.get('direct_teaching') ?? 0), reason: 'Direct teaching' })

  if (wordCount < 60) {
    candidates.push({ structure: 'short_insight', score: 2 - (usage.get('short_insight') ?? 0), reason: 'Short material suits a short insight' })
  }

  candidates.sort((a, b) => b.score - a.score)

  const best = candidates[0]
  return { structure: best.structure, reason: best.reason }
}

export function structureToPrompt(structure: ContentStructure): string {
  switch (structure) {
    case 'observation':
      return 'Open with a sharp, specific observation. No setup, no throat-clearing. Get to the point in the first line.'
    case 'story_to_realization':
      return 'Tell the story briefly, then land the realization. The realization is the payload — don\'t bury it.'
    case 'mistake_to_lesson':
      return 'Start with the mistake or what went wrong. Diagnose why. End with the specific lesson — concrete, not generic.'
    case 'technical_breakdown':
      return 'Explain the technical detail clearly. Assume intelligence, not ignorance. Show the specific mechanism.'
    case 'contrarian_argument':
      return 'State the counter-argument clearly. Support it with specific evidence or reasoning. Don\'t hedge excessively.'
    case 'decision_with_reasoning':
      return 'State the decision. Walk through the reasoning. Acknowledge tradeoffs without both-sidesing everything.'
    case 'before_after':
      return 'Show the before. Show the after. Let the contrast speak without over-explaining.'
    case 'short_insight':
      return 'One clear insight. No padding. If the idea is strong in three lines, leave it at three lines.'
    case 'mini_case_study':
      return 'Brief context, what happened, what it meant. Specific numbers or details if available.'
    case 'field_note':
      return 'A practitioner\'s note from the field. What you saw, what you did, what happened. Direct and concrete.'
    case 'misconception_correction':
      return 'Name the misconception. Explain why it\'s wrong. Offer the better way.'
    case 'practical_framework':
      return 'Present the framework plainly. No branding, no naming. Just the useful structure.'
    case 'narrative':
      return 'Tell it as a narrative with a beginning and an end. Let the reader arrive at the point themselves.'
    case 'teardown':
      return 'Take something apart. Show the specific mechanism. What works, what doesn\'t, why.'
    case 'opinion_with_evidence':
      return 'State the opinion. Back it with specific evidence. Don\'t soften it with excessive hedging.'
    case 'unexpected_result':
      return 'Set up the expectation. Reveal the unexpected result. Explain what it taught you.'
    case 'direct_teaching':
      return 'Teach directly. Assume the reader is smart. Show them something specific they can use.'
  }
}


export interface OriginalityReport {
  isOriginal: boolean
  issues: string[]
  score: number // 0-1
}

/**
 * Check if a piece of writing passes originality thresholds.
 * Returns a report with specific issues found.
 */
export function checkOriginality(
  text: string,
  recentTexts: string[],
  bannedPhrases: readonly string[] = BANNED_PHRASES,
): OriginalityReport {
  const issues: string[] = []
  const lower = text.toLowerCase()

  for (const phrase of bannedPhrases) {
    if (lower.includes(phrase.toLowerCase())) {
      issues.push(`Contains banned phrase: "${phrase}"`)
    }
  }

  for (const phrase of AI_TELL_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      issues.push(`Contains AI tell: "${phrase}"`)
    }
  }

  if (/it'?s\s+not\s+[^.]+[.,]\s*it'?s\s+/i.test(text)) {
    issues.push('Contains cliché contrast pattern: "It\'s not X, it\'s Y"')
  }

  const lines = text.split('\n').filter(l => l.trim().length > 0)
  if (lines.length >= 5) {
    const shortLines = lines.filter(l => l.trim().split(/\s+/).length <= 6)
    if (shortLines.length / lines.length > 0.8) {
      issues.push('Excessive one-line paragraphs — varies length to sound human')
    }
  }

  for (const recent of recentTexts) {
    const similarity = computeTextSimilarity(text, recent)
    if (similarity > 0.3) {
      issues.push(`Too similar to recent content (similarity: ${(similarity * 100).toFixed(0)}%)`)
    }
  }

  // Score: start at 1.0, subtract per issue
  const score = Math.max(0, 1 - issues.length * 0.15)

  return {
    isOriginal: issues.length === 0,
    issues,
    score,
  }
}

function computeTextSimilarity(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  const bWords = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  if (aWords.size === 0 || bWords.size === 0) return 0

  let intersection = 0
  for (const w of aWords) {
    if (bWords.has(w)) intersection++
  }
  const union = aWords.size + bWords.size - intersection
  return union === 0 ? 0 : intersection / union
}


export interface InsightAnalysis {
  hasStrongAngle: boolean
  angle: string
  expectation: string
  reality: string
  tension: string
  specificDetail: string
  missingElements: string[]
}

/**
 * Analyze source material to find the strongest angle before writing.
 * Returns what's actually interesting and what's missing.
 */
export function analyzeForInsight(sourceMaterial: string): InsightAnalysis {
  const sentences = sourceMaterial.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10)

  let expectation = ''
  let reality = ''
  let tension = ''
  let specificDetail = ''

  // Look for expectation vs reality
  for (const sentence of sentences) {
    const s = sentence.toLowerCase()
    if ((s.includes('thought') || s.includes('expected') || s.includes('assumed') || s.includes('naturally')) && !expectation) {
      expectation = sentence.trim()
    }
    if ((s.includes('but') || s.includes('actually') || s.includes('turned out') || s.includes('eventually') || s.includes('found')) && !reality) {
      reality = sentence.trim()
    }
    if ((s.includes('interesting') || s.includes('realized') || s.includes('discovered') || s.includes('lesson')) && !tension) {
      tension = sentence.trim()
    }
  }

  for (const sentence of sentences) {
    if (/\d/.test(sentence) || /specific|exactly|precisely|particular/i.test(sentence)) {
      specificDetail = sentence.trim()
      break
    }
  }
  if (!specificDetail && sentences.length > 0) {
    // Use the longest sentence as it often has the most detail
    specificDetail = sentences.reduce((a, b) => a.length > b.length ? a : b)
  }

  const hasStrongAngle = Boolean(
    (expectation && reality) ||
    (tension && specificDetail) ||
    (sentences.length >= 3 && specificDetail.length > 20),
  )

  const angle = tension || reality || specificDetail || sentences[0] || ''

  const missingElements: string[] = []
  if (!reality && !tension) missingElements.push('What actually happened or was discovered')
  if (!specificDetail) missingElements.push('A specific, concrete detail (number, name, tool, timing)')
  if (sentences.length < 3) missingElements.push('More context or detail about the situation')

  return {
    hasStrongAngle,
    angle,
    expectation,
    reality,
    tension,
    specificDetail,
    missingElements,
  }
}


export interface QualityGateResult {
  passed: boolean
  issues: string[]
  score: number // 0-1
}

export interface QualityGateOptions {
  checkOriginality: boolean
  checkSpecificity: boolean
  checkHumanization: boolean
  checkStructure: boolean
  recentTexts: string[]
  minSpecificityWords: number
}

const DEFAULT_GATE_OPTIONS: QualityGateOptions = {
  checkOriginality: true,
  checkSpecificity: true,
  checkHumanization: true,
  checkStructure: true,
  recentTexts: [],
  minSpecificityWords: 2,
}

/**
 * Run a comprehensive quality gate on a piece of generated writing.
 * Returns pass/fail with specific issues and a score.
 */
export function runQualityGate(
  text: string,
  sourceMaterial: string,
  options: Partial<QualityGateOptions> = {},
): QualityGateResult {
  const opts = { ...DEFAULT_GATE_OPTIONS, ...options }
  const issues: string[] = []

  // 1. Originality check
  if (opts.checkOriginality) {
    const orig = checkOriginality(text, opts.recentTexts)
    if (!orig.isOriginal) {
      issues.push(...orig.issues)
    }
  }

  // 2. Specificity check — does it contain concrete words from source?
  if (opts.checkSpecificity && sourceMaterial) {
    const hasSpecificity = checkSpecificityWords(text, sourceMaterial, opts.minSpecificityWords)
    if (!hasSpecificity) {
      issues.push('Lacks specific details from source material')
    }
  }

  // 3. Humanization check
  if (opts.checkStructure) {
    const emDashCount = (text.match(/[\u2014\u2013]/g) || []).length
    if (emDashCount > 2) {
      issues.push(`Excessive em dashes (${emDashCount}) — use plain punctuation`)
    }

    const exclamationCount = (text.match(/!/g) || []).length
    if (exclamationCount > 1) {
      issues.push(`Excessive exclamation marks (${exclamationCount})`)
    }

    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5)
    if (sentences.length >= 3) {
      const lengths = sentences.map(s => s.split(/\s+/).length)
      const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length
      if (avg > 0) {
        const variance = lengths.reduce((acc, l) => acc + (l - avg) ** 2, 0) / lengths.length
        const stdDev = Math.sqrt(variance)
        if (stdDev < 3 && avg > 5) {
          issues.push('Uniform sentence rhythm — vary length to sound human')
        }
      }
    }

    const lastLine = text.trim().split('\n').pop()?.trim().toLowerCase() ?? ''
    if (/^(thoughts\?|agree\?|what do you think\?|let me know|comment below|share your)/i.test(lastLine)) {
      issues.push('Generic engagement-bait closing — end on the idea itself')
    }

    if (/^in today'/i.test(text.trim())) {
      issues.push('Generic "In today\'s..." opening')
    }

    if (/".*"\s*—\s*(he|she|they|the|a|my)/i.test(text)) {
      issues.push('Possible fabricated quote attribution')
    }

    const bothSidesCount = (text.match(/\bon the one hand\b|\bon the other hand\b|\bwhile it's true\b|\bthat said\b|\bnevertheless\b/gi) || []).length
    if (bothSidesCount >= 2) {
      issues.push('Excessive both-sides hedging — pick a side if there\'s a real opinion')
    }
  }

  const score = Math.max(0, 1 - issues.length * 0.12)
  return {
    passed: issues.length === 0,
    issues,
    score,
  }
}

function checkSpecificityWords(text: string, sourceMaterial: string, minWords: number): boolean {
  const sourceWords = sourceMaterial
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)

  const textLower = text.toLowerCase()
  let matchCount = 0
  for (const word of sourceWords) {
    if (textLower.includes(word)) {
      matchCount++
      if (matchCount >= minWords) return true
    }
  }
  return false
}


export type MessageStage = 'connection' | 'first_dm' | 'follow_up' | 'reply'

export interface StageQualityResult {
  passed: boolean
  score: number
  issues: string[]
  stage: MessageStage
}

/**
 * Stage-specific quality gates.
 *
 * Connection notes and DMs fail on different things.
 * A connection note that's too long is a hard fail.
 * A DM that's too short is a hard fail.
 * A follow-up that repeats the connection note is a hard fail.
 */
export function evaluateMessageStage(
  text: string,
  stage: MessageStage,
  context: {
    prospectName?: string | null
    priorMessages?: string[]
    connectionNote?: string | null
    firstDm?: string | null
    followupCount?: number
  } = {},
): StageQualityResult {
  const issues: string[] = []
  const lower = text.toLowerCase().trim()

  // "Hi John — ..." or "John — ..." is a common AI pattern
  if (context.prospectName) {
    const firstName = context.prospectName.split(/\s+/)[0]
    if (firstName && firstName.length >= 2) {
      const escapedName = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const greetingDashPattern = new RegExp(`^(hi|hey|hello)\\s+${escapedName}\\s*[\\u2014\\u2013-]\\s*`, 'i')
      if (greetingDashPattern.test(text)) {
        issues.push('Em-dash after name — use comma or restructure')
      }
      const lineStartDashPattern = new RegExp(`(^|\\n)\\s*${escapedName}\\s*[\\u2014\\u2013-]`, 'i')
      if (lineStartDashPattern.test(text)) {
        issues.push('Em-dash name formatting reads as AI-generated')
      }
    }
  }


  if (stage === 'connection') {
    // Connection notes must be short
    if (text.length > 120) {
      issues.push(`Connection note too long (${text.length}/120 chars)`)
    }
    if (text.length < 15) {
      issues.push('Connection note too short to be meaningful')
    }
    if (/\b(we specialize|we offer|our services|we can help you|let me help you|i can help you (build|ship|grow|scale))\b/i.test(lower)) {
      issues.push('Connection note pitches services — earn access instead')
    }
    if (/\b(schedule|hop on|call|meeting|chat to discuss)\b/i.test(lower)) {
      issues.push('Connection note asks for meeting too early')
    }
    if (text.length > 50 && !/\b(you|your)\b/i.test(lower)) {
      issues.push('Connection note does not reference the prospect')
    }
  }

  if (stage === 'first_dm') {
    // DMs must be materially richer than connection notes
    if (text.length < 40) {
      issues.push('First DM too short to establish relevance')
    }
    if (/^thanks for connecting/i.test(lower) && text.length < 80) {
      issues.push('First DM is just a generic acknowledgment')
    }
    if (context.connectionNote && text.length > 0) {
      const similarity = computeTextSimilarity(text, context.connectionNote)
      if (similarity > 0.6) {
        issues.push('First DM too similar to connection note')
      }
    }
    if (/\b(we can help|let me help|i can help)\b/i.test(lower) && text.length < 100) {
      issues.push('First DM pitches without establishing context')
    }
  }

  if (stage === 'follow_up') {
    // Follow-ups must introduce something new
    if (/\b(just following up|checking in|bumping this|just wanted to follow up)\b/i.test(lower)) {
      issues.push('Follow-up uses empty "following up" language')
    }
    if (/not now is a perfect reply/i.test(lower)) {
      issues.push('Follow-up uses an unnatural call to action')
    }
    if (/\btech recruitment\b/i.test(lower)) {
      issues.push('Follow-up gives generic advice that is not grounded in this conversation')
    }
    if (context.connectionNote) {
      const similarity = computeTextSimilarity(text, context.connectionNote)
      if (similarity > 0.5) {
        issues.push('Follow-up repeats connection note content')
      }
    }
    if (context.firstDm) {
      const similarity = computeTextSimilarity(text, context.firstDm)
      if (similarity > 0.5) {
        issues.push('Follow-up repeats first DM content')
      }
    }
    if (context.priorMessages && context.priorMessages.length > 0) {
      for (const prior of context.priorMessages) {
        const similarity = computeTextSimilarity(text, prior)
        if (similarity > 0.5) {
          issues.push('Follow-up repeats a previous message')
          break
        }
      }
    }
    if (/\b(i know you're busy|haven't heard back|just wondering if|did you see my)\b/i.test(lower)) {
      issues.push('Follow-up uses guilt-tripping language')
    }
    if (/\b(closing soon|last chance|final reminder|ending soon|limited spots)\b/i.test(lower)) {
      issues.push('Follow-up creates fake urgency')
    }
  }

  if (stage === 'reply') {
    // Replies should be appropriate length for the inbound message
    if (text.length < 10) {
      issues.push('Reply too short')
    }
    if (/\b(dear| sincerely|regards)\b/i.test(lower)) {
      issues.push('Reply uses overly formal business letter style')
    }
  }

  // Detect "Hi John —" pattern (em dash after greeting+name). A plain hyphen
  // only counts with whitespace on both sides, so "Hi Anne-Marie," is fine.
  if (/^(hi|hey|hello)\s+\w+(?:\s*[—–]\s*|\s+-\s+)/i.test(text)) {
    issues.push('Em dash after name — use comma: "Hi John,"')
  }

  const score = Math.max(0, 1 - issues.length * 0.15)
  return {
    passed: issues.length === 0,
    score,
    issues,
    stage,
  }
}


export function adaptForLinkedIn(text: string): string {
  // LinkedIn: professional, no hashtag stuffing, clean formatting
  const result = text.replace(/#\w+(?:\s+#\w+)*/g, '') // Remove hashtag chains
  return result.trim()
}

export function adaptForX(text: string): string {
  // X: concise, no thread markers, clean
  let result = text.replace(/^\d+\/\d+\s*/gm, '') // Remove thread numbering
  result = result.replace(/🧵/g, '') // Remove thread emoji
  return result.trim()
}


export function buildAntiSlopBlock(): string {
  return [
    'ANTI-SLOP RULES (reject any output that violates these):',
    '- No emojis as decoration, bullets, or emphasis. Default: no emojis.',
    '- No em dashes. Rewrite sentences naturally instead.',
    '- No "Here\'s the thing", "Let that sink in", "In today\'s...", "Nobody talks about...", "It\'s not X, it\'s Y".',
    '- No generic engagement bait: "Thoughts?", "Agree?", "Who else?", "Comment below".',
    '- No excessive one-line paragraphs. Vary length naturally.',
    '- No both-sides hedging unless the material genuinely requires it.',
    '- No motivational filler or fake profundity.',
    '- No "game changer", "huge opportunity", "massive potential", "cutting-edge".',
    '- End on the idea itself. The last line must earn its place.',
  ].join('\n')
}

export function buildOriginalityBlock(): string {
  return [
    'ORIGINALITY REQUIREMENTS:',
    '- Could 10,000 other AI users generate essentially this same thing? If yes, rewrite.',
    '- Is there one specific, concrete detail that makes this post sound like only this person could have write it?',
    '- Avoid structures that AI defaults to: hook→story→bullets→lesson→CTA.',
    '- Find the most interesting angle in the material. Write around that, not the topic itself.',
    '- If there is no strong angle, say so rather than producing filler.',
  ].join('\n')
}
