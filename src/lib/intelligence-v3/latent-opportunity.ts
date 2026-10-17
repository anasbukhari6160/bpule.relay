/**
 * Commercial Potential Assessment — V3
 *
 * Separates CURRENT BUYER INTENT from COMMERCIAL POTENTIAL.
 *
 * A lead can have buyerIntent=UNKNOWN while commercialPotential=HIGH.
 * This layer answers: "Even without an explicit current request, is this
 * person/company strategically worth pursuing?"
 *
 * Key dimensions:
 * - Decision authority (founder/CEO/CTO vs IC)
 * - Build intensity (NONE/LOW/MEDIUM/HIGH/VERY_HIGH)
 * - Technical relevance (stack overlap with our services)
 * - Capacity need likelihood (will they need external help)
 * - Reachability
 * - Company maturity (funding, growth, team)
 */

import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import type { CommercialPotentialAssessment, BuildIntensity, CommercialPotentialLevel } from './types'

export type LatentPotentialLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface LatentOpportunityAssessment {
  capabilityFit: number
  buyerRoleLikelihood: number
  decisionInfluence: number
  companyBuildIntensity: number
  technicalRelevance: number
  likelyExternalCapacityNeed: number
  reachability: number
  relationshipPotential: number
  overallPotential: LatentPotentialLevel
  confidence: number
  signals: string[]
}

/**
 * Assess commercial potential using V2 extraction data + raw text.
 * Deterministic — no AI calls.
 */
export async function assessLatentOpportunity(
  v2Canonical: CanonicalProspectIntelligence,
  rawText?: string,
): Promise<LatentOpportunityAssessment> {
  const cp = await assessCommercialPotential(v2Canonical, rawText)
  return {
    capabilityFit: cp.technicalRelevance,
    buyerRoleLikelihood: cp.decisionAuthority,
    decisionInfluence: cp.decisionAuthority,
    companyBuildIntensity: buildIntensityToScore(cp.buildIntensity),
    technicalRelevance: cp.technicalRelevance,
    likelyExternalCapacityNeed: cp.capacityNeedLikelihood,
    reachability: cp.reachability,
    relationshipPotential: cp.companyMaturity,
    overallPotential: cp.overallPotential,
    confidence: cp.confidence,
    signals: cp.signals,
  }
}

/**
 * Primary commercial potential assessment.
 * Uses V2 extraction data + raw text to evaluate strategic worth.
 */
export async function assessCommercialPotential(
  v2Canonical: CanonicalProspectIntelligence,
  rawText?: string,
): Promise<CommercialPotentialAssessment> {
  const intel = v2Canonical.intelligence
  const textSource = (rawText || buildTextSource(intel)).toLowerCase()

  const decisionAuthority = evaluateDecisionAuthority(intel, textSource)
  const buildIntensity = evaluateBuildIntensity(intel, textSource)
  const technicalRelevance = evaluateTechnicalRelevance(intel, textSource)
  const capacityNeedLikelihood = evaluateCapacityNeed(intel, textSource)
  const reachability = evaluateReachability(intel)
  const companyMaturity = evaluateCompanyMaturity(intel, textSource)

  const commercialActivity = evaluateCommercialActivity(intel, textSource)

  // Collect human-readable signals
  const signals: string[] = []
  if (decisionAuthority >= 0.7) signals.push('Decision-maker role')
  if (buildIntensity !== 'NONE' && buildIntensity !== 'LOW') signals.push(`Active building (${buildIntensity})`)
  if (technicalRelevance >= 0.4) signals.push('Technical stack overlap')
  if (capacityNeedLikelihood >= 0.4) signals.push('Likely needs external help')
  if (reachability >= 0.5) signals.push('Reachable')
  if (companyMaturity >= 0.4) signals.push('Company growth signals')
  if (commercialActivity >= 0.3) signals.push('Active commercial activity')

  // Overall potential requires multiple independent dimensions
  const dimAvg = (
    decisionAuthority +
    buildIntensityToScore(buildIntensity) +
    technicalRelevance +
    capacityNeedLikelihood +
    reachability +
    companyMaturity
  ) / 6

  let overallPotential: CommercialPotentialLevel = 'LOW'
  if (dimAvg >= 0.45 || (decisionAuthority >= 0.7 && buildIntensityToScore(buildIntensity) >= 0.5 && technicalRelevance >= 0.3)) {
    overallPotential = 'HIGH'
  } else if (dimAvg >= 0.28 || (decisionAuthority >= 0.5 && buildIntensityToScore(buildIntensity) >= 0.3)) {
    overallPotential = 'MEDIUM'
  }

  const confidence = Math.min(1, signals.length / 4)

  return {
    decisionAuthority,
    buildIntensity,
    technicalRelevance,
    capacityNeedLikelihood,
    reachability,
    companyMaturity,
    commercialActivity,
    overallPotential,
    confidence,
    signals,
  }
}


