/**
 * Upwork application quality gate (cover letter + screening answers).
 *
 * Deterministic, runs on every generated application before it reaches the
 * rep. The model's own "self_check_passed" is advisory; this is the gate.
 *
 * Cover letter: 50–150 words, references the job, no biography dump, no
 * banned openers, no invented numbers or product names, uses real proof.
 * Screening answers: actually answer the question, grounded in the profile,
 * within the length band for the question type, not a copy of the letter.
 */

export const UPWORK_APPLICATION_GATE_VERSION = 'upwork_application_gate_v1'

export interface ApplicationProfileContext {
  /** Skills, technologies, expertise, allowed claims, project titles/descriptions. */
  claimableText: string[]
  /** Proof items the letter may cite (project summaries). */
  proof: string[]
  /** Numbers that appear in facts/proof and may be used. */
  allowedNumbers?: string[]
}

export interface ApplicationJobContext {
  title: string | null
  description: string
  skills: string[]
  screeningQuestions: string[]
}

export interface GateIssue { code: string; message: string; severity: 'block' | 'warn' }

export interface CoverLetterEvaluation {
  passed: boolean
  wordCount: number
  jobReferences: string[]
  proofUsed: boolean
  issues: GateIssue[]
  text: string
}

export interface ScreeningEvaluation {
  passed: boolean
  answers: Array<{ question: string; answer: string; type: QuestionType; wordCount: number; issues: GateIssue[] }>
  issues: GateIssue[]
}

export type QuestionType = 'availability_rate' | 'yes_no' | 'experience_example' | 'technical' | 'other'

export const COVER_LETTER_WORDS: [number, number] = [50, 150]

