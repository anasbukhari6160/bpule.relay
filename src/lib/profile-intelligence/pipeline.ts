import { generate, type AiRetryOptions } from '@/lib/ai/runtime'
import type { ParsedDocument } from './parse-document'
import type { DetectedPerson, ExtractedFacts, ExtractedProject, ExtractedReview, ExtractedProof } from '@/lib/domain/types'
import { normalizeSkills, extractYearsExperience, inferSeniority } from './skill-normalization'
import { resolveIdentity } from './identity-resolution'
import {
  SYSTEM_PROMPT_DOCUMENT_CLASSIFY,
  SYSTEM_PROMPT_FACT_EXTRACT,
  SYSTEM_PROMPT_PROJECT_EXTRACT,
  SYSTEM_PROMPT_PROOF_BUILD,
  SYSTEM_PROMPT_REVIEW_EXTRACT,
  SYSTEM_PROMPT_QUALITY_GATE,
  SYSTEM_PROMPT_SYNTHESIZE,
} from './extraction-prompts'
import {
  PROFILE_DOCUMENT_CLASSIFY_SCHEMA,
  PROFILE_FACT_EXTRACT_SCHEMA,
  PROFILE_PROJECT_EXTRACT_SCHEMA,
  PROFILE_PROOF_BUILD_SCHEMA,
  PROFILE_REVIEW_EXTRACT_SCHEMA,
  PROFILE_QUALITY_GATE_SCHEMA,
  PROFILE_SYNTHESIZE_SCHEMA,
} from './ai-schemas'

export interface PipelineContext {
  organizationId: string
  importBatchId?: string
  uploadedBy: string
}

export interface ExtractionResult {
  documentType: string
  sourceQuality: string
  people: DetectedPerson[]
  factsByPerson: Map<string, ExtractedFacts>
  projectsByPerson: Map<string, ExtractedProject[]>
  proofsByPerson: Map<string, ExtractedProof[]>
  reviews: ExtractedReview[]
  qualityGate: { passed: boolean; issues: string[] }
  /** Steps that failed but did not sink the whole source (partial extraction). */
  warnings: string[]
}

export interface PipelineOptions {
  /** Epoch ms the caller must finish by; AI retries never wait past it. */
  deadline?: number
  /**
   * The source is about one known person (a spreadsheet row group, or an
   * upload attached to a profile): skip classification and use this name.
   */
  knownPersonName?: string
  /** Skip the advisory quality-gate call (spreadsheet rows). */
  skipQualityGate?: boolean
}

interface CallCtx {
  orgId: string
  retry: AiRetryOptions
}

// Rate limits and provider cooldowns clear within seconds; two retries with
// backoff recover most of them without blowing the route's time budget.
function callCtx(orgId: string, deadline?: number): CallCtx {
  return { orgId, retry: { attempts: 2, baseDelayMs: 3_000, maxDelayMs: 20_000, deadline: deadline ? deadline - 5_000 : undefined } }
}

