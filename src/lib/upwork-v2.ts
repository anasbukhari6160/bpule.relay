
import { fetchOpenAI, withRetry } from '@/lib/intelligence-v3/retry-utils'
import { generate } from '@/lib/ai/runtime'

export interface UpworkJobInput {
  rawText: string
  url?: string
}

export interface ExtractedUpworkJob {
  title: string
  description: string
  skills: string[]
  budget: number | null
  budgetType: 'fixed' | 'hourly' | null
  hourlyRateMin: number | null
  hourlyRateMax: number | null
  experienceLevel: string | null
  projectLength: string | null
  locationRestrictions: string[]
  clientName: string | null
  screeningQuestions: string[]
  engagementType: string | null
  weeklyHours: string | null
  duration: string | null
  applicationRequirements: string[]
  proposalCount: number | null
  connectsCost: number | null
}

export interface UpworkApplication {
  coverLetter: string
  questionAnswers: Array<{ question: string; answer: string }>
  fitScore: number
  fitReason: string
  risks: string[]
  matchedProof: Array<{ title: string; description: string }>
}

const UPWORK_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Job title exactly as stated' },
    description: { type: 'string', description: 'Clean job description without navigation noise. Preserve all requirements, responsibilities, and application instructions.' },
    skills: { type: 'array', items: { type: 'string' }, description: 'ALL technical skills, technologies, frameworks, platforms mentioned. Be thorough — list every one.' },
    budget: { type: 'number', nullable: true, description: 'Fixed-price project budget only. Do NOT put monthly compensation here — use hourlyRateMin/Max for $/month or $/hour rates' },
    budgetType: { type: 'string', enum: ['fixed', 'hourly', null] },
    hourlyRateMin: { type: 'number', nullable: true, description: 'Minimum hourly rate in USD' },
    hourlyRateMax: { type: 'number', nullable: true, description: 'Maximum hourly rate in USD' },
    experienceLevel: { type: 'string', nullable: true, description: 'Entry, Intermediate, Expert, or specific years' },
    projectLength: { type: 'string', nullable: true, description: 'Duration: e.g. 3 months, 6+ months, ongoing' },
    locationRestrictions: { type: 'array', items: { type: 'string' } },
    clientName: { type: 'string', nullable: true },
    screeningQuestions: { type: 'array', items: { type: 'string' }, description: 'ALL questions the applicant must answer verbatim' },
    engagementType: { type: 'string', nullable: true, description: 'Full-time, part-time, contract, contract-to-hire' },
    weeklyHours: { type: 'string', nullable: true, description: 'Hours per week if stated' },
    duration: { type: 'string', nullable: true, description: 'Project duration if stated' },
    applicationRequirements: { type: 'array', items: { type: 'string' }, description: 'What the applicant must submit: resume, portfolio, rate, availability, references, etc.' },
    proposalCount: { type: 'number', nullable: true, description: 'Number of existing proposals if stated (e.g. 10, 15, 20)' },
    connectsCost: { type: 'number', nullable: true, description: 'Number of Connects required to submit a proposal' },
  },
  required: ['title', 'description', 'skills', 'screeningQuestions', 'applicationRequirements'],
  additionalProperties: false,
} as const

export type UpworkExtractionError =
  | 'INVALID_INPUT'
  | 'AI_PROVIDER_FAILURE'
  | 'SCHEMA_FAILURE'
  | 'TIMEOUT'

export interface UpworkExtractionResult {
  job: ExtractedUpworkJob | null
  error: UpworkExtractionError | null
  degraded: boolean
  diagnostics: {
    provider: string
    textLength: number
    stage: string
  }
}

// these functions fill the gaps. Zero AI cost.

const TECH_KEYWORDS = [
  'react native', 'react', 'javascript', 'typescript', 'node.js', 'nodejs', 'node',
  'java', 'python', 'swift', 'kotlin', 'flutter', 'dart',
  'rest api', 'restful', 'graphql', 'json',
  'postgresql', 'mysql', 'mongodb', 'firebase', 'sqlite',
  'aws', 'google cloud', 'gcp', 'azure', 'heroku',
  'docker', 'kubernetes', 'ci/cd', 'devops',
  'git', 'github', 'gitlab',
  'gps', 'geolocation', 'maps', 'google maps',
  'stripe', 'payment', 'paypal',
  'erp', 'crm',
  'redis', 'elasticsearch', 'kafka',
  'html', 'css', 'sass', 'tailwind',
  'vue', 'angular', 'svelte',
  'next.js', 'nextjs', 'express', 'fastapi', 'django', 'flask',
  'spring', 'rails', 'laravel',
  'terraform', 'ansible', 'jenkins',
  'prometheus', 'grafana', 'datadog',
  'ios', 'android', 'web', 'frontend', 'backend', 'full-stack', 'fullstack',
  'replit', 'figma', 'shopify', 'wordpress', 'webflow', 'bubble',
  'ai', 'machine learning', 'llm', 'openai', 'gemini', 'claude',
  'blockchain', 'solidity', 'web3',
  'unity', 'unreal', 'game dev',
  'devops', 'terraform', 'ansible',
]

