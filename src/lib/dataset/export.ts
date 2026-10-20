/**
 * Dataset Export — formats + privacy modes.
 *
 * Five export formats, each with a specific purpose. Privacy modes control
 * how PII is handled: REDACTED (safe default) or ANONYMIZED (linkable IDs).
 */

import { createHmac } from 'node:crypto'
import type { ExportFormat, ExportMode, IntelligenceSample, PrivacyMode } from './types'

// ── Anonymization ──────────────────────────────────────────────

/**
 * Stable, longitudinal anonymous ids: the same lead or sample maps to the
 * same anonymous id in every export of the same organisation, without any
 * table that could reverse it. Keyed HMAC-SHA256 over the original id; the
 * key is the organisation scope plus DATASET_ANON_SALT when set.
 */
export function anonId(prefix: string, original: string | null, scope: string): string | null {
  if (!original) return null
  const key = `${process.env.DATASET_ANON_SALT ?? 'relay-dataset-anon'}:${scope}`
  const digest = createHmac('sha256', key).update(`${prefix}:${original}`).digest('hex').slice(0, 16)
  return `${prefix}_${digest}`
}

const PII_PATTERNS: Array<[RegExp, string]> = [
  [/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, 'redact-email'],
  [/\+?\(?\d{1,3}\)?[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g, 'redact-phone'],
  [/linkedin\.com\/in\/[\w%-]+\/?/gi, 'redact-li-url'],
  [/https?:\/\/[^\s)]+/gi, 'redact-url'],
]

/** Strip PII from free text. Both privacy modes redact; ANONYMIZED only differs in keeping linkable ids. */
export function sanitizeText(text: string | null, mode: PrivacyMode): string | null {
  if (!text) return null
  let result = text
  for (const [pattern] of PII_PATTERNS) {
    result = result.replace(pattern, mode === 'REDACTED' ? '[REDACTED]' : '[ANONYMIZED]')
  }
  return result
}

/** Build a privacy-safe copy of a sample for export. */
function safeSample(sample: IntelligenceSample, mode: PrivacyMode, forExport: ExportMode, scope: string): Record<string, unknown> {
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

  // ANONYMIZED: keep longitudinal linkability via stable anon IDs; the real
  // ids never leave the system.
  return {
    anon_lead_id: anonId('lead', sample.leadId, scope),
    anon_sample_id: anonId('sample', sample.id, scope),
    anon_job_id: anonId('job', sample.upworkJobId, scope),
    anon_sender_id: anonId('sender', sample.senderProfileId, scope),
    decision_run_id: sample.decisionRunId,
    raw_input_hash: sample.rawInputHash,
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
    human_edited_text: (sample.humanEditedText ?? []).map(e => ({
      generatedText: sanitizeText(e.generatedText, mode),
      editedText: sanitizeText(e.editedText, mode),
      finalSentText: sanitizeText(e.finalSentText, mode),
      anon_editor_id: anonId('rep', e.editorId, scope),
      timestamp: e.timestamp,
    })),
    client_replies: (sample.clientReplies ?? []).map(r => sanitizeText(r, mode)),
    human_feedback: (sample.humanFeedback ?? []).map(f => ({ feedbackType: f.feedbackType, timestamp: f.timestamp })),
    score_dimensions: sample.scoreDimensions,
    source_facts: sample.sourceFacts,
    rejected_signals: sample.rejectedSignals,
    sender_rankings: (sample.senderRankings ?? []).map(r => ({ anon_sender_id: anonId('sender', r.senderId, scope), profileMatch: r.profileMatch })),
    anon_best_sender_id: anonId('sender', sample.bestSenderId, scope),
    anon_current_sender_id: anonId('sender', sample.currentSenderId, scope),
    versions: {
      scoring: sample.scoringVersion, sourceFacts: sample.sourceFactsVersion, buyerIntent: sample.buyerIntentVersion,
      attribution: sample.attributionVersion, routing: sample.routingVersion, prompt: sample.promptVersion, model: sample.modelVersion,
    },
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
 * Export samples in the requested mode + format. `anonScope` (the
 * organisation id) keys the anonymous ids so they are stable across exports
 * of one organisation and different between organisations.
 */
export function exportSamples(
  samples: IntelligenceSample[],
  mode: ExportMode,
  format: ExportFormat,
  privacy: PrivacyMode,
  opts: { anonScope?: string } = {},
): ExportResult {
  const scope = opts.anonScope ?? 'unscoped'
  const filtered = filterForMode(samples, mode)
  const safe = filtered.map(s => safeSample(s, privacy, mode, scope))

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