export async function runExtractionPipeline(
  parsed: ParsedDocument,
  rawContent: string,
  organizationId: string,
  options: PipelineOptions = {},
): Promise<ExtractionResult> {
  const ctx = callCtx(organizationId, options.deadline)
  const warnings: string[] = []

  let documentType = 'unknown'
  let sourceQuality = 'unknown'
  let people: DetectedPerson[]
  if (options.knownPersonName?.trim()) {
    people = [namedPerson(options.knownPersonName.trim(), rawContent.length)]
  } else {
    // A failed classification degrades to "one person's document" (a CV) —
    // it must never sink the whole source.
    try {
      const classification = await classifyDocument(rawContent, ctx)
      documentType = typeof classification.documentType === 'string' ? classification.documentType : 'unknown'
      sourceQuality = typeof classification.sourceQuality === 'string' ? classification.sourceQuality : 'unknown'
      people = validPeople(classification.detectedPeople)
    } catch (err) {
      warnings.push(`Document classification unavailable: ${reason(err)}`)
      people = []
    }
  }

  // Nobody detected: treat the document as a single person's (CV, profile
  // export). The name comes from the extracted facts or the document header.
  if (people.length === 0) {
    return extractSinglePersonDocument(rawContent, ctx, warnings, documentType, sourceQuality, options)
  }

  const segmentText = segmentByPeople(rawContent, people)
  const segmentedCount = segmentText.size

  const factsByPerson = new Map<string, ExtractedFacts>()
  const projectsByPerson = new Map<string, ExtractedProject[]>()
  const proofsByPerson = new Map<string, ExtractedProof[]>()

  // Independent calls run in parallel (bounded) so multi-person documents fit
  // within the route's time limit.
  const reviewsPromise = settle(extractReviews(rawContent, people, ctx), [] as ExtractedReview[], 'reviews', warnings)
  await mapLimit([...segmentText.entries()], PERSON_CONCURRENCY, async ([personName, text]) => {
    const person = await extractPerson(text, ctx, warnings, personName)
    if (!person) return
    person.facts.people = [{ name: personName, confidence: 0.9, sectionStart: 0, sectionEnd: text.length, role: person.facts.currentRole, company: person.facts.company, aliases: [], clues: [] }]
    factsByPerson.set(personName, person.facts)
    projectsByPerson.set(personName, person.projects)
    proofsByPerson.set(personName, person.proofs)
  })
  const reviews = await reviewsPromise
  if (factsByPerson.size === 0 && segmentedCount > 0) {
    const detail = warnings.length > 0 ? warnings.join(' | ') : 'no warnings recorded'
    throw new Error(`Extraction failed for ${segmentedCount} person(s). Warnings: ${detail}. Raw detected: ${people.length} people.`)
  }
  if (segmentedCount === 0 && people.length > 0) {
    const sample = people.slice(0, 3).map((p) => JSON.stringify({ name: p.name, role: p.role })).join('; ')
    throw new Error(`No valid people names. Detected ${people.length} but all filtered. Sample: ${sample}`)
  }

  // Advisory only: a failed quality check must not discard a good extraction.
  const qualityGate = options.skipQualityGate
    ? { passed: true, issues: [] as string[] }
    : await runQualityGate(rawContent, factsByPerson, projectsByPerson, proofsByPerson, ctx)
      .catch((err) => ({ passed: true, issues: [`Quality gate unavailable: ${err instanceof Error ? err.message : 'error'}`] }))

  return {
    documentType,
    sourceQuality,
    people,
    factsByPerson,
    projectsByPerson,
    proofsByPerson,
    reviews,
    qualityGate,
    warnings,
  }
}

/**
 * Extraction for a source the user explicitly attached to ONE known profile
 * (enrichment). Used when classification finds no named person — e.g. a
 * portfolio or case study that never states the owner's name.
 */
export async function extractForSinglePerson(text: string, organizationId: string, options: { deadline?: number } = {}) {
  const warnings: string[] = []
  const ctx = callCtx(organizationId, options.deadline)
  const [person, reviews] = await Promise.all([
    extractPerson(text, ctx, warnings),
    settle(extractReviews(text, [], ctx), [] as ExtractedReview[], 'reviews', warnings),
  ])
  if (!person) throw new Error(`Extraction failed. ${warnings.join(' ')}`.trim())
  return { ...person, reviews, warnings }
}

/**
 * Facts + projects in parallel, then proofs. A failed step degrades to empty
 * (recorded in `warnings`); only when BOTH facts and projects fail is the
 * person dropped.
 */
async function extractPerson(text: string, ctx: CallCtx, warnings: string[], label?: string) {
  const who = label ? ` (${label})` : ''
  const [factsR, projectsR] = await Promise.allSettled([extractFacts(text, ctx), extractProjects(text, ctx)])
  if (factsR.status === 'rejected' && projectsR.status === 'rejected') {
    warnings.push(`Could not extract${who}: ${reason(factsR.reason)}`)
    return null
  }
  if (factsR.status === 'rejected') warnings.push(`Profile facts unavailable${who}: ${reason(factsR.reason)}`)
  if (projectsR.status === 'rejected') warnings.push(`Projects unavailable${who}: ${reason(projectsR.reason)}`)
  const facts = factsR.status === 'fulfilled' ? factsR.value : emptyFacts()
  const projects = projectsR.status === 'fulfilled' ? projectsR.value : []
  const proofs = await settle(buildProofs(text, facts, projects, ctx), [] as ExtractedProof[], `proof${who}`, warnings)
  return { facts, projects, proofs }
}

async function settle<T>(p: Promise<T>, fallback: T, what: string, warnings: string[]): Promise<T> {
  try {
    return await p
  } catch (err) {
    warnings.push(`${what[0].toUpperCase()}${what.slice(1)} unavailable: ${reason(err)}`)
    return fallback
  }
}

function reason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg
}

