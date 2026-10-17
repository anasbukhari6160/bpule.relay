import type { ScoreResult } from '@/lib/domain/types'
import type { ProspectQualificationAssessment } from '@/lib/prospect/qualification-gate'

/**
 * Create Lead validation, by kind. "Everything checked out" is only true
 * when there is no format problem, nothing required is missing, every
 * score-affecting claim is supported by the research, and the lead can
 * qualify — field formatting alone is not a pass.
 */
export interface LeadValidation {
  formatIssues: string[]
  missingRequiredFields: string[]
  unsupportedEvidence: string[]
  qualificationBlockers: string[]
  warnings: string[]
  /** No issue of any blocking kind (unsupported claims count: they earn no points). */
  ok: boolean
  summary: string
}

const MISSING_CRITICAL_LABEL: Record<string, string> = {
  'company context': 'Company',
  'person or role context': 'Contact name or title',
  'specific opportunity signal': 'A specific opportunity signal in the research',
}

export function validateLeadDraft(input: {
  company: string
  signalEvidence: string
  locationRaw: string
  fieldErrors: Record<string, string | undefined>
  confidenceNotes: string[]
  qualification: ProspectQualificationAssessment
  score: ScoreResult
}): LeadValidation {
  const formatIssues = Object.values(input.fieldErrors).filter((m): m is string => Boolean(m))

  const missing = new Set<string>()
  const company = input.company.trim()
  if (!company || /^unknown( company)?$/i.test(company)) missing.add('Company')
  if (input.signalEvidence.trim().length < 12) missing.add('Signal evidence')
  for (const m of input.qualification.missingCritical) missing.add(MISSING_CRITICAL_LABEL[m] ?? m)

  const unsupportedEvidence: string[] = []
  for (const row of input.score.breakdown) {
    if (row.verification !== 'UNSUPPORTED' && row.verification !== 'UNVERIFIABLE') continue
    const noSource = row.verification === 'UNVERIFIABLE'
    if (row.category === 'signal') {
      unsupportedEvidence.push(noSource ? 'Signal type cannot be verified without the original research.' : 'Selected signal is not supported by the research.')
    } else if (row.label === 'Verbatim quote') {
      unsupportedEvidence.push(noSource ? 'Quote cannot be verified without the original research.' : 'Quote could not be verified against the research.')
    }
  }

  const qualificationBlockers = input.qualification.qualificationEligibility
    ? []
    : input.qualification.reasons.length > 0
      ? input.qualification.reasons.slice(0, 3)
      : ['Not enough verified context to qualify this lead.']

  const warnings = [...input.confidenceNotes]
  if (!input.locationRaw.trim()) warnings.push('Location missing. Market fit is not scored.')

  const blocking = formatIssues.length + missing.size + unsupportedEvidence.length + (qualificationBlockers.length > 0 ? 1 : 0)
  const ok = blocking === 0
  const summary = ok
    ? warnings.length === 0
      ? 'Nothing flagged. Every field checked out.'
      : `${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth a second look.`
    : `${blocking} issue${blocking === 1 ? '' : 's'} need${blocking === 1 ? 's' : ''} attention.`

  return {
    formatIssues,
    missingRequiredFields: [...missing],
    unsupportedEvidence,
    qualificationBlockers,
    warnings,
    ok,
    summary,
  }
}
