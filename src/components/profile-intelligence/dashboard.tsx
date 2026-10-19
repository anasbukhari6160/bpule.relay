'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { UploadBatchUploader } from './upload-batch'
import { ProfileList } from './profile-list'
import type { ProfileImportBatch } from '@/lib/domain/types'

export function ProfileIntelligenceDashboard({ orgId, isAdmin, canManage = isAdmin }: { orgId: string; isAdmin: boolean; canManage?: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeBatch, setActiveBatch] = useState<ProfileImportBatch | null>(null)
  const [processing, setProcessing] = useState(false)
  const [batchErrors, setBatchErrors] = useState<Array<{ sourceId: string; filename: string; error: string | null }>>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const processBatch = useCallback(async (batchId: string) => {
    setProcessing(true)
    let consecutiveErrors = 0
    const maxConsecutiveErrors = 3

    const poll = () => {
      fetch(`/api/profile-intelligence/batch/${batchId}/process`, { method: 'POST' })
        .then((r) => r.json())
        .then((data) => {
          consecutiveErrors = 0

          if ((data.done && data.status !== 'uploaded' && data.status !== 'extracting') || data.status === 'review_required' || data.status === 'partial_failure' || data.status === 'failed') {
            stopPolling()
            setProcessing(false)
            setActiveBatch(data.batch ?? null)
            setBatchErrors(data.errors ?? [])
            setRefreshKey((k) => k + 1)
          } else if (data.error) {
            console.warn('[profile-intelligence] file error:', data.error)
          }
        })
        .catch((err) => {
          consecutiveErrors++
          console.error('[profile-intelligence] poll error:', err)
          if (consecutiveErrors >= maxConsecutiveErrors) {
            stopPolling()
            setProcessing(false)
          }
        })
    }

    poll()
    pollRef.current = setInterval(poll, 5000)
  }, [stopPolling])

  const handleBatchCreated = useCallback((batch: ProfileImportBatch) => {
    setActiveBatch(batch)
    if (canManage) {
      processBatch(batch.id)
    }
  }, [canManage, processBatch])

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
        <section className="srf-console srf-console-edge overflow-hidden px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange/30 border-t-orange" />
            <div>
              <p className="text-[13px] text-[color:var(--console-text)]">
                Processing {activeBatch.totalFiles} files...
              </p>
              <p className="text-[11px] text-[color:var(--console-mute)]">
                One file at a time. Safe to close this page — processing continues.
              </p>
            </div>
          </div>
        </section>
      )}

      {activeBatch && !processing && (
        <section className="srf-console srf-console-edge overflow-hidden px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-[color:var(--console-text)]">
                Batch complete: {activeBatch.totalFiles} files
              </p>
              <p className="text-[11px] text-[color:var(--console-mute)]">
                Status: {activeBatch.status}
              </p>
              {batchErrors && batchErrors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {batchErrors.map((e) => (
                    <p key={e.sourceId} className="text-[11px] text-status-danger">
                      {e.filename}: {e.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => { setActiveBatch(null); setRefreshKey((k) => k + 1) }}
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
