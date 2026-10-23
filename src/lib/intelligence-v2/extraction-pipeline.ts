
import { isKnownPlaceName, looksLikePlace } from '@/lib/leads/targeting-pure'
import type {
  ExtractedPerson,
  ExtractedCompany,
  ExtractedOpportunity,
  ExtractedJob,
  ExtractedContent,
  NormalizedIntelligence,
  RawSourceData,
  RemoteEligibility,
  EvidenceEntry,
  EvidenceRelationship,
  OpportunitySignal,
} from './types'
import { assessRemoteEligibility, isJobSeekerAttribution, type RemoteEligibilityInput } from './remote-eligibility'
import {
  clinicianAllowedSignals,
  isClinicianProfile,
  isLinkedInChromeText,
  isNonBuyerProfessional,
  isRecruiterTitle,
  recruiterAllowedSignals,
  techKeywordMatches,
} from './role-signals'
import { generate } from '@/lib/ai/runtime'
import { classifyBusinessModel, classifySentence, deriveRelationship, isNonBuyerRelationship, stripThirdPartyRepostBlocks } from './subject-attribution'
import { applyBuyerIntentBoundary } from './commercial-reading'
import { classifyNeedOwnership } from './need-ownership'
import { cleanPersonName } from '@/lib/leads/normalize'
import { cleanCompanyName } from '@/lib/leads/normalize'


export interface ExtractionPipelineOptions {
  onStatus?: (message: string) => void
  /** Explicit source URLs if known before extraction */
  knownSourceUrl?: string | null
  knownProfileUrl?: string | null
  knownCompanyUrl?: string | null
  knownJobUrl?: string | null
  /** When true, AI failures are not silently replaced by deterministic fallback extraction */
  strictLiveMode?: boolean
  /** Lead this extraction is about, when one already exists. */
  leadId?: string | null
  /** Skip provider calls and use the deterministic extraction paths only. */
  deterministicOnly?: boolean
}

export interface ExtractionPipelineResult {
  intelligence: NormalizedIntelligence
  rawSource: RawSourceData
  remoteEligibility: RemoteEligibility
  evidenceLedger: EvidenceEntry[]
  callLog: Array<{ provider: string; model: string; task: string; latencyMs: number; fallback: boolean }>
  /** Source URLs found in the input */
  sourceUrls: string[]
}


const URL_PATTERNS = [
  /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi,
  /https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+/gi,
  /https?:\/\/[^\s<>"']+/gi,
  // Bare domains (no protocol) — common in pasted LinkedIn text
  /\b(?:www\.)?linkedin\.com\/(?:in|company)\/[a-zA-Z0-9_-]+/gi,
  /\b[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}\/[^\s<>"']*/gi,
]

function extractUrls(text: string): string[] {
  const urls = new Set<string>()
  for (const pattern of URL_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) {
      for (const m of matches) {
        urls.add(m.replace(/[,.;]+$/, ''))
      }
    }
  }
  return [...urls]
}

function categorizeUrl(url: string): 'linkedin_profile' | 'linkedin_company' | 'job_posting' | 'company_website' | 'other' {
  const lower = url.toLowerCase()
  if (lower.includes('linkedin.com/in/')) return 'linkedin_profile'
  if (lower.includes('linkedin.com/company/')) return 'linkedin_company'
  if (lower.includes('linkedin.com/jobs/') || lower.includes('linkedin.com/job/')) return 'job_posting'
  if (lower.includes('greenhouse.io') || lower.includes('lever.co') || lower.includes('workable.com') || lower.includes('indeed.com')) return 'job_posting'
  if (lower.includes('glassdoor.')) return 'job_posting'
  return 'other'
}


function detectSourceType(text: string): RawSourceData['sourceType'] {
  const hasProfileMarkers = /\b(about|experience|education|skills|endorsements|recommendations|connections|followers)\b/i.test(text)
  const hasJobMarkers = /\b(job description|responsibilities|requirements|qualifications|apply now|salary|compensation|benefits)\b/i.test(text)
  const hasPostMarkers = /\b(posted|shared|reactions|comments|reposted|view (?:my )?post)\b/i.test(text)

  const types: RawSourceData['sourceType'][] = []
  if (hasProfileMarkers) types.push('linkedin_profile')
  if (hasJobMarkers) types.push('job_posting')
  if (hasPostMarkers) types.push('linkedin_post')
  if (types.length === 0) types.push('pasted_text')
  if (types.length > 1) return 'mixed'
  return types[0]
}


interface PassAOutput {
  person: {
    fullName: string | null
    firstName: string | null
    title: string | null
    seniority: string | null
    location: string | null
    linkedinUrl: string | null
    otherUrls: string[]
  }
  company: {
    name: string | null
    domain: string | null
    linkedinUrl: string | null
    industry: string | null
    size: string | null
    sizeEvidence: string | null
    product: string | null
    stage: string | null
    stageEvidence: string | null
  }
  opportunity: {
    signals: string[]
    primarySignal: string | null
    description: string | null
    urgency: string
    organizationName?: string | null
    organizationId?: string
    organizationRelationship?: string
    temporalScope?: string
    polarity?: string
  }
  job: {
    title: string | null
    employmentType: string
    workplaceType: string
    allowedGeography: string | null
    timezone: string | null
    compensation: string | null
    skills: string[]
    seniority: string | null
    source: string | null
    postedDate: string | null
  } | null
  content: {
    recentPosts: Array<{
      paraphrase: string
      verbatimQuote: string | null
      topics: string[]
      signals: string[]
    }>
    topics: string[]
    explicitProblems: string[]
    initiatives: string[]
    launches: string[]
    technicalSignals: string[]
    hiringSignals: string[]
  }
}

// Fast structured extraction timeout: Groq 120b p95=3.1s, GPT p95=4.9s → 8s budget
const FAST_STRUCTURED_TIMEOUT_MS = 8_000

const PASS_A_SYSTEM = `You are a precise factual extraction engine. Extract ONLY what is explicitly stated in the text. Return a single JSON object.

CRITICAL RULES:
- Never invent missing facts. Use null for unknown fields.
- Never replace a source URL with an inferred URL.
- Distinguish between FACT (explicitly stated) and INFERENCE (your conclusion).
- Every extracted fact must have evidence from the text.
- Keep all values concise and factual.
- COMPANY LOCATION ≠ WORKER LOCATION. A company based in San Francisco offering remote work is NOT "US-only". Only mark workplaceType as ONSITE or geography as restricted if the text EXPLICITLY states a worker location requirement (e.g., "must be based in the US", "on-site in New York").
- "Remote OK", "Remote-friendly", "work from anywhere" = REMOTE. Do not downgrade to ONSITE or geography-restricted merely because the company has a headquarters city.
- COMPANY NAME: If the title contains "at CompanyName" or "of CompanyName" (e.g., "CEO of Starke Marketing"), extract "Starke Marketing" as the company name. Do NOT leave company.name null when the company is clearly mentioned in the title or text.

Extract these entities:
1. PERSON: fullName, firstName, title, seniority, location, linkedinUrl, otherUrls
2. COMPANY: name, domain, linkedinUrl, industry, size (+ evidence), product, stage (+ evidence)
3. OPPORTUNITY: signals (hiring, freelance_project_need, technical_problem, growth_signal, funding, launch, migration, rebuild, hiring_pressure, explicit_ask), primarySignal, description, urgency (immediate, near_term, future, unknown)
4. JOB (if present): title, employmentType, workplaceType (REMOTE/HYBRID/ONSITE/UNKNOWN), allowedGeography, timezone, compensation, skills, seniority, source, postedDate
5. CONTENT: recentPosts (paraphrase, verbatimQuote, topics, signals), topics, explicitProblems, initiatives, launches, technicalSignals, hiringSignals`

const PASS_A_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    person: {
      type: 'object',
      properties: {
        fullName: { type: ['string', 'null'] },
        firstName: { type: ['string', 'null'] },
        title: { type: ['string', 'null'] },
        seniority: { type: ['string', 'null'] },
        location: { type: ['string', 'null'] },
        linkedinUrl: { type: ['string', 'null'] },
        otherUrls: { type: 'array', items: { type: 'string' } },
      },
    },
    company: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        domain: { type: ['string', 'null'] },
        linkedinUrl: { type: ['string', 'null'] },
        industry: { type: ['string', 'null'] },
        size: { type: ['string', 'null'] },
        sizeEvidence: { type: ['string', 'null'] },
        product: { type: ['string', 'null'] },
        stage: { type: ['string', 'null'] },
        stageEvidence: { type: ['string', 'null'] },
      },
    },
    opportunity: {
      type: 'object',
      properties: {
        signals: { type: 'array', items: { type: 'string' } },
        primarySignal: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        urgency: { type: 'string' },
      },
    },
    job: {
      type: ['object', 'null'],
      properties: {
        title: { type: ['string', 'null'] },
        employmentType: { type: 'string' },
        workplaceType: { type: 'string' },
        allowedGeography: { type: ['string', 'null'] },
        timezone: { type: ['string', 'null'] },
        compensation: { type: ['string', 'null'] },
        skills: { type: 'array', items: { type: 'string' } },
        seniority: { type: ['string', 'null'] },
        source: { type: ['string', 'null'] },
        postedDate: { type: ['string', 'null'] },
      },
    },
    content: {
      type: 'object',
      properties: {
        recentPosts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              paraphrase: { type: 'string' },
              verbatimQuote: { type: ['string', 'null'] },
              topics: { type: 'array', items: { type: 'string' } },
              signals: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        topics: { type: 'array', items: { type: 'string' } },
        explicitProblems: { type: 'array', items: { type: 'string' } },
        initiatives: { type: 'array', items: { type: 'string' } },
        launches: { type: 'array', items: { type: 'string' } },
        technicalSignals: { type: 'array', items: { type: 'string' } },
        hiringSignals: { type: 'array', items: { type: 'string' } },
      },
    },
  },
}

function buildPassAUserPrompt(rawText: string, sourceUrls: string[]): string {
  let prompt = `Extract factual entities from this text:\n\n${rawText}`
  if (sourceUrls.length > 0) {
    prompt += `\n\nSource URLs found in the text:\n${sourceUrls.join('\n')}`
  }
  return prompt
}

async function runPassA(
  rawText: string,
  sourceUrls: string[],
  callLog: ExtractionPipelineResult['callLog'],
  onStatus?: (msg: string) => void,
  strictLiveMode?: boolean,
  leadId?: string | null,
  deterministicOnly?: boolean,
): Promise<PassAOutput> {
  onStatus?.('Analyzing prospect')
  const startTime = Date.now()

  if (deterministicOnly) {
    callLog.push({
      provider: 'deterministic',
      model: 'code',
      task: 'extract_pass_a',
      latencyMs: Date.now() - startTime,
      fallback: false,
    })
    const deterministic = demoPassA(rawText)
    deterministic.person.fullName = sanitizePersonName(deterministic.person.fullName)
    deterministic.person.firstName = sanitizePersonName(deterministic.person.firstName)
    deterministic.person.title = sanitizePersonTitle(deterministic.person.title)
    return constrainNonBuyerPassA(deterministic, rawText)
  }

  try {
    const result = await generate<unknown>({
      task: 'FAST_STRUCTURED',
      system: PASS_A_SYSTEM,
      user: buildPassAUserPrompt(rawText, sourceUrls),
      schema: PASS_A_SCHEMA,
      schemaName: 'intelligence_pass_a',
      maxTokens: 1024,
      onStatus,
      callSite: 'extraction-pipeline:runPassA',
      feature: 'prospect_extraction',
      leadId: leadId ?? undefined,
    })

    callLog.push({
      provider: result.trace.provider,
      model: result.trace.model,
      task: 'extract_pass_a',
      latencyMs: result.trace.latencyMs,
      fallback: result.trace.fallback,
    })

    const validated = validatePassA(result.data)
    return stabilizePassA(rawText, sourceUrls, validated)
  } catch (err) {
    if (strictLiveMode) {
      throw new Error(`Live extraction failed in Pass A: ${err instanceof Error ? err.message : String(err)}`)
    }
    callLog.push({
      provider: 'fallback',
      model: 'demo',
      task: 'extract_pass_a',
      latencyMs: Date.now() - startTime,
      fallback: true,
    })
    // The AI path runs sanitizePersonName inside stabilizePassA; the demo
    // fallback does not, so apply it here too so the same greeting/sentence
    // filters protect both paths.
    const demo = demoPassA(rawText)
    demo.person.fullName = sanitizePersonName(demo.person.fullName)
    demo.person.firstName = sanitizePersonName(demo.person.firstName)
    demo.person.title = sanitizePersonTitle(demo.person.title)
    return constrainNonBuyerPassA(demo, rawText)
  }
}

