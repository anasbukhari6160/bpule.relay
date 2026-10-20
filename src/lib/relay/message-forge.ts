import type { OutreachStrategy, MessageMode } from '@/lib/domain/types'
import { BANNED_PHRASES, AI_TELL_PHRASES, evaluateMessageStage, type MessageStage } from '@/lib/writing/engine'
import { ARTIFACT_LIMITS, countFor, type ArtifactLimitKey } from '@/lib/relay/artifact-limits'

/**
 * Premium Message Forge
 *
 * For important first-touch outreach, generates 2-3 DIFFERENT strategies cheaply,
 * evaluates them, and produces final copy from the best one.
 *
 * This is the quality gate that prevents the bad patterns:
 * - surveillance-like openings
 * - unsupported budget inferences
 * - generic agency pitches
 * - weak CTAs
 * - AI tells
 */

export interface StrategyCandidate {
  mode: MessageMode
  label: string
  description: string
  systemAddition: string
}

export interface ForgedMessage {
  text: string
  strategy: OutreachStrategy
  mode: MessageMode
  qualityScore: number
  passed: boolean
  failureReasons: string[]
}

/**
 * Generate strategy candidates for a lead.
 * Each candidate is a different approach angle.
 */
export function generateStrategyCandidates(
  strategy: OutreachStrategy,
): StrategyCandidate[] {
  const candidates: StrategyCandidate[] = []

  candidates.push({
    mode: strategy.mode,
    label: 'Primary',
    description: `Auto-selected: ${strategy.mode}`,
    systemAddition: '',
  })

  if (strategy.mode !== 'relevant_question' && strategy.relevantProof.length === 0) {
    candidates.push({
      mode: 'relevant_question',
      label: 'Question-led',
      description: 'Lead with a specific, relevant question',
      systemAddition: 'Open with a genuine question the prospect can answer in one sentence. No pitch, no proof dump.',
    })
  }

  if (strategy.mode !== 'proof_led' && strategy.relevantProof.length > 0) {
    candidates.push({
      mode: 'proof_led',
      label: 'Proof-led',
      description: 'Lead with relevant credibility',
      systemAddition: 'Reference one specific relevant project or capability. Keep it to one line. Then ask a question.',
    })
  }

  if (strategy.mode !== 'warm_conversational') {
    candidates.push({
      mode: 'warm_conversational',
      label: 'Conversational',
      description: 'Warm, human, no pitch',
      systemAddition: 'Sound like one professional writing to another. No sales language. A small observation or question, nothing more.',
    })
  }

  if (strategy.mode !== 'technical_peer' && strategy.tone.includes('technical')) {
    candidates.push({
      mode: 'technical_peer',
      label: 'Technical peer',
      description: 'Peer-level technical credibility',
      systemAddition: 'Write as a fellow engineer. Technical specificity is the credibility signal. No business jargon.',
    })
  }

  return candidates.slice(0, 3)
}

/**
 * Evaluate a generated message against hard quality gates.
 * Returns pass/fail with specific failure reasons.
 */
export function stageForChannel(channel: string): MessageStage {
  switch (channel.toLowerCase()) {
    case 'connection':
      return 'connection'
    case 'followup':
    case 'follow_up':
      return 'follow_up'
    case 'reply':
      return 'reply'
    default:
      return 'first_dm'
  }
}

import { hasUnfilledValues } from './unfilled-values'
export { hasUnfilledValues }

