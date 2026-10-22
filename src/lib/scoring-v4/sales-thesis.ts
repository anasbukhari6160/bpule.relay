/**
 * Sales Thesis Engine.
 *
 * Turns verified opportunity facts + the four commercial axes into a
 * commercially useful hypothesis about why this account matters and how to
 * approach it. It runs BEFORE message generation: the message layer receives
 * this thesis, never the raw profile.
 *
 * Two rules hold throughout:
 *   1. Every statement about a *possible* problem or risk is an explicit
 *      hypothesis ("potential", "possible", "unconfirmed"). Nothing inferred is
 *      ever stated as fact.
 *   2. Nothing is invented. No budget, pain, hiring plan or technical debt is
 *      asserted unless the source facts carry it.
 */

import type { SourceFactsSummary } from '@/lib/intelligence-v3/source-facts-model'
import type { OpportunityFeatures } from './opportunity-features'
import type { CapabilityFamily } from './capability-taxonomy'

export const SALES_THESIS_VERSION = 'sales_thesis_v1'

/** Verified proof only. Test/demo/unverified proof never reaches a thesis. */
export interface SalesProof {
  capability: string
  title: string
  strength: 'strong' | 'verified'
}

export interface SalesThesisInput {
  features: OpportunityFeatures
  facts: SourceFactsSummary
  orgCapabilityFamilies?: readonly CapabilityFamily[]
  /** Verified proof the org can point at. Optional; never fabricated. */
  proof?: SalesProof[]
}