function emptyFacts(): ExtractedFacts {
  return {
    fullName: null, displayName: null, currentRole: null, company: null, location: null, headline: null, bio: null,
    professionalSummary: null, seniority: null, yearsExperience: null, primarySkills: [], secondarySkills: [], technologies: [],
    industries: [], serviceCapabilities: [], specialties: [], positioning: null, differentiators: [], languages: [],
    communicationStyle: {}, projects: [], proofs: [], reviews: [], people: [],
  }
}

const PERSON_CONCURRENCY = 3
const MAX_PEOPLE_PER_DOCUMENT = 25

function namedPerson(name: string, length: number): DetectedPerson {
  return { name, confidence: 0.9, sectionStart: 0, sectionEnd: length, role: null, company: null, aliases: [], clues: [] } as DetectedPerson
}

/** People with a usable name, first mention wins, case-insensitive dedupe. */
export function validPeople(raw: unknown): DetectedPerson[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DetectedPerson[] = []
  for (const p of raw as Array<Partial<DetectedPerson> | null>) {
    const name = typeof p?.name === 'string' ? p.name.replace(/\s+/g, ' ').trim() : ''
    if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...(p as DetectedPerson), name })
    if (out.length >= MAX_PEOPLE_PER_DOCUMENT) break
  }
  return out
}

/** A person's name from a document header: "Jane Doe" on its own line near the top. */
export function guessNameFromHeader(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6)
  for (const line of lines) {
    const candidate = line.replace(/^(?:name|full name)\s*[:\-–]\s*/i, '').trim()
    if (candidate.length > 60 || /[@\d|•:/]/.test(candidate)) continue
    const words = candidate.split(/\s+/)
    if (words.length < 2 || words.length > 4) continue
    if (!words.every((w) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(w))) continue
    if (/\b(?:curriculum|vitae|resume|résumé|profile|summary|experience|engineer|developer|manager|designer|consultant|team|company|portfolio)\b/i.test(candidate)) continue
    return candidate
  }
  return null
}

async function extractSinglePersonDocument(
  text: string,
  ctx: CallCtx,
  warnings: string[],
  documentType: string,
  sourceQuality: string,
  options: PipelineOptions,
): Promise<ExtractionResult> {
  const headerName = guessNameFromHeader(text)
  const [person, reviews] = await Promise.all([
    extractPerson(text, ctx, warnings, headerName ?? undefined),
    settle(extractReviews(text, [], ctx), [] as ExtractedReview[], 'reviews', warnings),
  ])
  const name = (person?.facts.fullName ?? person?.facts.displayName ?? headerName ?? '').trim()
  if (!person || !name) {
    // Nothing usable: the caller reports "no person identified" with these reasons.
    return {
      documentType, sourceQuality, people: [], factsByPerson: new Map(), projectsByPerson: new Map(),
      proofsByPerson: new Map(), reviews, qualityGate: { passed: true, issues: ['No people detected in document.'] }, warnings,
    }
  }
  const facts = { ...person.facts, fullName: person.facts.fullName ?? name }
  facts.people = [{ name, confidence: 0.8, sectionStart: 0, sectionEnd: text.length, role: facts.currentRole, company: facts.company, aliases: [], clues: [] }]
  const qualityGate = options.skipQualityGate
    ? { passed: true, issues: [] as string[] }
    : await runQualityGate(text, new Map([[name, facts]]), new Map([[name, person.projects]]), new Map([[name, person.proofs]]), ctx)
      .catch((err) => ({ passed: true, issues: [`Quality gate unavailable: ${err instanceof Error ? err.message : 'error'}`] }))
  return {
    documentType: documentType === 'unknown' ? 'single_person' : documentType,
    sourceQuality,
    people: [namedPerson(name, text.length)],
    factsByPerson: new Map([[name, facts]]),
    projectsByPerson: new Map([[name, person.projects]]),
    proofsByPerson: new Map([[name, person.proofs]]),
    reviews,
    qualityGate,
    warnings,
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

async function classifyDocument(content: string, ctx: CallCtx) {
  const truncated = content.slice(0, 8000)
  const result = await generate<{
    documentType: string
    detectedPeople: DetectedPerson[]
    sourceQuality: string
    sectionBoundaries?: Array<{ name: string; startChar: number; endChar: number }>
  }>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_DOCUMENT_CLASSIFY,
    user: `Classify this document and list all people mentioned:\n\n${truncated}`,
    outputSchema: PROFILE_DOCUMENT_CLASSIFY_SCHEMA,
    organizationId: ctx.orgId,
    retry: ctx.retry,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 2048, timeoutMs: 45_000,
    callSite: 'profile-intelligence:classifyDocument',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  }).catch((err) => { throw stepError('classify', err) })

  if (!result.data || typeof result.data !== 'object') throw stepError('classify', 'empty response')
  return result.data
}

