/**
 * Canonical Upwork job score (upwork_score_v1).
 *
 * Nine bounded, additive dimensions, 0–100, from UpworkJobFacts only. The
 * JOB SCORE never depends on which sender/profile is chosen; profile match is
 * a separate ranking (matchProfilesToJob) so "Job 82/100 · Aneeb 91% · Zaira
 * 64%" reads as three independent numbers.
 *
 * Bands reuse the canonical table (STRONG 75+, WORTH_PURSUING 55+, MAYBE 35+,
 * LOW 15+, SKIP) and the legacy verdict is a projection of the band:
 * STRONG/WORTH_PURSUING → apply, MAYBE → apply_if_connects, else skip.
 */

import { readUpworkJobFacts, type UpworkJobFacts } from './facts'
import { qualifyCanonicalScore, displayScoreForCanonical, type CanonicalQualification } from '@/lib/scoring/qualification'
import { DEFAULT_ORG_CAPABILITIES } from '@/lib/intelligence-v3/dimensions'
import { rankSendersForLead, type SenderProfile, type RoutingResult } from '@/lib/relay/sender-routing-engine'
import type { UpworkJobVerdict } from '@/lib/domain/types'

export const UPWORK_SCORING_VERSION = 'upwork_score_v1'

export const UPWORK_WEIGHTS = {
  jobQuality: 0.12,
  commercialValue: 0.18,
  technicalFit: 0.18,
  clientQuality: 0.14,
  competition: 0.10,
  timing: 0.08,
  scopeClarity: 0.08,
  proofMatch: 0.06,
  evidenceQuality: 0.06,
} as const
export type UpworkDimensionKey = keyof typeof UPWORK_WEIGHTS

export interface UpworkDimension {
  key: UpworkDimensionKey
  label: string
  raw: number
  weight: number
  contribution: number
  note: string
}

export interface UpworkJobScore {
  version: typeof UPWORK_SCORING_VERSION
  score: number
  display: number
  qualification: CanonicalQualification
  verdict: UpworkJobVerdict
  dimensions: UpworkDimension[]
  reasons: string[]
  watchOut: string[]
  suspicious: string[]
  /** A disqualifying fact bounded the score below the dimension sum. */
  cap: { value: number; reason: string } | null
  facts: UpworkJobFacts
}

export interface UpworkScoreInput {
  rawText?: string | null
  /** Explicit values (a rep may correct the form); they override parsed facts when given. */
  overrides?: {
    hourlyRateMin?: number | null
    hourlyRateMax?: number | null
    fixedBudget?: number | null
    proposalCount?: number | null
    skills?: string[] | null
    description?: string | null
    title?: string | null
  }
  orgCapabilities?: string[]
  /** Org-wide proof tags (any profile). Empty = unverified, not negative. */
  orgProofTags?: string[]
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))
const norm = (s: string) => s.toLowerCase().trim()

export function verdictForQualification(q: CanonicalQualification): UpworkJobVerdict {
  if (q === 'STRONG' || q === 'WORTH_PURSUING') return 'apply'
  if (q === 'MAYBE') return 'apply_if_connects'
  return 'skip'
}

function applyOverrides(facts: UpworkJobFacts, o: UpworkScoreInput['overrides']): UpworkJobFacts {
  if (!o) return facts
  const f: UpworkJobFacts = { ...facts, rate: { ...facts.rate }, proposals: { ...facts.proposals } }
  if (o.hourlyRateMin != null || o.hourlyRateMax != null) {
    f.rate.type = 'hourly'
    f.rate.hourlyMin = o.hourlyRateMin ?? o.hourlyRateMax ?? f.rate.hourlyMin
    f.rate.hourlyMax = o.hourlyRateMax ?? o.hourlyRateMin ?? f.rate.hourlyMax
    f.rate.fixedBudget = null
  } else if (o.fixedBudget != null) {
    f.rate.type = 'fixed'
    f.rate.fixedBudget = o.fixedBudget
    f.rate.hourlyMin = null
    f.rate.hourlyMax = null
  }
  if (o.proposalCount != null) { f.proposals.count = o.proposalCount; f.proposals.range = [o.proposalCount, o.proposalCount] }
  if (o.skills && o.skills.length) f.skills = [...new Set([...f.skills, ...o.skills.map(norm)])]
  if (o.description && f.scope.wordCount < 40) {
    const words = o.description.split(/\s+/).filter(Boolean).length
    f.scope = { ...f.scope, wordCount: Math.max(f.scope.wordCount, words), vague: words < 40 && f.scope.vague }
  }
  if (o.title) f.title = o.title
  return f
}

