/**
 * Dataset Export — formats + privacy modes.
 *
 * Five export formats, each with a specific purpose. Privacy modes control
 * how PII is handled: REDACTED (safe default) or ANONYMIZED (linkable IDs).
 */

import type { ExportFormat, ExportMode, IntelligenceSample, PrivacyMode } from './types'

// ── Anonymization ──────────────────────────────────────────────

const ANON_MAP = new Map<string, string>()
let anonCounter = 0

function anonId(prefix: string, original: string | null): string | null {
  if (!original) return null
  const key = `${prefix}:${original}`
  if (!ANON_MAP.has(key)) {
    anonCounter++
    ANON_MAP.set(key, `${prefix}_${anonCounter.toString(36)}`)
  }
  return ANON_MAP.get(key)!
}

const PII_PATTERNS: Array<[RegExp, string]> = [
  [/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/, 'redact-email'],
  [/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, 'redact-phone'],
  [/linkedin\.com\/in\/[\w%-]+\/?/i, 'redact-li-url'],
  [/https?:\/\/[^\s]+/i, 'redact-url'],
]

/** Strip or replace PII from free text. */
function sanitizeText(text: string | null, mode: PrivacyMode): string | null {
  if (!text) return null
  if (mode === 'REDACTED') {
    let result = text
    for (const [pattern] of PII_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]')
    }
    return result
  }
  // ANONYMIZED: preserve structure, replace identifiers with anon IDs
  return text
}

/** Build a privacy-safe copy of a sample for export. */
function safeSample(sample: IntelligenceSample, mode: PrivacyMode, forExport: ExportMode): Record<string, unknown> {
  if (mode === 'REDACTED') {
    return {
      id: sample.id,
      platform: sample.platform,
      version: sample.version,
      funnel_stage: sample.funnelStage,
      qualification: sample.qualification,
      canonical_score: sample.canonicalScore,
      display_score: sample.displayScore,
      confidence: sample.confidence,
      recommended_action: sample.recommendedAction,
      final_outcome: sample.finalOutcome,
      label_status: sample.labelStatus,
      training_eligible: sample.trainingEligible,
      scoring_version: sample.scoringVersion,
      model_version: sample.modelVersion,
      created_at: sample.createdAt,
      // Redacted text fields
      raw_input: '[REDACTED]',
      connection_note: sanitizeText(sample.connectionNote, mode),
      first_dm: sanitizeText(sample.firstDm, mode),
      final_sent_text: sanitizeText(sample.finalSentText, mode),
      human_edited_text: (sample.humanEditedText ?? []).map(e => ({
        ...e,
        generatedText: '[REDACTED]',
        editedText: '[REDACTED]',
        finalSentText: e.finalSentText ? '[REDACTED]' : null,
      })),
    }
  }

  // ANONYMIZED: keep longitudinal linkability via stable anon IDs
  return {
    id: sample.id,
    anon_lead_id: anonId('lead', sample.leadId),
    anon_sample_id: anonId('sample', sample.id),
    platform: sample.platform,
    version: sample.version,
    funnel_stage: sample.funnelStage,
    qualification: sample.qualification,
    canonical_score: sample.canonicalScore,
    display_score: sample.displayScore,
    confidence: sample.confidence,
    recommended_action: sample.recommendedAction,
    final_outcome: sample.finalOutcome,
    label_status: sample.labelStatus,
    training_eligible: sample.trainingEligible,
    scoring_version: sample.scoringVersion,
    model_version: sample.modelVersion,
    created_at: sample.createdAt,
    raw_input: '[ANONYMIZED]',
    connection_note: sanitizeText(sample.connectionNote, mode),
    first_dm: sanitizeText(sample.firstDm, mode),
    final_sent_text: sanitizeText(sample.finalSentText, mode),
    score_dimensions: sample.scoreDimensions,
  }
}

// ── Format builders ────────────────────────────────────────────

interface ExportResult {
  content: string
  contentType: string
  filename: string
  schemaVersion: string
}

const DATASET_SCHEMA_VERSION = 'intelligence_dataset_v1'

/**
 * Export samples in the requested mode + format.
 * Resets anonymization state per call so exports are independent.
 */
export function exportSamples(
  samples: IntelligenceSample[],
  mode: ExportMode,
  format: ExportFormat,
  privacy: PrivacyMode,
): ExportResult {
  ANON_MAP.clear()
  anonCounter = 0

  const filtered = filterForMode(samples, mode)
  const safe = filtered.map(s => safeSample(s, privacy, mode))

  const meta = {
    dataset_schema_version: DATASET_SCHEMA_VERSION,
    export_mode: mode,
    privacy_mode: privacy,
    generated_at: new Date().toISOString(),
    count: safe.length,
  }

  switch (format) {
    case 'jsonl':
      return {
        content: safe.map(r => JSON.stringify(r)).join('\n'),
        contentType: 'application/x-ndjson',
        filename: `relay_dataset_${mode.toLowerCase()}_${Date.now()}.jsonl`,
        schemaVersion: DATASET_SCHEMA_VERSION,
      }
    case 'csv':
      return {
        content: toCsv(safe),
        contentType: 'text/csv',
        filename: `relay_dataset_${mode.toLowerCase()}_${Date.now()}.csv`,
        schemaVersion: DATASET_SCHEMA_VERSION,
      }
    case 'json':
    default:
      return {
        content: JSON.stringify({ meta, samples: safe }, null, 2),
        contentType: 'application/json',
        filename: `relay_dataset_${mode.toLowerCase()}_${Date.now()}.json`,
        schemaVersion: DATASET_SCHEMA_VERSION,
      }
  }
}

/** Apply export-mode-specific field filtering. */
function filterForMode(samples: IntelligenceSample[], mode: ExportMode): IntelligenceSample[] {
  switch (mode) {
    case 'TRAINING':
      // Only explicitly TRAINING_APPROVED records — outcome alone is not enough
      return samples.filter(s => s.trainingApproved)
    case 'MESSAGE_PREFERENCE':
      // Only samples with human edits
      return samples.filter(s => s.humanEditedText.length > 0)
    case 'SCORING_EVAL':
      // Samples with scores and either feedback or outcomes
      return samples.filter(s =>
        s.canonicalScore !== null &&
        (s.humanFeedback.length > 0 || s.finalOutcome !== null)
      )
    case 'UPWORK_TRAINING':
      return samples.filter(s => s.platform === 'upwork')
    case 'FULL_AUDIT':
    default:
      return samples
  }
}

/** Minimal CSV serializer (handles nested JSON as escaped strings). */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''

  // Flatten: pick scalar columns, stringify nested
  const scalarKeys = ['id', 'platform', 'version', 'funnel_stage', 'qualification',
    'canonical_score', 'display_score', 'confidence', 'recommended_action',
    'final_outcome', 'label_status', 'training_eligible', 'scoring_version',
    'model_version', 'created_at']

  const header = scalarKeys.join(',')
  const lines = rows.map(row =>
    scalarKeys.map(k => {
      const v = row[k]
      if (v === null || v === undefined) return ''
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return `"${s.replace(/"/g, '""')}"`
    }).join(',')
  )

  return [header, ...lines].join('\n')
}
