/**
 * Client-side driver for batch processing. One request at a time (the next
 * starts only after the previous answers), stops only on `done: true`, and
 * always ends: on repeated errors, on a stall, or after a hard time cap.
 * `sleep`/`now` are injected so tests can prove it never loops forever.
 */
import type { ImportBatchStatus, ProfileImportBatch } from '@/lib/domain/types'

export interface PollResponse {
  ok: boolean
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any | null
}

export type PollEnd =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'done'; body: any }
  | { kind: 'error'; message: string }
  | { kind: 'stalled'; message: string }
  | { kind: 'cancelled' }

export interface PollerOptions {
  step: () => Promise<PollResponse>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onProgress?: (body: any) => void
  isCancelled?: () => boolean
  intervalMs?: number
  maxConsecutiveErrors?: number
  /** No visible progress for this long ends the loop (server recovers stuck files in 5 min). */
  stallMs?: number
  /** Absolute cap on one processing session. */
  maxTotalMs?: number
}

export async function pollBatch(opts: PollerOptions): Promise<PollEnd> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const interval = opts.intervalMs ?? 5_000
  const maxErrors = opts.maxConsecutiveErrors ?? 6
  const stallMs = opts.stallMs ?? 12 * 60_000
  const maxTotalMs = opts.maxTotalMs ?? 60 * 60_000
  const started = now()
  let lastProgressAt = started
  let lastKey = ''
  let errors = 0

  for (;;) {
    if (opts.isCancelled?.()) return { kind: 'cancelled' }
    let res: PollResponse
    try {
      res = await opts.step()
    } catch (err) {
      res = { ok: false, status: 0, body: { error: err instanceof Error ? err.message : 'Network error' } }
    }

    if (res.ok && res.body?.done === true) return { kind: 'done', body: res.body }

    if (res.ok && res.body) {
      errors = 0
      opts.onProgress?.(res.body)
      const key = progressKey(res.body)
      if (key !== lastKey) { lastKey = key; lastProgressAt = now() }
    } else {
      errors++
      // Auth / missing batch will not fix itself by retrying.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { kind: 'error', message: res.body?.error ?? `Processing stopped (HTTP ${res.status}).` }
      }
      if (errors >= maxErrors) {
        return { kind: 'error', message: `Processing paused after ${errors} failed attempts${res.body?.error ? `: ${res.body.error}` : ''}. Resume to continue — finished files are kept.` }
      }
    }

    const t = now()
    if (t - lastProgressAt > stallMs) {
      return { kind: 'stalled', message: 'No progress for several minutes. Resume to continue — finished files are kept.' }
    }
    if (t - started > maxTotalMs) {
      return { kind: 'stalled', message: 'Processing is taking unusually long. Resume to continue — finished files are kept.' }
    }
    await sleep(errors > 0 ? interval * Math.min(8, 2 ** (errors - 1)) : interval)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function progressKey(body: any): string {
  const b = body?.batch ?? {}
  return [b.processed_files ?? b.processedFiles ?? '', body?.last?.sourceId ?? '', body?.last?.status ?? ''].join('|')
}

/** A batch row from the API (snake_case) as the UI type (camelCase). */
export function toImportBatch(row: Record<string, unknown> | null | undefined): ProfileImportBatch | null {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') return null
  const num = (snake: string, camel: string) => Number(row[snake] ?? row[camel] ?? 0) || 0
  return {
    id: row.id,
    organizationId: String(row.organization_id ?? row.organizationId ?? ''),
    uploadedBy: String(row.uploaded_by ?? row.uploadedBy ?? ''),
    status: String(row.status ?? 'uploaded') as ImportBatchStatus,
    totalFiles: num('total_files', 'totalFiles'),
    processedFiles: num('processed_files', 'processedFiles'),
    failedFiles: num('failed_files', 'failedFiles'),
    detectedPeople: num('detected_people', 'detectedPeople'),
    createdProfiles: num('created_profiles', 'createdProfiles'),
    mergedProfiles: num('merged_profiles', 'mergedProfiles'),
    errorMessage: (row.error_message ?? row.errorMessage ?? null) as string | null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at ?? row.createdAt ?? ''),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? ''),
  }
}