export function scoreUpworkFacts(input: UpworkJobFacts, opts: Omit<UpworkScoreInput, 'rawText'> = {}): UpworkJobScore {
  const facts = applyOverrides(input, opts.overrides)
  const caps = new Set((opts.orgCapabilities ?? DEFAULT_ORG_CAPABILITIES).map(norm))
  const proofTags = new Set((opts.orgProofTags ?? []).map(norm))
  const dims: UpworkDimension[] = []
  const reasons: string[] = []
  const watchOut: string[] = []
  const push = (key: UpworkDimensionKey, label: string, raw: number, note: string) => {
    const r = clamp(Math.round(raw * 100) / 100)
    dims.push({ key, label, raw: r, weight: UPWORK_WEIGHTS[key], contribution: Math.round(r * UPWORK_WEIGHTS[key] * 1000) / 10, note })
  }

  // 1. Job quality — is this a real, well-formed job from a real buyer?
  let jq = 0.5
  if (facts.scope.wordCount >= 80) jq += 0.2
  if (facts.scope.hasDeliverables) jq += 0.1
  if (facts.scope.bulletCount >= 2) jq += 0.05
  if (facts.title && facts.title.length >= 12) jq += 0.05
  if (facts.screeningQuestions.length > 0) jq += 0.05
  if (facts.scope.vague) jq -= 0.3
  if (facts.suspicious.length > 0) { jq = Math.min(jq, 0.15); watchOut.push(...facts.suspicious.map((s) => `Suspicious: ${s}`)) }
  push('jobQuality', 'Job quality', jq, facts.suspicious.length ? 'Suspicious signals cap job quality' : facts.scope.vague ? 'Vague post — under 40 words, no deliverables' : `${facts.scope.wordCount} words${facts.scope.hasDeliverables ? ', deliverables stated' : ''}`)

  // 2. Commercial value — what the engagement is worth, independent of us.
  let cv = 0.35
  let cvNote = 'No rate or budget stated'
  if (facts.rate.type === 'hourly') {
    const h = facts.rate.hourlyMax ?? facts.rate.hourlyMin ?? 0
    cv = h >= 60 ? 1 : h >= 40 ? 0.8 : h >= 25 ? 0.55 : h >= 15 ? 0.3 : 0.1
    const months = facts.duration.months
    const durF = months === null ? 0.85 : months >= 6 ? 1 : months >= 3 ? 0.92 : months >= 1 ? 0.82 : 0.65
    const hrsF = facts.weeklyHours.hours === null ? 0.92 : facts.weeklyHours.hours >= 30 ? 1 : 0.85
    cv = cv * durF * hrsF
    cvNote = `Hourly up to $${h}${months !== null ? `, ~${Math.round(months)} mo` : ''}${facts.weeklyHours.hours !== null ? `, ${facts.weeklyHours.hours} h/wk` : ''}`
    if (h >= 40) reasons.push(`Hourly rate up to $${h}`)
    if (h < 15) watchOut.push('Hourly rate under $15')
  } else if (facts.rate.type === 'fixed') {
    const b = facts.rate.fixedBudget ?? 0
    cv = b >= 10000 ? 1 : b >= 5000 ? 0.85 : b >= 2000 ? 0.65 : b >= 1000 ? 0.45 : b >= 500 ? 0.3 : 0.12
    cvNote = `Fixed budget $${b.toLocaleString()}`
    if (b >= 2000) reasons.push(`Fixed budget $${b.toLocaleString()}`)
    if (b < 500) watchOut.push('Fixed budget under $500')
  } else if (facts.rate.type === 'monthly') {
    const m = facts.rate.monthlyBudget ?? 0
    cv = m >= 8000 ? 1 : m >= 4000 ? 0.8 : m >= 2000 ? 0.6 : m >= 1000 ? 0.4 : 0.2
    cvNote = `Monthly retainer $${m.toLocaleString()}`
    if (m >= 2000) reasons.push(`Monthly retainer $${m.toLocaleString()}`)
  } else {
    watchOut.push('No rate or budget in the post')
  }
  push('commercialValue', 'Commercial value', cv, cvNote)

  // 3. Technical fit — do the required skills overlap what the org delivers?
  const required = facts.skills.map(norm)
  const overlap = required.filter((s) => caps.has(s) || [...caps].some((c) => c.length > 3 && (c.includes(s) || s.includes(c))))
  let tf: number
  let tfNote: string
  if (required.length === 0) { tf = facts.scope.hasTechSpecifics ? 0.5 : 0.4; tfNote = 'No skills named — fit unverified' }
  else { tf = 0.2 + 0.8 * (overlap.length / required.length); tfNote = overlap.length ? `Overlap: ${overlap.slice(0, 5).join(', ')} (${overlap.length}/${required.length})` : `None of ${required.slice(0, 4).join(', ')} is a core capability` }
  const offStack = required.filter((s) => ['data entry', 'video editing', 'copywriting', 'seo', 'unity', 'blockchain', 'salesforce'].includes(s))
  if (offStack.length && overlap.length === 0) { tf = Math.min(tf, 0.15); tfNote = `Off-stack work: ${offStack.join(', ')}` }
  if (overlap.length >= 2) reasons.push(`Stack match: ${overlap.slice(0, 4).join(', ')}`)
  if (required.length && overlap.length === 0) watchOut.push('Required skills do not match the core stack')
  push('technicalFit', 'Technical fit', tf, tfNote)

  // 4. Client quality — history on the platform. New ≠ bad; unverified payment is a real risk.
  const c = facts.client
  let cq = 0.35
  const bits: string[] = []
  if (c.paymentVerified === true) { cq += 0.2; bits.push('payment verified') }
  if (c.totalSpent !== null) { cq += c.totalSpent >= 50000 ? 0.25 : c.totalSpent >= 10000 ? 0.2 : c.totalSpent >= 1000 ? 0.12 : 0.05; bits.push(`$${Math.round(c.totalSpent).toLocaleString()} spent`) }
  if (c.hireRate !== null) { cq += c.hireRate >= 70 ? 0.12 : c.hireRate >= 40 ? 0.06 : -0.05; bits.push(`${c.hireRate}% hire rate`) }
  if (c.rating !== null) { cq += c.rating >= 4.8 ? 0.1 : c.rating >= 4.5 ? 0.05 : c.rating < 4 ? -0.1 : 0; bits.push(`${c.rating}★`) }
  if (c.avgHourlyPaid !== null && c.avgHourlyPaid >= 30) { cq += 0.05; bits.push(`pays ~$${c.avgHourlyPaid}/hr`) }
  if (c.paymentVerified === false) { cq = Math.min(cq, 0.3); watchOut.push('Payment method not verified') }
  if (c.paymentVerified === false && facts.rate.type === 'fixed' && (facts.rate.fixedBudget ?? 0) >= 20000) watchOut.push('Large budget from an unverified client — confirm before investing time')
  if (c.isNew && c.paymentVerified === null) watchOut.push('New client with no history')
  if (c.hireRate !== null && c.hireRate < 30 && (c.jobsPosted ?? 0) >= 5) watchOut.push(`Low hire rate (${c.hireRate}%) — posts often, hires rarely`)
  if (cq >= 0.75) reasons.push(`Established client: ${bits.slice(0, 3).join(', ')}`)
  push('clientQuality', 'Client quality', cq, bits.length ? bits.join(' · ') : c.isNew ? 'New client — unknown, not negative' : 'No client history in the paste')

  // 5. Competition — proposals already in.
  const p = facts.proposals
  let comp = 0.5
  let compNote = 'Proposal count unknown'
  if (p.count !== null) {
    const hi = p.range?.[1] ?? p.count
    comp = hi <= 5 ? 1 : hi <= 10 ? 0.8 : hi <= 15 ? 0.6 : hi <= 20 ? 0.45 : hi <= 50 ? 0.25 : 0.1
    compNote = `${p.evidence ?? `${p.count} proposals`}`
    if (hi <= 10) reasons.push(`Low competition (${p.evidence})`)
    if (hi > 20) watchOut.push(`Crowded (${p.evidence})`)
  }
  if (facts.connects !== null && facts.connects >= 16) comp -= 0.05
  push('competition', 'Competition', comp, compNote)

  // 6. Timing — when they want to start and how fresh the post is.
  let tm = 0.5
  const tmBits: string[] = []
  if (facts.start.urgency === 'asap') { tm = 0.9; tmBits.push(`starts ${facts.start.evidence}`) }
  else if (facts.start.urgency === 'soon') { tm = 0.75; tmBits.push(facts.start.evidence ?? 'starts soon') }
  else if (facts.start.urgency === 'scheduled') { tm = 0.65; tmBits.push(facts.start.evidence ?? 'scheduled start') }
  else if (facts.start.urgency === 'ongoing') { tm = 0.6; tmBits.push('ongoing') }
  if (facts.posted.hoursAgo !== null) {
    if (facts.posted.hoursAgo <= 24) { tm += 0.1; tmBits.push('posted today') }
    else if (facts.posted.hoursAgo > 24 * 7) { tm -= 0.2; tmBits.push(`posted ${Math.round(facts.posted.hoursAgo / 24)}d ago`) }
  }
  if (facts.suspicious.length && facts.start.urgency === 'asap') tm = 0.4
  push('timing', 'Timing', tm, tmBits.length ? tmBits.join(', ') : 'No start timing stated')

  // 7. Scope clarity — can we estimate it?
  let sc = 0.3
  if (facts.scope.hasDeliverables) sc += 0.25
  if (facts.scope.hasTechSpecifics) sc += 0.2
  if (facts.scope.hasTimeline) sc += 0.1
  if (facts.scope.wordCount >= 120) sc += 0.1
  if (facts.duration.label) sc += 0.05
  if (facts.scope.vague) sc = Math.min(sc, 0.2)
  push('scopeClarity', 'Scope clarity', sc, facts.scope.vague ? 'Too thin to estimate' : [facts.scope.hasDeliverables && 'deliverables', facts.scope.hasTechSpecifics && 'tech specifics', facts.scope.hasTimeline && 'timeline'].filter(Boolean).join(', ') || 'General description only')
  if (facts.scope.vague) watchOut.push('Scope is vague — ask clarifying questions before pricing')

  // 8. Proof match — does the org have shown work for this (any profile)?
  let pm = 0.4
  let pmNote = 'No org proof supplied — unverified'
  if (proofTags.size > 0) {
    const covered = required.filter((s) => proofTags.has(s) || [...proofTags].some((t) => t.includes(s) || s.includes(t)))
    pm = required.length ? 0.2 + 0.8 * (covered.length / required.length) : 0.5
    pmNote = covered.length ? `Proof covers ${covered.slice(0, 4).join(', ')}` : 'No proof item matches the required skills'
    if (covered.length >= 2) reasons.push(`Proof for ${covered.slice(0, 3).join(', ')}`)
  }
  push('proofMatch', 'Proof match', pm, pmNote)

  // 9. Evidence quality — how complete and parseable the paste is.
  const eq = 0.3 + 0.7 * (facts.completeness.score / 100)
  push('evidenceQuality', 'Evidence quality', eq, `${facts.completeness.score}% of job facts present${facts.completeness.missing.length ? ` — missing ${facts.completeness.missing.slice(0, 3).join(', ')}` : ''}`)
  if (facts.completeness.score < 50) watchOut.push('Paste is incomplete — include the client section and rate')

  let score = Math.round(dims.reduce((s, d) => s + d.contribution, 0))
  // Hard caps — a single disqualifying fact bounds the whole score, so a
  // strong client or low competition can never carry a $50 job to "apply".
  const hardCaps: Array<[boolean, number, string]> = [
    [facts.suspicious.length > 0, 34, 'suspicious signals'],
    [facts.rate.type === 'fixed' && (facts.rate.fixedBudget ?? 0) < 300, 40, 'fixed budget under $300'],
    [facts.rate.type === 'hourly' && (facts.rate.hourlyMax ?? 0) < 15, 40, 'hourly rate under $15'],
    [facts.rate.type === 'hourly' && (facts.rate.hourlyMax ?? 0) < 25, 60, 'hourly rate under $25'],
    [facts.rate.type === 'fixed' && (facts.rate.fixedBudget ?? 0) < 1000, 62, 'fixed budget under $1,000'],
    [facts.scope.vague, 45, 'vague scope'],
    [offStack.length > 0 && overlap.length === 0, 50, 'off-stack work'],
    [required.length > 0 && overlap.length === 0, 60, 'no stack overlap'],
    [c.paymentVerified === false, 60, 'payment not verified'],
    [c.hireRate !== null && c.hireRate < 20 && (c.jobsPosted ?? 0) >= 10, 60, 'very low hire rate'],
    [facts.posted.hoursAgo !== null && facts.posted.hoursAgo > 24 * 14, 65, 'posted over two weeks ago'],
    [facts.rate.type === 'unknown', 72, 'no rate or budget'],
    [(facts.proposals.range?.[0] ?? 0) >= 50, 65, '50+ proposals'],
  ]
  let capApplied: UpworkJobScore['cap'] = null
  for (const [cond, cap, why] of hardCaps) if (cond && score > cap) { score = cap; capApplied = { value: cap, reason: why }; if (!watchOut.some((w) => w.includes(why))) watchOut.push(`Capped at ${cap}: ${why}`) }
  score = Math.max(0, Math.min(100, score))
  const band = qualifyCanonicalScore(score)
  return {
    version: UPWORK_SCORING_VERSION,
    score,
    display: displayScoreForCanonical(score),
    qualification: band.qualification,
    verdict: verdictForQualification(band.qualification),
    dimensions: dims,
    reasons: [...new Set(reasons)].slice(0, 6),
    watchOut: [...new Set(watchOut)].slice(0, 8),
    suspicious: facts.suspicious,
    cap: capApplied,
    facts,
  }
}

