'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
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

export function ProfileIntelligenceDashboard({ orgId, isAdmin, canManage = isAdmin }: { orgId: string; isAdmin: boolean; canManage?: boolean }) {
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
    <div className="space-y-6">
      {canManage ? (
        <>
      <section className="srf-console srf-console-edge overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">
            Profile Intelligence V2
          </p>
          <h1 className="mt-2 text-[30px] leading-[1.05] tracking-[-0.03em] text-[color:var(--console-text)]">
            Upload documents. Relay builds your team.
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-[color:var(--console-mute)]">
            Drop CVs, reviews, project summaries, or a combined team PDF. Relay identifies each person,
            extracts experience and proof, and builds identities your reps can use in outreach.
          </p>
        </section>
  
        <UploadBatchUploader
          orgId={orgId}
          isAdmin={isAdmin}
          onBatchCreated={handleBatchCreated}
        />
        </>
      ) : (
        <section data-testid="rep-profiles-header" className="srf-console srf-console-edge overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Your profiles</p>
          <h1 className="mt-2 text-[24px] leading-[1.1] tracking-[-0.02em] text-[color:var(--console-text)]">
            Profiles assigned to you
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-[color:var(--console-mute)]">
            Open a profile to see its skills, proof and projects for your outreach. Profile data is managed by your admins —
            ask them to upload new sources or correct anything.
          </p>
        </section>
      )}

      {activeBatch && processing && (
        <section className="srf-console srf-console-edge overflow-hidden px-5 py-4 sm:px-6" aria-live="polite" data-testid="batch-processing">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange/30 border-t-orange" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[13px] text-[color:var(--console-text)]">
                Processing {Math.min(activeBatch.processedFiles, activeBatch.totalFiles)} of {activeBatch.totalFiles} {activeBatch.totalFiles === 1 ? 'file' : 'files'}…
              </p>
              <p className="truncate text-[11px] text-[color:var(--console-mute)]">
                {lastFile
                  ? `${lastFile.filename}: ${lastFile.extractionStatus === 'extracted' ? 'done' : lastFile.extractionStatus === 'failed' ? 'failed' : 'partly done'}`
                  : 'One file at a time. Finished files are saved as they complete.'}
              </p>
            </div>
          </div>
        </section>
      )}

      {activeBatch && !processing && pauseMessage && (
        <section role="alert" className="srf-console srf-console-edge overflow-hidden px-5 py-4 sm:px-6" data-testid="batch-paused">
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
        <section className="srf-console srf-console-edge overflow-hidden px-5 py-4 sm:px-6" data-testid="batch-complete">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] text-[color:var(--console-text)]">
                Batch complete: {okCount} of {results.length || activeBatch.totalFiles} {activeBatch.totalFiles === 1 ? 'file' : 'files'} processed
                {activeBatch.createdProfiles + activeBatch.mergedProfiles > 0 && (
                  <> · {activeBatch.createdProfiles} new {activeBatch.createdProfiles === 1 ? 'profile' : 'profiles'}{activeBatch.mergedProfiles > 0 ? `, ${activeBatch.mergedProfiles} updated` : ''}</>
                )}
              </p>
              <p className="text-[11px] text-[color:var(--console-mute)]">Status: {activeBatch.status.replaceAll('_', ' ')}</p>
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