function evaluateDecisionAuthority(intel: CanonicalProspectIntelligence['intelligence'], text: string): number {
  const title = (intel.person.title || '').toLowerCase()
  const seniority = (intel.person.seniority || '').toLowerCase()

  // C-level / founders — ultimate authority
  if (/\b(ceo|founder|co-founder|coowner|owner|president)\b/.test(title)) return 0.9
  if (/\b(cto|cfo|coo|chief)\b/.test(title)) return 0.85
  // VP / Head — high authority
  if (/\b(vp|vice president|head of)\b/.test(title)) return 0.75
  // Director — significant authority
  if (/\b(director)\b/.test(title)) return 0.65
  // Senior IC / lead — moderate influence
  if (/\b(lead|principal|staff|senior|sr\.)\b/.test(title) || seniority.includes('senior')) return 0.45
  // Manager
  if (/\b(manager)\b/.test(title)) return 0.5

  // Affiliations: a founder/CEO role at any affiliation boosts authority
  const affiliations = intel.person.affiliations || []
  const affiliationText = affiliations.map(a => `${a.role || ''} ${a.organizationName || ''}`).join(' ').toLowerCase()
  if (/\b(ceo|founder|co-founder|coowner|owner|president)\b/.test(affiliationText)) return 0.7
  if (/\b(cto|cfo|chief)\b/.test(affiliationText)) return 0.6
  if (/\b(vp|vice president|director|head of)\b/.test(affiliationText)) return 0.5
  // Multiple affiliations = multiple ventures = higher authority than IC
  if (affiliations.length >= 3) return 0.4
  if (affiliations.length >= 2) return 0.35

  // Text-based signals
  if (/\b(ceo|founder|co-founder)\b/.test(text)) return 0.8
  if (/\b(cto|cfo|chief)\b/.test(text)) return 0.7
  if (/\b(vp|vice president|director)\b/.test(text)) return 0.6

  return 0.2
}

function evaluateBuildIntensity(intel: CanonicalProspectIntelligence['intelligence'], text: string): BuildIntensity {
  let score = 0

  // Structured data signals
  const launches = intel.content.launches || []
  const initiatives = intel.content.initiatives || []
  if (launches.length > 0) score += 2
  if (initiatives.length > 0) score += 1

  const hasProduct = intel.company.product && intel.company.product !== 'Unknown'
  if (hasProduct) score += 1

  const stage = (intel.company.stage || '').toLowerCase()
  if (stage.includes('seed') || stage.includes('series') || stage.includes('growth')) score += 2
  if (stage.includes('mvp') || stage.includes('beta') || stage.includes('early')) score += 1

  // Text-based building signals (semantic, not keyword regex)
  const buildPatterns = [
    /\b(launch|launched|releasing|introducing)\b/,
    /\b(mvp|beta|prototype|pilot)\b/,
    /\b(building|developing|creating|founding)\b/,
    /\b(new product|new platform|new company|new venture)\b/,
    /\b(growing|scaling|expanding)\b/,
    /\b(pricing|waitlist|early access|show hn|product hunt)\b/,
    /\b(funding|raised|seed|series|investment)\b/,
  ]
  for (const p of buildPatterns) {
    if (p.test(text)) score += 1
  }

  // Number of affiliations (multiple companies = higher build)
  const affiliations = intel.person.affiliations || []
  if (affiliations.length >= 3) score += 2
  else if (affiliations.length >= 2) score += 1

  // Multiple product mentions
  const productMentions = (text.match(/\b(product|platform|saas|app|application|tool)\b/gi) || []).length
  if (productMentions >= 3) score += 2
  else if (productMentions >= 1) score += 1

  if (score >= 8) return 'VERY_HIGH'
  if (score >= 5) return 'HIGH'
  if (score >= 3) return 'MEDIUM'
  if (score >= 1) return 'LOW'
  return 'NONE'
}