export interface SalesThesis {
  version: typeof SALES_THESIS_VERSION
  /** Verified reasons this account matters commercially. */
  whyThisAccount: string[]
  /** Plausible problems — every entry is an explicit hypothesis. */
  likelyProblems: string[]
  /** Plausible capacity risks — every entry is an explicit hypothesis. */
  likelyCapacityRisks: string[]
  /** What we can credibly do, from verified capability overlap only. */
  whyWeCanHelp: string[]
  relevantCapabilities: string[]
  relevantProof: string[]
  outreachRisks: string[]
  missingEvidence: string[]
  recommendedEntryPoint: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

const FAMILY_LABELS: Record<CapabilityFamily, string> = {
  web_frontend: 'web frontend',
  backend_api: 'backend & APIs',
  fullstack_product: 'full-stack product delivery',
  mobile: 'mobile apps',
  ai_ml: 'AI / ML',
  data_engineering: 'data engineering',
  cloud_devops: 'cloud & DevOps',
  payments_fintech: 'payments & fintech',
  ecommerce: 'ecommerce',
  cms_marketing_sites: 'CMS & marketing sites',
  security_compliance: 'security & compliance',
  integration_automation: 'integrations & automation',
  web3: 'web3',
  design_ux: 'design & UX',
  qa_testing: 'QA & testing',
  enterprise_java_dotnet: 'enterprise Java / .NET',
  php_laravel: 'PHP / Laravel',
  ruby_rails: 'Ruby / Rails',
  python_backend: 'Python backend',
  go_rust_systems: 'Go / Rust systems',
}

const MATURITY_LABELS: Record<OpportunityFeatures['accountValue']['companyMaturity'], string> = {
  ENTERPRISE: 'enterprise-scale',
  ESTABLISHED: 'established',
  GROWING: 'growth-stage',
  EARLY: 'early-stage',
  PRE_PRODUCT: 'pre-product',
  UNKNOWN: 'unknown-stage',
}

function isTechnicalAuthority(level: OpportunityFeatures['authority']['level']): boolean {
  return level === 'FOUNDER' || level === 'EXECUTIVE' || level === 'VP_HEAD' || level === 'DIRECTOR' || level === 'SENIOR_IC' || level === 'MANAGER'
}

/**
 * Build the sales thesis for an opportunity.
 *
 * Deterministic. Reads only `features` (the canonical four axes) and `facts`
 * (the canonical reader's output). Never touches raw source text.
 */
export function buildSalesThesis(input: SalesThesisInput): SalesThesis {
  const { features } = input
  const av = features.accountValue
  const whyThisAccount: string[] = []
  const likelyProblems: string[] = []
  const likelyCapacityRisks: string[] = []
  const whyWeCanHelp: string[] = []
  const outreachRisks: string[] = []
  const missingEvidence: string[] = []

  // ── Why this account (verified facts only) ─────────────────────────────
  if (features.founderOrBuilder) {
    whyThisAccount.push(`${features.authority.level === 'FOUNDER' ? 'Founder' : 'Technical leader'} with decision authority over the current organisation.`)
  } else if (isTechnicalAuthority(features.authority.level)) {
    whyThisAccount.push(`${features.authority.level} role with ${features.authority.decisionAuthority >= 0.7 ? 'high' : 'some'} decision authority.`)
  }
  if (av.companyMaturity !== 'UNKNOWN') whyThisAccount.push(`${MATURITY_LABELS[av.companyMaturity]} account.`)
  if (av.buildIntensity === 'HIGH' || av.buildIntensity === 'VERY_HIGH') whyThisAccount.push('Actively building.')
  if (av.technicalComplexity === 'HIGH') whyThisAccount.push('Broad technical surface.')
  if (av.fundingSignal) whyThisAccount.push('Verified funding signal.')
  if (av.growthSignals > 0) whyThisAccount.push('Growth signals present in the current organisation.')
  if (av.currentProductActivity) whyThisAccount.push('Current product activity.')
  if (av.hiringCurrent && av.hiringCount > 0) whyThisAccount.push(`Currently hiring (${av.hiringCount}+ roles).`)

  // ── Plausible problems (hypotheses only) ───────────────────────────────
  if ((av.buildIntensity === 'HIGH' || av.buildIntensity === 'VERY_HIGH') && av.technicalComplexity === 'HIGH') {
    likelyProblems.push('Potential capacity pressure at the current build tempo.')
  }
  if (av.outsourcingPlausibility >= 0.6 && !features.intent.verifiedRequest) {
    likelyProblems.push('A possible need for external delivery capacity, unconfirmed.')
  }
  if (av.hiringUrgent && !features.intent.verifiedRequest) {
    likelyProblems.push('Possible pressure to staff up quickly, unconfirmed.')
  }

  // ── Plausible capacity risks (hypotheses only) ─────────────────────────
  if (av.technicalComplexity === 'HIGH' && av.buildIntensity === 'VERY_HIGH') {
    likelyCapacityRisks.push('Delivery risk if the internal team is smaller than the product surface.')
  }
  if (av.hiringCurrent && av.hiringCount >= 3 && av.technicalComplexity === 'HIGH') {
    likelyCapacityRisks.push('Possible ramp risk while new engineering hires come up to speed.')
  }

  // ── Why we can help (verified capability overlap) ─────────────────────
  const relevantCapabilities = features.fit.orgMatched.map((f) => FAMILY_LABELS[f])
  for (const family of features.fit.needs) {
    const label = FAMILY_LABELS[family]
    if (features.fit.orgMatched.includes(family)) {
      whyWeCanHelp.push(`We can deliver ${label} — named in the source and covered by our capability set.`)
    } else {
      missingEvidence.push(`Whether we can take on ${label} work.`)
    }
  }
  if (features.fit.level === 'STRONG' || features.fit.level === 'EXCEPTIONAL') {
    whyWeCanHelp.push('Strong capability overlap with the opportunity.')
  } else if (features.fit.level === 'GOOD') {
    whyWeCanHelp.push('Relevant capability overlap.')
  }

  // ── Verified proof only ───────────────────────────────────────────────
  const relevantProof = (input.proof ?? [])
    .filter((p) => p.strength === 'strong' || p.strength === 'verified')
    .map((p) => `${p.title} (${p.capability})`)
    .slice(0, 3)

  // ── Outreach risks (verified safety) ──────────────────────────────────
  const supply = features.supply
  if (supply.softwareServicesSeller || supply.sellerActivity) {
    outreachRisks.push('Supply-side account: partnership or referral only — do not pitch services.')
  }
  if (supply.recruiterProfile) outreachRisks.push('Recruiter: hiring for clients, not buying services.')
  if (supply.candidateSeeking) outreachRisks.push('Candidate seeking work: not a buyer.')
  if (features.episodeClosed) outreachRisks.push('Closed or negated episode: do not contact.')
  if (features.fallbackUsed) outreachRisks.push('Extraction incomplete (deterministic fallback): verify before outreach.')
  if (features.access.level === 'NONE' || features.access.level === 'INDIRECT') {
    outreachRisks.push('No reliable direct contact route.')
  }

  // ── Missing evidence ──────────────────────────────────────────────────
  if (!features.intent.verifiedRequest) missingEvidence.push('Whether they currently use external engineering capacity.')
  if (!features.intent.verifiedBudget) missingEvidence.push('Budget authority for external work.')
  if (features.access.level !== 'DIRECT') missingEvidence.push('A direct contact route.')
  if (features.sourceCompleteness < 60) missingEvidence.push('A more complete profile.')
  if (features.contradictions > 0) missingEvidence.push('Resolution of contradictory buyer signals.')

  // ── Recommended entry point ───────────────────────────────────────────
  const recommendedEntryPoint = recommendEntryPoint(features)

  // ── Confidence ────────────────────────────────────────────────────────
  let confidence: SalesThesis['confidence'] = 'MEDIUM'
  if (features.fallbackUsed || features.contradictions > 0 || features.evidenceQuality < 0.4) confidence = 'LOW'
  else if (features.evidenceQuality >= 0.7 && features.contradictions === 0) confidence = 'HIGH'

  return {
    version: SALES_THESIS_VERSION,
    whyThisAccount,
    likelyProblems,
    likelyCapacityRisks,
    whyWeCanHelp,
    relevantCapabilities,
    relevantProof,
    outreachRisks,
    missingEvidence,
    recommendedEntryPoint,
    confidence,
  }
}

function recommendEntryPoint(features: OpportunityFeatures): string {
  const supply = features.supply
  if (features.episodeClosed) return 'Do not contact.'
  if (supply.softwareServicesSeller || supply.sellerActivity) return 'Partnership or referral only — no service pitch.'
  if (supply.recruiterProfile) return 'Hiring/channel conversation — do not pitch services.'
  if (supply.candidateSeeking) return 'Candidate/channel conversation — do not pitch services.'
  if (features.intent.verifiedRequest) return 'Answer the stated need directly.'
  if (features.founderOrBuilder && (features.fit.level === 'STRONG' || features.fit.level === 'EXCEPTIONAL')) {
    return 'Technical peer conversation about the product and delivery surface.'
  }
  if (features.accountValue.outsourcingPlausibility >= 0.6 && features.accountValue.companyMaturity !== 'UNKNOWN') {
    return 'Research first, then a capacity hypothesis — no buying-intent claim.'
  }
  if (features.access.level === 'NONE' || features.access.level === 'INDIRECT') {
    return 'Research or observe — no reliable contact route yet.'
  }
  return 'Low-pressure observation, no pitch.'
}