interface BackfillInput {
  rawText: string
  aiSkills: string[]
  aiQuestions: string[]
  aiReqs: string[]
  aiHourlyMin: number | null
  aiHourlyMax: number | null
  aiBudget: number | null
  aiBudgetType: 'fixed' | 'hourly' | null
  aiExperience: string | null
  aiProjectLength: string | null
  aiEngagement: string | null
  aiWeeklyHours: string | null
  aiDuration: string | null
}

interface BackfillResult {
  skills: string[]
  hourlyRateMin: number | null
  hourlyRateMax: number | null
  budget: number | null
  budgetType: 'fixed' | 'hourly' | null
  experienceLevel: string | null
  projectLength: string | null
  screeningQuestions: string[]
  engagementType: string | null
  weeklyHours: string | null
  duration: string | null
  applicationRequirements: string[]
  proposalCount: number | null
  connectsCost: number | null
}

function backfillFromRawText(input: BackfillInput): BackfillResult {
  const { rawText } = input
  const lower = rawText.toLowerCase()

  // Skills: merge AI + deterministic scan
  const skills = mergeSkills(input.aiSkills, extractSkillsFromRaw(rawText))

  // Budget: use AI if present, else scan
  let hourlyRateMin = input.aiHourlyMin
  let hourlyRateMax = input.aiHourlyMax
  let budget = input.aiBudget
  let budgetType = input.aiBudgetType

  if (hourlyRateMin === null) {
    const rate = extractHourlyRate(rawText)
    hourlyRateMin = rate.min
    hourlyRateMax = rate.max
  }
  if (budget === null && budgetType !== 'hourly') {
    budget = extractFixedBudget(rawText)
  }
  if (budgetType === null) {
    if (hourlyRateMin !== null) budgetType = 'hourly'
    else if (budget !== null) budgetType = 'fixed'
  }

  // Experience
  const experienceLevel = input.aiExperience ?? extractExperience(rawText)

  // Project length / duration
  const projectLength = input.aiProjectLength ?? extractProjectLength(rawText)

  // Engagement type
  const engagementType = input.aiEngagement ?? extractEngagementType(rawText)

  // Weekly hours
  const weeklyHours = input.aiWeeklyHours ?? extractWeeklyHours(rawText)

  // Duration
  const duration = input.aiDuration ?? extractDuration(rawText)

  // Screening questions: use AI if present, else extract from text
  const screeningQuestions = input.aiQuestions.length > 0
    ? input.aiQuestions
    : extractScreeningQuestions(rawText)

    // Application requirements
    const applicationRequirements = input.aiReqs.length > 0
      ? input.aiReqs
      : extractApplicationRequirements(rawText)

    // Proposals and connects — pure regex, no AI
    const proposalCount = extractProposalCount(rawText)
    const connectsCost = extractConnectsCost(rawText)

    return {
      skills,
      hourlyRateMin,
      hourlyRateMax,
      budget,
      budgetType,
      experienceLevel,
      projectLength,
      screeningQuestions,
      engagementType,
      weeklyHours,
      duration,
      applicationRequirements,
      proposalCount,
      connectsCost,
    }
  }

function extractSkillsFromRaw(text: string): string[] {
  const lower = text.toLowerCase()
  const found: string[] = []
  for (const tech of TECH_KEYWORDS) {
    if (lower.includes(tech.toLowerCase()) && !found.some(f => f.toLowerCase() === tech.toLowerCase())) {
      found.push(tech)
    }
  }
  return found
}

const SKILL_BLACKLIST = [
  /business with \d+-\d+ employees/i,
  /business with \d+\+? employees/i,
  /rising talent/i,
  /english level/i,
  /fluent/i,
  /featured job/i,
  /promoted listing/i,
  /contract-to-hire/i,
  /ongoing project/i,
  /complex project/i,
]

function isValidSkill(skill: string): boolean {
  if (skill.length < 2 || skill.length > 50) return false
  return !SKILL_BLACKLIST.some(re => re.test(skill))
}

function mergeSkills(aiSkills: string[], rawSkills: string[]): string[] {
  const all = new Map<string, string>()
  for (const s of aiSkills) {
    if (isValidSkill(s)) all.set(s.toLowerCase(), s)
  }
  for (const s of rawSkills) {
    if (isValidSkill(s)) all.set(s.toLowerCase(), s)
  }
  return Array.from(all.values())
}

