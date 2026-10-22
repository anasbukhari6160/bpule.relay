/**
 * Research Router.
 *
 * Relay must not enrich every pasted profile — enrichment costs money and time,
 * and most profiles are not worth it. This module decides WHEN to research and
 * WHAT to look for, from the canonical axes only.
 *
 * It never fetches anything itself, and it never overwrites a source fact:
 * enrichment findings are stored separately with provenance, and the caller
 * reranks from facts + enrichment together.
 */

import type { OpportunityFeatures } from './opportunity-features'
import type { SalesThesis } from './sales-thesis'

export const RESEARCH_ROUTER_VERSION = 'research_router_v1'

export interface ResearchDecision {
  should: boolean
  reasons: string[]
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface ResearchTarget {
  kind: 'company_site' | 'product_page' | 'careers' | 'news' | 'tech_docs' | 'funding' | 'stack'
  why: string
  query: string
}

/** One enrichment finding. Kept out of the source facts. */
export interface ResearchFinding {
  kind: ResearchTarget['kind']
  fact: string
  /** Where it came from, always explicit — never folded into source facts. */
  provenance: { source: string; url: string | null; retrievedAt: string }
  confidence: number
}

/** Append-only enrichment store for one opportunity. */
export interface Enrichment {
  version: typeof RESEARCH_ROUTER_VERSION
  findings: ResearchFinding[]
}

export function emptyEnrichment(): Enrichment {
  return { version: RESEARCH_ROUTER_VERSION, findings: [] }
}

/**
 * Decide whether this opportunity is worth researching.
 *
 * Triggers: high account value, strong fit, high outsourcing propensity,
 * material V3/shadow disagreement, low confidence on a high-value account, or a
 * specific fact the sales thesis says it is missing.
 */
export function shouldResearch(input: {
  features: OpportunityFeatures
  thesis: SalesThesis | null
  v3Score: number | null
  shadowScores?: Array<number | null>
}): ResearchDecision {
  const reasons: string[] = []
  const f = input.features
  const av = f.accountValue

  // Account value, fit and outsourcing propensity are worth researching on
  // their own: they are the leads a rep would want enriched before working.
  const valuable =
    av.companyMaturity === 'ENTERPRISE'
    || av.companyMaturity === 'ESTABLISHED'
    || f.fit.level === 'STRONG'
    || f.fit.level === 'EXCEPTIONAL'
    || av.outsourcingPlausibility >= 0.6

  if (av.companyMaturity === 'ENTERPRISE' || av.companyMaturity === 'ESTABLISHED') {
    reasons.push(`High-value ${av.companyMaturity.toLowerCase()} account.`)
  }
  if (f.fit.level === 'STRONG' || f.fit.level === 'EXCEPTIONAL') {
    reasons.push('Strong capability fit — worth confirming the technical surface.')
  }
  if (av.outsourcingPlausibility >= 0.7) {
    reasons.push('High external-capacity propensity — a capacity hypothesis is worth testing.')
  }

  // Thin-evidence and disagreement triggers only matter when the account is
  // worth the research cost; enriching every low-value paste is waste.
  if (valuable) {
    if (f.evidenceQuality < 0.45) reasons.push('Low extraction confidence — research may fill the gaps.')
    if (f.fallbackUsed) reasons.push('Deterministic fallback was used — the source was not fully read.')
    if (input.thesis?.missingEvidence?.length) {
      reasons.push(`The thesis is missing: ${input.thesis.missingEvidence[0].toLowerCase()}`)
    }
  }

  const shadow = (input.shadowScores ?? []).filter((s): s is number => s !== null)
  if (input.v3Score !== null && shadow.length > 0) {
    const spread = Math.max(...shadow) - Math.min(...shadow)
    if (spread >= 20) reasons.push(`Candidate engines disagree by ${Math.round(spread)} points.`)
  }

  if (reasons.length === 0) return { should: false, reasons: [], priority: 'LOW' }
  const priority: ResearchDecision['priority'] =
    av.companyMaturity === 'ENTERPRISE' || f.fit.level === 'EXCEPTIONAL' || av.outsourcingPlausibility >= 0.8
      ? 'HIGH'
      : reasons.length >= 3 ? 'MEDIUM' : 'LOW'
  return { should: true, reasons, priority }
}

/** What to look for, given the decision. */
export function researchPlan(input: {
  features: OpportunityFeatures
  decision: ResearchDecision
  company: string | null
}): ResearchTarget[] {
  const f = input.features
  const company = input.company ?? 'the company'
  const targets: ResearchTarget[] = []

  if (input.decision.reasons.some((r) => /capability fit|technical surface/.test(r))) {
    targets.push({ kind: 'product_page', why: 'Confirm the product surface behind the fit.', query: `${company} product engineering team` })
    targets.push({ kind: 'tech_docs', why: 'Read the current stack for capability coverage.', query: `${company} engineering blog stack` })
  }
  if (input.decision.reasons.some((r) => /capacity propensity/.test(r))) {
    targets.push({ kind: 'careers', why: 'Team size and open roles indicate internal capacity.', query: `${company} careers engineering hiring` })
  }
  if (input.decision.reasons.some((r) => /High-value|enterprise/i.test(r))) {
    targets.push({ kind: 'company_site', why: 'Confirm scale, market and buying capacity.', query: `${company} about company` })
    targets.push({ kind: 'funding', why: 'Funding or revenue signals indicate budget capacity.', query: `${company} funding revenue` })
  }
  if (input.decision.reasons.some((r) => /disagree|confidence|fallback/.test(r))) {
    targets.push({ kind: 'news', why: 'Recent news may explain a change in circumstances.', query: `${company} news` })
  }

  return targets.slice(0, 4)
}

/**
 * Merge enrichment findings into the store. Append-only: source facts are never
 * touched, and each finding keeps its provenance.
 */
export function mergeEnrichment(
  enrichment: Enrichment,
  findings: ResearchFinding[],
): Enrichment {
  const seen = new Set(enrichment.findings.map((x) => `${x.kind}|${x.fact}`))
  const added = findings.filter((x) => !seen.has(`${x.kind}|${x.fact}`))
  return { version: RESEARCH_ROUTER_VERSION, findings: [...enrichment.findings, ...added] }
}

/** Facts the enrichment store contributes to a rerank, with provenance attached. */
export function enrichmentFacts(enrichment: Enrichment): Array<{ fact: string; provenance: ResearchFinding['provenance']; confidence: number }> {
  return enrichment.findings.map((x) => ({ fact: x.fact, provenance: x.provenance, confidence: x.confidence }))
}
