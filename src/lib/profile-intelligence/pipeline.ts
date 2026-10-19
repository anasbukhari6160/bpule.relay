import { generate } from '@/lib/ai/runtime'
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

export async function runExtractionPipeline(
  parsed: ParsedDocument,
  rawContent: string,
  organizationId: string,
): Promise<ExtractionResult> {
  const classification = await classifyDocument(rawContent, organizationId)

  const people = classification.detectedPeople
  if (people.length === 0) {
    return {
      documentType: classification.documentType,
      sourceQuality: classification.sourceQuality,
      people: [],
      factsByPerson: new Map(),
      projectsByPerson: new Map(),
      proofsByPerson: new Map(),
      reviews: [],
      qualityGate: { passed: true, issues: ['No people detected in document.'] },
      warnings: [],
    }
  }

  const segmentText = segmentByPeople(rawContent, people)

  const factsByPerson = new Map<string, ExtractedFacts>()
  const projectsByPerson = new Map<string, ExtractedProject[]>()
  const proofsByPerson = new Map<string, ExtractedProof[]>()

  // Independent calls run in parallel (bounded) so multi-person documents fit
  // within the route's time limit.
  const warnings: string[] = []
  const reviewsPromise = settle(extractReviews(rawContent, people, organizationId), [] as ExtractedReview[], 'reviews', warnings)
  await mapLimit([...segmentText.entries()], PERSON_CONCURRENCY, async ([personName, text]) => {
    const person = await extractPerson(text, organizationId, warnings, personName)
    if (!person) return
    person.facts.people = [{ name: personName, confidence: 0.9, sectionStart: 0, sectionEnd: text.length, role: person.facts.currentRole, company: person.facts.company, aliases: [], clues: [] }]
    factsByPerson.set(personName, person.facts)
    projectsByPerson.set(personName, person.projects)
    proofsByPerson.set(personName, person.proofs)
  })
  const reviews = await reviewsPromise
  if (factsByPerson.size === 0 && people.length > 0) {
    throw new Error(`Extraction failed for every person in the document. ${warnings.join(' ')}`.trim())
  }

  // Advisory only: a failed quality check must not discard a good extraction.
  const qualityGate = await runQualityGate(rawContent, factsByPerson, projectsByPerson, proofsByPerson, organizationId)
    .catch((err) => ({ passed: true, issues: [`Quality gate unavailable: ${err instanceof Error ? err.message : 'error'}`] }))

  return {
    documentType: classification.documentType,
    sourceQuality: classification.sourceQuality,
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
export async function extractForSinglePerson(text: string, organizationId: string) {
  const warnings: string[] = []
  const [person, reviews] = await Promise.all([
    extractPerson(text, organizationId, warnings),
    settle(extractReviews(text, [], organizationId), [] as ExtractedReview[], 'reviews', warnings),
  ])
  if (!person) throw new Error(`Extraction failed. ${warnings.join(' ')}`.trim())
  return { ...person, reviews, warnings }
}

/**
 * Facts + projects in parallel, then proofs. A failed step degrades to empty
 * (recorded in `warnings`); only when BOTH facts and projects fail is the
 * person dropped.
 */
async function extractPerson(text: string, orgId: string, warnings: string[], label?: string) {
  const who = label ? ` (${label})` : ''
  const [factsR, projectsR] = await Promise.allSettled([extractFacts(text, orgId), extractProjects(text, orgId)])
  if (factsR.status === 'rejected' && projectsR.status === 'rejected') {
    warnings.push(`Could not extract${who}: ${reason(factsR.reason)}`)
    return null
  }
  if (factsR.status === 'rejected') warnings.push(`Profile facts unavailable${who}: ${reason(factsR.reason)}`)
  if (projectsR.status === 'rejected') warnings.push(`Projects unavailable${who}: ${reason(projectsR.reason)}`)
  const facts = factsR.status === 'fulfilled' ? factsR.value : emptyFacts()
  const projects = projectsR.status === 'fulfilled' ? projectsR.value : []
  const proofs = await settle(buildProofs(text, facts, projects, orgId), [] as ExtractedProof[], `proof${who}`, warnings)
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

async function classifyDocument(content: string, orgId: string) {
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
    organizationId: orgId,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 2048, timeoutMs: 45_000,
    callSite: 'profile-intelligence:classifyDocument',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  })

  return result.data
}

async function extractFacts(text: string, orgId: string): Promise<ExtractedFacts> {
  const truncated = text.slice(0, 12000)
  const result = await generate<ExtractedFacts>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_FACT_EXTRACT,
    user: `Extract professional facts from this person's section:\n\n${truncated}`,
    outputSchema: PROFILE_FACT_EXTRACT_SCHEMA,
    organizationId: orgId,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 3072, timeoutMs: 60_000,
    callSite: 'profile-intelligence:extractFacts',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  })

  const facts = result.data
  if (facts.primarySkills) facts.primarySkills = normalizeSkills(facts.primarySkills)
  if (facts.secondarySkills) facts.secondarySkills = normalizeSkills(facts.secondarySkills)
  if (facts.technologies) facts.technologies = normalizeSkills(facts.technologies)

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