function extractHourlyRate(text: string): { min: number | null; max: number | null } {
  const normalized = text.replace(/\s+/g, ' ').trim()

  // Monthly rate range: $1000-2000/month → convert to hourly (/160)
  const monthlyRange = normalized.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*[-–]\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:\/|per\s*)?(?:month|mo)/i)
  if (monthlyRange) {
    const min = parseFloat(monthlyRange[1].replace(/,/g, '')) / 160
    const max = parseFloat(monthlyRange[2].replace(/,/g, '')) / 160
    return { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 }
  }

  // Single monthly rate: $1500/month
  const monthlySingle = normalized.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:\/|per\s*)?(?:month|mo)\b/i)
  if (monthlySingle) {
    const rate = parseFloat(monthlySingle[1].replace(/,/g, '')) / 160
    const rounded = Math.round(rate * 100) / 100
    return { min: rounded, max: rounded }
  }

  // Hourly rate range: $5-$15/hour, $5 - $15 per hour, $10.00 - $30.00
  const rangeMatch = normalized.match(/\$\s*(\d+(?:\.\d+)?)\s*[-–]\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s*)?(?:hour|hr)?/i)
  if (rangeMatch) {
    return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) }
  }
  const singleMatch = normalized.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s*)?(?:hour|hr)/i)
  if (singleMatch) {
    const rate = parseFloat(singleMatch[1])
    return { min: rate, max: rate }
  }
  return { min: null, max: null }
}

function extractFixedBudget(text: string): number | null {
  // Only match true fixed-price budgets — NOT monthly/hourly/weekly rates
  const match = text.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:budget|total|price|fixed)/i)
  if (match) return parseFloat(match[1].replace(/,/g, ''))
  // "Fixed price: $X" pattern (must not be followed by /month, /hour, etc.)
  const fixedMatch = text.match(/fixed[- ]?price[:\s]*\$\s*(\d{3,6})(?:\.\d{1,2})?/i)
  if (fixedMatch) {
    const val = parseFloat(fixedMatch[1].replace(/,/g, ''))
    // Reject if this is a range like "$1000-2000/month"
    const contextStart = fixedMatch.index ?? 0
    const context = text.slice(contextStart, contextStart + 40)
    if (/\/(?:month|hour|hr|week)/i.test(context)) return null
    return val
  }
  return null
}

function extractExperience(text: string): string | null {
  if (/\bexpert\b/i.test(text)) return 'Expert'
  if (/\bintermediate\b/i.test(text)) return 'Intermediate'
  if (/\bentry[- ]?level\b/i.test(text)) return 'Entry'
  const yearsMatch = text.match(/(\d+)\+?\s*years?(?:\s*of)?\s*experience/i)
  if (yearsMatch) return `${yearsMatch[1]}+ years`
  return null
}

function extractProjectLength(text: string): string | null {
  if (/\bongoing\b/i.test(text)) return 'Ongoing'
  if (/\blong[- ]term\b/i.test(text)) return 'Long-term'
  const match = text.match(/(\d+)\+?\s*(?:months?|weeks?)/i)
  return match ? match[0] : null
}

function extractEngagementType(text: string): string | null {
  if (/\bcontract[- ]to[- ]hire\b/i.test(text)) return 'Contract-to-hire'
  if (/\bfull[- ]time\b/i.test(text)) return 'Full-time'
  if (/\bpart[- ]time\b/i.test(text)) return 'Part-time'
  if (/\bcontract\b/i.test(text)) return 'Contract'
  // Upwork "Hourly" engagement type
  if (/\bhourly\b/i.test(text)) return 'Hourly'
  return null
}

function extractWeeklyHours(text: string): string | null {
  const match = text.match(/(\d+)\+?\s*hrs?\s*(?:\/|per)\s*week/i)
  return match ? `${match[1]}+ hrs/week` : null
}

function extractDuration(text: string): string | null {
  if (/\bmore than 6 months\b/i.test(text)) return '6+ months'
  if (/\bmore than 3 months\b/i.test(text)) return '3+ months'
  const match = text.match(/(\d+)\+?\s*months?/i)
  return match ? `${match[1]}+ months` : null
}