/** An AI step failure that names the step, so warnings say which part failed. */
function stepError(step: string, err: unknown): Error {
  return new Error(`${step}: ${reason(err)}`)
}

async function extractFacts(text: string, ctx: CallCtx): Promise<ExtractedFacts> {
  const truncated = text.slice(0, 12000)
  const result = await generate<ExtractedFacts>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_FACT_EXTRACT,
    user: `Extract professional facts from this person's section:\n\n${truncated}`,
    outputSchema: PROFILE_FACT_EXTRACT_SCHEMA,
    organizationId: ctx.orgId,
    retry: ctx.retry,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 3072, timeoutMs: 60_000,
    callSite: 'profile-intelligence:extractFacts',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  }).catch((err) => { throw stepError('facts', err) })

  if (!result.data || typeof result.data !== 'object') throw stepError('facts', 'empty response')
  const facts = result.data
  // Models sometimes return a string where a list belongs; never let that crash normalization.
  for (const key of ['primarySkills', 'secondarySkills', 'technologies', 'industries', 'serviceCapabilities', 'specialties', 'differentiators', 'languages'] as const) {
    const v = (facts as unknown as Record<string, unknown>)[key]
    if (typeof v === 'string') (facts as unknown as Record<string, unknown>)[key] = v.split(/[,;]\s*/).filter(Boolean)
    else if (!Array.isArray(v)) (facts as unknown as Record<string, unknown>)[key] = []
  }
  if (typeof facts.fullName !== 'string' || !facts.fullName.trim()) facts.fullName = null
  if (Array.isArray(facts.primarySkills)) facts.primarySkills = normalizeSkills(facts.primarySkills)
  if (Array.isArray(facts.secondarySkills)) facts.secondarySkills = normalizeSkills(facts.secondarySkills)
  if (Array.isArray(facts.technologies)) facts.technologies = normalizeSkills(facts.technologies)

  if (facts.yearsExperience === undefined && facts.professionalSummary) {
    facts.yearsExperience = extractYearsExperience(facts.professionalSummary)
  }
  if (!facts.seniority && (facts.yearsExperience !== null || facts.currentRole)) {
    facts.seniority = inferSeniority(facts.yearsExperience ?? null, facts.currentRole ?? null)
  }

  return {
    fullName: facts.fullName ?? null,
    displayName: facts.displayName ?? null,
    currentRole: facts.currentRole ?? null,
    company: facts.company ?? null,
    location: facts.location ?? null,
    headline: facts.headline ?? null,
    bio: facts.bio ?? null,
    professionalSummary: facts.professionalSummary ?? null,
    seniority: facts.seniority ?? null,
    yearsExperience: facts.yearsExperience ?? null,
    primarySkills: facts.primarySkills ?? [],
    secondarySkills: facts.secondarySkills ?? [],
    technologies: facts.technologies ?? [],
    industries: facts.industries ?? [],
    serviceCapabilities: facts.serviceCapabilities ?? [],
    specialties: facts.specialties ?? [],
    positioning: facts.positioning ?? null,
    differentiators: facts.differentiators ?? [],
    languages: facts.languages ?? [],
    communicationStyle: facts.communicationStyle ?? {},
    ...(Array.isArray((facts as { employmentHistory?: unknown }).employmentHistory)
      ? { employmentHistory: (facts as unknown as { employmentHistory: unknown[] }).employmentHistory }
      : {}),
    projects: [],
    proofs: [],
    reviews: [],
    people: [],
  }
}

async function extractProjects(text: string, ctx: CallCtx): Promise<ExtractedProject[]> {
  const truncated = text.slice(0, 10000)
  const result = await generate<{ projects: ExtractedProject[] }>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_PROJECT_EXTRACT,
    user: `Extract all projects and work engagements from this text:\n\n${truncated}`,
    outputSchema: PROFILE_PROJECT_EXTRACT_SCHEMA,
    organizationId: ctx.orgId,
    retry: ctx.retry,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 4096, timeoutMs: 60_000,
    callSite: 'profile-intelligence:extractProjects',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  }).catch((err) => { throw stepError('projects', err) })

  return (Array.isArray(result.data?.projects) ? result.data.projects : []).filter((p) => p && typeof p.name === 'string' && p.name.trim()).map((p) => ({
    name: p.name,
    clientCompany: p.clientCompany ?? null,
    role: p.role ?? null,
    summary: p.summary,
    technologies: p.technologies ?? [],
    responsibilities: p.responsibilities ?? [],
    problem: p.problem ?? null,
    workPerformed: p.workPerformed ?? null,
    outcome: p.outcome ?? null,
    startDate: p.startDate ?? null,
    endDate: p.endDate ?? null,
    evidenceType: p.evidenceType ?? 'explicit_claim',
    confidence: p.confidence ?? 0.7,
    sourceReferences: p.sourceReferences ?? [],
  }))
}

