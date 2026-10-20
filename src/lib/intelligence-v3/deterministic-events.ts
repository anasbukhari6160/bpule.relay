/**
 * Deterministic event extraction from SourceFacts.
 *
 * Two jobs:
 *  1. Fallback when the structured event-extraction model is unavailable,
 *     times out or returns nothing: the verified facts still become events,
 *     so an explicit "we are looking for an agency" is never lost because an
 *     API call failed (Phase 35 — fallback preserves facts).
 *  2. The offline harness for the golden set, so 200+ fixtures run with no
 *     network and no model variance.
 *
 * Only verified, prospect-owned, current facts become events. Seller lines
 * become SERVICE_OFFERING, candidate lines JOB_SEEKING; neither is a buyer
 * event. Temporal class comes from the nearest LinkedIn relative-age marker.
 */

import type { ExtractedEvent } from './event-extractor'
import { postAgeDaysForLine, type SourceFacts } from './source-facts-model'

const AGENCY_WORDS = /\b(?:agenc(?:y|ies)|outsourc\w*|dev(?:elopment)?\s+shop|software\s+(?:house|partner|firm)|development\s+partner|vendor|consultanc(?:y|ies)|agentur|agence|agencia|ajans)\b/i
const FREELANCE_WORDS = /\b(?:freelanc\w*|contractor|independent\s+developer|part-time\s+developer)\b/i
const VENDOR_EVAL = /\b(?:rfp|request\s+for\s+proposals?|vendor\s+(?:evaluation|shortlist|selection)|evaluating\s+(?:vendors|agencies|partners))\b/i
const CONTACT_LINE = /\b(?:dm\s+me|message\s+me|email\s+(?:me|us)|reach\s+out|contact\s+(?:me|us)|send\s+(?:me|us)\s+(?:a\s+)?(?:proposal|quote|message|portfolio)|apply\s+(?:here|now|at|via)|[\w.+-]+@[\w-]+\.[a-z]{2,})\b/i

const ageDaysForLine = postAgeDaysForLine

function applyInstructions(rawText: string, near: string | null): { instructions: string[]; channels: string[] } {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
  const idx = near ? lines.indexOf(near) : -1
  const window = idx >= 0 ? lines.slice(idx, idx + 4) : lines
  const instructions = window.filter((l) => CONTACT_LINE.test(l)).slice(0, 2)
  const channels = new Set<string>()
  for (const l of instructions) {
    if (/@[\w-]+\.[a-z]{2,}|\bemail\b/i.test(l)) channels.add('EMAIL')
    if (/\bdm\b|\bmessage\b/i.test(l)) channels.add('DM')
    if (/\bapply\b|https?:\/\//i.test(l)) channels.add('APPLICATION_LINK')
  }
  if (instructions.length > 0 && channels.size === 0) channels.add('LINKEDIN')
  return { instructions, channels: [...channels] }
}

export function extractEventsDeterministically(rawText: string, facts: SourceFacts): ExtractedEvent[] {
  const org = facts.currentCompany ?? 'UNKNOWN'
  const events: ExtractedEvent[] = []

  if (facts.buyerRequest) {
    const line = facts.buyerRequest
    const type: ExtractedEvent['eventType'] = VENDOR_EVAL.test(line) ? 'VENDOR_EVALUATION' : AGENCY_WORDS.test(line) ? 'AGENCY_REQUEST' : FREELANCE_WORDS.test(line) ? 'FREELANCE_REQUEST' : 'PROJECT_REQUEST'
    const apply = applyInstructions(rawText, line)
    events.push({
      eventType: type,
      organizationName: org,
      organizationEvidence: facts.currentIndustryLine ?? line,
      requestedCapabilities: facts.capabilityNeeds,
      requestedAssets: /\bportfolio|examples?\s+of\s+(?:similar\s+)?work|case\s+stud/i.test(line) ? ['portfolio'] : [],
      applicationChannels: apply.channels,
      applyInstructions: apply.instructions,
      explicitness: 'EXPLICIT',
      needOwner: 'ORGANIZATION_NEED',
      evidenceQuote: line,
      confidence: 0.85,
      ageDays: ageDaysForLine(rawText, line),
    })
  }

  if (facts.currentHiringActivity && facts.currentHiringActivity !== facts.buyerRequest) {
    const line = facts.currentHiringActivity
    const apply = applyInstructions(rawText, line)
    events.push({
      eventType: 'HIRING',
      organizationName: org,
      organizationEvidence: line,
      requestedCapabilities: facts.capabilityNeeds,
      requestedAssets: /\b(?:cv|resume|résumé|github)\b/i.test(line) ? ['resume'] : [],
      applicationChannels: apply.channels,
      applyInstructions: apply.instructions,
      explicitness: apply.instructions.length > 0 ? 'EXPLICIT' : 'IMPLIED',
      needOwner: 'HIRING_NEED',
      evidenceQuote: line,
      confidence: 0.8,
      ageDays: ageDaysForLine(rawText, line),
    })
  }

  if (facts.fundingEvidence) {
    events.push({
      eventType: 'FUNDING',
      organizationName: org,
      organizationEvidence: facts.fundingEvidence,
      requestedCapabilities: [],
      requestedAssets: [],
      applicationChannels: [],
      applyInstructions: [],
      explicitness: 'IMPLIED',
      needOwner: 'ORGANIZATION_NEED',
      evidenceQuote: facts.fundingEvidence,
      confidence: 0.8,
      ageDays: ageDaysForLine(rawText, facts.fundingEvidence),
    })
  }

  if (facts.currentProductActivity && facts.currentIndustryLine && !facts.buyerRequest) {
    events.push({
      eventType: facts.signals.intent.launching ? 'PRODUCT_LAUNCH' : 'TECHNICAL_BUILD',
      organizationName: org,
      organizationEvidence: facts.currentIndustryLine,
      requestedCapabilities: [],
      requestedAssets: [],
      applicationChannels: [],
      applyInstructions: [],
      explicitness: 'IMPLIED',
      needOwner: 'ORGANIZATION_NEED',
      evidenceQuote: facts.currentIndustryLine,
      confidence: 0.7,
      ageDays: facts.recentPostAgeDays,
    })
  }

  if (facts.sellerActivity && facts.serviceOffering[0] && !facts.buyerRequest) {
    events.push({
      eventType: 'SERVICE_OFFERING',
      organizationName: org,
      organizationEvidence: facts.serviceOffering[0],
      requestedCapabilities: [],
      requestedAssets: [],
      applicationChannels: [],
      applyInstructions: [],
      explicitness: 'IMPLIED',
      needOwner: 'SERVICE_OFFERING',
      evidenceQuote: facts.serviceOffering[0],
      confidence: 0.75,
      ageDays: facts.recentPostAgeDays,
    })
  }

  if (facts.candidateSeeking && !facts.buyerRequest) {
    const line = facts.rejectedSignals.find((r) => r.reason.startsWith('candidate'))?.sourceLine ?? facts.person.title ?? 'Open to work'
    events.push({
      eventType: 'OTHER',
      organizationName: 'UNKNOWN',
      organizationEvidence: line,
      requestedCapabilities: [],
      requestedAssets: [],
      applicationChannels: [],
      applyInstructions: [],
      explicitness: 'IMPLIED',
      needOwner: 'UNKNOWN',
      evidenceQuote: line,
      confidence: 0.7,
      ageDays: facts.recentPostAgeDays,
    })
  }

  return events
}
