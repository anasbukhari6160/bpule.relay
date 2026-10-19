'use client'

import { useState, useRef, useCallback } from 'react'
import type { ProfileImportBatch } from '@/lib/domain/types'

const ACCEPTED = '.pdf,.docx,.doc,.txt,.md,.markdown,.csv,.xlsx,.xls'
const MAX_FILES = 20

export function UploadBatchUploader({ onBatchCreated }: {
  orgId: string
  isAdmin: boolean
  onBatchCreated: (batch: ProfileImportBatch) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming).slice(0, MAX_FILES)
    setFiles(arr)
    setError(null)
  }, [])

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return
    setUploading(true)
    setError(null)

    const formData = new FormData()
    for (const file of files) formData.append('files', file)

    try {
      const res = await fetch('/api/profile-intelligence/batch', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Upload failed.')
        setUploading(false)
        return
      }
      onBatchCreated(data.batch)
      setFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    }
    setUploading(false)
  }, [files, onBatchCreated])

  return (
    <>
    <section>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? 'border-orange bg-orange/5' : 'border-line hover:border-orange/40'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
        <p className="text-[15px] text-ink">
          Upload profiles &amp; proof
        </p>
        <p className="mt-1 text-[12px] text-graphite">
          PDF, DOCX, TXT, Markdown · up to {MAX_FILES} files · drag &amp; drop or click
        </p>
        {files.length > 0 && (
          <p className="mt-3 text-[12px] font-medium text-orange">
            {files.length} file{files.length > 1 ? 's' : ''} selected
          </p>
        )}
      </div>
    </section>

    <div>
      {files.length > 0 && (
        <div className="mt-3 flex items-center justify-between">
          <ul className="text-[11px] text-graphite">
            {files.slice(0, 5).map((f, i) => (
              <li key={i}>{f.name} ({(f.size / 1024).toFixed(0)} KB)</li>
            ))}
            {files.length > 5 && <li>...and {files.length - 5} more</li>}
          </ul>
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="rounded bg-orange px-4 py-2 text-[12px] font-medium text-white hover:bg-orange/90 disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-[12px] text-danger">{error}</p>
      )}
    </div>
    </>
  )
}