export function scoreUpworkJob(input: UpworkScoreInput): UpworkJobScore {
  const facts = readUpworkJobFacts(input.rawText ?? [input.overrides?.title, input.overrides?.description].filter(Boolean).join('\n'))
  return scoreUpworkFacts(facts, input)
}

/**
 * Profile/sender match for a job — SEPARATE from the job score. Uses the
 * same deterministic routing engine as LinkedIn leads so one engine ranks
 * senders everywhere.
 */
export function matchProfilesToJob(facts: UpworkJobFacts, senders: SenderProfile[], currentSenderId?: string | null): RoutingResult {
  const title = (facts.title ?? '').toLowerCase().split(/[^a-z0-9.+#]+/).filter((t) => t.length > 2)
  const industries = detectIndustries(facts.descriptionText)
  return rankSendersForLead({
    capabilities: facts.skills,
    industries,
    buyerRequestProbability: 0.9,
    fitLevel: facts.skills.length ? 'STRONG' : 'MEDIUM',
    rawTerms: [...new Set([...facts.skills, ...industries, ...title])],
    platform: 'upwork',
  }, senders.filter((s) => !s.platform || s.platform === 'upwork'), currentSenderId)
}

const INDUSTRY_HINTS: Array<[string, RegExp]> = [
  ['fintech', /\b(?:fintech|payments?|banking|lending|trading|invoic)/i],
  ['healthcare', /\b(?:health|clinic|patient|medical|telehealth|hipaa)/i],
  ['ecommerce', /\b(?:e-?commerce|shopify|woocommerce|store|checkout|marketplace)/i],
  ['logistics', /\b(?:logistics|fleet|delivery|shipping|freight|warehouse)/i],
  ['real estate', /\b(?:real\s+estate|property|listing|mls)/i],
  ['education', /\b(?:edtech|course|learning\s+platform|students?)/i],
  ['saas', /\bsaas\b/i],
  ['legal', /\b(?:legal|law\s+firm|contracts?\b)/i],
  ['marketing', /\b(?:marketing|ads?\s+platform|seo|crm)/i],
]
export function detectIndustries(text: string): string[] {
  return INDUSTRY_HINTS.filter(([, re]) => re.test(text)).map(([k]) => k)
}
