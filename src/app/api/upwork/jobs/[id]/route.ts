import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import type { UpworkJobStatus } from '@/lib/domain/types'

const VALID_STATUSES: UpworkJobStatus[] = [
  'new', 'drafted', 'applied', 'shortlisted', 'interviewing',
  'offer_sent', 'awarded', 'rejected', 'replied', 'no', 'dead',
]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { status?: string; notes?: string; proposedRate?: number | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  if (body.status && !VALID_STATUSES.includes(body.status as UpworkJobStatus)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const store = await createScoutStore()
  const job = await store.getUpworkJob(id)
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 })

  try {
    await store.updateUpworkJob(id, {
      status: body.status as UpworkJobStatus | undefined,
      notes: body.notes !== undefined ? body.notes : undefined,
      proposedRate: body.proposedRate !== undefined ? body.proposedRate : undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update.' },
      { status: 500 },
    )
  }
}