function extractScreeningQuestions(text: string): string[] {
  const questions: string[] = []
  // Look for screening question sections in various formats
  const applySection = text.match(/(?:how\s+to\s+apply|to\s+apply|you\s+will\s+be\s+asked\s+to\s+answer|interested\s+candidates\s+should|applicants\s+should\s+submit)[^\n]*\n([\s\S]*?)(?:\n\n|\n#{3,}|_{10,}|\nless|\nmore|\nskills\s+and\s+experience)/i)
  if (applySection) {
    const lines = applySection[1].split('\n').map(l => l.trim()).filter(l => l.length > 5)
    for (const line of lines) {
      // Strip leading "1. " "2. " "- " "• " prefixes
      const cleaned = line.replace(/^\d+[.)]\s*/, '').replace(/^[-•]\s*/, '')
      // Skip the section header itself
      if (/^(please include|how to apply|to apply|you will be asked)/i.test(cleaned)) continue
      // Lines ending with ? are questions
      if (cleaned.endsWith('?')) questions.push(cleaned)
      // Lines that ask for specific info
      else if (/\b(share|describe|provide|submit|include|tell us|explain|include with)\b/i.test(cleaned)) {
        questions.push(cleaned)
      }
      // Bullet points in "Please Include" section are all requirements
      else if (line.startsWith('-') || line.startsWith('•')) {
        questions.push(cleaned)
      }
    }
  }
  return questions
}

function extractApplicationRequirements(text: string): string[] {
  const reqs: string[] = []
  const patterns = [
    { pattern: /resume|cv|curriculum vitae/i, label: 'Updated résumé or CV' },
    { pattern: /portfolio|examples of (?:previous|past) work/i, label: 'Work portfolio or examples' },
    { pattern: /hourly rate|monthly retainer|proposed rate|your rate/i, label: 'Proposed rate (hourly or monthly)' },
    { pattern: /availability|preferred working arrangement|weekly hours/i, label: 'Availability and working arrangement' },
    { pattern: /references|client testimonials/i, label: 'Professional references or testimonials' },
    { pattern: /cover letter|summary of experience/i, label: 'Cover letter or experience summary' },
    { pattern: /github|source code/i, label: 'GitHub or code samples' },
  ]
  for (const { pattern, label } of patterns) {
    if (pattern.test(text)) reqs.push(label)
  }
  return reqs
}

function cleanExtractedTitle(title: string): string {
  let t = title.trim()
  // Strip common paste artifacts: "sf", "spS", etc. (Upwork UI noise)
  t = t.replace(/^(sf|spS|sp|sv|sb)\s*/i, '')
  // Strip "current page X" prefix from Upwork page paste
  t = t.replace(/^current\s+page\s+.*?(?=\n|$)/i, '')
  // Strip leading non-alphanumeric except common title chars
  t = t.replace(/^[^a-zA-Z0-9"'()[\]{<>]+/, '')
  // Strip "Posted X minutes/hours ago" prefixes
  t = t.replace(/^posted\s+\d+\s+(minutes?|hours?|days?)\s+ago\s*/i, '')
  // Strip "Title:" prefix from Upwork page paste
  t = t.replace(/^title:\s*/i, '')
  return t.slice(0, 150) || 'Unknown Job'
}

function extractProposalCount(text: string): number | null {
  // "Proposals: 20 to 50" (number may be on same or next line)
  const rangeMatch = text.match(/proposals?[:\s]+(\d+)\s*(?:to|-|–)\s*(\d+)/im)
  if (rangeMatch) return Math.round((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2)
  const singleMatch = text.match(/proposals?[:\s]+(\d+)/im)
  if (singleMatch) return parseInt(singleMatch[1])
  const looseMatch = text.match(/(\d+)\s*(?:to|-|–)\s*(\d+)\s+proposals/im)
  if (looseMatch) return Math.round((parseInt(looseMatch[1]) + parseInt(looseMatch[2])) / 2)
  return null
}

function extractConnectsCost(text: string): number | null {
  // "Required Connects to submit a proposal:15" or "Required Connects to submit a proposal: 15"
  const requiredMatch = text.match(/required\s+connects.*?proposal[:\s]+(\d+)/i)
  if (requiredMatch) return parseInt(requiredMatch[1])
  // "15 Connects", "Connects: 15"
  const match = text.match(/(\d+)\s+connects?/i)
  if (match) return parseInt(match[1])
  return null
}

function cleanRawUpworkText(text: string): string {
  // Strip Upwork page-level UI noise that leaks into pasted text.
  // NOTE: intentionally preserves "Proposals:", "Required Connects:",
  // "Available Connects:" lines — those are extracted by regex before cleaning.
  let cleaned = text
  // "current page X" line
  cleaned = cleaned.replace(/^current\s+page.*$/gmi, '')
  // "About the client" section and everything after (including client metadata)
  cleaned = cleaned.replace(/about\s+the\s+client[\s\S]*$/i, '')
  // Client metadata lines that might leak
  cleaned = cleaned.replace(/^(payment\s+verified|phone\s+number\s+verified|verified)\s*$/gmi, '')
  cleaned = cleaned.replace(/^\d+\s+jobs\s+posted\s*$/gmi, '')
  cleaned = cleaned.replace(/^\d+%\s+hire\s+rate\s*$/gmi, '')
  cleaned = cleaned.replace(/^\d+\s+open\s+job\s*$/gmi, '')
  cleaned = cleaned.replace(/^member\s+since.*$/gmi, '')
  // "Activity on this job" header
  cleaned = cleaned.replace(/^activity\s+on\s+this\s+job\s*$/gmi, '')
  // Metadata lines: interviewing, invites sent, unanswered invites
  cleaned = cleaned.replace(/^interviewing:\s*\d*\s*$/gmi, '')
  cleaned = cleaned.replace(/^invites\s+sent:\s*\d*\s*$/gmi, '')
  cleaned = cleaned.replace(/^unanswered\s+invites:\s*\d*\s*$/gmi, '')
  // "Available Connects:" (we extract from "Required Connects" line instead)
  cleaned = cleaned.replace(/^available\s+connects:\s*\d*\s*$/gmi, '')
  // "Upgrade your membership" line
  cleaned = cleaned.replace(/upgrade\s+your\s+membership.*$/gmi, '')
  // "Job link" line
  cleaned = cleaned.replace(/job\s+link.*$/gmi, '')
  // "Copy link" line
  cleaned = cleaned.replace(/copy\s+link.*$/gmi, '')
  // "Less" / "More" toggle words
  cleaned = cleaned.replace(/^\s*(less|more)\s*$/gmi, '')
  // "Send a proposal for: X Connects"
  cleaned = cleaned.replace(/send\s+a\s+proposal.*$/gmi, '')
  // "Client's recent history" section with freelancer list
  cleaned = cleaned.replace(/client'?s?\s+recent\s+history[\s\S]*$/i, '')
  // "Other open jobs by this client" section
  cleaned = cleaned.replace(/other\s+open\s+jobs[\s\S]*$/i, '')
  // "Pagination" and page numbers
  cleaned = cleaned.replace(/^pagination\s*$/gmi, '')
  cleaned = cleaned.replace(/^\d+\s*$/gmi, '')
  cleaned = cleaned.replace(/^page\s+\d+\s*$/gmi, '')
  // "Learn more" toggle
  cleaned = cleaned.replace(/^learn\s+more\s*$/gmi, '')
  // "Featured Job" / "Promoted listing" badges
  cleaned = cleaned.replace(/^featured\s+job\s*$/gmi, '')
  cleaned = cleaned.replace(/^promoted\s+listing\s*$/gmi, '')
  // "Attachment" line
  cleaned = cleaned.replace(/^attachment\s*.*$/gmi, '')
  // "Rising Talent" / "English level" metadata
  cleaned = cleaned.replace(/^rising\s+talent.*$/gmi, '')
  cleaned = cleaned.replace(/^english\s+level.*$/gmi, '')
  // "Preferred qualifications" section
  cleaned = cleaned.replace(/^preferred\s+qualifications\s*$/gmi, '')
  // "Hiring now" / "Client is online" badges
  cleaned = cleaned.replace(/^hiring\s+now\s*$/gmi, '')
  cleaned = cleaned.replace(/^client\s+is\s+online.*$/gmi, '')
  // "Skills and experience" / "Mandatory skills" / "Nice-to-have" section headers
  cleaned = cleaned.replace(/^skills\s+and\s+experience\s*$/gmi, '')
  cleaned = cleaned.replace(/^mandatory\s+skills\s*$/gmi, '')
  cleaned = cleaned.replace(/^nice-to-have\s+skills?\s*$/gmi, '')
  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  return cleaned.trim()
}

function extractTitleFromRaw(text: string): string {
  // First non-noise line is usually the title
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5)
  for (const line of lines) {
    // Skip metadata lines
    if (/^(posted|proposals|interviewing|invites|connects|client|activity|skill|budget|hourly|fixed|expert|intermediate|entry|worldwide|united states|indianapolis)/i.test(line)) continue
    if (/^\$/.test(line)) continue
    if (/^\d+\s*(minutes?|hours?|days?)\s*(ago)?$/i.test(line)) continue
    return cleanExtractedTitle(line)
  }
  return 'Unknown Job'
}

/**
 * Extract structured data from raw Upwork job paste.
 *
 * Returns typed failure with diagnostics instead of silent null.
 */
export async function extractUpworkJob(input: UpworkJobInput): Promise<UpworkExtractionResult> {
  const textLength = input.rawText.trim().length
  if (textLength < 50) {
    return { job: null, error: 'INVALID_INPUT', degraded: false, diagnostics: { provider: 'none', textLength, stage: 'validation' } }
  }

  const rawText = cleanRawUpworkText(input.rawText)

  const systemPrompt = `You are a structured data extractor for Upwork job postings.

Your job: extract EVERY piece of structured information from the raw job text.

Rules:
1. skills: List ALL technologies, frameworks, platforms, tools mentioned anywhere in the job. Include mobile, backend, database, cloud, DevOps, domain-specific. Never leave empty if tech is mentioned.
2. hourlyRateMin/Max: Extract from patterns like "$5-$15/hour", "$10/hr", "$1000-2000/month". For monthly rates, convert to hourly: divide by 160 (monthly hours). If only one number, use it for both min and max.
3. budget: Extract fixed-price project budget ONLY. Do NOT extract monthly compensation ($1000-2000/month) as budget — that goes in hourlyRateMin/Max. Budget is for one-time project totals like "budget: $5000" or "fixed price: $3000".
4. budgetType: "hourly" if hourly or monthly rates mentioned, "fixed" only if a true fixed-price project budget exists, null if unclear.
5. experienceLevel: Extract "Expert", "Intermediate", "Entry", or years like "5+ years".
6. projectLength / duration: Extract "3 months", "6+ months", "ongoing", "long-term".
7. weeklyHours: Extract "30+ hrs/week", "40 hours per week", "part-time".
8. engagementType: "full-time", "part-time", "contract", "contract-to-hire".
9. screeningQuestions: Extract ALL questions applicants must answer. Look for numbered lists, "How to Apply" sections.
10. applicationRequirements: What must the applicant submit? (resume, portfolio, rate, availability, references, etc.)
11. description: Clean description preserving all requirements and responsibilities.

Be thorough. If information exists in the text, extract it. Do not leave fields empty when the raw text contains the data.`

  const userPrompt = `Extract ALL structured data from this Upwork job posting:

${rawText.slice(0, 10000)}`

  // Helper: parse AI output into structured job
  const parseJob = (data: Record<string, unknown>, provider: string, degraded: boolean): UpworkExtractionResult => {
        const aiSkills = Array.isArray(data.skills) ? (data.skills as string[]) : []
    const aiQuestions = Array.isArray(data.screeningQuestions) ? (data.screeningQuestions as string[]) : []
    const aiReqs = Array.isArray(data.applicationRequirements) ? (data.applicationRequirements as string[]) : []

    // Backfill any fields the AI missed. Isolated in try-catch so a backfill
    // failure never crashes the entire extraction.
    let backfilled: BackfillResult
    try {
      backfilled = backfillFromRawText({
        rawText,
        aiSkills,
        aiQuestions,
        aiReqs,
        aiHourlyMin: (data.hourlyRateMin as number) ?? null,
        aiHourlyMax: (data.hourlyRateMax as number) ?? null,
        aiBudget: (data.budget as number) ?? null,
        aiBudgetType: (data.budgetType as 'fixed' | 'hourly' | null) ?? null,
        aiExperience: (data.experienceLevel as string) ?? null,
        aiProjectLength: (data.projectLength as string) ?? null,
        aiEngagement: (data.engagementType as string) ?? null,
        aiWeeklyHours: (data.weeklyHours as string) ?? null,
        aiDuration: (data.duration as string) ?? null,
      })
    } catch (backfillErr) {
      console.warn('[upwork-extract] Backfill failed, using AI data only:', backfillErr instanceof Error ? backfillErr.message : String(backfillErr))
      backfilled = {
        skills: aiSkills,
        hourlyRateMin: (data.hourlyRateMin as number) ?? null,
        hourlyRateMax: (data.hourlyRateMax as number) ?? null,
        budget: (data.budget as number) ?? null,
        budgetType: (data.budgetType as 'fixed' | 'hourly' | null) ?? null,
        experienceLevel: (data.experienceLevel as string) ?? null,
        projectLength: (data.projectLength as string) ?? null,
        screeningQuestions: aiQuestions,
        engagementType: (data.engagementType as string) ?? null,
        weeklyHours: (data.weeklyHours as string) ?? null,
        duration: (data.duration as string) ?? null,
        applicationRequirements: aiReqs,
        proposalCount: null,
        connectsCost: null,
      }
    }

    // Post-validation: clear budget if it's actually an hourly rate
    let finalBudget = backfilled.budget
    let finalBudgetType = backfilled.budgetType
    if (finalBudget !== null) {
      // If budget equals hourly rate, it was misclassified
      if (backfilled.hourlyRateMin !== null && Math.abs(finalBudget - backfilled.hourlyRateMin) < 1) {
        finalBudget = null
        finalBudgetType = 'hourly'
      }
      // If text says "Hourly" near the dollar amount but no "budget/fixed" keyword
      else if (/\bhourly\b/i.test(rawText) && !/\b(budget|fixed[- ]?price|total[- ]?price|project[- ]?budget)\b/i.test(rawText)) {
        finalBudget = null
        finalBudgetType = null
      }
    }

    return {
      job: {
        title: cleanExtractedTitle((data.title as string) || extractTitleFromRaw(rawText)),
        description: (data.description as string) || rawText.slice(0, 3000),
        skills: backfilled.skills,
        budget: finalBudget,
        budgetType: finalBudgetType,
        hourlyRateMin: backfilled.hourlyRateMin,
        hourlyRateMax: backfilled.hourlyRateMax,
        experienceLevel: backfilled.experienceLevel,
        projectLength: backfilled.projectLength,
        locationRestrictions: Array.isArray(data.locationRestrictions) ? (data.locationRestrictions as string[]) : [],
        clientName: (data.clientName as string) ?? null,
        screeningQuestions: backfilled.screeningQuestions,
        engagementType: backfilled.engagementType,
        weeklyHours: backfilled.weeklyHours,
        duration: backfilled.duration,
        applicationRequirements: backfilled.applicationRequirements,
        proposalCount: backfilled.proposalCount,
        connectsCost: backfilled.connectsCost,
      },
      error: null,
      degraded,
      diagnostics: { provider, textLength, stage: 'parsed' },
    }
  }

  try {
    const result = await generate<Record<string, unknown>>({
      task: 'FAST_STRUCTURED',
      system: systemPrompt,
      user: userPrompt,
      schema: UPWORK_EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'upwork_extraction',
      maxTokens: 2000,
      callSite: 'upwork-v2:extract',
      feature: 'upwork_extraction',
    })

    if (result.data && typeof result.data === 'object') {
      try {
        return parseJob(result.data, 'runtime', false)
      } catch (parseErr) {
        console.error('[upwork-extract] Runtime parse failed:', parseErr instanceof Error ? parseErr.message : JSON.stringify(parseErr))
        // Fall through to raw extraction
      }
    }
  } catch (err) {
    console.error('[upwork-extract] Runtime router failed:', err instanceof Error ? err.message : JSON.stringify(err))
  }

  // Fallback: direct OpenAI call
  try {
    const result = await withRetry(
      () => fetchOpenAI(
        process.env.OPENAI_API_KEY || '',
        'gpt-4o-mini',
        'https://api.openai.com/v1',
        systemPrompt,
        userPrompt,
        UPWORK_EXTRACTION_SCHEMA,
        2000,
      ),
      { maxRetries: 1, baseDelayMs: 1000 },
    )

    if (result.data) {
      try {
        const parsed = JSON.parse(result.data) as Record<string, unknown>
        if (parsed && typeof parsed === 'object') {
          return parseJob(parsed, 'openai-fallback', true)
        }
      } catch {
        console.error('[upwork-extract] Schema parse failure')
        return { job: null, error: 'SCHEMA_FAILURE', degraded: false, diagnostics: { provider: 'openai', textLength, stage: 'parse' } }
      }
    }
  } catch (err) {
    console.error('[upwork-extract] OpenAI fallback failed:', err instanceof Error ? err.message : JSON.stringify(err))
  }

  return { job: null, error: 'AI_PROVIDER_FAILURE', degraded: false, diagnostics: { provider: 'all', textLength, stage: 'all-providers-failed' } }
}

const UPWORK_BANNED_PHRASES = [
  'i came across your profile', 'i noticed', 'i saw that you',
  'game.chang', 'revolutioniz', 'cutting.edge', 'synerg',
  'passionate about', 'thrilled to', 'honored to', 'excited to reach out',
  'over the past', 'years of experience', 'i am confident',
]

function classifyQuestionType(question: string): 'availability_rate' | 'yes_no' | 'experience_example' | 'technical' {
  const q = question.toLowerCase()
  if (/\b(availability|available|rate|hourly|budget|hours per week|start|begin)\b/.test(q)) return 'availability_rate'
  if (/\b(yes or no|do you|have you|can you|are you)\s/.test(q) && q.length < 80) return 'yes_no'
  if (/\b(describe|example|approach|how would you|walk us through|explain your)\b/.test(q)) return 'technical'
  return 'experience_example'
}

const QUESTION_LIMITS: Record<string, [number, number]> = {
  availability_rate: [5, 40],
  yes_no: [10, 60],
  experience_example: [20, 120],
  technical: [30, 150],
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Validate and repair screening question answers. Returns repaired answers
 * and a list of issues found.
 */
function validateScreeningAnswers(
  answers: Array<{ question: string; answer: string }>,
  profile: { skills: string[]; technologies: string[]; expertise: string[]; allowedClaims: string[]; projects?: Array<{ title: string; description: string }> },
  coverLetter: string,
): { answers: Array<{ question: string; answer: string }>; issues: string[] } {
  const issues: string[] = []
  const profileTokens = new Set([
    ...profile.skills.map(s => s.toLowerCase()),
    ...profile.technologies.map(s => s.toLowerCase()),
    ...profile.expertise.map(s => s.toLowerCase()),
    ...profile.allowedClaims.map(c => c.toLowerCase()),
    ...(profile.projects?.flatMap(p => [...p.title.toLowerCase().split(/\s+/), ...p.description.toLowerCase().split(/\s+/)]) ?? []),
  ])

  const repaired = answers.map(({ question, answer }) => {
    let text = answer.trim()
    const qType = classifyQuestionType(question)
    const [minWords, maxWords] = QUESTION_LIMITS[qType] ?? [10, 100]
    const wc = wordCount(text)

    for (const phrase of UPWORK_BANNED_PHRASES) {
      if (text.toLowerCase().includes(phrase)) {
        text = text.replace(new RegExp(phrase, 'gi'), '')
        issues.push(`Removed banned phrase from answer "${question.slice(0, 40)}": "${phrase}"`)
      }
    }

    if (wc < minWords) {
      issues.push(`Answer too short for "${question.slice(0, 40)}..." (${wc} words, min ${minWords})`)
    }
    if (wc > maxWords) {
      text = text.split(/\s+/).slice(0, maxWords).join(' ') + '.'
      issues.push(`Answer too long for "${question.slice(0, 40)}..." (${wc} words, max ${maxWords}) — truncated`)
    }

    if (/\bi\b.{0,30}\b(built|shipped|delivered|led|managed|specialized)\b/i.test(text)) {
      const claimTokens = text.toLowerCase().split(/\W+/).filter(w => w.length >= 4)
      const grounded = claimTokens.some(t => profileTokens.has(t))
      if (!grounded) {
        issues.push(`Answer for "${question.slice(0, 40)}..." makes claims not grounded in profile`)
      }
    }

    const coverTokens = new Set(coverLetter.toLowerCase().split(/\W+/).filter(w => w.length >= 5))
    const answerTokens = text.toLowerCase().split(/\W+/).filter(w => w.length >= 5)
    const overlap = answerTokens.filter(t => coverTokens.has(t)).length
    if (answerTokens.length > 3 && overlap / answerTokens.length > 0.7) {
      issues.push(`Answer for "${question.slice(0, 40)}..." repeats cover letter content`)
    }

    text = text.replace(/[\u2014\u2013]/g, '-').replace(/!/g, '.').replace(/  +/g, ' ').trim()

    return { question, answer: text }
  })

  return { answers: repaired, issues }
}

/**
 * Generate Upwork application (cover letter + screening answers).
 */
export async function generateUpworkApplication(
  job: ExtractedUpworkJob,
  profile: {
    identityName: string
    skills: string[]
    technologies: string[]
    expertise: string[]
    industries: string[]
    allowedClaims: string[]
    projects?: Array<{ title: string; description: string; technologies: string[] }>
  },
  matchScore: number,
  matchingCapabilities: string[],
  missingCapabilities: string[],
): Promise<UpworkApplication | null> {
  const hasQuestions = job.screeningQuestions.length > 0

  const systemPrompt = `You write Upwork proposals for a software developer.
Rules:
- Be concise and specific (3-5 short paragraphs max)
- Reference REAL skills from the profile only — never fabricate experience
- Address the client's specific needs from the job description
- If screening questions exist, answer each one separately and truthfully
- Use professional tone
- If a required skill is missing from the profile, acknowledge it honestly rather than claiming false expertise`

  const profileContext = `
Profile: ${profile.identityName}
Skills: ${profile.skills.join(', ')}
Technologies: ${profile.technologies.join(', ')}
Expertise: ${profile.expertise.join(', ')}
Industries: ${profile.industries.join(', ')}
Allowed claims: ${profile.allowedClaims.join(', ')}
${profile.projects && profile.projects.length > 0 ? `Projects:\n${profile.projects.map(p => `- ${p.title}: ${p.description || ''} (${p.technologies.join(', ')})`).join('\n')}` : ''}

Match score: ${matchScore}/100
Matching capabilities: ${matchingCapabilities.join(', ')}
Missing capabilities: ${missingCapabilities.join(', ')}
`

  const jobContext = `
Job: ${job.title}
Engagement: ${job.engagementType ?? 'Not specified'} ${job.weeklyHours ? `(${job.weeklyHours})` : ''}
Duration: ${job.duration ?? job.projectLength ?? 'Not specified'}
Budget: ${job.hourlyRateMin ? `$${job.hourlyRateMin}-$${job.hourlyRateMax ?? job.hourlyRateMin}/hour` : job.budget ? `$${job.budget} ${job.budgetType ?? ''}` : 'Not specified'}
Experience: ${job.experienceLevel ?? 'Not specified'}
Skills needed: ${job.skills.join(', ')}
Description: ${job.description.slice(0, 3000)}
${job.applicationRequirements.length > 0 ? `\nApplication Requirements:\n${job.applicationRequirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}
${hasQuestions ? `\nScreening Questions:\n${job.screeningQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : ''}
`

  const outputSchema = {
    type: 'object',
    properties: {
      coverLetter: { type: 'string' },
      questionAnswers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            answer: { type: 'string' },
          },
          required: ['question', 'answer'],
        },
      },
      fitReason: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' } },
      matchedProof: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['title'],
        },
      },
    },
    required: ['coverLetter', 'questionAnswers', 'fitReason', 'risks', 'matchedProof'],
    additionalProperties: false,
  }

  const result = await withRetry(
    () => fetchOpenAI(
      process.env.OPENAI_API_KEY || '',
      'gpt-4o-mini',
      'https://api.openai.com/v1',
      systemPrompt,
      `${profileContext}\n\n${jobContext}`,
      outputSchema,
      3000,
    ),
    { maxRetries: 1, baseDelayMs: 1000 },
  )

  if (result.error || !result.data) return null

  try {
    const parsed = JSON.parse(result.data) as Record<string, unknown>
    const coverLetter = (parsed.coverLetter as string) || ''
    const rawAnswers = Array.isArray(parsed.questionAnswers)
      ? (parsed.questionAnswers as Array<{ question: string; answer: string }>)
      : []
    const { answers: validatedAnswers, issues } = validateScreeningAnswers(rawAnswers, profile, coverLetter)
    for (const issue of issues) {
      console.warn(`[upwork-screening] ${issue}`)
    }
    return {
      coverLetter,
      questionAnswers: validatedAnswers,
      fitScore: matchScore,
      fitReason: (parsed.fitReason as string) || '',
      risks: Array.isArray(parsed.risks) ? (parsed.risks as string[]) : [],
      matchedProof: Array.isArray(parsed.matchedProof)
        ? (parsed.matchedProof as Array<{ title: string; description: string }>)
        : [],
    }
  } catch {
    return null
  }
}