const BANNED_OPENERS: RegExp[] = [
  /^(?:dear\s+(?:hiring\s+manager|sir|madam|client))/i,
  /^(?:hi|hello|hey)?[,\s]*i\s+(?:came\s+across|saw|noticed|found)\s+your\s+(?:job|post|project)/i,
  /^(?:hi|hello|hey)?[,\s]*(?:i\s+am|i'm)\s+(?:a|an)\s+/i,
  /^(?:hi|hello|hey)?[,\s]*(?:i\s+have|with)\s+\d+\+?\s+years/i,
  /^(?:hi|hello|hey)?[,\s]*i\s+(?:would|'d)\s+love\s+the\s+opportunity/i,
  /^(?:hi|hello|hey)?[,\s]*i\s+am\s+(?:writing|applying|interested)/i,
]

const BANNED_PHRASES: RegExp[] = [
  /\bi\s+came\s+across\s+your\b/i,
  /\bi(?:'d| would)\s+love\s+the\s+opportunity\b/i,
  /\bwith\s+\d+\+?\s+years?\s+of\s+experience\b/i,
  /\bi\s+am\s+confident\s+that\b/i,
  /\bas\s+you\s+can\s+see\s+from\s+my\s+profile\b/i,
  /\bgame[-\s]?chang/i,
  /\brevolutioniz/i,
  /\bcutting[-\s]?edge\b/i,
  /\bsynerg/i,
  /\bpassionate\s+about\b/i,
  /\b(?:thrilled|honou?red|excited)\s+to\b/i,
  /\bperfect\s+fit\s+for\s+this\s+(?:job|role|project)\b/i,
  /\blook\s+forward\s+to\s+hearing\s+from\s+you\b/i,
  /\bi\s+can\s+start\s+immediately\s+and\s+work\s+(?:24\/7|around\s+the\s+clock)\b/i,
  /\bbest\s+regards\b|\byours\s+sincerely\b/i,
]

const BIO_DUMP: RegExp[] = [
  /\bmy\s+(?:skills|expertise|experience)\s+includes?\s*:/i,
  /\bi\s+(?:have\s+)?(?:worked\s+with|am\s+proficient\s+in|specialize\s+in)\s+(?:[\w.#+-]+,\s*){4,}/i,
  /(?:^|\n)\s*(?:[-•*]\s*[\w.#+/ -]{2,30}\n){5,}/,
]

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'your', 'you', 'our', 'are', 'will', 'from', 'have', 'need', 'looking', 'want', 'into', 'about', 'should', 'must', 'able', 'who', 'can', 'all', 'any', 'job', 'project', 'work', 'developer', 'experience', 'team', 'build', 'using', 'based'])

const CLAIM_FILLER = new Set(['built', 'shipped', 'delivered', 'managed', 'migrated', 'designed', 'implemented', 'launched', 'large', 'small', 'system', 'systems', 'users', 'millions', 'thousands', 'handled', 'platform', 'application', 'applications', 'project', 'projects', 'client', 'clients', 'company', 'companies', 'recently', 'similar', 'experience', 'years', 'scale', 'production', 'scheduling', 'portal'])
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean)
const tokens = (t: string) => t.toLowerCase().split(/[^a-z0-9.#+]+/).filter((w) => w.length >= 4 && !STOP.has(w))

export function classifyQuestion(question: string): QuestionType {
  const q = question.toLowerCase()
  if (/\b(availability|available|rate|hourly|budget|hours\s+per\s+week|start|begin|time\s*zone)\b/.test(q)) return 'availability_rate'
  if (/^\s*(?:do|have|can|are|will|is)\s+you\b/.test(q) && q.length < 90) return 'yes_no'
  if (/\b(?:describe|walk\s+(?:us|me)\s+through|explain\s+your|how\s+would\s+you|what\s+is\s+your\s+(?:approach|process))\b/.test(q)) return 'technical'
  if (/\b(?:example|similar|experience|portfolio|link|previous|past)\b/.test(q)) return 'experience_example'
  return 'other'
}

export const QUESTION_WORD_LIMITS: Record<QuestionType, [number, number]> = {
  availability_rate: [5, 40],
  yes_no: [8, 60],
  experience_example: [20, 120],
  technical: [30, 150],
  other: [10, 100],
}

function capitalizedTerms(text: string): string[] {
  // Product / company-looking tokens inside sentences (not sentence starts).
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const ws = sentence.split(/\s+/)
    for (let i = 1; i < ws.length; i++) {
      const w = ws[i].replace(/[^\w.#+-]/g, '')
      if (/^[A-Z][a-zA-Z0-9]{2,}(?:\.[a-z]{2,4})?$/.test(w) && !/^(?:I|React|Node|Python|AWS|API|SQL|HTML|CSS|JSON|REST|GraphQL|TypeScript|JavaScript|Next|Django|Rails|Docker|Kubernetes|Postgres|PostgreSQL|MongoDB|Stripe|Shopify|WordPress|Flutter|Android|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/.test(w)) out.push(w)
    }
  }
  return [...new Set(out)]
}

export function evaluateCoverLetter(text: string, job: ApplicationJobContext, profile: ApplicationProfileContext): CoverLetterEvaluation {
  const issues: GateIssue[] = []
  const t = text.replace(/[—–]/g, '-').replace(/!/g, '.').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/[ \t]{2,}/g, ' ').trim()
  const wc = words(t).length
  if (wc < COVER_LETTER_WORDS[0]) issues.push({ code: 'TOO_SHORT', message: `${wc} words — under ${COVER_LETTER_WORDS[0]}`, severity: 'block' })
  if (wc > COVER_LETTER_WORDS[1]) issues.push({ code: 'TOO_LONG', message: `${wc} words — over ${COVER_LETTER_WORDS[1]}`, severity: 'block' })

  for (const re of BANNED_OPENERS) if (re.test(t)) { issues.push({ code: 'GENERIC_OPENER', message: 'Opens like every other proposal', severity: 'block' }); break }
  for (const re of BANNED_PHRASES) { const m = t.match(re); if (m) issues.push({ code: 'BANNED_PHRASE', message: `Banned phrase: "${m[0]}"`, severity: 'block' }) }
  for (const re of BIO_DUMP) if (re.test(t)) { issues.push({ code: 'BIO_DUMP', message: 'Reads as a biography or skills list, not a response to this job', severity: 'block' }); break }

  // Specificity: must reference the job (skills, title words, distinctive description terms).
  const jobTerms = new Set([...job.skills.map((s) => s.toLowerCase()), ...tokens(job.title ?? ''), ...tokens(job.description).filter((w) => w.length >= 6)])
  const letterTokens = new Set(tokens(t))
  const jobReferences = [...jobTerms].filter((term) => letterTokens.has(term) || t.toLowerCase().includes(term)).slice(0, 12)
  if (jobReferences.length < 2) issues.push({ code: 'NOT_SPECIFIC', message: 'Fewer than two references to this job', severity: 'block' })

  // Proof: a real project/outcome must be cited when proof exists.
  const proofTokens = new Set(profile.proof.flatMap(tokens))
  const proofHits = [...letterTokens].filter((w) => proofTokens.has(w)).length
  const proofUsed = profile.proof.length === 0 ? false : proofHits >= 3
  if (profile.proof.length > 0 && !proofUsed) issues.push({ code: 'NO_PROOF', message: 'Does not cite any real proof item', severity: 'warn' })

  // Hallucination: numbers and product names must come from facts, proof or the job.
  const allowedNumbers = new Set([...(profile.allowedNumbers ?? []), ...(`${job.description} ${profile.proof.join(' ')} ${profile.claimableText.join(' ')}`.match(/\d[\d,.]*\s*(?:%|k|x|\+)?/gi) ?? []).map((n) => n.replace(/\s+/g, '').toLowerCase())])
  for (const n of t.match(/\d[\d,.]*\s*(?:%|k|x|\+)?/gi) ?? []) {
    const key = n.replace(/\s+/g, '').toLowerCase()
    if (!allowedNumbers.has(key) && !/^\d{1,2}$/.test(key)) issues.push({ code: 'INVENTED_NUMBER', message: `Number "${n.trim()}" is not in the facts, proof or job`, severity: 'block' })
  }
  const known = `${job.title ?? ''} ${job.description} ${profile.claimableText.join(' ')} ${profile.proof.join(' ')}`.toLowerCase()
  for (const term of capitalizedTerms(t)) if (!known.includes(term.toLowerCase())) issues.push({ code: 'UNKNOWN_NAME', message: `"${term}" is not in the profile, proof or job`, severity: 'warn' })

  // Placeholders.
  if (/\[[^\]]{1,40}\]|\bby\s*%|\bx%|\{\{/i.test(t)) issues.push({ code: 'PLACEHOLDER', message: 'Contains a placeholder', severity: 'block' })

  // A question at the end is the house style; two or more is noise.
  const qs = (t.match(/\?/g) ?? []).length
  if (qs > 2) issues.push({ code: 'TOO_MANY_QUESTIONS', message: `${qs} question marks`, severity: 'warn' })

  const passed = !issues.some((i) => i.severity === 'block')
  return { passed, wordCount: wc, jobReferences, proofUsed, issues, text: t }
}

export function evaluateScreeningAnswers(
  answers: Array<{ question: string; answer: string }>,
  job: ApplicationJobContext,
  profile: ApplicationProfileContext,
  coverLetter: string,
): ScreeningEvaluation {
  const all: GateIssue[] = []
  const claimTokens = new Set(profile.claimableText.flatMap(tokens).concat(profile.proof.flatMap(tokens)))
  const coverTokens = new Set(tokens(coverLetter).filter((w) => w.length >= 5))
  const asked = new Set(job.screeningQuestions.map((q) => q.trim().toLowerCase()))

  const out = answers.map(({ question, answer }) => {
    const issues: GateIssue[] = []
    const type = classifyQuestion(question)
    let text = answer.replace(/[—–]/g, '-').replace(/!/g, '.').replace(/[ \t]{2,}/g, ' ').trim()
    const [min, max] = QUESTION_WORD_LIMITS[type]
    const wc = words(text).length
    if (wc < min) issues.push({ code: 'TOO_SHORT', message: `${wc} words (min ${min})`, severity: 'block' })
    if (wc > max) { text = words(text).slice(0, max).join(' ').replace(/[,;:]$/, '') + '.'; issues.push({ code: 'TOO_LONG', message: `${wc} words (max ${max}) — truncated`, severity: 'warn' }) }
    for (const re of BANNED_PHRASES) { const m = text.match(re); if (m) issues.push({ code: 'BANNED_PHRASE', message: `Banned phrase: "${m[0]}"`, severity: 'block' }) }
    if (/\[[^\]]{1,40}\]|\{\{/.test(text)) issues.push({ code: 'PLACEHOLDER', message: 'Contains a placeholder', severity: 'block' })

    // Does it answer the question?
    if (type === 'yes_no' && !/^\s*(?:yes|no|not\s+yet|i\s+(?:do|don't|have|haven't|can|can't|am|am\s+not))\b/i.test(text)) issues.push({ code: 'NOT_ANSWERED', message: 'A yes/no question is not answered directly', severity: 'block' })
    if (type === 'availability_rate' && !/\b(?:\d+\s*(?:hours?|hrs?|h)\b|\$\s*\d|per\s+hour|hourly|full[-\s]?time|part[-\s]?time|immediately|asap|monday|next\s+week|this\s+week|within\s+\d+|utc|gmt|est|pst|cet|am\b|pm\b)/i.test(text)) issues.push({ code: 'NOT_ANSWERED', message: 'Availability/rate question has no concrete time or number', severity: 'block' })
    if ((type === 'technical' || type === 'experience_example' || type === 'other')) {
      const qTokens = tokens(question)
      const aTokens = new Set(tokens(text))
      const overlap = qTokens.filter((w) => aTokens.has(w)).length
      if (qTokens.length >= 2 && overlap === 0) issues.push({ code: 'NOT_ANSWERED', message: 'Answer shares no terms with the question', severity: 'block' })
    }

    // Grounding: first-person delivery claims must name something from the
    // profile or proof — a technology, product or client — not just share a
    // verb like "built" with it.
    if (/\bi\b.{0,40}\b(?:built|shipped|delivered|led|managed|migrated|designed|implemented|launched)\b/i.test(text)) {
      const grounded = tokens(text).filter((w) => !CLAIM_FILLER.has(w)).some((w) => claimTokens.has(w) && !CLAIM_FILLER.has(w))
      if (!grounded) issues.push({ code: 'UNGROUNDED_CLAIM', message: 'Delivery claim not grounded in the profile or proof', severity: 'block' })
    }

    // Copy of the cover letter?
    const aTok = tokens(text).filter((w) => w.length >= 5)
    const ov = aTok.filter((w) => coverTokens.has(w)).length
    if (aTok.length > 3 && ov / aTok.length > 0.7) issues.push({ code: 'COPIES_COVER_LETTER', message: 'Repeats the cover letter', severity: 'block' })

    if (asked.size > 0 && !asked.has(question.trim().toLowerCase())) issues.push({ code: 'QUESTION_NOT_ASKED', message: 'Answers a question the job did not ask', severity: 'warn' })

    all.push(...issues.map((i) => ({ ...i, message: `[${question.slice(0, 40)}] ${i.message}` })))
    return { question, answer: text, type, wordCount: words(text).length, issues }
  })

  // Every asked question must be answered.
  const answered = new Set(answers.map((a) => a.question.trim().toLowerCase()))
  for (const q of job.screeningQuestions) if (!answered.has(q.trim().toLowerCase())) all.push({ code: 'MISSING_ANSWER', message: `[${q.slice(0, 40)}] No answer`, severity: 'block' })

  return { passed: !all.some((i) => i.severity === 'block'), answers: out, issues: all }
}
