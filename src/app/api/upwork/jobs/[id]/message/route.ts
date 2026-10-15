import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'

/**
 * POST /api/upwork/jobs/[id]/message
 * Log an inbound message from a client on Upwork.
 * Body: { text: string, direction?: 'inbound' | 'outbound' }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { text?: string; direction?: 'inbound' | 'outbound' }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  if (!body.text?.trim()) {
    return NextResponse.json({ error: 'text is required.' }, { status: 400 })
  }

  const store = await createScoutStore()
  const job = await store.getUpworkJob(id)
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 })

  await store.saveUpworkDraft({
    jobId: id,
    type: body.direction === 'inbound' ? 'reply' : 'followup',
    draftText: body.text.trim(),
    modelUsed: 'manual',
  })

  // Update job status to 'replied' if inbound
  if (body.direction !== 'outbound') {
    try {
      await store.updateUpworkJob(id, { status: 'replied' })
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true })
}
