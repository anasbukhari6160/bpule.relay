/**
 * Status rules for a Profile Intelligence import batch. Pure, so the polling
 * contract ("done only when every file is finished and the batch is saved")
 * is unit-tested rather than inferred from the route.
 */

/** extraction_status values that end a source (DB check constraint values). */
export const TERMINAL_EXTRACTION = new Set(['extracted', 'partial_failure', 'failed'])

/** A source still "extracting" after this long belongs to a call that died. */
export const STUCK_AFTER_MS = 5 * 60 * 1000

const RESET_MARKER = 'Reset: previous extraction timed out'

export interface SourceOutcome {
  extraction: 'extracted' | 'partial_failure' | 'failed'
  parsing?: 'parsed' | 'failed' | 'ocr_required' | 'unsupported'
  /** Shown to the user next to the file name. Null when there is nothing to say. */
  message: string | null
  detectedPeople?: unknown
  result?: { created: number; merged: number; failures: string[] }
}

/**
 * What to write for a source stuck in "extracting": one retry, then a clear
 * failure — never an endless reset loop.
 */
export function stuckSourceUpdate(previousError: string | null | undefined): Record<string, unknown> {
  if ((previousError ?? '').startsWith(RESET_MARKER)) {
    return {
      extraction_status: 'failed',
      error_message: 'Extraction timed out twice. The file may be too large or complex; split it into smaller files and upload again.',
    }
  }
  return { extraction_status: 'pending', error_message: RESET_MARKER }
}

/**
 * Final batch status once every source is terminal. A partial_failure source
 * that still produced a profile counts as a success for the batch.
 */
export function finalizeBatchStatus(sources: Array<{ extraction_status: string; profile_id?: string | null }>): {
  status: 'review_required' | 'partial_failure' | 'failed'
  succeeded: number
  failedFiles: number
} {
  const succeeded = sources.filter((s) => s.extraction_status === 'extracted' || (s.extraction_status === 'partial_failure' && s.profile_id)).length
  const failedFiles = sources.filter((s) => s.extraction_status === 'failed' || s.extraction_status === 'partial_failure').length
  const status = succeeded === 0 ? 'failed' : failedFiles > 0 ? 'partial_failure' : 'review_required'
  return { status, succeeded, failedFiles }
}