function evaluateTechnicalRelevance(intel: CanonicalProspectIntelligence['intelligence'], text: string): number {
  const techSignals = intel.content.technicalSignals || []
  const topics = intel.content.topics || []

  const relevant = ['react', 'node', 'next.js', 'typescript', 'python', 'api', 'saas', 'ai', 'automation', 'aws', 'cloud', 'javascript', 'java', '.net', 'postgresql', 'mongodb', 'docker']
  let matchCount = [...techSignals, ...topics].filter(t =>
    relevant.some(r => t.toLowerCase().includes(r))
  ).length

  const textTech = ['javascript', 'typescript', 'react', 'node', 'python', '.net', 'java', 'azure', 'aws', 'api', 'postgresql', 'mongodb', 'docker', 'kubernetes', 'nextjs', 'vue', 'angular']
  const textMatches = textTech.filter(t => text.includes(t)).length
  matchCount = Math.max(matchCount, textMatches)

  return Math.min(1, matchCount / 4)
}

function evaluateCapacityNeed(intel: CanonicalProspectIntelligence['intelligence'], text: string): number {
  const companySize = (intel.company.size || '').toLowerCase()
  const stage = (intel.company.stage || '').toLowerCase()

  // Small companies and early-stage startups are most likely to need outside help
  if (companySize.includes('self-employed') || companySize.includes('1-10') || companySize.includes('small')) return 0.7
  if (companySize.includes('11-50')) return 0.5
  if (stage.includes('mvp') || stage.includes('beta') || stage.includes('early')) return 0.6
  if (stage.includes('seed') || stage.includes('series a')) return 0.5

  // Text signals: solo founder, small team
  if (/\b(solo|just me|small team|lean team|one person)\b/.test(text)) return 0.7
  if (/\b(bootstrapped|self-funded|pre-revenue)\b/.test(text)) return 0.6

  return 0.2
}

function evaluateReachability(intel: CanonicalProspectIntelligence['intelligence']): number {
  let score = 0.3 // base: they're on LinkedIn

  if (intel.person.linkedinUrl) score += 0.3
  if (intel.person.otherUrls && intel.person.otherUrls.length > 0) score += 0.2

  const posts = intel.content.recentPosts || []
  if (posts.length > 0) score += 0.2

  return Math.min(1, score)
}

function evaluateCompanyMaturity(intel: CanonicalProspectIntelligence['intelligence'], text: string): number {
  const stage = (intel.company.stage || '').toLowerCase()
  const size = (intel.company.size || '').toLowerCase()

  let score = 0.1

  if (stage.includes('seed') || stage.includes('series')) score += 0.4
  if (stage.includes('mvp') || stage.includes('beta')) score += 0.3
  if (stage.includes('growth')) score += 0.5

  if (size.includes('11-50') || size.includes('51-200')) score += 0.2
  if (size.includes('201-500') || size.includes('500+')) score += 0.3

  // Funding mention in text
  if (/\b(raised|funding|series [abc]|seed|angel|venture)\b/.test(text)) score += 0.3

  return Math.min(1, score)
}

function evaluateCommercialActivity(intel: CanonicalProspectIntelligence['intelligence'], text: string): number {
  let count = 0

  if ((intel.content.launches || []).length > 0) count++
  if ((intel.content.initiatives || []).length > 0) count++
  if ((intel.content.hiringSignals || []).length > 0) count++
  if (/\b(launch|launching|released|announcing)\b/.test(text)) count++
  if (/\b(growing|scaling|expanding|hiring)\b/.test(text)) count++
  if (/\b(funding|raised|investment|backed)\b/.test(text)) count++
  if (/\b(new (product|company|platform|venture))\b/.test(text)) count++

  return Math.min(1, count / 5)
}