async function buildProofs(text: string, facts: ExtractedFacts, projects: ExtractedProject[], ctx: CallCtx): Promise<ExtractedProof[]> {
  const evidenceContext = buildEvidenceContext(facts, projects, text)
  if (!evidenceContext) return []

  const result = await generate<{ proofs: ExtractedProof[] }>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_PROOF_BUILD,
    user: `Build safe outreach proof from this evidence:\n\n${evidenceContext.slice(0, 8000)}`,
    outputSchema: PROFILE_PROOF_BUILD_SCHEMA,
    organizationId: ctx.orgId,
    retry: ctx.retry,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 3072, timeoutMs: 60_000,
    callSite: 'profile-intelligence:buildProofs',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  }).catch((err) => { throw stepError('proofs', err) })

  return (Array.isArray(result.data?.proofs) ? result.data.proofs : []).filter((p) => p && typeof p.claim === 'string' && p.claim.trim()).map((p) => ({
    claim: p.claim,
    whyItMatters: p.whyItMatters,
    supportingEvidence: p.supportingEvidence,
    technologyDomain: p.technologyDomain ?? null,
    confidence: p.confidence ?? 0.5,
    safeForOutreach: p.safeForOutreach ?? false,
    evidenceType: p.evidenceType ?? 'explicit_claim',
  }))
}

async function extractReviews(text: string, people: DetectedPerson[], ctx: CallCtx): Promise<ExtractedReview[]> {
  const truncated = text.slice(0, 10000)
  const peopleNames = people.map((p) => p.name).join(', ')

  const result = await generate<{ reviews: ExtractedReview[] }>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_REVIEW_EXTRACT,
    user: `Extract reviews/testimonials. People in document: ${peopleNames}\n\n${truncated}`,
    outputSchema: PROFILE_REVIEW_EXTRACT_SCHEMA,
    organizationId: ctx.orgId,
    retry: ctx.retry,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 3072, timeoutMs: 60_000,
    callSite: 'profile-intelligence:extractReviews',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  }).catch((err) => { throw stepError('reviews', err) })

  return (Array.isArray(result.data?.reviews) ? result.data.reviews : []).filter((r) => r && typeof r.reviewText === 'string' && r.reviewText.trim()).map((r) => ({
    reviewText: r.reviewText,
    assignedPersonName: r.assignedPersonName ?? null,
    reviewerName: r.reviewerName ?? null,
    reviewerCompany: r.reviewerCompany ?? null,
    relevantSkills: r.relevantSkills ?? [],
    projectContext: r.projectContext ?? null,
    confidence: r.confidence ?? 0.6,
    evidenceType: r.evidenceType ?? 'explicit_claim',
    ownershipStatus: r.ownershipStatus ?? 'clear',
  }))
}

async function runQualityGate(
  sourceText: string,
  factsByPerson: Map<string, ExtractedFacts>,
  projectsByPerson: Map<string, ExtractedProject[]>,
  proofsByPerson: Map<string, ExtractedProof[]>,
  ctx: CallCtx,
) {
  const summary: string[] = []
  for (const [name, facts] of factsByPerson.entries()) {
    const skills = [...facts.primarySkills, ...facts.technologies].join(', ')
    summary.push(`${name}: role=${facts.currentRole ?? 'unknown'}, skills=${skills}`)
  }

  const proofCount = [...proofsByPerson.values()].reduce((sum, p) => sum + p.length, 0)
  const projectCount = [...projectsByPerson.values()].reduce((sum, p) => sum + p.length, 0)

  const gateInput = `Source length: ${sourceText.length} chars. People: ${factsByPerson.size}. Projects: ${projectCount}. Proofs: ${proofCount}.\n\n${summary.join('\n')}\n\nSource excerpt: ${sourceText.slice(0, 3000)}`

  const result = await generate<{
    passed: boolean
    issues: string[]
    personMixingDetected?: boolean
    fabricatedClaims?: string[]
    missingProvenance?: string[]
  }>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_QUALITY_GATE,
    user: gateInput,
    outputSchema: PROFILE_QUALITY_GATE_SCHEMA,
    organizationId: ctx.orgId,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 1024, timeoutMs: 30_000,
    callSite: 'profile-intelligence:qualityGate',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  })

  return {
    passed: Boolean(result.data?.passed) && !result.data?.personMixingDetected,
    issues: Array.isArray(result.data?.issues) ? result.data.issues : [],
  }
}