export function evaluateMessage(
  text: string,
  strategy: OutreachStrategy | null,
  channel: string,
  stage?: MessageStage,
  stageContext: Parameters<typeof evaluateMessageStage>[2] = {},
): { passed: boolean; score: number; reasons: string[] } {
  const failures: string[] = []
  let score = 100

  const lower = text.toLowerCase()

  // The stage gates differ per message type; when the caller does not say,
  // read it off the channel so a follow-up is never judged as a first DM.
  const resolvedStage = stage ?? stageForChannel(channel)
  const stageResult = evaluateMessageStage(text, resolvedStage, stageContext)
  if (!stageResult.passed) {
    failures.push(...stageResult.issues.map(i => `[${resolvedStage}] ${i}`))
    score -= stageResult.issues.length * 10
  }


  // 0. Unfilled values. "a -month free trial with / support" is a draft
  //    written around facts that were never extracted; it must not be
  //    copied or logged.
  if (hasUnfilledValues(text)) {
    failures.push('Contains an empty value or broken placeholder (e.g. "-month", "with /", "{{...}}")')
    score -= 50
  }

  // 1. Surveillance-like opening
  if (/^(hey|hi|hello)\s+\w+,?\s*(i noticed|i saw|i came across|i was looking at|i found your)/i.test(lower)) {
    failures.push('Opens with surveillance language ("I noticed/saw/came across")')
    score -= 30
  }

  // 2. Unsupported budget inference — any mention of budget linked to
  //    funding context, or assuming budget from company state
  if (/\b(budget|spend|afford)\b.*\b(raised|funding|series|seed|investment|round|backed|closed)\b|\b(raised|funding|series|round|builders round).*\b(budget|spend|afford)\b/i.test(lower)) {
    failures.push('Assumes funding = available budget')
    score -= 40
  }
  else if (/\b(gives? you|have|has|with).*\b(some\s+)?budget\b/i.test(lower)) {
    failures.push('Assumes prospect has budget to spend')
    score -= 40
  }

  // 3. Generic agency language
  if (/\b(full[- ]service|end[-to[-]end|one[- ]stop|we offer|our services|we specialize in)\b/i.test(lower)) {
    failures.push('Uses generic agency language')
    score -= 25
  }

  // 4. Excessive praise
  if (/\b(amazing|incredible|impressive|fantastic|brilliant|love what you|great work)\b/i.test(lower)) {
    failures.push('Excessive praise')
    score -= 20
  }

  // 5. Generic CTA
  if (/\b(let me know if (that|this) sounds helpful|thoughts\?|would love to connect|can we schedule|hop on a (call|chat))\b/i.test(lower)) {
    failures.push('Generic or call-seeking CTA')
    score -= 20
  }

  // 6. AI tells
  for (const phrase of AI_TELL_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      failures.push(`AI tell: "${phrase}"`)
      score -= 15
      break
    }
  }

  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      failures.push(`Banned phrase: "${phrase}"`)
      score -= 15
      break
    }
  }

  // 7. Em dash abuse
  const emDashCount = (text.match(/[\u2014\u2013]/g) ?? []).length
  if (emDashCount > 1) {
    failures.push(`Em dash abuse (${emDashCount} em/en dashes)`)
    score -= 10
  }

  // 8. Excessive length for channel — enforced from the shared artifact map so
  //    the server gate always matches the workspace UI counter.
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  const artifactLimit = ARTIFACT_LIMITS[channel.toLowerCase() as ArtifactLimitKey]
  if (artifactLimit) {
    const count = countFor(artifactLimit.kind, text)
    if (count > artifactLimit.max) {
      failures.push(`Too long for ${channel.toLowerCase()} (${count} ${artifactLimit.label}, max ${artifactLimit.max})`)
      score -= 15
    }
  }

  // 9. Could be sent to 100 other leads?
  const genericPatterns = [
    /\b(i help teams|i help companies|i work with|businesses like yours)\b/i,
    /\b(as a (software|senior|experienced|full[- ]stack))\b/i,
    /\b(i am reaching out because|i wanted to reach out because)\b/i,
  ]
  for (const pattern of genericPatterns) {
    if (pattern.test(lower)) {
      failures.push('Generic enough to send to 100 other leads')
      score -= 25
      break
    }
  }

  // 10. Fake familiarity
  if (/\b(i have been following|i have been watching|i have been keeping up)\b/i.test(lower)) {
    failures.push('Claims fake familiarity')
    score -= 20
  }

  // 11. Emoji check
  if (/[\u{1F300}-\u{1F9FF}]/u.test(text)) {
    failures.push('Contains emoji')
    score -= 10
  }

  // 12. Exclamation marks
  if (/!/.test(text)) {
    failures.push('Contains exclamation mark')
    score -= 10
  }

  // 13. Unnatural cleverness
  if (/\b(speaking of|fun enough|here is the thing|plot twist|hot take)\b/i.test(lower)) {
    failures.push('Unnatural cleverness / forced casual')
    score -= 15
  }

  // 14. Sender voice mismatch (we can't fully check this without the profile,
  //     but flag obvious "we" usage for solo senders)
  if (/\b(we can help|our team|we have|we are a)\b/i.test(lower)) {
    failures.push('Uses "we" for a solo sender')
    score -= 15
  }

  // 15b. Outreach failure patterns the writer must not produce
  const outreachTells = [
    { pattern: /\bsaw your post\b/i, reason: 'Opens by proving we scraped a post' },
    { pattern: /\bthis caught my eye\b/i, reason: 'Fake personalization ("caught my eye")' },
    { pattern: /\bcongrats on\b/i, reason: 'Manufactured compliment' },
    { pattern: /\bover the past \d+ years\b/i, reason: 'Credential dump' },
    { pattern: /\bwe specialize in\b/i, reason: 'Agency credential dump' },
    { pattern: /\bi can write (up )?a quick (analysis|read|audit)\b/i, reason: 'Unsolicited analysis offer' },
    { pattern: /\bwould that be useful\??\b/i, reason: 'Soft fake CTA' },
    { pattern: /\bjust following up\b|\bchecking in\b|\bbumping this\b/i, reason: 'Empty follow-up' },
    { pattern: /\bwe(?:'re| are) hiring\b|\bi(?:'m| am) hiring\b/i, reason: 'Echoes prospect hiring voice as if the sender is hiring' },
    // Shared-space / peer claims without verified sender proof — the sender's
    // Revenue Identity/proof must support "I work in this space" claims.
    { pattern: /\bi\s+work\s+in\s+(?:this|the\s+(?:same|that))\s+space\b/i, reason: 'Unsupported shared-space claim — no verified sender proof' },
    { pattern: /\bi(?:'m| am)\s+(?:also\s+)?(?:in|part\s+of)\s+(?:this|the)\s+(?:same\s+)?space\b/i, reason: 'Unsupported shared-space claim — no verified sender proof' },
  ]
  for (const { pattern, reason } of outreachTells) {
    if (pattern.test(lower)) {
      failures.push(reason)
      score -= 20
    }
  }

  const questionCount = (text.match(/\?/g) ?? []).length
  if (questionCount > 1) {
    failures.push('Multiple questions / CTAs — one job only')
    score -= 20
  }

  if (strategy?.wordBudget && wordCount > strategy.wordBudget.max) {
    failures.push(`Over strategy word budget (${wordCount} > ${strategy.wordBudget.max})`)
    score -= 15
  }

  if (strategy?.messageJob === null || strategy?.contact?.messageRecommended === false) {
    if (text.trim().length > 0) {
      failures.push('A message was written when silence was the correct result')
      score -= 40
    }
  }

  // 15. No specific personalization — check if the message references
  // anything from the lead context, safe trigger, or proof
  if (strategy && wordCount > 20) {
    const textLower = lower
    const companyReferenced = strategy.leadContext.split('.').some((s) => {
      const match = s.match(/company:\s*(.+)/i)
      return match?.[1] && textLower.includes(match[1].trim().toLowerCase())
    })
    const triggerContent = strategy.safeTrigger.replace(/^Their own words: "?/, '').replace(/"$/, '').toLowerCase()
    const triggerWords = triggerContent.split(/\s+/).filter((w) => w.length >= 4)
    const triggerReferenced = triggerWords.length > 0 && triggerWords.some((w) => textLower.includes(w))
    const proofWords = strategy.relevantProof.flatMap((p) => p.toLowerCase().split(/\s+/).filter((w) => w.length >= 5))
    const proofReferenced = proofWords.length > 0 && proofWords.some((w) => textLower.includes(w))
    const hasSomeSpecificity = companyReferenced || triggerReferenced || proofReferenced
    if (!hasSomeSpecificity) {
      failures.push('No specific personalization carried through')
      score -= 20
    }
  }

  // 16. Factual claim guard — thingsNotToClaim must not appear in output
  if (strategy) {
    const claimsToCheck = [
      ...(strategy.neverClaim ?? []),
    ]
    for (const claim of claimsToCheck) {
      const claimLower = claim.toLowerCase().trim()
      if (claimLower.length >= 4 && lower.includes(claimLower)) {
        failures.push(`Violates thingsNotToClaim: "${claim.slice(0, 40)}"`)
        score -= 30
        break
      }
    }
  }

  return {
    passed: failures.length === 0,
    score: Math.max(0, score),
    reasons: failures,
  }

}

/**
 * The critical evaluator question:
 * "Could this message be sent unchanged to 100 other prospects?"
 */
export function isGeneric(message: string, leadCompany: string): boolean {
  const withoutCompany = message.replace(new RegExp(leadCompany, 'gi'), 'COMPANY')
  const genericPatterns = [
    /^(hey|hi|hello)\s*,?\s*(i noticed|i saw|i came across)/i,
    /\b(noticed\s+(hiring|the hiring|that you|you're hiring))/i,
    /\b(open to connecting)\b/i,
    /\b(let me know if (that|this) sounds helpful)\b/i,
    /\b(would love to (connect|chat|discuss))\b/i,
    /\b(i can help (you|COMPANY) (ship|build|grow|scale))\b/i,
    /\b(as a (senior|experienced|full[- ]stack|software))\b/i,
  ]

  let genericHits = 0
  for (const pattern of genericPatterns) {
    if (pattern.test(withoutCompany.toLowerCase())) genericHits++
  }

  return genericHits >= 2
}

/**
 * The second evaluator question:
 * "Would receiving this make me feel researched or watched?"
 */
export function feelsSurveillance(message: string): boolean {
  const lower = message.toLowerCase()
  const surveillancePatterns = [
    /i (noticed|saw|found|came across|was looking at) your/i,
    /i (noticed|saw|found|came across)\s+(hiring|that you|you're hiring)/i,
    /you('ve| have|'re| are)?\s*(recently|just|currently)/i,
    /your (funding|raise|series|budget)/i,
    /i (read|saw) that you (raised|closed|secured)/i,
    /congrats on (your|the) (raise|funding|series)/i,
  ]

  if (/\b(saw|noticed) your (post|article|thread|update)\b/i.test(lower)) return true

  return surveillancePatterns.some((p) => p.test(lower))
}

/**
 * Repair a message that failed quality gates.
 * Attempts one fix pass.
 */
export function repairMessage(
  text: string,
  reasons: string[],
  _strategy: OutreachStrategy | null,
): string {
  let repaired = text

  // Fix surveillance openings — only if meaning survives the strip
  if (reasons.some((r) => r.includes('surveillance'))) {
    const stripped = repaired
      .replace(/^(hey|hi|hello)\s+\w+,?\s*(i noticed|i saw|i came across|i was looking at|i found your)\s+/i, '')
      .replace(/^you('ve| have)\s+(recently|just|currently)\s+[^.]+\.\s*/i, '')
      .trim()
    if (stripped.split(/\s+/).filter(Boolean).length >= 8) {
      repaired = stripped
    }
  }

  // Fix budget inferences
  if (reasons.some((r) => r.toLowerCase().includes('budget'))) {
    repaired = repaired.replace(
      /which likely gives you some budget to spend on delivery[^.]*\.\s*/i,
      '',
    )
    repaired = repaired.replace(
      /with that budget[^.]*\.\s*/i,
      '',
    )
  }

  // Fix generic CTAs
  if (reasons.some((r) => r.includes('Generic or call-seeking CTA'))) {
    repaired = repaired.replace(
      /\blet me know if (that|this) sounds helpful\.?$/i,
      'Worth a quick thought?',
    )
    repaired = repaired.replace(
      /\bwould love to connect\.?$/i,
      '',
    )
    repaired = repaired.replace(
      /\bcan we schedule (a )?(15 minute|quick)?\s*(call|chat|meeting)\??$/i,
      '',
    )
  }

  // Fix "we" for solo senders
  if (reasons.some((r) => r.includes('"we"'))) {
    repaired = repaired.replace(/\bwe can help\b/gi, 'I can help')
    repaired = repaired.replace(/\bour team\b/gi, 'I')
    repaired = repaired.replace(/\bwe have\b/gi, 'I have')
    repaired = repaired.replace(/\bwe are\b/gi, 'I am')
  }

  repaired = repaired.replace(/[\u2014\u2013]/g, '-')

  repaired = repaired.replace(/!/g, '.')

  repaired = repaired.replace(/[\u{1F300}-\u{1F9FF}]/gu, '')

  repaired = repaired.replace(/  +/g, ' ').trim()

  return repaired
}
