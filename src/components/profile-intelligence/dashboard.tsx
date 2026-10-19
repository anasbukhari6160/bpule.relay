'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { ChevronDown, Upload } from 'lucide-react'
import { UploadBatchUploader } from './upload-batch'
import { ProfileList } from './profile-list'
import type { ProfileImportBatch } from '@/lib/domain/types'
import { pollBatch, toImportBatch } from '@/lib/profile-intelligence/batch-poller'

interface FileResult {
  sourceId: string
  filename: string
  extractionStatus?: string
  error: string | null
}

export function ProfileIntelligenceDashboard({ orgId, isAdmin, canManage = isAdmin, openUpload = true }: { orgId: string; isAdmin: boolean; canManage?: boolean; openUpload?: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeBatch, setActiveBatch] = useState<ProfileImportBatch | null>(null)
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState<FileResult[]>([])
  const [lastFile, setLastFile] = useState<FileResult | null>(null)
  const [pauseMessage, setPauseMessage] = useState<string | null>(null)
  const runRef = useRef(0)

  // Leaving the page ends the loop; the server keeps finished work.
  useEffect(() => () => { runRef.current++ }, [])

  const processBatch = useCallback(async (batchId: string) => {
    const run = ++runRef.current
    setProcessing(true)
    setPauseMessage(null)
    setResults([])
    setLastFile(null)

    const end = await pollBatch({
      step: async () => {
        const res = await fetch(`/api/profile-intelligence/batch/${batchId}/process`, { method: 'POST' })
        const body = await res.json().catch(() => null)
        return { ok: res.ok, status: res.status, body }
      },
      isCancelled: () => runRef.current !== run,
      onProgress: (body) => {
        const batch = toImportBatch(body.batch)
        if (batch) setActiveBatch(batch)
        if (body.last) setLastFile(body.last)
      },
    })
    if (runRef.current !== run || end.kind === 'cancelled') return

    setProcessing(false)
    if (end.kind === 'done') {
      setActiveBatch((prev) => toImportBatch(end.body.batch) ?? prev)
      setResults(Array.isArray(end.body.sources) ? end.body.sources : [])
      setRefreshKey((k) => k + 1)
    } else {
      setPauseMessage(end.message)
    }
  }, [])

  const handleBatchCreated = useCallback((raw: ProfileImportBatch) => {
    const batch = toImportBatch(raw as unknown as Record<string, unknown>) ?? raw
    setActiveBatch(batch)
    if (canManage) void processBatch(batch.id)
  }, [canManage, processBatch])

  const failedResults = results.filter((r) => r.extractionStatus !== 'extracted')
  const noteResults = results.filter((r) => r.extractionStatus === 'extracted' && r.error)
  const okCount = results.filter((r) => r.extractionStatus === 'extracted').length

  return (
    <div className="space-y-4">
      {canManage && (
        <details className="group rounded-xl border border-line bg-bone-raised" open={openUpload}>
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:hidden">
            <span className="flex size-8 items-center justify-center rounded-lg bg-orange/10 text-orange" aria-hidden="true">
              <Upload className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink">Add people from documents</span>
              <span className="block text-[12px] text-graphite">Drop CVs, reviews, project write-ups or a whole team PDF. Relay finds each person, pulls their experience and proof, and builds or updates their profile.</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-stone transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="border-t border-line px-5 pb-5 pt-4">
            <UploadBatchUploader orgId={orgId} isAdmin={isAdmin} onBatchCreated={handleBatchCreated} />
          </div>
        </details>
      )}

      {activeBatch && processing && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-4 sm:px-6" aria-live="polite" data-testid="batch-processing">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange/30 border-t-orange" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[13px] text-ink">
                Processing {Math.min(activeBatch.processedFiles, activeBatch.totalFiles)} of {activeBatch.totalFiles} {activeBatch.totalFiles === 1 ? 'file' : 'files'}…
              </p>
              <p className="truncate text-[11px] text-graphite">
                {lastFile
                  ? `${lastFile.filename}: ${lastFile.extractionStatus === 'extracted' ? 'done' : lastFile.extractionStatus === 'failed' ? 'failed' : 'partly done'}`
                  : 'One file at a time. Finished files are saved as they complete.'}
              </p>
            </div>
          </div>
        </section>
      )}

      {activeBatch && !processing && pauseMessage && (
        <section role="alert" className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-4 sm:px-6" data-testid="batch-paused">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-status-warning">{pauseMessage}</p>
            <button
              onClick={() => void processBatch(activeBatch.id)}
              className="rounded bg-orange px-4 py-2 text-[12px] font-medium text-white hover:bg-orange/90"
            >
              Resume
            </button>
          </div>
        </section>
      )}

      {activeBatch && !processing && !pauseMessage && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-4 sm:px-6" data-testid="batch-complete">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] text-ink">
                Batch complete: {okCount} of {results.length || activeBatch.totalFiles} {activeBatch.totalFiles === 1 ? 'file' : 'files'} processed
                {activeBatch.createdProfiles + activeBatch.mergedProfiles > 0 && (
                  <> · {activeBatch.createdProfiles} new {activeBatch.createdProfiles === 1 ? 'profile' : 'profiles'}{activeBatch.mergedProfiles > 0 ? `, ${activeBatch.mergedProfiles} updated` : ''}</>
                )}
              </p>
              <p className="text-[11px] text-graphite">Status: {activeBatch.status.replaceAll('_', ' ')}</p>
              {failedResults.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Files that failed">
                  {failedResults.map((e) => (
                    <li key={e.sourceId} className="text-[11px] text-status-danger">
                      <span className="font-medium">{e.filename}</span>: {e.error ?? 'Failed without a reason.'}
                    </li>
                  ))}
                </ul>
              )}
              {noteResults.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Notes">
                  {noteResults.map((e) => (
                    <li key={e.sourceId} className="text-[11px] text-status-warning">
                      <span className="font-medium">{e.filename}</span>: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => { setActiveBatch(null); setResults([]); setRefreshKey((k) => k + 1) }}
              className="rounded bg-orange px-4 py-2 text-[12px] font-medium text-white hover:bg-orange/90"
            >
              View Profiles
            </button>
          </div>
        </section>
      )}

      <ProfileList key={refreshKey} orgId={orgId} isAdmin={isAdmin} />
    </div>
  )
}
