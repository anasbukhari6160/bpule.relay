import type {
  ExtractedLead,
  OrganizationRulebook,
  ScoreBreakdownItem,
  ScoreResult,
  SignalDefinition,
  Verdict,
} from '@/lib/domain/types'
import { mapLocationToRegion } from '@/lib/leads/targeting-pure'
import { isVerified, verifyQuote, verifySignal, type ClaimOrigin } from '@/lib/evidence/provenance'

export interface ScoreOptions {
  /**
   * The original research. When given, the signal and verbatim-quote rows
   * only earn points for claims found in it — a dropdown choice or a typed
   * quote is not evidence. Omitted = legacy behaviour (no source to check).
   */
  sourceText?: string | null
  /** Who chose the signal type: the extractor or the user. */
  signalOrigin?: ClaimOrigin
}

/**
 * Scout qualification rubric.
 *
 * Pure arithmetic. No model is ever consulted here. The score is the sum of
 * two groups:
 *
 *   Signal base (max rulebook.maxSignalWeight points)
 *     Each signal type has a configurable weight.
 *
 *   Completeness (max rulebook.maxCompleteness points)
 *     +1 url present
 *     +1 contact name present
 *     +1 contact title present
 *     +1 evidence is specific (mentions a number or a year)
 *     +1 verbatim quote present
 *     +2/-2 market region fit
 *
 * Verdict bands are configurable per organization via verdictThresholds.
 */
