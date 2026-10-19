import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { safeErrorResponse } from '@/lib/errors'
import { createServiceSupabase } from '@/lib/supabase/service'
import type { ProfileImportBatch } from '@/lib/domain/types'
import { profileAccess } from '@/lib/profile-intelligence/access'

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

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      failed++
      await client.from('profile_sources').insert({
        organization_id: orgId,
        import_batch_id: batchId,
        storage_path: '',
        original_filename: file.name.slice(0, 200),
        mime_type: file.type || 'unknown',
        file_size_bytes: file.size,
        file_hash: '',
        parsing_status: 'failed',
        error_message: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit.`,
        uploaded_by: uploadedBy,
      })
      continue
    }

    if (!ALLOWED_MIME.has(file.type)) {
      failed++
      await client.from('profile_sources').insert({
        organization_id: orgId,
        import_batch_id: batchId,
        storage_path: '',
        original_filename: file.name.slice(0, 200),
        mime_type: file.type || 'unknown',
        file_size_bytes: file.size,
        file_hash: '',
        parsing_status: 'unsupported',
        error_message: `Unsupported file type: ${file.type}`,
        uploaded_by: uploadedBy,
      })
      continue
    }

    try {
      const buffer = await file.arrayBuffer()
      const { contentHash, sanitizeFilename } = await import('@/lib/profile-intelligence/parse-document')
      const hash = contentHash(new TextDecoder().decode(buffer))
      const safeName = sanitizeFilename(file.name)
      const storagePath = `${orgId}/${batchId}/${crypto.randomUUID()}_${safeName}`

      const { error: uploadError } = await client.storage
        .from('profile-sources')
        .upload(storagePath, new Uint8Array(buffer), {
          contentType: file.type,
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        failed++
        await client.from('profile_sources').insert({
          organization_id: orgId,
          import_batch_id: batchId,
          storage_path: storagePath,
          original_filename: file.name.slice(0, 200),
          mime_type: file.type,
          file_size_bytes: file.size,
          file_hash: hash,
          parsing_status: 'failed',
          error_message: uploadError.message,
          uploaded_by: uploadedBy,
        })
        continue
      }

      const { data: sourceRecord } = await client.from('profile_sources').insert({
        organization_id: orgId,
        import_batch_id: batchId,
        storage_path: storagePath,
        original_filename: file.name.slice(0, 200),
        mime_type: file.type,
        file_size_bytes: file.size,
        file_hash: hash,
        parsing_status: 'pending',
        uploaded_by: uploadedBy,
      }).select().single()

      if (sourceRecord) {
        sourceRecords.push({ id: sourceRecord.id as string, path: storagePath })
      }
      processed++
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : 'Upload failed'
      await client.from('profile_sources').insert({
        organization_id: orgId,
        import_batch_id: batchId,
        storage_path: '',
        original_filename: file.name.slice(0, 200),
        mime_type: file.type || 'unknown',
        file_size_bytes: file.size,
        file_hash: '',
        parsing_status: 'failed',
        error_message: msg,
        uploaded_by: uploadedBy,
      })
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