export async function synthesizeAiContext(
  facts: ExtractedFacts,
  projects: ExtractedProject[],
  proofs: ExtractedProof[],
  orgId: string,
) {
  const context = {
    fullName: facts.fullName,
    currentRole: facts.currentRole,
    company: facts.company,
    seniority: facts.seniority,
    primarySkills: facts.primarySkills,
    technologies: facts.technologies,
    industries: facts.industries,
    projectCount: projects.length,
    proofCount: proofs.length,
    topProjects: projects.slice(0, 5).map((p) => p.name),
    topProofs: proofs.filter((p) => p.safeForOutreach).slice(0, 5).map((p) => p.claim),
  }

  const result = await generate<{
    identitySummary: string
    capabilities: string[]
    strongestProof: string[]
    industries: string[]
    technologies: string[]
    differentiators: string[]
    voice?: string
    safeClaims: string[]
    prohibitedClaims: string[]
  }>({
    task: 'BACKGROUND_INTELLIGENCE',
    system: SYSTEM_PROMPT_SYNTHESIZE,
    user: `Synthesize AI context from: ${JSON.stringify(context)}`,
    outputSchema: PROFILE_SYNTHESIZE_SCHEMA,
    organizationId: orgId,
    callSite: 'profile-intelligence:synthesizeAiContext',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  })

  return result.data
}

/**
 * Each person's section of a multi-person document. The model's character
 * offsets are used when they are sane; otherwise the section starts at the
 * first mention of the person's name. A section too short to describe anyone
 * falls back to the whole document rather than producing an empty extraction.
 */
export function segmentByPeople(text: string, people: DetectedPerson[]): Map<string, string> {
  const segments = new Map<string, string>()
  const valid = validPeople(people)
  if (valid.length === 0) return segments
  if (valid.length === 1) {
    segments.set(valid[0].name, text)
    return segments
  }

  const lower = text.toLowerCase()
  const starts = valid.map((p) => {
    const offset = Number(p.sectionStart)
    if (Number.isFinite(offset) && offset >= 0 && offset < text.length) return offset
    const at = lower.indexOf(p.name.toLowerCase())
    return at >= 0 ? at : -1
  })
  const ordered = valid
    .map((p, i) => ({ p, start: starts[i] }))
    .sort((a, b) => (a.start < 0 ? Infinity : a.start) - (b.start < 0 ? Infinity : b.start))

  for (let i = 0; i < ordered.length; i++) {
    const { p, start } = ordered[i]
    if (start < 0) {
      segments.set(p.name, text)
      continue
    }
    const nextStart = ordered.slice(i + 1).find((o) => o.start > start)?.start
    const declaredEnd = Number(p.sectionEnd)
    const end = nextStart ?? (Number.isFinite(declaredEnd) && declaredEnd > start ? Math.min(declaredEnd, text.length) : text.length)
    const segment = text.slice(start, end)
    segments.set(p.name, segment.trim().length >= MIN_SEGMENT_CHARS ? segment : text)
  }
  return segments
}

const MIN_SEGMENT_CHARS = 80

function buildEvidenceContext(facts: ExtractedFacts, projects: ExtractedProject[], rawText: string): string {
  const parts: string[] = []
  if (facts.professionalSummary) parts.push(`Summary: ${facts.professionalSummary}`)
  if (facts.currentRole) parts.push(`Role: ${facts.currentRole}`)
  if (facts.primarySkills.length > 0) parts.push(`Skills: ${facts.primarySkills.join(', ')}`)
  if (projects.length > 0) {
    parts.push('Projects:')
    for (const p of projects.slice(0, 8)) {
      parts.push(`- ${p.name} (${p.role ?? 'unknown role'}): ${p.summary}. ${p.outcome ? `Outcome: ${p.outcome}` : ''}`)
    }
  }
  if (rawText.length > 0) parts.push(`\nSource excerpt: ${rawText.slice(0, 2000)}`)
  return parts.join('\n')
}