async function extractProjects(text: string, orgId: string): Promise<ExtractedProject[]> {
  const truncated = text.slice(0, 10000)
  const result = await generate<{ projects: ExtractedProject[] }>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_PROJECT_EXTRACT,
    user: `Extract all projects and work engagements from this text:\n\n${truncated}`,
    outputSchema: PROFILE_PROJECT_EXTRACT_SCHEMA,
    organizationId: orgId,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 4096, timeoutMs: 60_000,
    callSite: 'profile-intelligence:extractProjects',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  })

  return (result.data.projects || []).map((p) => ({
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

async function buildProofs(text: string, facts: ExtractedFacts, projects: ExtractedProject[], orgId: string): Promise<ExtractedProof[]> {
  const evidenceContext = buildEvidenceContext(facts, projects, text)
  if (!evidenceContext) return []

  const result = await generate<{ proofs: ExtractedProof[] }>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_PROOF_BUILD,
    user: `Build safe outreach proof from this evidence:\n\n${evidenceContext.slice(0, 8000)}`,
    outputSchema: PROFILE_PROOF_BUILD_SCHEMA,
    organizationId: orgId,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 3072, timeoutMs: 60_000,
    callSite: 'profile-intelligence:buildProofs',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  })

  return (result.data.proofs || []).map((p) => ({
    claim: p.claim,
    whyItMatters: p.whyItMatters,
    supportingEvidence: p.supportingEvidence,
    technologyDomain: p.technologyDomain ?? null,
    confidence: p.confidence ?? 0.5,
    safeForOutreach: p.safeForOutreach ?? false,
    evidenceType: p.evidenceType ?? 'explicit_claim',
  }))
}

async function extractReviews(text: string, people: DetectedPerson[], orgId: string): Promise<ExtractedReview[]> {
  const truncated = text.slice(0, 10000)
  const peopleNames = people.map((p) => p.name).join(', ')

  const result = await generate<{ reviews: ExtractedReview[] }>({
    task: 'FAST_STRUCTURED',
    system: SYSTEM_PROMPT_REVIEW_EXTRACT,
    user: `Extract reviews/testimonials. People in document: ${peopleNames}\n\n${truncated}`,
    outputSchema: PROFILE_REVIEW_EXTRACT_SCHEMA,
    organizationId: orgId,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 3072, timeoutMs: 60_000,
    callSite: 'profile-intelligence:extractReviews',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  })

  return (result.data.reviews || []).map((r) => ({
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
  orgId: string,
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
    organizationId: orgId,
    // Long documents → large JSON output; FAST_STRUCTURED defaults (1024 tokens / 8s)
    // truncate or time out, which surfaced as 'Unable to normalize JSON' / 'aborted'.
    maxTokens: 1024, timeoutMs: 30_000,
    callSite: 'profile-intelligence:qualityGate',
    feature: 'profile_extraction',
    promptVersion: 'v2',
  })

  return {
    passed: result.data.passed && !result.data.personMixingDetected,
    issues: result.data.issues || [],
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

function segmentByPeople(text: string, people: DetectedPerson[]): Map<string, string> {
  const segments = new Map<string, string>()

  // Filter out people with no name — AI can return incomplete objects.
  const validPeople = people.filter((p) => p && typeof p.name === 'string' && p.name.trim())
  if (validPeople.length === 0) return segments

  if (validPeople.length === 1) {
    segments.set(validPeople[0].name, text)
    return segments
  }

  for (let i = 0; i < validPeople.length; i++) {
    const person = validPeople[i]
    const nextPerson = validPeople[i + 1]
    const start = person.sectionStart
    const end = nextPerson ? nextPerson.sectionStart : person.sectionEnd || text.length
    const segment = text.slice(start, Math.min(end, text.length))
    segments.set(person.name, segment)
  }

  return segments
}

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