function mergeUnique(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const value = item.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function stabilizePassA(rawText: string, sourceUrls: string[], modelPassA: PassAOutput): PassAOutput {
  const heuristic = demoPassA(rawText)
  const out: PassAOutput = {
    person: { ...modelPassA.person },
    company: { ...modelPassA.company },
    opportunity: { ...modelPassA.opportunity },
    job: modelPassA.job ? { ...modelPassA.job } : null,
    content: {
      recentPosts: [...modelPassA.content.recentPosts],
      topics: [...modelPassA.content.topics],
      explicitProblems: [...modelPassA.content.explicitProblems],
      initiatives: [...modelPassA.content.initiatives],
      launches: [...modelPassA.content.launches],
      technicalSignals: [...modelPassA.content.technicalSignals],
      hiringSignals: [...modelPassA.content.hiringSignals],
    },
  }

  // Neither the model nor the heuristic may put a greeting ("Hi,") in the
  // name field or a sentence fragment ("I'm a freelance React developer
  // with") in the title. An unknown identity stays blank.
  out.person.fullName = sanitizePersonName(out.person.fullName)
  out.person.firstName = sanitizePersonName(out.person.firstName)
  out.person.title = sanitizePersonTitle(out.person.title)
  if (!out.person.fullName && heuristic.person.fullName) out.person.fullName = sanitizePersonName(heuristic.person.fullName)
  if (!out.person.firstName && heuristic.person.firstName) out.person.firstName = sanitizePersonName(heuristic.person.firstName)
  if (!out.person.title && heuristic.person.title) out.person.title = sanitizePersonTitle(heuristic.person.title)
  if (out.person.firstName && out.person.fullName && !out.person.fullName.toLowerCase().startsWith(out.person.firstName.toLowerCase())) {
    out.person.firstName = out.person.fullName.split(/\s+/)[0] ?? null
  }
  if (!out.person.seniority && heuristic.person.seniority) out.person.seniority = heuristic.person.seniority
  if (!out.person.location && heuristic.person.location) out.person.location = heuristic.person.location
  if (!out.person.linkedinUrl && heuristic.person.linkedinUrl) out.person.linkedinUrl = heuristic.person.linkedinUrl

  const sourceOtherUrls = sourceUrls.filter((u) => u !== out.person.linkedinUrl)
  out.person.otherUrls = mergeUnique([
    ...out.person.otherUrls,
    ...heuristic.person.otherUrls,
    ...sourceOtherUrls,
  ])

  if (!out.company.name && heuristic.company.name) out.company.name = heuristic.company.name
  if (!out.company.domain && heuristic.company.domain) out.company.domain = heuristic.company.domain
  if (!out.company.linkedinUrl && heuristic.company.linkedinUrl) out.company.linkedinUrl = heuristic.company.linkedinUrl
  if (!out.company.product && heuristic.company.product) out.company.product = heuristic.company.product
  if (!out.company.stage && heuristic.company.stage) out.company.stage = heuristic.company.stage
  if (!out.company.size && heuristic.company.size) out.company.size = heuristic.company.size
  if (!out.company.sizeEvidence && heuristic.company.sizeEvidence) out.company.sizeEvidence = heuristic.company.sizeEvidence

  // LinkedIn-specific fallback: parse company from the known paste structure.
  // Format: "Name\n· Nth\nRole @ Company | Description\nLocation"
  if (!out.company.name) {
    const linkedinCompany = extractCompanyFromLinkedInHeadline(rawText)
    if (linkedinCompany) out.company.name = linkedinCompany
  }

  const mergedSignals = mergeUnique([
    ...out.opportunity.signals,
    ...heuristic.opportunity.signals,
  ])
  out.opportunity.signals = mergedSignals
  if (!out.opportunity.primarySignal && mergedSignals.length > 0) {
    out.opportunity.primarySignal = selectPrimarySignal(mergedSignals as OpportunitySignal[])
  }
  if ((!out.opportunity.description || /^remote\b/i.test(out.opportunity.description)) && heuristic.opportunity.description) {
    out.opportunity.description = heuristic.opportunity.description
  }
  if (out.opportunity.urgency === 'unknown' && heuristic.opportunity.urgency !== 'unknown') {
    out.opportunity.urgency = heuristic.opportunity.urgency
  }

  if (!out.job && heuristic.job) {
    out.job = { ...heuristic.job }
  } else if (out.job && heuristic.job) {
    out.job = {
      ...out.job,
      title: out.job.title ?? heuristic.job.title,
      employmentType: out.job.employmentType !== 'unknown' ? out.job.employmentType : heuristic.job.employmentType,
      workplaceType: out.job.workplaceType !== 'UNKNOWN' ? out.job.workplaceType : heuristic.job.workplaceType,
      allowedGeography: out.job.allowedGeography ?? heuristic.job.allowedGeography,
      timezone: out.job.timezone ?? heuristic.job.timezone,
      compensation: out.job.compensation ?? heuristic.job.compensation,
      skills: mergeUnique([...out.job.skills, ...heuristic.job.skills]),
      seniority: out.job.seniority ?? heuristic.job.seniority,
      source: out.job.source ?? heuristic.job.source,
      postedDate: out.job.postedDate ?? heuristic.job.postedDate,
    }
  }

  out.content.hiringSignals = mergeUnique([
    ...out.content.hiringSignals,
    ...heuristic.content.hiringSignals,
  ]).slice(0, 5)
  out.content.technicalSignals = mergeUnique([
    ...out.content.technicalSignals,
    ...heuristic.content.technicalSignals,
    ...(out.job?.skills ?? []),
  ]).slice(0, 12)
  out.content.explicitProblems = mergeUnique([
    ...out.content.explicitProblems,
    ...heuristic.content.explicitProblems,
  ]).slice(0, 5)
  out.content.topics = mergeUnique([
    ...out.content.topics,
    ...heuristic.content.topics,
  ]).slice(0, 10)
  out.content.initiatives = mergeUnique([
    ...out.content.initiatives,
    ...heuristic.content.initiatives,
  ]).slice(0, 5)
  out.content.launches = mergeUnique([
    ...out.content.launches,
    ...heuristic.content.launches,
  ]).slice(0, 5)

  if (out.content.recentPosts.length === 0 && heuristic.content.recentPosts.length > 0) {
    out.content.recentPosts = heuristic.content.recentPosts
  }
  out.content.recentPosts = out.content.recentPosts.filter(
    (post) => !isLinkedInChromeText(post.paraphrase) && !isLinkedInChromeText(post.verbatimQuote),
  )

  const identity = separateRoleFromEmployer(rawText, out.person.title, out.company.name)
  out.person.title = identity.title
  out.company.name = identity.company

  return constrainNonBuyerPassA(out, rawText)
}

function constrainNonBuyerPassA(out: PassAOutput, rawText = ''): PassAOutput {
  const title = out.person.title
  const recruiter = isRecruiterTitle(title) || isRecruiterTitle(rawText)
  const clinician = isClinicianProfile(title, out.company.name, `${out.company.industry ?? ''} ${rawText}`)
  // Business-model detection: a career-coaching / recruiting business
  // (e.g. "Find a Job in Germany", "coached candidates") is a non-buyer even
  // describes helping OTHER people find jobs — not buying software delivery.
  const recruiterBusiness = !recruiter && !clinician && classifyBusinessModel(rawText) === 'RECRUITER'
  if (!recruiter && !clinician && !recruiterBusiness) return out

  if (recruiter || recruiterBusiness) {
    out.opportunity.signals = recruiterAllowedSignals(out.opportunity.signals as OpportunitySignal[])
    out.job = null
  } else {
    out.opportunity.signals = clinicianAllowedSignals(out.opportunity.signals as OpportunitySignal[])
    out.job = null
  }
  out.opportunity.primarySignal = selectPrimarySignal(out.opportunity.signals as OpportunitySignal[])
  if (recruiter || clinician || recruiterBusiness) {
    out.content.technicalSignals = []
    out.content.explicitProblems = []
    out.opportunity.urgency = 'unknown'
  }
  return out
}

function validatePassA(raw: unknown): PassAOutput {
  const defaultOut: PassAOutput = {
    person: { fullName: null, firstName: null, title: null, seniority: null, location: null, linkedinUrl: null, otherUrls: [] },
    company: { name: null, domain: null, linkedinUrl: null, industry: null, size: null, sizeEvidence: null, product: null, stage: null, stageEvidence: null },
    opportunity: { signals: [], primarySignal: null, description: null, urgency: 'unknown' },
    job: null,
    content: { recentPosts: [], topics: [], explicitProblems: [], initiatives: [], launches: [], technicalSignals: [], hiringSignals: [] },
  }

  if (!raw || typeof raw !== 'object') return defaultOut
  const r = raw as Record<string, unknown>

  // Coerce provider quirks: "null" string → null, "" → null
  const s = (v: unknown): string | null => {
    if (v === 'null' || v === 'NULL' || v === 'None' || v === '') return null
    return typeof v === 'string' ? v : null
  }
  const a = (v: unknown): string[] => {
    if (v === 'null' || v === 'NULL' || v === 'None' || v === '') return []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }
  // Case-insensitive key lookup (GPT returns PERSON, COMPANY; Groq returns person, company)
  const getKey = (obj: Record<string, unknown> | undefined, key: string): unknown => {
    if (!obj) return undefined
    if (key in obj) return obj[key]
    const lower = key.toLowerCase()
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower) return obj[k]
    }
    return undefined
  }

  // Person
  const person = getKey(r, 'person') as Record<string, unknown> | undefined
  defaultOut.person = {
    fullName: s(getKey(person, 'fullName')),
    firstName: s(getKey(person, 'firstName')),
    title: s(getKey(person, 'title')),
    seniority: s(getKey(person, 'seniority')),
    location: s(getKey(person, 'location')),
    linkedinUrl: s(getKey(person, 'linkedinUrl')),
    otherUrls: a(getKey(person, 'otherUrls')),
  }

  // Company
  const company = getKey(r, 'company') as Record<string, unknown> | undefined
  defaultOut.company = {
    name: s(getKey(company, 'name')),
    domain: s(getKey(company, 'domain')),
    linkedinUrl: s(getKey(company, 'linkedinUrl')),
    industry: s(getKey(company, 'industry')),
    size: s(getKey(company, 'size')),
    sizeEvidence: s(getKey(company, 'sizeEvidence')),
    product: s(getKey(company, 'product')),
    stage: s(getKey(company, 'stage')),
    stageEvidence: s(getKey(company, 'stageEvidence')),
  }

  // Opportunity
  const opportunity = getKey(r, 'opportunity') as Record<string, unknown> | undefined
  defaultOut.opportunity = {
    signals: a(getKey(opportunity, 'signals')),
    primarySignal: s(getKey(opportunity, 'primarySignal')),
    description: s(getKey(opportunity, 'description')),
    urgency: ['immediate', 'near_term', 'future', 'unknown'].includes(String(getKey(opportunity, 'urgency')))
      ? String(getKey(opportunity, 'urgency')) as PassAOutput['opportunity']['urgency']
      : 'unknown',
  }

  // Job (optional)
  const jobRaw = getKey(r, 'job')
  if (jobRaw && typeof jobRaw === 'object') {
    const job = jobRaw as Record<string, unknown>
    defaultOut.job = {
      title: s(getKey(job, 'title')),
      employmentType: ['full_time', 'part_time', 'contract', 'freelance', 'unknown'].includes(String(getKey(job, 'employmentType')))
        ? String(getKey(job, 'employmentType')) as 'full_time' | 'part_time' | 'contract' | 'freelance' | 'unknown'
        : 'unknown',
      workplaceType: ['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'].includes(String(getKey(job, 'workplaceType')))
        ? String(getKey(job, 'workplaceType')) as 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN'
        : 'UNKNOWN',
      allowedGeography: s(getKey(job, 'allowedGeography')),
      timezone: s(getKey(job, 'timezone')),
      compensation: s(getKey(job, 'compensation')),
      skills: a(getKey(job, 'skills')),
      seniority: s(getKey(job, 'seniority')),
      source: s(getKey(job, 'source')),
      postedDate: s(getKey(job, 'postedDate')),
    }
  }

  // Content
  const content = getKey(r, 'content') as Record<string, unknown> | undefined
  defaultOut.content = {
    recentPosts: (() => {
      const rp = getKey(content, 'recentPosts')
      if (rp === 'null' || rp === 'None' || rp === '') return []
      return Array.isArray(rp)
        ? rp.filter((p): p is { paraphrase: string; verbatimQuote: string | null; topics: string[]; signals: string[] } =>
            typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).paraphrase === 'string'
          ).map((p) => ({
            paraphrase: p.paraphrase,
            verbatimQuote: s(p.verbatimQuote),
            topics: a(p.topics),
            signals: a(p.signals),
          }))
        : []
    })(),
    topics: a(getKey(content, 'topics')),
    explicitProblems: a(getKey(content, 'explicitProblems')),
    initiatives: a(getKey(content, 'initiatives')),
    launches: a(getKey(content, 'launches')),
    technicalSignals: a(getKey(content, 'technicalSignals')),
    hiringSignals: a(getKey(content, 'hiringSignals')),
  }

  return defaultOut
}


function normalizePassA(
  passA: PassAOutput,
  sourceUrls: string[],
  _remoteEligibility: RemoteEligibility,
  rawText?: string,
): {
  intelligence: Omit<NormalizedIntelligence, 'remoteEligibility'>
  evidenceLedger: EvidenceEntry[]
  normalizedSourceUrls: string[]
} {
  const evidenceLedger: EvidenceEntry[] = []
  const normalizedUrls: string[] = []

  // Preserve and normalize URLs
  for (const url of sourceUrls) {
    const normalized = normalizeUrl(url)
    if (normalized) {
      normalizedUrls.push(normalized)
      evidenceLedger.push({
        signal: `Source URL: ${categorizeUrl(url)}`,
        source: categorizeUrl(url) === 'linkedin_profile' ? 'linkedin_profile'
          : categorizeUrl(url) === 'linkedin_company' ? 'linkedin_profile'
          : categorizeUrl(url) === 'job_posting' ? 'job_posting'
          : 'pasted_text',
        sourceUrl: normalized,
        evidenceType: 'FACT',
        ownership: categorizeUrl(url) === 'job_posting' ? 'JOB_REQUIREMENT' : 'COMPANY_ATTRIBUTE',
        confidence: 'HIGH',
        safeForOutreach: false,
      })
    }
  }

  // Person normalization — clean LinkedIn UI artifacts from AI extraction
  const person: ExtractedPerson = {
    fullName: cleanPersonName(passA.person.fullName) || null,
    firstName: passA.person.firstName?.trim() || extractFirstName(passA.person.fullName),
    title: passA.person.title?.trim() || null,
    seniority: normalizeSeniority(passA.person.seniority, passA.person.title),
    location: passA.person.location?.trim() || null,
    linkedinUrl: normalizeLinkedInUrl(passA.person.linkedinUrl),
    otherUrls: passA.person.otherUrls.map(normalizeUrl).filter((u): u is string => u !== null),
  }

  // Company normalization — clean LinkedIn UI artifacts (e.g. "Lotus logo")
  const company: ExtractedCompany = {
    name: cleanCompanyName(passA.company.name),
    domain: passA.company.domain?.trim() || null,
    linkedinUrl: normalizeLinkedInUrl(passA.company.linkedinUrl),
    industry: passA.company.industry?.trim() || null,
    size: passA.company.size?.trim() || null,
    sizeEvidence: passA.company.sizeEvidence?.trim() || null,
    product: passA.company.product?.trim() || null,
    stage: normalizeStage(passA.company.stage),
    stageEvidence: passA.company.stageEvidence?.trim() || null,
  }

  // Opportunity normalization
  const validSignals: OpportunitySignal[] = [
    'hiring', 'freelance_project_need', 'technical_problem', 'growth_signal',
    'funding', 'launch', 'migration', 'rebuild', 'hiring_pressure', 'explicit_ask',
  ]
  const signals = passA.opportunity.signals.filter((s): s is OpportunitySignal =>
    validSignals.includes(s as OpportunitySignal)
  )
  const primarySignal = signals[0] ?? null

  const opportunity: ExtractedOpportunity = {
    signals,
    primarySignal,
    description: passA.opportunity.description?.trim() || null,
    urgency: ['immediate', 'near_term', 'future', 'unknown'].includes(passA.opportunity.urgency)
      ? passA.opportunity.urgency as ExtractedOpportunity['urgency']
      : 'unknown',
    organizationName: passA.opportunity.organizationName?.trim() || undefined,
    organizationId: passA.opportunity.organizationId?.trim() || undefined,
    organizationRelationship: (passA.opportunity.organizationRelationship as ExtractedOpportunity['organizationRelationship']) || undefined,
    temporalScope: (passA.opportunity.temporalScope as ExtractedOpportunity['temporalScope']) || undefined,
    polarity: (passA.opportunity.polarity as ExtractedOpportunity['polarity']) || undefined,
  }

  // Job normalization (if present)
  let job: ExtractedJob | null = null
  const passAJob = passA.job
  if (passAJob) {
    job = {
      title: passAJob.title?.trim() || null,
      employmentType: (['full_time', 'part_time', 'contract', 'freelance', 'unknown'] as const).includes(passAJob.employmentType as never)
        ? passAJob.employmentType as ExtractedJob['employmentType']
        : 'unknown',
      workplaceType: (['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'] as const).includes(passAJob.workplaceType as never)
        ? passAJob.workplaceType as ExtractedJob['workplaceType']
        : 'UNKNOWN',
      allowedGeography: passAJob.allowedGeography?.trim() || null,
      timezone: passAJob.timezone?.trim() || null,
      compensation: passAJob.compensation?.trim() || null,
      skills: passAJob.skills.map((s) => s.trim()).filter(Boolean),
      seniority: passAJob.seniority?.trim() || null,
      source: passAJob.source?.trim() || null,
      postedDate: passAJob.postedDate?.trim() || null,
    }
  }

  // Content normalization
  const fallbackTechnicalSignals = job?.skills ?? []
  const content: ExtractedContent = {
    recentPosts: passA.content.recentPosts.map((p) => ({
      paraphrase: p.paraphrase.trim(),
      verbatimQuote: p.verbatimQuote?.trim() || null,
      topics: p.topics.map((t) => t.trim()).filter(Boolean),
      signals: p.signals.filter((s): s is OpportunitySignal => validSignals.includes(s as OpportunitySignal)),
    })),
    topics: mergeUnique([
      ...passA.content.topics.map((t) => t.trim()).filter(Boolean),
      ...fallbackTechnicalSignals,
    ]).slice(0, 10),
    explicitProblems: passA.content.explicitProblems.map((p) => p.trim()).filter(Boolean),
    initiatives: passA.content.initiatives.map((i) => i.trim()).filter(Boolean),
    launches: passA.content.launches.map((l) => l.trim()).filter(Boolean),
    technicalSignals: mergeUnique([
      ...passA.content.technicalSignals.map((t) => t.trim()).filter(Boolean),
      ...fallbackTechnicalSignals,
    ]).slice(0, 12),
    hiringSignals: passA.content.hiringSignals.map((h) => h.trim()).filter(Boolean),
  }

  const opportunityOrg = opportunity.organizationName ?? company.name ?? undefined
  const opportunityRelationship: EvidenceRelationship | undefined = opportunity.organizationRelationship
    || (opportunity.organizationName && opportunity.organizationName !== company.name
      ? 'OPPORTUNITY_ORGANIZATION'
      : undefined)

  if (content.hiringSignals.length > 0) {
    const quote = content.hiringSignals[0]
    evidenceLedger.push({
      signal: 'Hiring activity detected',
      source: 'pasted_text',
      evidenceType: 'FACT',
      ownership: 'HIRING_INTENT',
      confidence: 'HIGH',
      safeForOutreach: true,
      verbatimQuote: quote.slice(0, 200),
      subjectType: 'OPPORTUNITY',
      organizationName: opportunityOrg,
      organizationId: opportunity.organizationId,
      relationshipToProspect: opportunityRelationship,
      temporalScope: opportunity.temporalScope ?? 'UNKNOWN',
      polarity: opportunity.polarity ?? 'ACTIVE',
      needOwnership: classifyNeedOwnership(quote),
    })
  }
  if (content.technicalSignals.length > 0) {
    const techSummary = content.technicalSignals.slice(0, 3).join(', ')
    evidenceLedger.push({
      signal: `Technical work detected: ${techSummary}`,
      source: 'pasted_text',
      evidenceType: 'STRONG_INFERENCE',
      ownership: 'BUYER_INTENT',
      confidence: 'MEDIUM',
      safeForOutreach: true,
      subjectType: 'OPPORTUNITY',
      organizationName: opportunityOrg,
      organizationId: opportunity.organizationId,
      relationshipToProspect: opportunityRelationship,
      temporalScope: opportunity.temporalScope ?? 'UNKNOWN',
      polarity: opportunity.polarity ?? 'ACTIVE',
      needOwnership: classifyNeedOwnership(rawText ?? ''),
    })
  }
  if (content.explicitProblems.length > 0) {
    const problem = content.explicitProblems[0]
    evidenceLedger.push({
      signal: 'Explicit problem stated',
      source: 'pasted_text',
      evidenceType: 'FACT',
      ownership: 'BUYER_INTENT',
      confidence: 'HIGH',
      safeForOutreach: true,
      verbatimQuote: problem.slice(0, 200),
      subjectType: 'OPPORTUNITY',
      organizationName: opportunityOrg,
      organizationId: opportunity.organizationId,
      relationshipToProspect: opportunityRelationship,
      temporalScope: opportunity.temporalScope ?? 'UNKNOWN',
      polarity: opportunity.polarity ?? 'ACTIVE',
      needOwnership: classifyNeedOwnership(problem),
    })
  }

  return {
    intelligence: {
      person,
      company,
      opportunity,
      job,
      content,
      probableNeed: null, // Filled in Pass C
      opportunityTrigger: null, // Filled in Pass C
      timingSignal: null, // Filled in Pass C
      risks: [],
      unknowns: [],
      resolvedContradictions: [],
      businessModel: 'UNKNOWN',
      relationship: 'UNKNOWN',
    },
    evidenceLedger,
    normalizedSourceUrls: normalizedUrls,
  }
}