function buildIntensityToScore(bi: BuildIntensity): number {
  switch (bi) {
    case 'NONE': return 0
    case 'LOW': return 0.2
    case 'MEDIUM': return 0.5
    case 'HIGH': return 0.8
    case 'VERY_HIGH': return 1.0
    default: return 0
  }
}


export function computeLatentScore(assessment: LatentOpportunityAssessment): number {
  const baseScore = (
    assessment.capabilityFit * 20 +
    assessment.buyerRoleLikelihood * 15 +
    assessment.decisionInfluence * 15 +
    assessment.companyBuildIntensity * 15 +
    assessment.technicalRelevance * 15 +
    assessment.likelyExternalCapacityNeed * 10 +
    assessment.reachability * 5 +
    assessment.relationshipPotential * 5
  )

  switch (assessment.overallPotential) {
    case 'HIGH': return Math.min(70, Math.max(40, Math.round(baseScore)))
    case 'MEDIUM': return Math.min(50, Math.max(25, Math.round(baseScore * 0.8)))
    case 'LOW': return Math.min(20, Math.round(baseScore * 0.4))
    default: return 0
  }
}

export function latentActionFromPotential(
  potential: LatentPotentialLevel,
  confidence: number,
): { action: string; messageEligible: boolean } {
  if (potential === 'HIGH' && confidence > 0.3) {
    return { action: 'CONNECT_WITH_NOTE', messageEligible: true }
  }
  if (potential === 'HIGH') {
    return { action: 'CONNECT_WITHOUT_NOTE', messageEligible: false }
  }
  if (potential === 'MEDIUM' && confidence > 0.3) {
    return { action: 'OBSERVE', messageEligible: false }
  }
  return { action: 'SKIP', messageEligible: false }
}


function isProductCompany(intel: CanonicalProspectIntelligence['intelligence']): boolean {
  const stage = (intel.company.stage || '').toLowerCase()
  const size = (intel.company.size || '').toLowerCase()
  const product = (intel.company.product || '').toLowerCase()

  if (stage.includes('seed') || stage.includes('series') || stage.includes('growth')) return true
  if (product.includes('saas') || product.includes('platform') || product.includes('product')) return true
  if (size.includes('self-employed') || size.includes('1-10') || size.includes('11-50')) return true

  const expText = JSON.stringify(intel.person.affiliations || []).toLowerCase()
  if (expText.includes('building') || expText.includes('founding') || expText.includes('product') || expText.includes('saas')) return true

  return false
}

function buildTextSource(intel: CanonicalProspectIntelligence['intelligence']): string {
  const parts: string[] = []
  if (intel.person.title) parts.push(intel.person.title)
  if (intel.company.name) parts.push(intel.company.name)
  if (intel.company.product) parts.push(intel.company.product)
  parts.push(...(intel.content.topics || []))
  parts.push(...(intel.content.technicalSignals || []))
  parts.push(...(intel.content.initiatives || []))
  parts.push(...(intel.content.launches || []))
  return parts.join(' ').toLowerCase()
}

function scanTextForSignals(text: string): string[] {
  const signals: string[] = []
  if (!text) return signals

  if (/\b(saas|platform|product|app|application)\b/.test(text)) {
    signals.push('Building product/platform')
  }

  const techKeywords = ['react', 'node', 'typescript', 'next.js', 'python', 'azure', 'aws', 'api', 'frontend', 'backend', 'fullstack', 'full-stack', 'javascript', 'csharp', 'c#', 'cosmos', 'postgresql', 'mongodb', 'docker', 'kubernetes']
  const techMatches = techKeywords.filter(t => text.includes(t))
  if (techMatches.length >= 3) {
    signals.push('Strong technical stack')
  }

  if (/\b(building|developing|growing|scaling|launching|started|founded|creating)\b/.test(text)) {
    signals.push('Active development')
  }

  if (/\b(self-employed|solo|freelance|small team|just me|1-10|personal project)\b/.test(text)) {
    signals.push('Small team — likely needs help')
  }

  if (/\b(developer|engineer|architect|technical lead|cto|founder|co-founder)\b/.test(text)) {
    const productSignals = ['saas', 'platform', 'product', 'startup', 'building', 'growing']
    if (productSignals.some(p => text.includes(p))) {
      signals.push('Technical role at product company')
    }
  }

  return signals
}