export function computeScore(
  lead: ExtractedLead,
  rulebook: OrganizationRulebook,
  options: ScoreOptions = {},
): ScoreResult {
  const signal = rulebook.signals.find((s) => s.id === lead.signalType) ?? null
  const checkSource = options.sourceText !== undefined
  const signalClaim = checkSource && signal ? verifySignal(signal.id, options.sourceText, options.signalOrigin ?? 'USER_ENTERED') : null
  const signalSupported = !signalClaim || isVerified(signalClaim.status)
  const quoteClaim = checkSource && lead.verbatimQuote ? verifyQuote(lead.verbatimQuote, options.sourceText) : null
  const quoteSupported = !quoteClaim || isVerified(quoteClaim.status)

  const evidenceSpecific = evidenceIsSpecific(lead.signalEvidence)
  const region = mapLocationToRegion(lead.locationRaw ?? null)
  const regionPoints = region === 'outside_core' ? -2 : region === 'unknown' ? 0 : 2

  const items: ScoreBreakdownItem[] = [
    {
      category: 'signal',
      label: signal ? `${signal.short} (${signal.name})` : 'No signal',
      points: signal && signalSupported ? signal.weight : 0,
      max: rulebook.maxSignalWeight,
      note: !signal
        ? 'No recognized signal type was extracted.'
        : signalClaim?.status === 'UNVERIFIABLE'
          ? 'Add the original research to verify this signal. No points without a source.'
          : !signalSupported
            ? `"${signal.short}" is not supported by the research. No points until the source shows it.`
            : signal.description,
      ...(signalClaim ? {
        verification: signalSupported ? 'VERIFIED' as const : signalClaim.status === 'UNVERIFIABLE' ? 'UNVERIFIABLE' as const : 'UNSUPPORTED' as const,
        sourceQuote: signalClaim.sourceQuote,
      } : {}),
    },
    {
      category: 'completeness',
      label: 'URL present',
      points: lead.url ? 1 : 0,
      max: 1,
      note: lead.url ? 'Source URL on file.' : 'Add a source URL for this lead.',
    },
    {
      category: 'completeness',
      label: 'Contact name present',
      points: lead.name ? 1 : 0,
      max: 1,
      note: lead.name ? 'Named person identified.' : 'No named person yet.',
    },
    {
      category: 'completeness',
      label: 'Contact title present',
      points: lead.title ? 1 : 0,
      max: 1,
      note: lead.title ? 'Title known.' : 'Title not known.',
    },
    {
      category: 'completeness',
      label: 'Evidence is specific',
      points: evidenceSpecific ? 1 : 0,
      max: 1,
      note: evidenceSpecific
        ? 'Evidence cites a concrete number or date.'
        : 'Evidence is vague; no number or date to anchor on.',
    },
    {
      category: 'completeness',
      label: 'Core market fit',
      points: regionPoints,
      max: 2,
      note:
        region === 'outside_core'
          ? 'Location maps outside the core markets (US, UK, EU, CA, AU, UAE, SG).'
          : region === 'unknown'
            ? 'Location missing or ambiguous; no market-fit adjustment applied.'
            : `Location maps to core market ${region}.`,
    },
    {
      category: 'completeness',
      label: 'Verbatim quote',
      points: lead.verbatimQuote && quoteSupported ? 1 : 0,
      max: 1,
      note: !lead.verbatimQuote
        ? 'No quotable line captured.'
        : quoteClaim?.status === 'UNVERIFIABLE'
          ? 'Add the original research to verify this quote. No points without a source.'
          : !quoteSupported
            ? 'Quote could not be found in the research. No verified-evidence credit.'
            : quoteClaim ? 'Quote found in the research.' : 'A verbatim quote is on file.',
      ...(quoteClaim ? {
        verification: quoteSupported ? 'VERIFIED' as const : quoteClaim.status === 'UNVERIFIABLE' ? 'UNVERIFIABLE' as const : 'UNSUPPORTED' as const,
        sourceQuote: quoteClaim.sourceQuote,
      } : {}),
    },
  ]

  const rawTotal = items.reduce((sum, item) => sum + item.points, 0)
  const total = Math.max(0, Math.min(12, rawTotal))
  const baseVerdict = verdictFor(total, rulebook)
  const gates: string[] = []

  let verdict = baseVerdict
  const confidence = lead.extractionConfidence ?? 100
  if (confidence < rulebook.confidenceSendThreshold && baseVerdict === 'send') {
    verdict = 'research_more'
    gates.push(
      `Extraction confidence is ${confidence}/100 (needs ${rulebook.confidenceSendThreshold}+ for auto-send).`,
    )
  }
  for (const note of lead.confidenceNotes ?? []) {
    gates.push(note)
  }
  if (signal && !signalSupported) gates.push(`Selected signal "${signal.short}" is not supported by the research.`)
  if (lead.verbatimQuote && !quoteSupported) gates.push('Verbatim quote could not be verified against the research.')

  return { total, verdict, baseVerdict, breakdown: items, gates }
}

export function verdictFor(total: number, rulebook: OrganizationRulebook): Verdict {
  const t = rulebook.verdictThresholds
  if (total >= t.send.min) return 'send'
  if (total >= t.research_more.min) return 'research_more'
  return 'skip'
}

/**
 * Normalize any lead score to a 0-100 comparable scale.
 * Canonical scores are already 0-100; legacy rubric scores are 0-12.
 * Use this for ALL sorting, filtering, and comparison.
 *
 * The `score` column stores ONLY legacy rubric scores (0-12).
 * The `canonical_score` column stores canonical scores (0-100).
 * These must never be mixed — see score contract in score-ring.tsx.
 */
export function getComparableLeadScore(record: { canonicalScore?: number | null; score?: number | null }): number {
  if (record.canonicalScore != null) return record.canonicalScore
  if (record.score != null) return (record.score / 12) * 100
  return 0
}

/** Deterministic check: does the evidence cite a number or a 4-digit year? */
function evidenceIsSpecific(evidence: string | null | undefined): boolean {
  if (!evidence) return false
  const trimmed = evidence.trim()
  if (trimmed.length === 0) return false
  if (trimmed.length < 12) return false
  return /\d{1,3}(?:[,.]\d+)?/.test(trimmed) || /\b(19|20)\d{2}\b/.test(trimmed)
}