const PASS_C_SYSTEM = `You are a strategic sales intelligence analyst. Given extracted prospect data, determine WHY this person/company could realistically hire a software development team.

CRITICAL RULES:
- Clearly distinguish FACT vs STRONG_INFERENCE vs WEAK_INFERENCE
- Weak inferences must NOT become outreach claims
- Be specific about what signals support each conclusion
- If evidence is insufficient, say so rather than speculating

Return a JSON object with:
- probableNeed: What delivery need they likely have (null if unclear)
- opportunityTrigger: What specific event/signal creates the opportunity now
- timingSignal: Why now vs later (null if no timing signal)
- risks: List of reasons this may NOT be a good opportunity
- unknowns: List of important information we don't have`

function buildPassCPrompt(passA: PassAOutput, passB: Omit<NormalizedIntelligence, 'remoteEligibility'>): string {
  return `Analyze this prospect data for sales opportunity intelligence:

PERSON: ${JSON.stringify(passB.person)}
COMPANY: ${JSON.stringify(passB.company)}
OPPORTUNITY: ${JSON.stringify(passB.opportunity)}
JOB: ${JSON.stringify(passB.job)}
CONTENT SIGNALS:
- Topics: ${passB.content.topics.join(', ')}
- Technical signals: ${passB.content.technicalSignals.join(', ')}
- Hiring signals: ${passB.content.hiringSignals.join(', ')}
- Explicit problems: ${passB.content.explicitProblems.join(', ')}
- Recent initiatives: ${passB.content.initiatives.join(', ')}

CONTEXT: Our team is based in Pakistan, seeking remote international contracts and freelance projects. We deliver software development services.

What is their probable delivery need, what creates this opportunity now, and what are the risks/unknowns?`
}

const PASS_C_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    probableNeed: { type: ['string', 'null'] },
    opportunityTrigger: { type: ['string', 'null'] },
    timingSignal: { type: ['string', 'null'] },
    risks: { type: 'array', items: { type: 'string' } },
    unknowns: { type: 'array', items: { type: 'string' } },
  },
}

async function runPassC(
  passA: PassAOutput,
  intelligence: Omit<NormalizedIntelligence, 'remoteEligibility'>,
  callLog: ExtractionPipelineResult['callLog'],
  onStatus?: (msg: string) => void,
  strictLiveMode?: boolean,
  leadId?: string | null,
  deterministicOnly?: boolean,
): Promise<Pick<NormalizedIntelligence, 'probableNeed' | 'opportunityTrigger' | 'timingSignal' | 'risks' | 'unknowns'>> {
  // Pass C is only needed for risks/unknowns when deterministic fallback is insufficient.
  const hasSignals = passA.opportunity.signals.length > 0
  const hasPersonOrCompany = Boolean(passA.person.fullName || passA.company.name)
  const deterministicPassC = stabilizePassC(demoPassC(passA), passA, intelligence)
  const deterministicSufficient = hasSignals && hasPersonOrCompany &&
    deterministicPassC.probableNeed !== null &&
    deterministicPassC.opportunityTrigger !== null

  if (deterministicSufficient || deterministicOnly) {
    callLog.push({
      provider: 'deterministic',
      model: 'code',
      task: 'intelligence_pass_c',
      latencyMs: 0,
      fallback: false,
    })
    return deterministicPassC
  }

  onStatus?.('Finalizing intelligence')
  const startTime = Date.now()

  try {
    const result = await generate<unknown>({
      task: 'FAST_STRUCTURED',
      system: PASS_C_SYSTEM,
      user: buildPassCPrompt(passA, intelligence),
      schema: PASS_C_SCHEMA,
      schemaName: 'intelligence_pass_c',
      maxTokens: 512,
      onStatus,
      callSite: 'extraction-pipeline:runPassC',
      feature: 'prospect_extraction',
      leadId: leadId ?? undefined,
    })

    callLog.push({
      provider: result.trace.provider,
      model: result.trace.model,
      task: 'intelligence_pass_c',
      latencyMs: result.trace.latencyMs,
      fallback: result.trace.fallback,
    })

    const validated = validatePassC(result.data)
    return stabilizePassC(validated, passA, intelligence)
  } catch (err) {
    if (strictLiveMode) {
      throw new Error(`Live extraction failed in Pass C: ${err instanceof Error ? err.message : String(err)}`)
    }
    callLog.push({
      provider: 'fallback',
      model: 'demo',
      task: 'intelligence_pass_c',
      latencyMs: Date.now() - startTime,
      fallback: true,
    })
    return deterministicPassC
  }
}

function isRemoteOnlyInsight(text: string | null): boolean {
  if (!text) return true
  const value = text.trim().toLowerCase()
  if (!value) return true
  return /^(remote|remote role|this is remote|fully remote|work from anywhere)[\s.!]*$/.test(value)
}

function buildFallbackTrigger(passA: PassAOutput, intelligence: Omit<NormalizedIntelligence, 'remoteEligibility'>): string | null {
  const company = intelligence.company.name ?? passA.company.name ?? 'The company'
  const jobTitle = intelligence.job?.title ?? passA.job?.title
  const skills = (intelligence.job?.skills ?? passA.job?.skills ?? []).slice(0, 5)

  if (intelligence.opportunity.signals.includes('explicit_ask') || intelligence.opportunity.signals.includes('hiring')) {
    const titlePart = jobTitle ? ` ${jobTitle}` : ' software talent'
    const skillPart = skills.length > 0 ? ` (${skills.join(', ')})` : ''
    return `${company} is explicitly hiring${titlePart}${skillPart}.`
  }

  if (intelligence.content.explicitProblems.length > 0) {
    return intelligence.content.explicitProblems[0]
  }

  if (intelligence.content.hiringSignals.length > 0) {
    return intelligence.content.hiringSignals[0]
  }

  if (intelligence.opportunity.description && !isRemoteOnlyInsight(intelligence.opportunity.description)) {
    return intelligence.opportunity.description
  }

  return null
}

function buildFallbackProbableNeed(passA: PassAOutput, intelligence: Omit<NormalizedIntelligence, 'remoteEligibility'>): string | null {
  if (isNonBuyerProfessional({
    title: intelligence.person.title ?? passA.person.title,
    company: intelligence.company.name ?? passA.company.name,
    industry: intelligence.company.industry ?? passA.company.industry,
  })) {
    return null
  }
  const company = intelligence.company.name ?? passA.company.name ?? 'This company'
  const skills = (intelligence.job?.skills ?? passA.job?.skills ?? intelligence.content.technicalSignals).slice(0, 6)

  // Only return a need statement when there's a genuine buying signal,
  // and keep it hedged — this is a fallback, not an AI-extracted fact.
  if (intelligence.opportunity.signals.includes('explicit_ask')) {
    if (skills.length > 0) {
      return `${company} appears to need full-stack delivery capacity across ${skills.join(', ')}.`
    }
    return `${company} appears to need additional engineering delivery capacity.`
  }

  if (intelligence.opportunity.signals.includes('technical_problem')) {
    return `${company} appears to need support resolving a technical delivery issue.`
  }

  // Hiring signal alone is NOT evidence of need for external delivery —
  // they may be hiring full-time employees. Return null rather than fabricate.
  return null
}

function stabilizePassC(
  passC: Pick<NormalizedIntelligence, 'probableNeed' | 'opportunityTrigger' | 'timingSignal' | 'risks' | 'unknowns'>,
  passA: PassAOutput,
  intelligence: Omit<NormalizedIntelligence, 'remoteEligibility'>,
): Pick<NormalizedIntelligence, 'probableNeed' | 'opportunityTrigger' | 'timingSignal' | 'risks' | 'unknowns'> {
  const out = {
    probableNeed: passC.probableNeed,
    opportunityTrigger: passC.opportunityTrigger,
    timingSignal: passC.timingSignal,
    risks: [...passC.risks],
    unknowns: [...passC.unknowns],
  }

  if (isNonBuyerProfessional({
    title: intelligence.person.title ?? passA.person.title,
    company: intelligence.company.name ?? passA.company.name,
    industry: intelligence.company.industry ?? passA.company.industry,
  })) {
    out.probableNeed = null
    if (!out.risks.some((risk) => /not a buyer/i.test(risk))) {
      out.risks.push('Profile is a clinician, recruiter, or other non-buyer of software delivery.')
    }
  }

  if (!out.probableNeed) {
    out.probableNeed = buildFallbackProbableNeed(passA, intelligence)
  }

  if (isRemoteOnlyInsight(out.opportunityTrigger)) {
    out.opportunityTrigger = buildFallbackTrigger(passA, intelligence)
  }

  if (!out.timingSignal) {
    if (intelligence.opportunity.urgency === 'immediate') {
      out.timingSignal = 'Immediate demand signaled in current hiring/problem statements.'
    } else if (intelligence.opportunity.urgency === 'near_term' || intelligence.content.hiringSignals.length > 0) {
      out.timingSignal = 'Current hiring activity indicates a near-term delivery window.'
    }
  }

  return out
}

function validatePassC(raw: unknown): Pick<NormalizedIntelligence, 'probableNeed' | 'opportunityTrigger' | 'timingSignal' | 'risks' | 'unknowns'> {
  if (!raw || typeof raw !== 'object') {
    return { probableNeed: null, opportunityTrigger: null, timingSignal: null, risks: [], unknowns: [] }
  }
  const r = raw as Record<string, unknown>
  return {
    probableNeed: typeof r.probableNeed === 'string' ? r.probableNeed : null,
    opportunityTrigger: typeof r.opportunityTrigger === 'string' ? r.opportunityTrigger : null,
    timingSignal: typeof r.timingSignal === 'string' ? r.timingSignal : null,
    risks: Array.isArray(r.risks) ? r.risks.filter((x): x is string => typeof x === 'string') : [],
    unknowns: Array.isArray(r.unknowns) ? r.unknowns.filter((x): x is string => typeof x === 'string') : [],
  }
}


function normalizeUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.toString()
  } catch {
    return url.trim() || null
  }
}

function normalizeLinkedInUrl(url: string | null): string | null {
  if (!url) return null
  const normalized = normalizeUrl(url)
  if (!normalized) return null
  if (!normalized.includes('linkedin.com/')) return null
  return normalized
}

// Name prefixes/titles that should never be used as a first name.
const NAME_PREFIXES = new Set([
  'dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss',
  'prof', 'prof.', 'sir', 'madam', 'lord', 'lady',
  'capt', 'capt.', 'maj', 'maj.', 'col', 'col.', 'sgt', 'sgt.',
  'rev', 'rev.', 'hon', 'hon.',
])

function extractFirstName(fullName: string | null): string | null {
  if (!fullName) return null
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  // Skip titles/prefixes like "Dr.", "Mr.", etc.
  const firstReal = parts.find((p) => !NAME_PREFIXES.has(p.toLowerCase().replace(/\.$/, '')))
  return firstReal || parts[0] || null
}

function normalizeSeniority(seniority: string | null, title: string | null): string | null {
  if (seniority) return seniority
  if (!title) return null
  const lower = title.toLowerCase()
  if (/\b(ceo|cto|cio|coo|chief|founder|co[- ]?founder|president|partner|managing director)\b/i.test(lower)) return 'executive'
  if (/\b(vp|head of|director)\b/i.test(lower)) return 'senior'
  if (/\b(principal|staff|lead|architect|distinguished)\b/i.test(lower)) return 'senior'
  if (/\b(senior|sr\.?|manager)\b/i.test(lower)) return 'mid_senior'
  if (/\b(junior|jr\.?|intern|associate|entry|graduate)\b/i.test(lower)) return 'junior'
  return 'mid'
}

function normalizeStage(stage: string | null): string | null {
  if (!stage) return null
  const lower = stage.toLowerCase()
  if (/\b(seed|pre[- ]?seed|angel)\b/i.test(lower)) return 'seed'
  if (/\b(series [abc])\b/i.test(lower)) return lower.match(/series [abc]/)?.[0] || 'growth'
  if (/\b(growth|scale|series [def])\b/i.test(lower)) return 'growth'
  if (/\b(enterprise|late|established|public|ipo)\b/i.test(lower)) return 'enterprise'
  if (/\b(startup|early|small)\b/i.test(lower)) return 'early'
  return stage.trim()
}


const TECH_KEYWORDS = [
  'next.js',
  'react',
  'node.js',
  'node',
  'rails',
  'ruby on rails',
  'svelte',
  'wxt',
  'typescript',
  'javascript',
  'python',
  'flask',
  'firebase',
  'postgresql',
  'openai',
  'chatgpt',
  'langflow',
  'oidc',
  'oauth',
  'blockchain',
  'gdpr',
  'rls',
  'tenant isolation',
  'headless cms',
  'cdn',
  'base44',
  'payments',
  'seo',
  'lead generation',
  'architecture',
  'hipaa',
  'supplement',
  'rails 8',
  'figma',
  'css',
  'astro',
  '11ty',
]

const SOFTWARE_ASK_PATTERNS = [
  /\blooking for\b.{0,80}\b(?:developer|engineer|contractor|freelancer|agency|technical partner|(?:dev|engineering) team|react|node\.?js)\b/i,
  /\bneed (?:a|an|someone who can|help) (?:build|fix|ship|develop|engineer|integrate|embed)\b/i,
  /\bwe need (?:a |an )?(?:developer|engineer|contractor|technical|dev)\b/i,
  /\bseeking (?:a |an )?(?:developer|engineer|contractor|technical cofounder|dev)\b/i,
  /\bexternal (?:dev|developer|engineering|technical) help\b/i,
]

const DEV_ROLE_HINT = /\b(developer|engineer|full[- ]?stack|backend|frontend|software|app|platform|api|architect|devops|contractor|integration)\b/i

const PAIN_PATTERNS = [
  /\bstruggling\b/i,
  /\bblank screen\b/i,
  /\bbug\b/i,
  /\burgent\b/i,
  /\bnot production ready\b/i,
  /\bdrowning\b/i,
  /\bcan'?t deliver\b/i,
  /\bslowing down\b/i,
  /\bbacklog\b/i,
  /\bprevious developer\b/i,
  /\bdisappeared\b/i,
  /\bfull requirements\b/i,
]

function splitLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Identity-block section headers. Everything before the first of these is the
 * profile header (name + headline + location) and is owned by the prospect.
 * Everything after is About / posts / experience / education — where market
 * commentary, audience language, and reposted content live, and which must NOT
 * be mined for the prospect's title, location, or company.
 */
const SECTION_HEADER_RE = /^(about|activity|experience|posts?|comments?|images?|education|licenses?\s*&\s*certifications?|skills|highlights|contact\s*info|show\s+all)$/i

/**
 * Return only the header lines before the first section boundary. This keeps
 * identity extraction (name/title/location/company) from being poisoned by
 * post content — e.g. a line like "Software Engineer → use AI in development"
 * inside a post must not become the prospect's title.
 */
function identityBlockLines(lines: string[]): string[] {
  const end = lines.findIndex((line) => SECTION_HEADER_RE.test(line))
  return end === -1 ? lines : lines.slice(0, end)
}

// LinkedIn UI chrome that must never be treated as a person's name.
const LINKEDIN_NAME_BLOCKLIST = [
  'view', 'view profile', 'view connection', 'follow', 'follow back',
  'connect', 'message', 'recommend', 'endorse', 'more', 'see all',
  'load more', 'show all', 'skip', 'close', 'edit', 'share',
  'report', 'block', 'remove', 'accept', 'decline', 'pending',
  'invitation sent', 'mutual connections', 'connections', 'connection',
]

