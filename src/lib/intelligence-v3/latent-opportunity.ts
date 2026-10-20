/**
 * Commercial Potential — compatibility surface.
 *
 * The assessment itself lives in ./dimensions (assessCommercialPotentialFromFacts)
 * and reads SourceFacts. This module keeps the old entry point for callers
 * and tests that pass a V2 canonical + raw text; it no longer scans text on
 * its own, applies no floors, and no longer replaces the score.
 */

import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import type { CommercialPotentialAssessment } from './types'
import { readSourceFacts } from './source-facts-model'
import { resolveBuyerIntentFromSource } from './buyer-intent'
import { assessCommercialPotentialFromFacts } from './dimensions'

export type LatentPotentialLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export async function assessCommercialPotential(
  v2Canonical: CanonicalProspectIntelligence,
  rawText?: string,
): Promise<CommercialPotentialAssessment> {
  const text = rawText || buildTextSource(v2Canonical.intelligence)
  const affiliations = (v2Canonical.intelligence.person.affiliations ?? []) as Array<{ organizationName?: string; role?: string | null; isCurrent?: boolean }>
  const facts = readSourceFacts(text, {
    identity: {
      name: v2Canonical.intelligence.person.fullName,
      title: v2Canonical.intelligence.person.title,
      company: v2Canonical.intelligence.company.name,
      location: v2Canonical.intelligence.person.location,
    },
    currentOrganizations: affiliations.filter((a) => a.isCurrent !== false).map((a) => a.organizationName ?? '').filter(Boolean),
    affiliationRoles: affiliations.filter((a) => a.isCurrent !== false).map((a) => a.role ?? '').filter(Boolean),
  })
  const intent = resolveBuyerIntentFromSource(text)
  const cp = assessCommercialPotentialFromFacts(facts, intent)
  return {
    decisionAuthority: cp.decisionAuthority,
    buildIntensity: cp.buildIntensity,
    technicalRelevance: cp.technicalRelevance,
    capacityNeedLikelihood: cp.capacityNeedLikelihood,
    reachability: cp.reachability,
    companyMaturity: cp.companyMaturity,
    commercialActivity: cp.commercialActivity,
    overallPotential: cp.overallPotential,
    confidence: cp.confidence,
    signals: cp.signals,
  }
}

function buildTextSource(intel: CanonicalProspectIntelligence['intelligence']): string {
  const parts: string[] = []
  if (intel.person.fullName) parts.push(intel.person.fullName)
  if (intel.person.title) parts.push(intel.person.title)
  if (intel.company.name) parts.push(`${intel.person.title ?? ''} at ${intel.company.name}`)
  if (intel.company.product) parts.push(intel.company.product)
  parts.push(...(intel.content.topics || []))
  parts.push(...(intel.content.technicalSignals || []))
  parts.push(...(intel.content.initiatives || []))
  parts.push(...(intel.content.launches || []))
  return parts.join('\n')
}
