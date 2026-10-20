import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { computeUpworkScore } from '@/lib/score/upwork-rubric'
import type { UpworkJob } from '@/lib/domain/types'

/**
 * POST /api/upwork/jobs
 *
 * Saves (or, when `jobId` is given, updates the row the extract step already
 * created) and scores the job with the canonical Upwork scorer. The score is
 * read from the raw paste first; explicit form values override parsed facts.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!title || !description) {
    return NextResponse.json(
      { error: 'Title and description are required.' },
      { status: 400 },
    )
  }

  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json(
      { error: 'Not signed in.' },
      { status: 401 },
    )
  }

  const requiredSkills = Array.isArray(body.requiredSkills)
    ? (body.requiredSkills as unknown[]).filter((t): t is string => typeof t === 'string')
    : typeof body.requiredSkills === 'string'
      ? body.requiredSkills.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      : []
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  const rawInput = typeof body.rawInput === 'string' && body.rawInput.trim() ? body.rawInput : null

  const fields = {
    title,
    description,
    budgetMin: num(body.budgetMin),
    budgetMax: num(body.budgetMax),
    hourlyRateMin: num(body.hourlyRateMin),
    hourlyRateMax: num(body.hourlyRateMax),
    proposalCount: num(body.proposalCount) != null ? Math.round(num(body.proposalCount)!) : null,
    connectsCost: num(body.connectsCost) != null ? Math.round(num(body.connectsCost)!) : 0,
    requiredSkills,
    urgencySignal: typeof body.urgencySignal === 'string' && body.urgencySignal.trim() ? body.urgencySignal.trim() : null,
    rawInput,
    tags: Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
    screeningQuestions: Array.isArray(body.screeningQuestions) ? (body.screeningQuestions as unknown[]).filter((t): t is string => typeof t === 'string') : undefined,
    applicationRequirements: Array.isArray(body.applicationRequirements) ? (body.applicationRequirements as unknown[]).filter((t): t is string => typeof t === 'string') : undefined,
    engagementType: typeof body.engagementType === 'string' && body.engagementType ? body.engagementType : undefined,
    weeklyHours: typeof body.weeklyHours === 'string' && body.weeklyHours ? body.weeklyHours : undefined,
    duration: typeof body.duration === 'string' && body.duration ? body.duration : undefined,
    experienceLevel: typeof body.experienceLevel === 'string' && body.experienceLevel ? body.experienceLevel : undefined,
  }

  // Update the row the extract step created instead of inserting a twin.
  const existingId = typeof body.jobId === 'string' && body.jobId ? body.jobId : null
  const existing: UpworkJob | null = existingId ? await store.getUpworkJob(existingId) : null
  let job: UpworkJob
  if (existing) {
    await store.updateUpworkJobFields(existing.id, fields)
    job = (await store.getUpworkJob(existing.id)) ?? existing
  } else {
    job = await store.createUpworkJob(fields)
  }

  const score = computeUpworkScore({
    budgetMin: job.budgetMin,
    budgetMax: job.budgetMax,
    hourlyRateMin: job.hourlyRateMin,
    hourlyRateMax: job.hourlyRateMax,
    proposalCount: job.proposalCount,
    requiredSkills: job.requiredSkills,
    urgencySignal: job.urgencySignal,
    description: job.description,
    rawInput: job.rawInput,
    title: job.title,
  })

  await store.updateUpworkJobScore(job.id, {
    total: score.total,
    verdict: score.verdict,
    canonicalScore: score.canonical.score,
    scoreVersion: score.canonical.version,
    scoreBreakdown: { dimensions: score.canonical.dimensions, reasons: score.canonical.reasons, watchOut: score.canonical.watchOut },
    jobFacts: score.canonical.facts,
  })

  return NextResponse.json({
    job: { ...job, score: score.total, verdict: score.verdict, canonicalScore: score.canonical.score },
    score: { total: score.total, verdict: score.verdict, breakdown: score.breakdown },
    canonical: { score: score.canonical.score, qualification: score.canonical.qualification, reasons: score.canonical.reasons, watchOut: score.canonical.watchOut, version: score.canonical.version },
  }, { status: 201 })
}

export async function GET() {
  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json(
      { error: 'Not signed in.' },
      { status: 401 },
    )
  }

  const jobs = await store.listUpworkJobs()
  return NextResponse.json({ jobs })
}