const GREETING_WORDS = /^(?:hi|hey|hello|dear|greetings|good\s+(?:morning|afternoon|evening|day)|hallo|hola|bonjour|salut|team|there|all|everyone|sir|madam|ma'am)$/i

/** Per-word greeting/address vocabulary for multi-word greeting detection. */
const ALL_GREETING_WORDS = /^(?:hi|hey|hello|hey|dear|greetings|good|good morning|good afternoon|good evening|good day|hallo|hola|bonjour|salut|team|there|all|everyone|folks|people|guys|sir|madam|ma'am|morning|afternoon|evening|day|there|thanks|regards|best|cheers|sincerely|please|dear)$/i

/**
 * A capitalized person/company token — first letter uppercase, at least 2 chars.
 * Single uppercase letters (like "I" or "A") are rejected because they are
 * almost always sentence fragments, not name or company tokens.
 *
 * Uses Unicode property escapes (\p{Lu} uppercase letter, \p{L} any letter) so
 * international names (José, Müller, Михаил, O'Brien) are accepted. The 'u'
 * flag enables Unicode mode.
 */
const NAME_TOKEN = /^[\p{Lu}][\p{Ll}\p{L}'.-]+$/u

/**
 * Pull 1-4 consecutive capitalized words starting at `startIdx` from `words`.
 * Returns the joined name and the index of the next word after the name.
 * Stops at lowercase words, sentence boundaries, contractions, or 4 tokens.
 */
function takeCapitalizedName(words: string[], startIdx: number): { name: string; nextIdx: number } {
  const tokens: string[] = []
  let i = startIdx
  while (i < words.length && tokens.length < 4) {
    const raw = words[i]
    const w = raw.replace(/^[("'“]+|[,:;"'”.!?\)]+$/g, '')
    if (!NAME_TOKEN.test(w)) break
    // Reject common contractions that start with a capital letter (I'm, I've, I'd,
    // It's, We're, They've). These are never name tokens.
    if (/^(?:I'm|I've|I'd|I'll|It's|We're|We've|We'll|They're|They've|They'll|He's|She's|Who's|What's|Here's|There's|That's)$/i.test(w)) break
    tokens.push(w)
    i++
    if (/[,;:.!?]$/.test(raw)) break
  }
  return { name: tokens.join(' '), nextIdx: i }
}

/**
 * Extract sender identity from explicit self-introduction prose such as
 * "My name is …", "I'm … from …", or "I lead our product engineering
 * department". These patterns appear inside sentences that
 * the line-based name scanner (`extractName`) skips because the line does not
 * look like a standalone name header.
 *
 * Uses token-based parsing (not fragile Unicode regex) to stay robust across
 * locales and avoid fixture-specific behavior.
 *
 * Returns the first confident match — name and/or role/company — or null.
 */
export function extractIntroduction(text: string): { name: string | null; role: string | null; company: string | null } | null {
  if (!text) return null

  // Word-token array for pattern scanning.
  const words = text.split(/\s+/)

  // --- Pattern 1: "My name is [name]" / "My name's [name]" ---
  for (let i = 0; i < words.length - 2; i++) {
    const w0 = words[i].toLowerCase().replace(/[^a-z'-]/g, '')
    const w1 = words[i + 1].toLowerCase().replace(/[^a-z'-]/g, '')
    const w2 = words[i + 2].toLowerCase().replace(/[^a-z'-]/g, '')
    if ((w0 === 'my' && (w1 === 'name' || w1 === "name's" || w1 === 'names') && (w2 === 'is' || w2 === 'was'))) {
      const { name, nextIdx } = takeCapitalizedName(words, i + 3)
      if (looksLikePersonName(name)) {
        const rest = words.slice(nextIdx).join(' ')
        const { role, company } = extractRoleAndCompanyFromTail(rest)
        return { name, role, company }
      }
    }
  }

  // --- Pattern 2: "This is [name] from [company]" ---
  for (let i = 0; i < words.length - 2; i++) {
    const w0 = words[i]
    const w1 = words[i + 1].toLowerCase().replace(/[^a-z'-]/g, '')
    if (/^This$/i.test(w0) && (w1 === 'is' || w1 === 'was')) {
      const { name, nextIdx } = takeCapitalizedName(words, i + 2)
      if (looksLikePersonName(name)) {
        const rest = words.slice(nextIdx).join(' ')
        const { role, company } = extractRoleAndCompanyFromTail(rest)
        return { name, role, company }
      }
    }
  }

  // --- Pattern 3: "I'm [name]" / "I am [name]" ---
  for (let i = 0; i < words.length - 1; i++) {
    const rawWord = words[i]
    const w0 = rawWord.toLowerCase()
    // Match "I'm", "I'am" (typo), or "I" (for "I am")
    const isContraction = /^(i'm|i'am|i’m)$/.test(w0)
    const isPronoun = w0 === 'i'
    if (!isContraction && !isPronoun) continue
    if (isPronoun && (words[i + 1] ?? '').toLowerCase().replace(/[^a-z]/g, '') !== 'am') continue
    // "I am" vs "I'm" — the name starts 1 or 2 tokens after position i
    const startIdx = isContraction ? i + 1 : i + 2
    if (startIdx >= words.length) continue
    // Skip articles/adverbs that aren't part of the name
    const firstWord = (words[startIdx] || '').toLowerCase().replace(/[^a-z]/g, '')
    if (['a', 'an', 'the', 'looking', 'currently', 'available', 'here', 'writing'].includes(firstWord)) {
      continue
    }
    const { name, nextIdx } = takeCapitalizedName(words, startIdx)
    if (looksLikePersonName(name)) {
      const rest = words.slice(nextIdx).join(' ')
      const { role, company } = extractRoleAndCompanyFromTail(rest)
      return { name, role, company }
    }
  }

  // --- Pattern 4: "Myself [name]" ---
  for (let i = 0; i < words.length - 1; i++) {
    const w0 = words[i].toLowerCase().replace(/[^a-z'-]/g, '')
    if (w0 === 'myself') {
      const { name } = takeCapitalizedName(words, i + 1)
      if (looksLikePersonName(name)) {
        return { name, role: null, company: null }
      }
    }
  }

  // --- Pattern 5: "I lead / head / manage [department]" / "I work as [role]" (role only) ---
  for (let i = 0; i < words.length - 2; i++) {
    const w0 = words[i].toLowerCase().replace(/[^a-z'-]/g, '')
    const w1 = words[i + 1].toLowerCase().replace(/[^a-z'-]/g, '')
    if (w0 === 'i' && ['lead', 'head', 'manage', 'oversee', 'run', 'work'].includes(w1)) {
      // For "work as", skip the "as" to get to the role
      const roleStart = w1 === 'work' ? i + 3 : i + 2
      if (w1 === 'work' && (words[i + 2] || '').toLowerCase().replace(/[^a-z]/g, '') !== 'as') continue
      let raw = words.slice(roleStart).join(' ').split(/\s*[,.;()]\s*/)[0].trim()
      // Strip leading articles (a, an, the) from the role.
      raw = raw.replace(/^(?:a|an|the)\s+/i, '').trim()
      if (raw) {
        // Strip leading possessive pronouns (our, the, my) from the role.
        const roleStripped = raw.replace(/^(?:our|the|my)\s+/i, '').trim()
        // Split role from an optional "at [company]" suffix.
        const rawLower = roleStripped.toLowerCase()
        const atIdx = rawLower.indexOf(' at ')
        const roleRaw = atIdx >= 0 ? roleStripped.slice(0, atIdx).trim() : roleStripped
        const company = atIdx >= 0 ? roleStripped.slice(atIdx + 4).split(/\s*[,.;()]\s*/)[0].trim() || null : null
        const role = roleRaw.split(/\s+/).map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
        return { name: null, role, company }
      }
    }
  }

  return null
}

/**
 * Given the tail of a sentence after a name, extract role and company if the
 * prose states them — e.g. "from [company]", "I work as X at Y".
 */
function extractRoleAndCompanyFromTail(rest: string): { role: string | null; company: string | null } {
  const lower = rest.toLowerCase()
  let company: string | null = null
  let role: string | null = null

  // ", VP Engineering at Aurora Commerce" after an explicit name.
  const roleAt = rest.match(/^[\s,;:–—-]*([\p{L}][\p{L}\p{N}&/.+ -]{1,80}?)\s+at\s+([\p{Lu}\p{N}][^.!?\n]{0,79})/u)
  if (roleAt) {
    role = sanitizePersonTitle(roleAt[1].trim())
    company = sanitizeCompanyName(roleAt[2].trim())
  }

  // "from [Company]" — the first capitalized run after "from".
  // Try " from " (mid-sentence) first, then "from" at the very start of `rest`.
  let fromIdx = lower.indexOf(' from ')
  let fromLen = 6
  if (fromIdx < 0 && lower.startsWith('from ')) {
    fromIdx = 0
    fromLen = 5
  }
  if (fromIdx >= 0) {
    const after = rest.slice(fromIdx + fromLen)
    const afterWords = after.split(/\s+/)
    const tokens: string[] = []
    for (const w of afterWords) {
      const clean = w.replace(/^[("'“]+|[,:;"'”.!?\)]+$/g, '')
      if (!NAME_TOKEN.test(clean)) break
      tokens.push(clean)
    }
    if (tokens.length > 0) {
      company = tokens.join(' ')
    }
  }

  // "work as / am / 'm [role] at [company]"
  const workAsMatch = lower.match(/work as\s+(.+?)\s+at\s+/)
  if (workAsMatch?.[1]) {
    role = workAsMatch[1].split(/\s+/).map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
    const atIdx = lower.indexOf(' at ', lower.indexOf('work as'))
    if (atIdx >= 0) {
      const after = rest.slice(atIdx + 4)
      const afterWords = after.split(/\s+/)
      const tokens: string[] = []
      for (const w of afterWords) {
        const clean = w.replace(/^[("'“]+|[,:;"'”.!?\)]+$/g, '')
        if (!NAME_TOKEN.test(clean)) break
        tokens.push(clean)
      }
      if (tokens.length > 0) company = tokens.join(' ')
    }
  }

  return { role: role || null, company: company || null }
}

/**
 * Reusable guard: is `value` a plausible person name? 1-4 capitalized tokens,
 * no sentence fragments, no role/company keywords, no greeting words.
 */
function looksLikePersonName(candidate: string): boolean {
  if (!candidate) return false
  const cleaned = candidate.replace(/[\s,.;:!?]+$/u, '').trim()
  if (!cleaned) return false
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 4) return false
  if (!words.every((w) => NAME_TOKEN.test(w))) return false
  if (GREETING_WORDS.test(cleaned)) return false
  if (/\b(?:i'?m|i am|we are|we're|looking|currently|available|offering|need|want)\b/i.test(cleaned)) return false
  // Reject role/company phrases that happen to be capitalized.
  const ROLE_COMPANY_WORDS = /\b(?:founder|ceo|cto|cfo|director|manager|lead|engineer|developer|consultant|president|partner|owner|specialist|analyst|designer|architect|officer|coordinator|head|vp|chief|officer|associate|assistant|intern|consultancy|solutions|technologies|systems|services|group|holdings|ventures|enterprises|company|corporation|inc|ltd|llc|gmbh)\b/i
  if (ROLE_COMPANY_WORDS.test(cleaned)) return false
  return true
}

/**
 * A person name is one to four name tokens. Greetings ("Hi,"), labels and
 * sentence fragments are not names; the field stays blank instead.
 */
export function sanitizePersonName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/[\s,.;:!?-]+$/u, '').replace(/^[\s,.;:!?-]+/u, '').trim()
  if (!trimmed) return null
  const words = trimmed.split(/\s+/)
  if (words.length > 4) return null
  // A multi-word greeting ("Good afternoon", "Good evening") must be rejected
  // as a whole phrase before the per-word check below (which only catches
  // single-word greetings — "Good" alone is not in GREETING_WORDS).
  if (GREETING_WORDS.test(trimmed)) return null
  if (words.length <= 2 && words.every((w) => GREETING_WORDS.test(w.replace(/[,.!]$/, '')))) return null
  if (GREETING_WORDS.test(words[0]) && words.length === 1) return null
  // A name has no sentence words in it: "I'm", "with", "looking for".
  if (/\b(?:i'?m|i am|we are|we're|with|looking|currently|available|offering)\b/i.test(trimmed)) return null
  if (!/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}(")][\p{L}'’.()"-]*){0,3}$/u.test(trimmed)) return null
  return trimmed
}

/**
 * A title is a bounded role phrase. A first-person sentence fragment ("I'm
 * a freelance React developer with") is reduced to the role it names
 * ("Freelance React Developer") or dropped.
 */
export function sanitizePersonTitle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  let text = value.trim().replace(/^(?:headline|title|current\s*role)\s*:\s*/i, '')
  if (!text) return null
  // Profile headlines commonly append positioning copy after a pipe. Bound
  // the headline before prose-length rejection, while preserving an employer
  // qualifier such as "CTO at [company]" or "Partner @ [company]".
  text = text.split('|')[0]?.trim() ?? text
  if (!text) return null
  const firstPerson = text.match(/^(?:(?:hi|hey|hello)[,!]?\s*)?(?:i\s*(?:'m|am)|we\s*(?:'re|are)|i\s+work\s+as)\s+(?:an?\s+|the\s+)?(.+)$/i)
  if (firstPerson?.[1]) {
    text = firstPerson[1]
      .split(/\b(?:with|who|that|and|based|currently|looking|available|from|at|for|,|\.|;|\s[-–—]\s)\b/i)[0]
      .trim()
    if (!text || text.split(/\s+/).length > 6) return null
    return text.split(/\s+/).map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
  }
  // Drops anything that still reads as prose: trailing connectives or a
  // sentence longer than a headline.
  if (/\b(?:with|and|or|the|a|an|to|of|for|in)$/i.test(text)) text = text.replace(/\s+\b(?:with|and|or|the|a|an|to|of|for|in)$/i, '').trim()
  // Reject greetings ("Hi,", "Hello,", "Hi there", "Good morning") — only a
  // real role is a title. Check both single-word and multi-word greetings.
  if (GREETING_WORDS.test(text.replace(/[,.!]$/, ''))) return null
  const titleWords = text.split(/\s+/).filter(Boolean).map((w) => w.replace(/[,.!]$/, '').toLowerCase())
  if (titleWords.length <= 3 && titleWords.every((w) => ALL_GREETING_WORDS.test(w))) return null
  if (text.split(/\s+/).length > 14) return null
  return text || null
}

function extractName(lines: string[]): string | null {
  for (const [index, line] of lines.slice(0, 8).entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^(job|description|skills|posted|budget|client|company)\b/i.test(trimmed)) continue
    // Skip LinkedIn UI chrome and action labels
    if (LINKEDIN_NAME_BLOCKLIST.some((word) => trimmed.toLowerCase() === word || trimmed.toLowerCase().startsWith(word + ' '))) continue
    // Skip greetings ("Hi,", "Hello,", "Good morning") — never a person's name.
    // Applies the same GREETING_WORDS set used by sanitizePersonName so the demo
    // fallback path (which does not run sanitizePersonName) is also protected.
    if (GREETING_WORDS.test(trimmed.replace(/^[,\s]+|[,.\s!]+$/g, ''))) continue
    const explicitName = trimmed.match(/^name:\s*(.+)$/i)
    if (explicitName?.[1]) return explicitName[1].trim()
    // Skip section headers, labels, and all-caps structural labels
    if (/^(===|source|identity|about|current|past|activity|education|skills|other|hiring|batch|prospect|experience|contact)\b/i.test(trimmed)) continue
    // An all-caps line is usually a structural label ("ABOUT", "SKILLS"), but
    // LinkedIn also renders SOME display names in all caps ("MD ABUL
    // MANSUR"). The very first non-empty line of a pasted profile is always
    // the display name — never a structural label — so treat an all-caps
    // first line as the literal full name (checked BEFORE the mixed-case
    // nameMatch heuristic below, which misparses an all-caps multi-token
    // name by treating a middle token as an optional nickname parenthetical
    // and dropping it — "MD ABUL MANSUR" would otherwise become "MD
    // MANSUR"). An all-caps line at any other position is still a label.
    if (/^[A-Z][A-Z\s'-]+$/.test(line)) {
      if (index === 0 && line.split(/\s+/).length <= 4) return line.trim()
      continue
    }
    // Match a plain name ("Brian Maccaba") OR a name with a parenthetical
    // nickname ("Ephraim (Effy) Gittler", 'Justus ("riptide") Hanna').
    // LinkedIn renders the nickname in quotes inside parentheses. Strip both.
    const nameMatch = line.match(/^([A-Z][A-Za-z'-]+)(?:\s+[\("']*[A-Za-z]+[\)"']*)?\s+([A-Za-z'-]+(?:\s+[A-Z][A-Za-z'.-]+){0,2})$/)
    if (nameMatch) {
      return [nameMatch[1], nameMatch[2]].join(' ').trim()
    }
  }
  return null
}

function extractTitle(lines: string[]): string | null {
  // Only the profile header block — never posts or experience — so that a
  // reposted job description or a thought-leadership line ("Software Engineer
  // → use AI in development") cannot become the prospect's title.
  const headerLines = identityBlockLines(lines)
  const titleLine = headerLines.find((line) =>
    /\b(founder|ceo|cto|coo|cfo|chief|officer|vp|head|director|manager|lead|owner|president|engineer|developer|architect|recruiter|rekruter(?:ka)?|recruiting|headhunter|sourcer|partner|consultant|managing)\b/i.test(line),
  )
  if (!titleLine) return null
  return titleLine
    .replace(/^headline:\s*/i, '')
    .replace(/^title:\s*/i, '')
    .replace(/^current\s*role:\s*/i, '')
    .trim()
}

const LABELED_LOCATION = /^(?:job\s+)?(?:location|based\s+in|located\s+in|work\s+location|office\s+location)\s*[:\-–]\s*(.+)$/i

/**
 * A location the source states: a labeled line ("Location: Austin, Texas,
 * USA", "Based in: Lahore") or a bare "City, Region" line in the profile
 * header. Never guessed from schools, company HQ, phone codes or prose.
 */
export function extractStatedLocation(rawText: string): { value: string; sourceLine: string; method: 'labeled' | 'header' } | null {
  const all = splitLines(rawText)
  for (const line of all) {
    const m = line.replace(/^[📍•·\-\s]+/u, '').match(LABELED_LOCATION)
    const value = m?.[1]?.replace(/[.;]+$/, '').trim()
    if (value && value.length <= 80) return { value, sourceLine: line, method: 'labeled' }
  }
  // Skip the name line; a header line only counts when it names a known
  // geography — "React, Node, TypeScript" or "Google, Meta, Amazon" don't.
  const header = identityBlockLines(all).slice(1, 6)
  // "City, Region[, Country]": every part is 1-4 capitalized words (small
  // connectors allowed). Prose like "We help companies in Germany, France."
  // is a sentence, not a header location.
  const PLACE_PART = /^(?:[\p{Lu}][\p{L}'’.-]*)(?:\s+(?:[\p{Lu}][\p{L}'’.-]*|of|de|la|upon|on|am|del))*$/u
  const bare = header.find((line) => {
    if (!looksLikePlace(line)) return false
    if (/[.!?]$/.test(line) || roleOnlyLine(line) || /\b(?:inc|ltd|llc|gmbh|corp|limited)\b/i.test(line)) return false
    const parts = line.split(',').map((p) => p.trim())
    return parts.every((p) => PLACE_PART.test(p) && p.split(/\s+/).length <= 4)
  })
  return bare ? { value: bare, sourceLine: bare, method: 'header' } : null
}

// Whitespace is required before the suffix, so "Collab" never reads as "Coll ab".
const LEGAL_SUFFIX = /(?:\s*\((?:pvt|private|smc-pvt|smc|opc)\.?\))?\s+(?:pte\.?\s*ltd|pty\.?\s*ltd|sdn\.?\s*bhd|co\.?,?\s*ltd|ltd|limited(?!\s+(?:time|seats?|spots?|offers?|edition|availability|places?|slots?|stock|access|budget|period|number)\b)|llc|l\.l\.c\.|inc|incorporated|gmbh|corp|corporation|plc|s\.a\.|b\.v\.)(?![\p{L}])\.?/giu
const NAME_WORD = /^(?:[\p{Lu}0-9&][\p{L}\p{N}&.'’-]*|\p{Ll}+\p{Lu}[\p{L}\p{N}.&'’-]*)$/u
const NOT_A_NAME_WORD = /^(?:The|A|An|At|In|For|With|By|Our|We|I|Join|Hiring|Company|Client|Job|About|Apply|Today|Now|Urgent|New|Free|Only|Get|Book|Call)$/i
const LABELED_COMPANY = /^(?:company(?:\s+name)?|organi[sz]ation|employer|hiring\s+(?:company|organi[sz]ation)|client)\s*[:\-–]\s*(.+)$/i
const JOB_AD_MARKERS = /\b(?:hiring|we(?:'|’)?re\s+looking|vacanc(?:y|ies)|job\s+(?:opening|description|title|type)|responsibilities|requirements|qualifications|apply\s+(?:now|here|via|at|by)|send\s+(?:your\s+)?(?:cv|resume)|salary|positions?\s+available)\b/i

/** The capitalized name ending right before a legal suffix match. */
function nameBefore(line: string, suffixStart: number, suffix: string): string | null {
  const words = line.slice(0, suffixStart).trim().split(/\s+/)
  const name: string[] = []
  for (let i = words.length - 1; i >= 0 && name.length < 6; i--) {
    const w = words[i].replace(/^[("'“]+|[,:;"'”]+$/g, '')
    if (!w || NOT_A_NAME_WORD.test(w) || !NAME_WORD.test(w)) break
    name.unshift(w)
  }
  if (name.length === 0) return null
  return `${name.join(' ')} ${suffix.trim()}`.replace(/\s+/g, ' ').trim()
}

/**
 * The hiring organization a job advertisement or recruiter post names, in
 * priority order: a labeled company field, the client a recruiter posts
 * for, a registered legal name (Ltd, (Pvt) Ltd, LLC, Inc, GmbH…), then
 * "X is hiring" / "join X". The person who published the ad is never the
 * organization. Null when the text names none — Unknown is the honest answer.
 */
export function extractHiringOrganization(rawText: string): { name: string; sourceLine: string; method: string } | null {
  const all = splitLines(rawText)
  for (const line of all) {
    const m = line.match(LABELED_COMPANY)
    const value = m?.[1]?.trim()
    if (value && value.length <= 80 && !/^(?:n\/?a|unknown|confidential)$/i.test(value)) return { name: value, sourceLine: line, method: 'labeled' }
  }
  for (const line of all) {
    const m = line.match(/\b(?:for|on behalf of)\s+(?:our|a|the)\s+client[,:]?\s+([\p{Lu}][\p{L}\p{N}&.'’ -]{1,60}?)(?=[,.(]|\s+(?:is|who|a|an|in|based)\b|$)/u)
    if (m?.[1]) return { name: m[1].trim(), sourceLine: line, method: 'client' }
  }
  // A registered name counts in the header or in a hiring sentence — not a
  // past employer listed further down a profile.
  const headerLines = new Set(all.slice(0, 5))
  const HIRING_CUE = /\b(?:hiring|looking\s+for|seeking|recruiting|join|vacanc(?:y|ies)|careers?|opening|is\s+expanding|we(?:'|’)?re\s+growing)\b/i
  for (const line of all) {
    if (!headerLines.has(line) && !HIRING_CUE.test(line)) continue
    for (const m of line.matchAll(LEGAL_SUFFIX)) {
      const name = nameBefore(line, m.index ?? 0, m[0])
      if (name) return { name, sourceLine: line, method: 'legal_name' }
    }
  }
  for (const line of all) {
    const hiring = line.match(/^(?:at\s+)?([\p{Lu}][\p{L}\p{N}&.'’-]*(?:\s+[\p{Lu}0-9&][\p{L}\p{N}&.'’-]*){0,4})\s+(?:is|are)\s+(?:hiring|looking\s+for|seeking|recruiting|expanding)\b/u)
    if (hiring?.[1] && !NOT_A_NAME_WORD.test(hiring[1].split(/\s+/)[0])) return { name: hiring[1], sourceLine: line, method: 'is_hiring' }
    const join = line.match(/\b[Jj]oin\s+(?:the\s+)?([\p{Lu}][\p{L}\p{N}&.'’-]*(?:\s+[\p{Lu}0-9&][\p{L}\p{N}&.'’-]*){0,4})(?=\s+(?:team|as|in|and)\b|[.!,]|$)/u)
    if (join?.[1] && !/^(?:Our|Us|We)$/i.test(join[1])) return { name: join[1], sourceLine: line, method: 'join' }
  }
  return null
}

/**
 * Whether a company candidate is a name, not a labeled field or a job-ad
 * section line ("Requirements: React.", "Apply now.").
 */
export function isPlausibleCompanyName(candidate: string | null | undefined): boolean {
  const c = (candidate ?? '').trim()
  if (c.length < 2 || c.length > 80) return false
  if (/^[\p{L} ]{2,30}:\s/u.test(c)) return false
  if (/^(?:requirements?|responsibilities|qualifications|benefits|salary|apply|send|location|skills|experience|about|job|role|we|our|i|you)\b/i.test(c)) return false
  if (/[.!?]$/.test(c) && !/\b(?:inc|ltd|co|corp|llc|l\.l\.c|s\.a|b\.v)\.$/i.test(c)) return false
  // "Lahore, Pakistan" is where they are, not who they work for.
  if (looksLikePlace(c) || isKnownPlaceName(c)) return false
  return true
}

/**
 * Reject obviously invalid company names — greetings, person names, sentence
 * fragments — that the extraction pipeline or AI model may incorrectly assign.
 * Returns null for invalid values, or the cleaned candidate otherwise.
 *
 * This is the canonical company guard: every company value that reaches the
 * Inbound UI MUST pass through here, regardless of which extraction path
 * produced it (signature, introduction, AI model, or demo fallback).
 */
export function sanitizeCompanyName(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string') return null
  const trimmed = candidate.trim()
  if (!trimmed) return null

  // Reject values that are ONLY punctuation/whitespace after trimming.
  if (!trimmed || /^[\s,;.!?]+$/.test(trimmed)) return null

  // Strip trailing/leading whitespace, commas, and sentence punctuation for
  // further validation, but keep the original to detect trailing-fragment
  // issues (a sentence-ending period can mark extraction bleed even when the
  // stripped form looks valid).
  const cleaned = trimmed.replace(/^[,\s]+|[,\s.!?]+$/g, '').trim()
  if (!cleaned) return null

  // If the original (pre-strip) ended with sentence-ending punctuation that
  // isn't a legal suffix, reject it because the period is a sentence boundary,
  // not part of the name.
  if (/[.!?]$/.test(trimmed) && !/\b(?:inc|ltd|co|corp|llc|l\.l\.c|s\.a|b\.v)\.$/i.test(trimmed)) return null

  // Reject greetings — both single-word ("Hello") and multi-word ("Hi there",
  // "Dear team", "Hey folks", "Greetings everyone"). A greeting phrase is one
  // where every word is a greeting/address word with no company-like content.
  const cleanedLower = cleaned.toLowerCase()
  if (GREETING_WORDS.test(cleanedLower)) return null
  const cleanedWords = cleanedLower.split(/\s+/).filter(Boolean)
  const ALL_GREETING_WORDS = /^(?:hi|hey|hello|hey there|dear|greetings|good|good morning|good afternoon|good evening|good day|hallo|hola|bonjour|salut|team|there|all|everyone|folks|people|guys|sir|madam|ma'am|morning|afternoon|evening|day)$/i
  if (cleanedWords.length <= 3 && cleanedWords.every((w) => ALL_GREETING_WORDS.test(w))) return null

  // Reject single-word companies that are role keywords, pronouns, or
  // sentence starters — these are almost never real companies.
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    const w = words[0].toLowerCase()
    if (/^(hi|hey|hello|dear|greetings|good|team|there|thanks|please|regards|cheers|sincerely|best)$/.test(w)) return null
    if (/^(ceo|cto|cfo|coo|cpo|vp|founder|director|manager|lead|engineer|developer|architect|consultant|partner|president|officer|recruiter|owner|head)$/.test(w)) return null
    if (/^(the|a|an|this|that|these|those|our|my|your|his|her|their|its)$/.test(w)) return null
    if (/^(i|you|he|she|it|we|they|me|him|her|us|them)$/.test(w)) return null
  }

  // Reject multi-word values that are clearly person names — specifically
  // 1-2 capitalized tokens with no company indicators. Longer capitalized
  // phrases (3-4 words) can be company names and are kept. A short capitalized
  // phrase is left to the primary extractors because it may be a person or a
  // company.
  // Note: we do NOT reject single capitalized words here (e.g. "CometHire" is
  // a valid one-word company). The primary extractors are responsible for not
  // producing person names as companies. This guard only catches clearly
  // invalid values (greetings, fragments, places).

  // Reject values ending with a sentence fragment — a trailing single uppercase
  // letter or a pronoun/sentence starter. These indicate the extractor bled
  // into the next sentence.
  const lastWord = words[words.length - 1]
  if (words.length >= 2 && /^[A-Z]$/.test(lastWord)) return null
  if (words.length >= 2 && /^(?:I|We|You|He|She|It|They|Me|Him|Her|Us|Them)$/i.test(lastWord)) return null

  // Reject known places.
  if (looksLikePlace(cleaned) || isKnownPlaceName(cleaned)) return null

  return cleaned
}

/**
 * Reject obviously invalid person names — greetings, company names, role
 * titles — that the extraction pipeline or AI model may incorrectly assign.
 * Returns null for invalid values, or the cleaned candidate otherwise.
 */
export function sanitizeContactName(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string') return null
  const trimmed = candidate.trim()
  if (!trimmed) return null

  // Strip leading/trailing punctuation and whitespace.
  const cleaned = trimmed.replace(/^[,\s]+|[,\s.!?]+$/g, '').trim()
  if (!cleaned) return null

  // Reject greetings.
  if (GREETING_WORDS.test(cleaned)) return null

  // Reject greetings — both single-word ("Hello") and multi-word ("Hello Team",
  // "Dear all", "Good morning"). A greeting phrase is one where every word is
  // a greeting/address word.
  const words = cleaned.split(/\s+/).filter(Boolean)
  const cleanedLower = cleaned.toLowerCase()
  if (GREETING_WORDS.test(cleanedLower)) return null
  if (words.length <= 3 && words.every((w) => ALL_GREETING_WORDS.test(w))) return null

  // Must look like a person name: 1-4 capitalized tokens.
  if (!words.every((w) => NAME_TOKEN.test(w.replace(/^[("'“]+|[,:;"'”.!?\)]+$/g, '')))) return null
  if (words.length > 4) return null

  return cleaned
}

/**
 * Prefer the fuller of two candidate names that refer to the same sender.
 * If `fuller` contains `partial` as a substring (case-insensitive), prefer
 * `fuller`. Otherwise return whichever is non-null.
 */
export function preferFullName(partial: string | null, fuller: string | null): string | null {
  if (!partial) return fuller ?? null
  if (!fuller) return partial ?? null
  const partialLower = partial.toLowerCase().trim()
  const fullerLower = fuller.toLowerCase().trim()
  // If the fuller name contains the partial, the fuller is preferred.
  if (fullerLower.includes(partialLower)) return fuller
  // If the partial contains the fuller, the partial is actually the fuller name.
  if (partialLower.includes(fullerLower)) return partial
  // Only prefer the longer name if its first token matches (same person).
  // This prevents an unrelated longer name from overriding a correct shorter one.
  const partialFirst = partialLower.split(/\s+/)[0]
  const fullerFirst = fullerLower.split(/\s+/)[0]
  if (partialFirst === fullerFirst && fuller.length > partial.length) return fuller
  // Otherwise keep the original (partial) — it came from the more reliable source.
  return partial
}

/** Whether the text reads as a job advertisement / hiring post. */
export function looksLikeJobAd(rawText: string): boolean {
  return JOB_AD_MARKERS.test(rawText)
}

function extractLocation(lines: string[], rawText: string): string | null {
  const stated = extractStatedLocation(rawText)
  if (stated?.method === 'labeled') return stated.value

  // Restrict to the header block so a prose line deep in a post
  // ("Germany, I would therefore think much broader than Berlin startups")
  // cannot be mistaken for the prospect's location.
  const headerBlock = identityBlockLines(lines).join('\n')
  const inline = headerBlock.match(/\b(?:in|at)\s+([A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+)/)
  if (inline?.[1]) return inline[1].trim()

  // A bare "City, Country" line in the header (common LinkedIn format).
  const bare = identityBlockLines(lines).find((line) =>
    /^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+$/.test(line),
  )
  return bare ?? null
}

// Multi-word employers ("at Northstar Technologies") must match whole, or the
// role line keeps its "at Employer" suffix and the company shows twice.
// Each word is capitalized (or a camel-cased brand like "bPulse"); small
// connector words are allowed between them.
const EMPLOYER_WORD = String.raw`(?:[\p{Lu}0-9&][\p{L}\p{N}.&'’-]*|\p{Ll}+\p{Lu}[\p{L}\p{N}.&'’-]*)`
const EMPLOYER_AT = new RegExp(
  // A parenthetical part of a legal name ("EGO (PVT) LTD"-style) stays in the name.
  String.raw`\s+(?:[Aa][Tt]|@)\s+(${EMPLOYER_WORD}(?:\s+(?:${EMPLOYER_WORD}|of|and|the|for|de|\([\p{L}.\-]{2,14}\)))*)\s*(?:[|·—,]|$)`,
  'u',
)
const HEADER_LOCATION = /^[\p{L}][\p{L} .'-]+,\s*[\p{L}]/u
const CONNECTION_DEGREE = /^[·•]?\s*\d+(st|nd|rd|th)\b/i
const EMPLOYMENT_LINE = /^(.{2,80}?)\s*[·|]\s*(?:Full-time|Part-time|Contract|Freelance|Self-employed)\b/i

function roleOnlyLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 80 || trimmed.split(/\s+/).length > 8) return false
  if (/[.!?]/.test(trimmed)) return false
  const rolePart = trimmed.split(/\s+(?:at|@)\s+/i)[0]?.trim() ?? trimmed
  return isRecruiterTitle(rolePart)
}

function employerFromAt(text: string | null | undefined): string | null {
  if (!text) return null
  const match = text.match(EMPLOYER_AT)
  const name = match?.[1]?.trim() ?? ''
  if (!name || roleOnlyLine(name)) return null
  return name
}

function employerLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 60 || trimmed.split(/\s+/).length > 5) return null
  if (/[.!?]/.test(trimmed) || HEADER_LOCATION.test(trimmed) || CONNECTION_DEGREE.test(trimmed)) return null
  if (roleOnlyLine(trimmed) || /^(full-time|part-time|contract|freelance)$/i.test(trimmed)) return null
  if (!/^[\p{L}0-9]/u.test(trimmed)) return null
  return trimmed
}

function employerFromExperience(lines: string[]): string | null {
  const start = lines.findIndex((line) => /^experience$/i.test(line))
  if (start < 0) return null
  for (const line of lines.slice(start + 1, start + 8)) {
    if (/^(about|education|skills|licenses?|projects|recommendations|activity)$/i.test(line)) break
    const match = line.match(EMPLOYMENT_LINE)
    const name = match?.[1]?.trim() ?? ''
    if (name && !roleOnlyLine(name)) return name
  }
  return null
}

/**
 * A role line is not an employer. "Rekruter IT" stays the title;
 * the next header line or "Company · Full-time" is the employer.
 * When no employer is present the company stays empty.
 */
export function separateRoleFromEmployer(
  rawText: string,
  title: string | null,
  company: string | null,
): { title: string | null; company: string | null } {
  const lines = splitLines(rawText)
  const header = identityBlockLines(lines)
  let resolvedTitle = title?.trim() || null
  let resolvedCompany = company && !roleOnlyLine(company) ? company.trim() : null

  const embedded = employerFromAt(resolvedTitle) ?? header.map((line) => employerFromAt(line)).find(Boolean) ?? null
  if (!resolvedCompany && embedded) resolvedCompany = embedded

  if (!resolvedCompany) {
    let sawRole = false
    for (let i = 1; i < header.length; i++) {
      const line = header[i]
      if (CONNECTION_DEGREE.test(line) || HEADER_LOCATION.test(line)) continue
      if (roleOnlyLine(line)) {
        sawRole = true
        if (!resolvedTitle || roleOnlyLine(resolvedTitle)) {
          resolvedTitle = line.split(/\s+(?:at|@)\s+/i)[0]?.trim() || line
        }
        continue
      }
      if (sawRole) {
        const next = employerLine(line)
        if (next) {
          resolvedCompany = next
          break
        }
      }
    }
  }

  if (!resolvedCompany) {
    const fromExperience = employerFromExperience(lines)
    if (fromExperience) resolvedCompany = fromExperience
  }

  if (resolvedCompany && roleOnlyLine(resolvedCompany)) resolvedCompany = null
  if (resolvedTitle && employerFromAt(resolvedTitle)) {
    resolvedTitle = resolvedTitle.split(/\s+(?:at|@)\s+/i)[0]?.trim() || resolvedTitle
  }

  return {
    title: resolvedTitle || null,
    company: resolvedCompany || null,
  }
}

// Trailing/leading words that mean the adjacent capitalized phrase is a
// role/function/department, NOT a company — guards the comma-separated
// headline pattern below against false positives like "Senior Engineer,
// Backend Team" or "CEO, Founder" (a dual-title line, not a company).
const NON_COMPANY_WORD = /\b(founder|co-?founder|president|chairman|chairwoman|chairperson|owner|partner|director|manager|lead|head|engineer|engineering|developer|team|department|division|group|unit|operations|sales|marketing|product|design|finance|hr|people|recruiting|talent)\b/i

function extractCompany(lines: string[], title: string | null, rawText: string): string | null {
  const companyLine = lines.find((line) => /^company:\s*/i.test(line))
  if (companyLine) return companyLine.replace(/^company:\s*/i, '').trim()

  // Job ads name the hiring organization; take it before profile heuristics.
  if (looksLikeJobAd(rawText)) {
    const hiringOrg = extractHiringOrganization(rawText)
    if (hiringOrg) return hiringOrg.name
  }

  // LinkedIn headline: "Role @ Company | Description" — most common format.
  // Pipe-separated: role+company is always the first segment.
  if (title) {
    const firstSegment = title.split('|')[0].trim()

    // "Founder @ Art of Cyber" — @ separator
    const atMatch = firstSegment.match(/(?:^|[\s,])@\s+([^,\s]+(?:\s+[^,\s]+)*)/)
    if (atMatch?.[1]) {
      const cleaned = atMatch[1].trim().replace(/\s+(?:and|&)\s+.*$/, '')
      if (cleaned && !NON_COMPANY_WORD.test(cleaned)) return cleaned
    }

    // "Co-Founder & CEO at XRAI" — "at" separator
    const wordAtMatch = firstSegment.match(/(?:^|[\s,])at\s+([^,\s]+(?:\s+[^,\s]+)*)/i)
    if (wordAtMatch?.[1]) {
      const cleaned = wordAtMatch[1].trim()
      if (cleaned && !NON_COMPANY_WORD.test(cleaned)) return cleaned
    }

    // "Founder of X" / "Co-founder of X" / "Owner of X"
    const founderOfMatch = firstSegment.match(/\b(?:founder|co-?founder|owner|proprietor)\s+of\s+([^|,]+)/i)
    if (founderOfMatch?.[1]) return founderOfMatch[1].trim()

    // "Role, Company" — comma-separated headline
    const commaSegments = firstSegment.split(',').map((s) => s.trim()).filter(Boolean)
    if (commaSegments.length >= 2) {
      const candidate = commaSegments[commaSegments.length - 1]
      if (candidate && /^[A-Z]/.test(candidate) && !NON_COMPANY_WORD.test(candidate)) {
        return candidate
      }
    }
  }

  // About/bio prose mentioning the company without a "Title at/of Company"
  // headline at all. Two directions, both deliberately conservative:
  // "Company [verb]" (e.g. "CometHire is building the future...") and
  // "works/working for Company" (e.g. "I work for CometHire"). A bare
  // "\bfor\s+(...)" / "\bat\s+(...)" / "\bwith\s+(...)" match was tried and
  // rejected — it false-positives on ordinary prose ("for Q3 this year",
  // "at scale", "with Passion and dedication") because the capture group
  // happily swallows multi-word phrases including generic capitalized-
  // after-period sentence starts. Every capture here is capped at a SINGLE
  // word/hyphenated-name token, not a run of words, to avoid grabbing a
  // trailing sentence fragment as a fake company name.
  const companyThenVerbMatch = rawText.match(/\b([A-Z][A-Za-z0-9&._'-]{2,60})\s+(?:is building|builds|provides|runs|helps)\b/)
  if (companyThenVerbMatch?.[1] && !NON_COMPANY_WORD.test(companyThenVerbMatch[1])) {
    return companyThenVerbMatch[1].trim()
  }

  const worksForMatch = rawText.match(/\bworks?(?:ing)?\s+for\s+([A-Z][A-Za-z0-9&.'-]{1,40})\b/)
  if (worksForMatch?.[1] && !NON_COMPANY_WORD.test(worksForMatch[1])) {
    return worksForMatch[1].trim()
  }

  return extractHiringOrganization(rawText)?.name ?? null
}

/**
 * LinkedIn paste format is deterministic:
 *   Name
 *   · Nth                          ← connection degree (1st/2nd/3rd)
 *   Role @ Company | Description   ← headline with @ separator
 *   Role at Company | Description  ← or "at" separator
 *   City, State/Country
 *
 * This parser understands that structure and extracts the company
 * from the headline line (the one with @ or "at") regardless of
 * what the AI extraction produced.
 */
function extractCompanyFromLinkedInHeadline(rawText: string): string | null {
  const lines = splitLines(rawText)

  // contains @ or " at " with a company name.
  for (const line of lines) {
    const trimmed = line.trim()

    // Skip connection degree markers ("· 2nd", "· 1st")
    if (/^·\s*\d+(st|nd|rd|th)$/i.test(trimmed)) continue

    // Skip the name line (First Last) — headlines have @ or " at "
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(trimmed)) continue

    // Skip location lines
    if (/^[\w\s]+,\s*(Israel|United States|UK|India|Canada|Australia|Germany|France|Singapore|UAE)/i.test(trimmed)) continue

    // "Founder @ Art of Cyber | Description" — extract from first pipe segment
    const firstSegment = trimmed.split('|')[0].trim()

    // @ separator: "Founder @ Art of Cyber"
    const atMatch = firstSegment.match(/@\s+([A-Za-z0-9][A-Za-z0-9&.' -]{2,60}?)(?:\s*$|\s+(?:and|&|\|))/i)
    if (atMatch?.[1]) {
      const cleaned = atMatch[1].trim()
      // Exclude role/department words
      if (!/^(founder|ceo|cto|cfo|chief|officer|vp|head|director|manager|lead|owner|president|partner|consultant|senior|junior|principal|staff|associate|coordinator|specialist|analyst|designer|developer|engineer|architect|recruiter|recruiting|operations|sales|marketing|product|finance|hr|people|talent|team|department|division|group|unit)$/i.test(cleaned)) {
        return cleaned
      }
    }

    // "at" separator: "Co-Founder & CEO at XRAI"
    const atWordMatch = firstSegment.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9&.' -]{2,60}?)$/i)
    if (atWordMatch?.[1]) {
      const cleaned = atWordMatch[1].trim()
      if (!/^(founder|ceo|cto|cfo|chief|officer|vp|head|director|manager|lead|owner|president|partner|consultant|senior|junior|principal|staff|associate|coordinator|specialist|analyst|designer|developer|engineer|architect|recruiter|recruiting|operations|sales|marketing|product|finance|hr|people|talent|team|department|division|group|unit)$/i.test(cleaned)) {
        return cleaned
      }
    }
  }

  return null
}

function extractClientName(lines: string[]): string | null {
  const clientLine = lines.find((line) => /^client:\s*/i.test(line))
  if (!clientLine) return null
  const value = clientLine.replace(/^client:\s*/i, '').trim()
  return value.length > 0 ? value : null
}

/**
 * Detect opportunity organization — may differ from prospect's current company.
 * E.g. "Tayo360 needing a full stack developer" → Tayo360 is the opportunity org.
 */
function extractOpportunityOrganization(rawText: string, prospectCompany: string | null): {
  name: string | null
  relationship: 'OPPORTUNITY_ORGANIZATION' | 'CLIENT' | 'THIRD_PARTY' | null
} {
  const lines = splitLines(rawText)
  // Explicit "opportunity:" or "for [Company]" patterns
  const oppLine = lines.find((l) => /^opportunity\s*:/i.test(l))
  if (oppLine) {
    const value = oppLine.replace(/^opportunity\s*:\s*/i, '').trim()
    if (value) return { name: value, relationship: 'OPPORTUNITY_ORGANIZATION' }
  }
  // "X is hiring/looking for/needs a..." where X differs from prospect company
  const hiringFor = rawText.match(/\b([A-Z][A-Za-z0-9\s&]+?)\s+(?:is\s+)?(?:hiring|looking\s+for|needs?\s+a?|seeking)\b/i)
  if (hiringFor?.[1]) {
    const orgName = hiringFor[1].trim()
    if (orgName.length > 2 && orgName.length < 60 && (!prospectCompany || !orgName.toLowerCase().includes(prospectCompany.toLowerCase()))) {
      return { name: orgName, relationship: 'OPPORTUNITY_ORGANIZATION' }
    }
  }
  return { name: null, relationship: null }
}

function extractCompanySize(rawText: string): { size: string | null; evidence: string | null } {
  const lineMatch = rawText.match(/\b(team of\s+\d+\+?\s+(?:engineers?|developers?|people)|\d+\+?\s+(?:engineers?|developers?|team members?))\b/i)
  if (!lineMatch?.[1]) {
    return { size: null, evidence: null }
  }
  return {
    size: lineMatch[1],
    evidence: lineMatch[0],
  }
}

function extractSkills(lines: string[], rawText: string): string[] {
  const skills = new Set<string>()
  const skillsLine = lines.find((line) => /^skills:\s*/i.test(line))
  if (skillsLine) {
    const list = skillsLine
      .replace(/^skills:\s*/i, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const skill of list) skills.add(skill)
  }

  const lower = rawText.toLowerCase()
  for (const keyword of TECH_KEYWORDS) {
    if (techKeywordMatches(rawText, keyword)) skills.add(keyword)
  }

  const cloneMatch = lower.match(/clone of\s+([a-z0-9]+)/)
  if (cloneMatch?.[1]) {
    skills.add(`${cloneMatch[1]} clone`)
  }

  return [...skills].slice(0, 12)
}

/**
 * Check if a match is negated within a window before the match index.
 * Returns true if the signal is negated/closed (should not be treated as active).
 */
const NEGATION_PATTERNS = [
  /\bno\s+longer\b/,
  /\bnot\s+(?:currently\s+)?(?:hiring|looking|seeking|open|accepting|interested)\b/,
  /\bstopped\s+(?:hiring|looking|accepting)\b/,
  /\bwe\s+(?:are|'re)\s+not\b/,
  /\bwe\s+(?:have|'ve)?\s*(?:already\s+)?(?:filled|hired|found)\b/,
  /\brole\s+is\s+(?:filled|closed|taken)\b/,
  /\bposition\s+(?:filled|closed)\b/,
  /\bno\s+(?:longer|open)\s+(?:roles?|positions?|openings?)\b/,
  /\b(?:hiring|recruiting)\s+(?:freeze|pause|halt)\b/,
  /\blocked\s+(?:to|for)\s+(?:outsourcing|contractors|agencies|freelancers)\b/,
  /\bnot\s+open\s+to\s+(?:outsourcing|contractors|agencies|freelancers)\b/,
  /\b(?:don't|do\s+not)\s+(?:work\s+with|accept|use)\s+(?:agencies|outsourcing|contractors)\b/,
]

function isNegatedContext(text: string, matchIndex: number, window = 60): boolean {
  const before = text.slice(Math.max(0, matchIndex - window), matchIndex).toLowerCase()
  return NEGATION_PATTERNS.some((p) => p.test(before))
}

/** Same negation check, but scanning the entire document — for signals (like
 * a structural job-posting match) that have no single match index to anchor
 * a windowed lookbehind around. */
function isNegatedContextAnywhere(text: string): boolean {
  const lower = text.toLowerCase()
  return NEGATION_PATTERNS.some((p) => p.test(lower))
}

/**
 * Detect whether a pain/problem keyword appears in a SOLVER / achievement /
 * service-offering context rather than a "we have this problem" context.
 *
 * Solver context examples (should NOT produce technical_problem):
 *   "earned $600K in bug bounty rewards"        → achievement
 *   "finds critical vulnerabilities in protocols" → service offering
 *   "we spent years building the scaffolding"    → own product development
 *   "we've helped protocols like Ethereum"       → customer success
 *   "I spent years finding critical vulnerabilities" → personal expertise
 *
 * Problem context examples (SHOULD produce technical_problem):
 *   "struggling with our payment integration"
 *   "urgent: our database is drowning"
 *   "we need help with a critical vulnerability in our protocol"
 */
function isSolverContext(text: string): boolean {
  const lower = text.toLowerCase()

  // Achievement / bounty / reward language near pain keywords.
  if (/\b(?:earned|won|received|payout|bounty|reward)\b/i.test(lower) && /\b(?:bug|vulnerabilit|exploit|hack|breach|flaw)\b/i.test(lower)) {
    return true
  }
  // "Finding / detecting / discovering X for [customers|clients|protocols]"
  // → the prospect solves this for others.
  if (/\b(?:find(?:s|ing)?|detect(?:s|ing)?|discover(?:s|ing)?|hunt(?:s|ing)?)\b.{0,60}\b(?:vulnerabilit|bug|exploit|flaw|breach|weakness)\b/i.test(lower)) {
    return true
  }
  // "Helped [companies/protocols] (with|solve|fix)" → service delivered.
  if (/\b(?:helped|helping|assisted)\b.{0,40}\b(?:protocols?|companies?|clients?|projects?|teams?)\b/i.test(lower) && /\b(?:vulnerabilit|security|bug|exploit|audit)\b/i.test(lower)) {
    return true
  }
  // Explicit offering/seller CTA: "if you're wondering about X, let's connect"
  // or "we provide / we offer / our [product|service]".
  if (/\b(?:we (?:provide|offer|deliver|specialize)|our (?:product|service|platform|solution|company)|if you're wondering|let's connect|we (?:help|assist) (?:protocols|companies|clients))\b/i.test(lower)) {
    return true
  }
  // Past-tense expertise: "I spent years finding / I previously found"
  if (/\b(?:i (?:spent|previously|used to|was))\b.{0,50}\b(?:find(?:ing)?|hunt(?:ing)?|search(?:ing)?)\b.{0,40}\b(?:vulnerabilit|bug|exploit|flaw)\b/i.test(lower)) {
    return true
  }
  // Building own product: "building [company]" / "we're building" near pain words.
  if (/we'?re\s+building\b.{0,80}\b(?:vulnerabilit|security|detection|scanning)\b/i.test(lower)) {
    return true
  }
  return false
}

export function extractOpportunitySignals(rawText: string): { signals: OpportunitySignal[]; urgency: 'immediate' | 'near_term' | 'future' | 'unknown' } {
  const signals: OpportunitySignal[] = []

  const budgetMatch = rawText.match(/\b(?:budget:\s*)?[\$€£]\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{2,5})(?:\.\d{1,2})?/i)
  const budgetValue = budgetMatch?.[1] ? Number(budgetMatch[1].replace(/,/g, '')) : null
  const proposalMatch = rawText.match(/\bproposals?:\s*(\d{2,3})\b/i)
  const proposalCount = proposalMatch?.[1] ? Number(proposalMatch[1]) : null
  const oversizedScope = /\b(uber|clone|exactly like|everything|full app|entire platform|all features|drivers,\s*riders,\s*payments,\s*maps)\b/i.test(rawText)
  const unrealisticTimeline = /\bin\s*(?:[1-9]\s*days?|[1-2]\s*weeks?)\b/i.test(rawText)
  const nonCredibleFreelanceBrief =
    budgetValue !== null
    && budgetValue <= 300
    && (oversizedScope || unrealisticTimeline || (proposalCount !== null && proposalCount >= 20))

  const hasTechContext = DEV_ROLE_HINT.test(rawText) || TECH_KEYWORDS.some((k) => techKeywordMatches(rawText, k))
  const softwareAsk = SOFTWARE_ASK_PATTERNS.some((p) => p.test(rawText)) && hasTechContext
  const hiringMatch = rawText.match(/\bhiring\b.{0,50}\b(developer|engineer|contractor|full[- ]?stack|backend|frontend|software)\b/i)
    || rawText.match(/\b(developer|engineer|contractor|full[- ]?stack|backend|frontend|software)\b.{0,50}\bhiring\b/i)
  // Job postings often never use the literal word "hiring" — a title naming a
  // tech role, structured with posting sections (What you'll do/Responsibilities,
  // Requirements) and an application route, IS itself a hiring signal.
  // e.g. "Senior Fullstack Engineer (Remote, Worldwide)" / "Founding Engineer" ...
  const jobPostingTitle = /^[A-Z][\w\s/-]{0,60}(developer|engineer|architect|devops)\b.{0,40}$/im.test(rawText)
  const jobPostingStructure =
    /\b(what you'?ll do|responsibilities|requirements)\s*:?/i.test(rawText)
    && /\b(apply|compensation|salary)\b/i.test(rawText)
  const structuralJobPosting = jobPostingTitle && jobPostingStructure && hasTechContext
  const explicitHiring = /\b(open roles?)\b/i.test(rawText) || hiringMatch || structuralJobPosting

  if (softwareAsk && !nonCredibleFreelanceBrief) signals.push('explicit_ask')
  if (/(job:|upwork|budget:|proposals?:)/i.test(rawText) && hasTechContext && !nonCredibleFreelanceBrief) signals.push('freelance_project_need')
  // technical_problem: only flag when the prospect APPEARS TO HAVE the problem,
  // not when they SOLVE it for others. "Earned $600K in bug bounty rewards"
  // (achievement/solver context) or "We find critical vulnerabilities in
  // protocols" (service offering) must NOT produce a buying signal. Check
  const hasPain = PAIN_PATTERNS.some((p) => p.test(rawText))
  if (hasPain && hasTechContext && !isSolverContext(rawText)) {
    signals.push('technical_problem')
  }
  // A structural job posting has no single "hiring" match index to check
  // context around, so scan the whole document for a filled/no-longer-hiring
  // disclaimer instead of only the 60 chars before one match.
  const negated = hiringMatch
    ? isNegatedContext(rawText, rawText.indexOf(hiringMatch[0]))
    : structuralJobPosting
      ? isNegatedContextAnywhere(rawText)
      : false
  if (explicitHiring && !negated) {
    const relevance = classifyHiringRelevance(rawText)
    if (relevance === 'software') signals.push('hiring')
  }
  if (/\b(raised\s+[\$€£\d]|seed round|series [abc]\b|funding round)\b/i.test(rawText)) signals.push('funding')
  if (/\b(migration|migrate|migrated|move from|move to)\b/i.test(rawText)) signals.push('migration')
  if (/\b(rebuild|overhaul|rewrite|re-?platform|production[- ]?ready)\b/i.test(rawText)) signals.push('rebuild')
  if (/\b(growing|scaling|scale|expanding|growth)\b/i.test(rawText)) signals.push('growth_signal')
  if (/\b(launch|launched|launching|rollout|release|released)\b/i.test(rawText)) signals.push('launch')
  if (/\b(drowning|can'?t keep up|slowing down|backlog|understaffed)\b/i.test(rawText)) signals.push('hiring_pressure')

  if (signals.length === 0 && !hasTechContext) {
    return { signals: [], urgency: 'unknown' }
  }

  const dedup = [...new Set(signals)]

  let urgency: 'immediate' | 'near_term' | 'future' | 'unknown' = 'unknown'
  if (/\b(urgent|asap|immediately|right now|this week)\b/i.test(rawText)) urgency = 'immediate'
  else if (/\b(soon|next month|q[1-4]|near term|in \d+ (days|weeks))\b/i.test(rawText)) urgency = 'near_term'
  else if (/\b(future|later this year|next quarter|long term)\b/i.test(rawText)) urgency = 'future'

  return { signals: dedup, urgency }
}

function selectPrimarySignal(signals: OpportunitySignal[]): OpportunitySignal | null {
  const priority: OpportunitySignal[] = [
    'explicit_ask',
    'freelance_project_need',
    'technical_problem',
    'hiring',
    'hiring_pressure',
    'migration',
    'rebuild',
    'funding',
    'growth_signal',
    'launch',
  ]
  for (const p of priority) {
    if (signals.includes(p)) return p
  }
  return signals[0] ?? null
}

function extractSignalLine(lines: string[]): string | null {
  for (const line of lines) {
    if (SOFTWARE_ASK_PATTERNS.some((p) => p.test(line)) || (PAIN_PATTERNS.some((p) => p.test(line)) && DEV_ROLE_HINT.test(line)) || /\b(open roles?|hiring (?:a |an )?(?:developer|engineer)|seed round|series [abc])\b/i.test(line)) {
      return line.slice(0, 220)
    }
  }
  return null
}

function extractJobFromText(lines: string[], rawText: string, skills: string[], opportunitySignals: OpportunitySignal[] = []): PassAOutput['job'] {
  const hasJobMarkers = /(job:|description:|responsibilities:|requirements:|skills:|budget:|proposals?:|apply)/i.test(rawText)
  // A bare workplace-type word ("remote", "hybrid", "on-site") appearing
  // ANYWHERE in the raw text is not evidence of a job/engagement opportunity
  // — it is frequently the prospect's OWN employment-history workplace_type
  // (e.g. an Experience entry like "SettWiz · Israel · Hybrid" for their
  // current role as Founder/CEO). That is a fact about the prospect's job,
  // not a location-constrained opportunity for BPulse to deliver into, and
  // signal when they appear alongside an actual hiring/engagement ask —
  const hasExplicitEngagementAsk = /\b(hiring|we're looking for|we are looking for|open role|open position|job opening|now hiring|looking to hire|seeking a (?:developer|engineer|contractor|freelancer)|freelance project|contract role|apply now|apply by|send your resume|send your cv)\b/i.test(rawText)
  // shape used elsewhere in this file (SOFTWARE_ASK_PATTERNS) — e.g. "Looking
  // engagement ask phrased this way isn't dropped by the stricter gate above.
  const hasSoftwareAsk = SOFTWARE_ASK_PATTERNS.some((p) => p.test(rawText))
    && (DEV_ROLE_HINT.test(rawText) || TECH_KEYWORDS.some((k) => techKeywordMatches(rawText, k)))
  // signals: an explicit_ask / freelance_project_need / hiring / technical_problem
  // signal already means real engagement language was found in the prospect's
  // OWN attributable text, even when its exact phrasing doesn't match the
  // narrower regexes above (e.g. "We need a team to help us build..."). This
  // keeps the gate general — driven by the same signal detection already
  // trusted elsewhere — rather than growing an ever-longer bespoke regex list.
  const hasRelevantOpportunitySignal = opportunitySignals.some((s) =>
    ['explicit_ask', 'freelance_project_need', 'hiring', 'technical_problem'].includes(s),
  )
  if (!hasJobMarkers && !hasExplicitEngagementAsk && !hasSoftwareAsk && !hasRelevantOpportunitySignal) {
    return null
  }

  const titleLine = lines.find((line) => /^job:\s*/i.test(line))
  const title = titleLine ? titleLine.replace(/^job:\s*/i, '').trim() : null

  let workplaceType: 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN' = 'UNKNOWN'
  if (/\b(on-?site|onsite|in[- ]?person|no remote)\b/i.test(rawText)) workplaceType = 'ONSITE'
  else if (/\b(hybrid|office requirement|days\/week in|in our .* office)\b/i.test(rawText)) workplaceType = 'HYBRID'
  else if (/\b(remote|work from anywhere|worldwide|distributed|async)\b/i.test(rawText)) workplaceType = 'REMOTE'

  let allowedGeography: string | null = null
  if (/\b(us only|remote within us|united states only|must be based in the us)\b/i.test(rawText)) allowedGeography = 'US'
  else if (/\b(eu\/?eea|eu only|europe only|eea only)\b/i.test(rawText)) allowedGeography = 'EU/EEA'
  else if (/\b(uk only|united kingdom only)\b/i.test(rawText)) allowedGeography = 'UK'
  else if (/\b(london office|in london)\b/i.test(rawText)) allowedGeography = 'London, UK'
  else if (/\b(manhattan|new york office|on-site in new york)\b/i.test(rawText)) allowedGeography = 'Manhattan, New York, USA'

  let timezone: string | null = null
  if (/\b(pst|pdt|pacific)\b/i.test(rawText)) timezone = 'PST/PDT'
  else if (/\b(est|edt|eastern)\b/i.test(rawText)) timezone = 'EST/EDT'
  else if (/\b(cet|cest|central european)\b/i.test(rawText)) timezone = 'CET/CEST'
  else if (/\b(gmt|utc)\b/i.test(rawText)) timezone = 'GMT/UTC'

  const compensationLine = lines.find((line) => /^budget:\s*/i.test(line) || /\b\$\d+/i.test(line))
  const compensation = compensationLine ? compensationLine.slice(0, 120) : null

  const postedLine = lines.find((line) => /^posted:\s*/i.test(line))
  const postedDate = postedLine ? postedLine.replace(/^posted:\s*/i, '').trim() : null

  const employmentType: 'full_time' | 'part_time' | 'contract' | 'freelance' | 'unknown' =
    /\b(freelance|upwork|proposal)\b/i.test(rawText)
      ? 'freelance'
      : /\b(contract)\b/i.test(rawText)
        ? 'contract'
        : /\b(full[- ]?time)\b/i.test(rawText)
          ? 'full_time'
          : /\b(part[- ]?time)\b/i.test(rawText)
            ? 'part_time'
            : 'unknown'

  return {
    title,
    employmentType,
    workplaceType,
    allowedGeography,
    timezone,
    compensation,
    skills,
    seniority: /\b(senior|staff|lead|principal)\b/i.test(rawText) ? 'senior' : null,
    source: /upwork\.com/i.test(rawText) || /\bupwork\b/i.test(rawText) ? 'upwork' : null,
    postedDate,
  }
}

function extractContentSignals(lines: string[], rawText: string): PassAOutput['content'] {
  // Tech keywords are extracted from the full text (they describe the space,
  // not a buying intent) — but de-duplicated and capped.
  const technicalSignals = TECH_KEYWORDS.filter((k) => techKeywordMatches(rawText, k)).slice(0, 10)

  // Hiring / problem / initiative / launch signals MUST come from prospect-
  // attributable lines only — market commentary lines ("79,000 unfilled IT
  // positions", "companies need Software Engineers") describe the market, not
  // the prospect's own buying intent. Filter before matching.
  const attributableLines = lines.filter(
    (line) => {
      const subject = classifySentence(line)
      return subject === 'PROSPECT' || subject === 'UNKNOWN'
    },
  )

  // Bare "need" is far too broad on its own — it matches routine marketing
  // copy ("tailored to address the current demand and need of the particular
  // region") describing what a company's PRODUCT satisfies for ITS customers,
  // not a hiring ask. Require an actual hiring/acquisition verb phrase
  // ("need a developer", "hiring a contractor") rather than the bare noun.
  const HIRING_INTENT_PHRASE = /\b(?:looking for|open roles?|hiring)\b|\bneed(?:s|ed)?\s+(?:a|an|to\s+hire|someone)\b.{0,30}?\b(?:developer|engineer|contractor|freelancer|team)\b|\bcontractor\b/i
  const hiringSignals = attributableLines
    .filter((line) =>
      HIRING_INTENT_PHRASE.test(line) &&
      (DEV_ROLE_HINT.test(line) || TECH_KEYWORDS.some((k) => techKeywordMatches(line, k))),
    )
    .slice(0, 5)

  // Explicit problems must be scoped to the prospect's OWN current situation.
  // A pain keyword (e.g. "bug") near a dev keyword (e.g. "platform") in a
  // third-party panel description ("HackenProof | Web3 bug bounty platform")
  // or an achievement ("solved vulnerabilities for protocols") is NOT a current
  // buying need. Require: (1) first-person/current-ownership framing, (2) NOT
  // negated to a solved/achievement/past state, (3) NOT a third-party panel or
  // event description.
  const SOLVED_NEGATION = /\b(solved|resolved|fixed|built|created|designed|implemented|earned|helped|reduced|prevented|found|detected|discovered|shipped|delivered|launched)\b/i
  const THIRD_PARTY_PANEL = /\b(panel(?:ists?)?|conference|summit|event|debate|discussion|conversation with|spoke at|keynote|session|meetup)\b/i
  const FIRST_PERSON_PROBLEM = /\b(i|we|my|our|i'm|i've|we're|we've)\b.{0,60}(?:struggling|stuck|having|dealing|issue|problem|challenge|need|want|looking|seeking)|(?:struggling|stuck|having|dealing|issue|problem|challenge)\b.{0,40}(?:i|we|my|our)\b/i
  const explicitProblems = attributableLines
    .filter((line) => {
      if (!PAIN_PATTERNS.some((p) => p.test(line)) || !DEV_ROLE_HINT.test(line)) return false
      const lower = line.toLowerCase()
      if (THIRD_PARTY_PANEL.test(lower)) return false
      // "earned bounties" describes what the prospect SOLVES, not what they HAVE.
      if (SOLVED_NEGATION.test(lower)) return false
      // Require first-person current-ownership OR clear present-tense problem
      // framing for it to count as a buying signal.
      return FIRST_PERSON_PROBLEM.test(lower) || /\b(currently|now|right now|today|still)\b/i.test(lower)
    })
    .slice(0, 5)

  const recentPosts = lines
    .filter((line) => !isLinkedInChromeText(line) && (line.startsWith('"') || line.startsWith("'") || /^“.+"$/.test(line)))
    .slice(0, 3)
    .map((line) => ({
      paraphrase: line.slice(0, 180),
      verbatimQuote: line.slice(0, 180),
      topics: technicalSignals.slice(0, 3),
      signals: extractOpportunitySignals(line).signals,
    }))

  const topics = [...new Set(technicalSignals.map((s) => s.replace(/[^a-z0-9+.#-]/gi, '')))].filter(Boolean)

  return {
    recentPosts,
    topics,
    explicitProblems,
    initiatives: attributableLines.filter((line) => /\b(building|launching|migrating|rebuilding|scaling)\b/i.test(line)).slice(0, 3),
    launches: attributableLines.filter((line) => /\b(launch|released|rollout)\b/i.test(line)).slice(0, 3),
    technicalSignals,
    hiringSignals,
  }
}

/**
 * Returns the subset of lines that are attributable to the prospect — filters
 * out market-commentary lines (macro statistics about Germany/industry) and
 * audience lines ("professionals looking for jobs", "anyone looking for a
 * role") that describe the prospect's audience rather than the prospect's
 * own buying intent. Only PROSPECT- and UNKNOWN-attribution lines survive.
 *
 * This is the core subject-attribution fix: market statistics and audience
 * language must not produce buyer signals for the prospect.
 */
export function prospectAttributableText(rawText: string, prospectName?: string | null): string {
  // Person>'s profile" block is authored by someone else entirely, so
  // line-level MARKET/AUDIENCE classification must never even see it as
  // "the prospect's own text" in the first place. See
  // stripThirdPartyRepostBlocks for the full rationale.
  const ownText = prospectName ? stripThirdPartyRepostBlocks(rawText, prospectName) : rawText
  return splitLines(ownText)
    .filter((line) => {
      const subject = classifySentence(line)
      return subject === 'PROSPECT' || subject === 'UNKNOWN'
    })
    .join('\n')
}

function demoPassA(rawText: string): PassAOutput {
  const lines = splitLines(rawText)
  const name = extractName(lines) ?? extractIntroduction(rawText)?.name ?? null
  const title = extractTitle(lines)
  const location = extractLocation(lines, rawText)
  const company = extractCompany(lines, title, rawText)
  const identity = separateRoleFromEmployer(rawText, title, company)
  // If the line-based scan found no company but an introduction prose line did,
  // prefer the introduction's company.
  const intro = extractIntroduction(rawText)
  const companyFinal = company ?? intro?.company ?? null
  const sizeInfo = extractCompanySize(rawText)
  const clientName = extractClientName(lines)
  const linkedinUrl = extractUrls(rawText).find((u) => u.toLowerCase().includes('linkedin.com/in/')) ?? null
  const otherUrls = extractUrls(rawText).filter((u) => u !== linkedinUrl)
  const skills = extractSkills(lines, rawText)

  // Subject attribution: classify signals only from prospect-attributable text,
  // else's post. This prevents a recruiter's labor-market posts (or a
  // third party's repost content) from becoming buyer evidence.
  const attributableText = prospectAttributableText(rawText, name ?? clientName)
  const businessModel = classifyBusinessModel(stripThirdPartyRepostBlocks(rawText, name ?? clientName))
  const { signals, urgency } = extractOpportunitySignals(attributableText)
  const primarySignal = selectPrimarySignal(signals)
  const signalLine = extractSignalLine(lines)
  const content = extractContentSignals(lines, attributableText)
  const job = extractJobFromText(lines, rawText, skills, signals)
  const opportunityOrg = extractOpportunityOrganization(rawText, identity.company)

  return {
    person: {
      fullName: name ?? clientName ?? null,
      firstName: (name ?? clientName)?.split(/\s+/)[0] ?? null,
      title: identity.title ?? intro?.role ?? null,
      seniority: null,
      location,
      linkedinUrl,
      otherUrls,
    },
    company: {
      name: identity.company ?? companyFinal,
      domain: null,
      linkedinUrl: null,
      industry: null,
      size: sizeInfo.size,
      sizeEvidence: sizeInfo.evidence,
      product: null,
      stage: null,
      stageEvidence: null,
    },
    opportunity: {
      signals,
      primarySignal,
      description: signalLine,
      urgency,
      organizationName: opportunityOrg.name,
      organizationRelationship: opportunityOrg.relationship || undefined,
    },
    job,
    content,
  }
}

function classifyHiringRelevance(rawText: string): 'software' | 'product_design' | 'non_technical' | 'unknown' {
  const segments = rawText.split(/(?:\n{2,}|--- POST \d+ ---|Posts|Activity)/gi)
  // found anywhere in the document, rather than returning on the first
  // matching segment in document order. A profile header/About section can
  // legitimately mention "founder" (hiring-context) alongside an unrelated
  // generic word like "operations" (from describing the prospect's own
  // product, e.g. "...documentation, and operations for service
  // businesses") with zero software-role words — short-circuiting on that
  // segment would misclassify the WHOLE profile as non-technical even
  // though a later segment (the actual hiring post) clearly names
  // developer/engineer roles. Software > product design > non-technical is
  // the priority order because a real software-role mention is unambiguous
  // and should not be shadowed by a coincidental generic word elsewhere.
  let sawProductDesign = false
  let sawNonTech = false
  for (const seg of segments) {
    const isHiringContext = /\b(hiring|looking for|open roles?|we need|join our team|developer|engineer|senior|lead|manager|director|head of|vp|cto|co-founder|founder)\b/i.test(seg)
    if (!isHiringContext) continue
    const softwareRoles = (seg.match(/\b(developer|engineer|software|frontend|backend|full[- ]?stack|devops|sre|ml engineer|data engineer|security engineer|qa engineer|automation engineer|technical architect|vp of engineering|director of engineering|head of engineering)\b/gi) || []).length
    const productRoles = (seg.match(/\b(product manager|product designer|ux designer|ui designer|program manager|project manager|product owner|scrum master|agile coach)\b/gi) || []).length
    const genericNonTech = (seg.match(/\b(marketing|sales|finance|hr|people ops|recruiter|talent|operations|admin|legal|compliance|support|customer success)\b/gi) || []).length
    if (softwareRoles > 0) return 'software'
    if (productRoles > 0) sawProductDesign = true
    else if (genericNonTech > 0) sawNonTech = true
  }
  if (sawProductDesign) return 'product_design'
  if (sawNonTech) return 'non_technical'
  return 'unknown'
}

function demoPassC(passA: PassAOutput): Pick<NormalizedIntelligence, 'probableNeed' | 'opportunityTrigger' | 'timingSignal' | 'risks' | 'unknowns'> {
  const signals = passA.opportunity.signals
  const nonBuyer = isNonBuyerProfessional({
    title: passA.person.title,
    company: passA.company.name,
    industry: passA.company.industry,
  })
  let probableNeed: string | null = null
  if (!nonBuyer && (signals.includes('freelance_project_need') || signals.includes('explicit_ask'))) {
    probableNeed = 'External software delivery support for an active project need.'
  } else if (!nonBuyer && signals.includes('technical_problem')) {
    probableNeed = 'Specialized engineering help to resolve a technical issue.'
  } else if (!nonBuyer && (signals.includes('hiring') || signals.includes('hiring_pressure'))) {
    const relevance = classifyHiringRelevance(passA.opportunity.description ?? '')
    if (relevance === 'software') {
      probableNeed = 'Additional delivery capacity to keep up with shipping demands.'
    }
  }

  const opportunityTrigger =
    passA.opportunity.description
    ?? passA.content.hiringSignals[0]
    ?? passA.content.explicitProblems[0]
    ?? null

  const risks: string[] = []
  const unknowns: string[] = []
  if (!passA.person.fullName) unknowns.push('Contact name missing in source text')
  if (!passA.company.name && !passA.person.fullName) unknowns.push('No clear company or client identified')
  if (signals.length === 0) risks.push('No explicit buying signal detected')

  return {
    probableNeed,
    opportunityTrigger,
    timingSignal: passA.opportunity.urgency === 'immediate' ? 'Immediate signal from source text' : null,
    risks,
    unknowns,
  }
}


export async function runIntelligencePipeline(
  rawText: string,
  opts: ExtractionPipelineOptions = {},
): Promise<ExtractionPipelineResult> {
  const callLog: ExtractionPipelineResult['callLog'] = []

  const sourceUrls = extractUrls(rawText)

  const rawSource: RawSourceData = {
    rawInput: rawText,
    sourceType: detectSourceType(rawText),
    sourceUrl: opts.knownSourceUrl ?? sourceUrls[0] ?? null,
    profileUrl: opts.knownProfileUrl ?? sourceUrls.find((u) => u.includes('linkedin.com/in/')) ?? null,
    companyUrl: opts.knownCompanyUrl ?? sourceUrls.find((u) => u.includes('linkedin.com/company/')) ?? null,
    jobUrl: opts.knownJobUrl ?? sourceUrls.find((u) => u.includes('linkedin.com/jobs/') || u.includes('greenhouse.io') || u.includes('lever.co')) ?? null,
    postUrls: sourceUrls.filter((u) => u.includes('linkedin.com/posts/') || u.includes('linkedin.com/feed/update')),
    rawPosts: [],
    rawJobDescription: null,
    rawProfileText: null,
    rawCompanyText: null,
    capturedAt: new Date().toISOString(),
  }

  // Heuristic prospect name, computed early (before Pass A) purely so raw-text
  // scans below can exclude third-party repost blocks — a repost's "View
  // <Other Person>'s profile" block is authored by someone else, and must
  // location, opportunity signals, etc). See stripThirdPartyRepostBlocks.
  const heuristicName = extractName(splitLines(rawText))
  const ownRawText = stripThirdPartyRepostBlocks(rawText, heuristicName)

  // Assess remote eligibility (deterministic, no AI needed)
  // Detect if this is a job seeker profile to avoid misinterpreting
  // "looking for roles in UK" as "employer restricts to UK". Attribution-aware:
  // only first-person / self-reference markers count — audience language like
  // "anyone looking for a job" must not mark the prospect as a job seeker.
  const isJobSeekerContext = isJobSeekerAttribution(ownRawText)
  const remoteEligibility = assessRemoteEligibility({
    rawText: ownRawText,
    requiredWorkerLocation: null, // Will be refined from extraction
    sourceContext: isJobSeekerContext ? 'job_seeker_profile' : 'unknown',
  })

  // Pass A: Extract
  const passA = await runPassA(rawText, sourceUrls, callLog, opts.onStatus, opts.strictLiveMode, opts.leadId, opts.deterministicOnly)

  // Pass B: Normalize
  opts.onStatus?.('Normalizing extraction')
  const { intelligence: partialIntelligence, evidenceLedger, normalizedSourceUrls } = normalizePassA(passA, sourceUrls, remoteEligibility, rawText)

  // Repost scoping refined with the FINAL extracted name (Pass A may know
  // better than the pre-Pass-A heuristic, e.g. via "Name:" fields or AI
  // extraction) for everything downstream of Pass A.
  const ownRawTextFinal = stripThirdPartyRepostBlocks(rawText, passA.person.fullName ?? heuristicName)

  // Refine remote eligibility with extracted job data.
  // EVIDENCE OWNERSHIP: For job seeker profiles, AI-extracted workplaceType/allowedGeography
  // are the PERSON'S preferences, not employer requirements. Pass sourceContext so
  // the eligibility engine doesn't invert preferences into restrictions.
  const refinedEligibility = passA.job
    ? assessRemoteEligibility({
        rawText: ownRawTextFinal,
        statedWorkplaceType: isJobSeekerContext ? 'UNKNOWN' : (passA.job.workplaceType as RemoteEligibilityInput['statedWorkplaceType']),
        requiredWorkerLocation: isJobSeekerContext ? null : passA.job.allowedGeography,
        sourceContext: isJobSeekerContext ? 'job_seeker_profile' : 'unknown',
      })
    : remoteEligibility

  // Subject attribution: classify the prospect's business model and commercial
  // relationship from the raw source + extracted entities. This is computed
  // BEFORE scoring so the score can reflect "this is a recruiter, not a buyer".
  // Scoped to the prospect's OWN text — a repost's content (someone else's
  // job, someone else's employer) must never feed business-model/relationship
  // classification for the prospect.
  const businessModel = classifyBusinessModel(
    `${ownRawTextFinal} ${passA.person.title ?? ''} ${passA.company.name ?? ''}`,
  )
  const relationship = deriveRelationship(businessModel, passA, ownRawTextFinal)

  // networking-only founder), strip market-derived opportunity signals. Their
  // posts about hiring demand, market growth, industry roadshows, or "moving
  // to"/"scaling" language describe THEIR SERVICE, THEIR CUSTOMERS, or THEIR
  // OWN COMPANY'S growth — not a buying intent for our software delivery.
  // Line-by-line subject classification can miss mixed prose ("...we explored
  // opportunities for collaboration..."), so as a backstop we remove these
  // signal types entirely for any non-buyer relationship, not just
  // recruiters — a founder doing BD for their own product is exactly as
  // unlikely to be a genuine buyer as a recruiter is. This enforces
  // invariant: MARKET/OWN-COMPANY COMMENTARY ≠ BUYING INTENT FOR BPULSE.
  const bounded = applyBuyerIntentBoundary(partialIntelligence.opportunity, ownRawTextFinal)
  partialIntelligence.opportunity = bounded.opportunity
  partialIntelligence.opportunity.primarySignal = selectPrimarySignal(partialIntelligence.opportunity.signals)
  partialIntelligence.commercialReading = bounded.reading
  if (bounded.reading.externalEngineeringNeed === 'NONE_DETECTED') {
    partialIntelligence.content.explicitProblems = []
    partialIntelligence.probableNeed = null
  }

  const isNonBuyer = isNonBuyerRelationship(relationship) || businessModel === 'RECRUITER'
  if (isNonBuyer) {
    partialIntelligence.opportunity = {
      ...partialIntelligence.opportunity,
      signals: partialIntelligence.opportunity.signals.filter(
        (s) => !['growth_signal', 'hiring', 'hiring_pressure', 'funding', 'launch', 'migration', 'rebuild'].includes(s),
      ),
      primarySignal: selectPrimarySignal(
        partialIntelligence.opportunity.signals.filter(
          (s) => !['growth_signal', 'hiring', 'hiring_pressure', 'funding', 'launch', 'migration', 'rebuild'].includes(s),
        ),
      ),
      urgency: 'unknown',
    }
  }

  // Pass C: Intelligence
  const passC = await runPassC(passA, partialIntelligence, callLog, opts.onStatus, opts.strictLiveMode, opts.leadId, opts.deterministicOnly)

  // Remote eligibility override for non-buyer relationships: a recruiter,
  // partner, or networking contact is not a job opportunity, so "remote
  // eligibility" (which measures worker-geography fit for a job) is not
  // applicable. Geography does not determine whether we can deliver services
  // to them. Without this, a social-post "in person" line, a header
  // location, or the prospect's OWN employment workplace_type (e.g. "Israel ·
  // Hybrid" on their current role) would wrongly make a recruiter/partner/peer
  // INELIGIBLE — conflating their employment arrangement with a
  // location-constrained requirement for an unrelated BPulse engagement.
  // Applies regardless of whether `passA.job` happens to be populated: for a
  // non-buyer relationship, an extracted "job" is not a BPulse opportunity.
  //
  // Separately (and independent of relationship): when there is NO job
  // object AND no opportunity signal that would make geography relevant at
  // all (no hiring/freelance/explicit-ask/technical-problem/migration/
  // rebuild signal), there is nothing for remote eligibility to be assessed
  // against — the correct state is NOT_APPLICABLE, not UNCLEAR. UNCLEAR is
  // reserved for when a real opportunity exists but geographic evidence is
  // until an opportunity type where geography is relevant has been
  // established.
  const LOCATION_RELEVANT_SIGNALS: OpportunitySignal[] = [
    'hiring', 'hiring_pressure', 'freelance_project_need', 'explicit_ask', 'technical_problem', 'migration', 'rebuild',
  ]
  const hasLocationRelevantOpportunity =
    partialIntelligence.opportunity.signals.some((s) => LOCATION_RELEVANT_SIGNALS.includes(s))
  // Only treat this as "no opportunity at all" when there is genuinely
  // nothing to go on: no job object, no location-relevant opportunity
  // signal, AND the deterministic workplace-type scan itself found no
  // REMOTE/HYBRID/ONSITE evidence either (refinedEligibility.workplaceType
  // stayed UNKNOWN). If the raw text already contains real workplace
  // language (e.g. "Remote OK", "Remote-first company") the eligibility
  // assessment computed from it is real evidence of a location-relevant
  // opportunity and must not be discarded just because passA.job/opportunity
  // signals happen not to have populated.
  // A profile without an extracted job posting AND no detected workplace type
  // employment workplace type (e.g. "England · Remote") describes THEIR
  // arrangement, not a vendor restriction. ABSENCE OF RESTRICTION ≠ VERIFIED
  // ELIGIBILITY. Only when a job posting or location-relevant buying signal
  // exists does geography become a service-eligibility factor.
  //
  // IMPORTANT: only override to NOT_APPLICABLE when the workplace type scan
  // itself found nothing (UNKNOWN). If the text genuinely says "Remote-first"
  // or "Remote OK", that IS real workplace evidence and the eligibility
  // assessment derived from it (ELIGIBLE for a distributed prospect) must be
  // preserved — overriding it would discard real signal (e.g. Emily Torres).
  const noOpportunityAtAll = !passA.job
    && !hasLocationRelevantOpportunity
    && refinedEligibility.workplaceType === 'UNKNOWN'

  // reflect real detected-in-text reality (e.g. a job post genuinely says
  // ONSITE) and are kept as descriptive metadata — but `evidence` and
  // `reason` are reset, never carried through. `evidence` strings get
  // pushed into the evidence ledger as FACT/EMPLOYER_REQUIREMENT entries
  // (see below) and can leak into strategy/message grounding as if they
  // heuristics pattern-matching generic vocabulary (e.g. "explicit ask for
  // external project help" from ordinary engineering language) rather than
  // a real employment/engagement ask. eligibility=NOT_APPLICABLE must never
  // carry forward reasoning that argues for a specific eligibility verdict —
  // only the plain fact of what workplace type text was detected, if any.
  const finalEligibility: RemoteEligibility =
    isNonBuyerRelationship(relationship) || noOpportunityAtAll
      ? {
          workplaceType: refinedEligibility.workplaceType,
          remoteScope: refinedEligibility.remoteScope,
          eligibility: 'NOT_APPLICABLE',
          reason: isNonBuyerRelationship(relationship)
            ? 'Not an employment or engagement opportunity — remote eligibility does not apply to this commercial relationship.'
            : 'No employment or location-constrained engagement opportunity detected.',
        }
      : refinedEligibility

  // Assemble final intelligence
  const intelligence: NormalizedIntelligence = {
    ...partialIntelligence,
    ...passC,
    businessModel,
    relationship,
    remoteEligibility: finalEligibility,
    commercialReading: partialIntelligence.commercialReading,
  }
  if (intelligence.commercialReading?.externalEngineeringNeed === 'NONE_DETECTED') {
    intelligence.probableNeed = null
    intelligence.timingSignal = null
    intelligence.opportunity.urgency = 'unknown'
  }

  if (finalEligibility.eligibility !== 'NOT_APPLICABLE' && finalEligibility.evidence) {
    for (const ev of finalEligibility.evidence) {
      evidenceLedger.push({
        signal: `Remote eligibility: ${ev}`,
        source: 'pasted_text',
        evidenceType: 'FACT',
        ownership: 'EMPLOYER_REQUIREMENT',
        confidence: 'HIGH',
        safeForOutreach: false,
      })
    }
  }

  return {
    intelligence,
    rawSource,
    remoteEligibility: finalEligibility,
    evidenceLedger,
    callLog,
    sourceUrls: normalizedSourceUrls,
  }
}
