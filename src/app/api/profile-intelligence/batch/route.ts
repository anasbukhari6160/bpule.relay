import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { safeErrorResponse } from '@/lib/errors'
import { createServiceSupabase } from '@/lib/supabase/service'
import type { ProfileImportBatch } from '@/lib/domain/types'
import { profileAccess } from '@/lib/profile-intelligence/access'
import { contentHash, resolveMimeType, sanitizeFilename } from '@/lib/profile-intelligence/parse-document'

const BUCKET = 'profile-sources'

const MAX_FILES = 20
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/x-markdown',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

export async function GET(request: Request) {
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!profileAccess(authCtx).canManage) return NextResponse.json({ error: 'Only admins and managers can manage profiles.' }, { status: 403 })

  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100)

  const client = createServiceSupabase()
  const { data, error } = await client
    .from('profile_import_batches')
    .select('*')
    .eq('organization_id', authCtx.orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return safeErrorResponse(error, 500, 'Failed to load batches.', 'profile-intelligence/batch')

  return NextResponse.json({ batches: data })
}

export async function POST(request: Request) {
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!profileAccess(authCtx).canManage) return NextResponse.json({ error: 'Only admins and managers can manage profiles.' }, { status: 403 })

  let files: File[]
  try {
    const form = await request.formData()
    const entries = form.getAll('files').filter((f): f is File => f instanceof File)
    files = entries
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 })
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 })
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Maximum ${MAX_FILES} files per batch.` }, { status: 400 })
  }

  const client = createServiceSupabase()
  const orgId = authCtx.orgId
  const uploadedBy = authCtx.repId

  const { data: batch, error: batchError } = await client
    .from('profile_import_batches')
    .insert({
      organization_id: orgId,
      uploaded_by: uploadedBy,
      status: 'uploaded',
      total_files: files.length,
      metadata: { file_names: files.map((f) => f.name) },
    })
    .select()
    .single()

  if (batchError || !batch) {
    return safeErrorResponse(batchError, 500, 'Failed to create import batch.', 'profile-intelligence/batch')
  }

  const batchId = batch.id as string
  let processed = 0
  let failed = 0
  const sourceRecords: Array<{ id: string; path: string }> = []

  // A file rejected here is recorded as failed with its reason, so the
  // processor reports that reason instead of a confusing download error.
  const recordRejected = async (file: File, mimeType: string, parsingStatus: 'failed' | 'unsupported', message: string, storagePath = '', hash = '') => {
    failed++
    await client.from('profile_sources').insert({
      organization_id: orgId,
      import_batch_id: batchId,
      storage_path: storagePath,
      original_filename: file.name.slice(0, 200),
      mime_type: mimeType || 'unknown',
      file_size_bytes: file.size,
      file_hash: hash,
      parsing_status: parsingStatus,
      extraction_status: 'failed',
      error_message: message,
      uploaded_by: uploadedBy,
    })
  }

  for (const file of files) {
    const mimeType = resolveMimeType(file.type, file.name)
    if (file.size === 0) {
      await recordRejected(file, mimeType, 'failed', 'The file is empty.')
      continue
    }
    if (file.size > MAX_BYTES) {
      await recordRejected(file, mimeType, 'failed', `File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.`)
      continue
    }
    if (!ALLOWED_MIME.has(mimeType)) {
      await recordRejected(file, mimeType, 'unsupported', `Unsupported file type (${mimeType || 'unknown'}). Upload PDF, DOCX, TXT, CSV or XLSX.`)
      continue
    }

    try {
      const buffer = await file.arrayBuffer()
      const hash = contentHash(new TextDecoder().decode(buffer))
      const storagePath = `${orgId}/${batchId}/${crypto.randomUUID()}_${sanitizeFilename(file.name)}`

      const uploadError = await uploadWithBucketCheck(client, storagePath, buffer, mimeType)
      if (uploadError) {
        await recordRejected(file, mimeType, 'failed', `Upload to storage failed: ${uploadError}`, storagePath, hash)
        continue
      }

      const { data: sourceRecord, error: insertError } = await client.from('profile_sources').insert({
        organization_id: orgId,
        import_batch_id: batchId,
        storage_path: storagePath,
        original_filename: file.name.slice(0, 200),
        mime_type: mimeType,
        file_size_bytes: file.size,
        file_hash: hash,
        parsing_status: 'pending',
        extraction_status: 'pending',
        uploaded_by: uploadedBy,
      }).select().single()

      if (insertError || !sourceRecord) {
        failed++
        console.error('[profile-intelligence] source insert failed:', insertError?.message ?? 'no row')
        continue
      }
      sourceRecords.push({ id: sourceRecord.id as string, path: storagePath })
      processed++
    } catch (err) {
      await recordRejected(file, mimeType, 'failed', err instanceof Error ? err.message : 'Upload failed')
    }
  }

  await client
    .from('profile_import_batches')
    .update({
      processed_files: processed,
      failed_files: failed,
      status: processed > 0 ? 'uploaded' : 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)

  // Return the updated batch so the frontend sees correct processed_files.
  const { data: updatedBatch } = await client
    .from('profile_import_batches')
    .select('*')
    .eq('id', batchId)
    .single()

  return NextResponse.json({
    batch: updatedBatch ?? batch,
    source_ids: sourceRecords.map((s) => s.id),
    processed,
    failed,
  })
}

/**
 * Upload to the profile-sources bucket. When the bucket is missing (fresh
 * project, migration not run) it is created as a private bucket and the
 * upload retried once. Returns an error message, or null on success.
 */
async function uploadWithBucketCheck(
  client: ReturnType<typeof createServiceSupabase>,
  path: string,
  buffer: ArrayBuffer,
  contentType: string,
): Promise<string | null> {
  const upload = () => client.storage.from(BUCKET).upload(path, new Uint8Array(buffer), { contentType, cacheControl: '3600', upsert: false })
  const first = await upload()
  if (!first.error) return null
  if (!/bucket not found|not found/i.test(first.error.message)) return first.error.message
  const { error: createError } = await client.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: [...ALLOWED_MIME],
  })
  if (createError && !/already exists/i.test(createError.message)) return `${first.error.message}; creating the storage bucket also failed: ${createError.message}`
  const second = await upload()
  return second.error ? second.error.message : null
}
