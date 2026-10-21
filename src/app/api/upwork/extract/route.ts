import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { extractUpworkJob, type ExtractedUpworkJob } from '@/lib/upwork-v2'
import { createSample, captureScore } from '@/lib/dataset/service'
import { computeUpworkScore } from '@/lib/score/upwork-rubric'
import { createServiceSupabase } from '@/lib/supabase/service'
import { readUpworkJobFacts } from '@/lib/upwork/facts'

export const maxDuration = 120

/**
 * POST /api/upwork/extract
 * Extract structured job data from pasted Upwork job text.
 * Returns SSE stream for compatibility with the upwork/new page.
 * Uses createScoutStore() for proper user-session auth (not service role).
 */
export async function POST(request: Request) {
  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: { rawText?: string; url?: string; isTest?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  if (!body.rawText || body.rawText.length < 50) {
    return NextResponse.json({ error: 'Job text too short.' }, { status: 400 })
  }

  const rawText = body.rawText
  const rawUrl = body.url
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }

      try {
        send({ type: 'status', message: 'Extracting job data...' })

        const result = await extractUpworkJob({ rawText, url: rawUrl })
        if (result.error || !result.job) {
          const errorMessages: Record<string, string> = {
            INVALID_INPUT: 'Job text is too short or invalid.',
            AI_PROVIDER_FAILED: 'AI service temporarily unavailable. Please retry.',
            AI_PROVIDER_FAILURE: 'AI service temporarily unavailable. Please retry.',
            SCHEMA_FAILURE: 'Could not parse job structure. Please try again or enter manually.',
            TIMEOUT: 'Extraction timed out. Please try with shorter text.',
          }
          send({
            type: 'error',
            message: errorMessages[result.error ?? ''] ?? 'Extraction failed. Please retry.',
            errorCode: result.error,
            degraded: result.degraded,
          })
          controller.close()
          return
        }

        const job = result.job
        // Numbers come from the source, never from the model: the deterministic
        // reader is the authority for rates, proposals, connects, client history
        // and start timing. The AI extraction only fills descriptive fields.
        const facts = readUpworkJobFacts(rawText)
        const hourlyMin = facts.rate.type === 'hourly' ? facts.rate.hourlyMin : job.hourlyRateMin ?? null
        const hourlyMax = facts.rate.type === 'hourly' ? facts.rate.hourlyMax : job.hourlyRateMax ?? null
        const fixedBudget = facts.rate.type === 'fixed' ? facts.rate.fixedBudget : facts.rate.type === 'monthly' ? facts.rate.monthlyBudget : (facts.rate.type === 'unknown' ? job.budget ?? null : null)
        const skills = [...new Set([...(job.skills ?? []).map((x) => x.toLowerCase().trim()), ...facts.skills])].filter(Boolean)
        const tags = buildTags(job)
        const urgencySignal = deriveUrgency(job, facts.start.urgency)
        const proposalCount = facts.proposals.count ?? job.proposalCount ?? null
        // Missing Connects is unknown, never zero (QA BUG-11-03).
        const connectsCost = facts.connects ?? job.connectsCost ?? null
        const screeningQuestions = (job.screeningQuestions?.length ? job.screeningQuestions : facts.screeningQuestions) ?? []
        const applicationRequirements = (job.applicationRequirements?.length ? job.applicationRequirements : facts.applicationRequirements) ?? []
        const savedJob = await store.createUpworkJob({
          title: job.title,
          description: job.description,
          // One canonical budget: a fixed price is min = max, so every surface
          // (scoring, snapshot, pay label) reads the same number (QA BUG-11-04).
          budgetMin: fixedBudget,
          budgetMax: fixedBudget,
          hourlyRateMin: hourlyMin,
          hourlyRateMax: hourlyMax,
          requiredSkills: skills,
          urgencySignal,
          rawInput: body.rawText,
          tags,
          screeningQuestions,
          applicationRequirements,
          engagementType: job.engagementType ?? facts.engagement ?? null,
          weeklyHours: job.weeklyHours ?? facts.weeklyHours.label ?? null,
          duration: job.duration ?? facts.duration.label ?? null,
          experienceLevel: job.experienceLevel ?? facts.experience.level ?? null,
          proposalCount: proposalCount != null ? Math.round(proposalCount) : undefined,
          connectsCost: connectsCost ?? undefined,
        })

        // Score once, canonically, and persist it with the row.
        const score = computeUpworkScore({
          budgetMin: fixedBudget, budgetMax: null, hourlyRateMin: hourlyMin, hourlyRateMax: hourlyMax,
          proposalCount: proposalCount != null ? Math.round(proposalCount) : null, requiredSkills: skills, urgencySignal,
          description: job.description, rawInput: body.rawText, title: job.title,
        })
        try {
          await store.updateUpworkJobScore(savedJob.id, {
            total: score.total, verdict: score.verdict, canonicalScore: score.canonical.score, scoreVersion: score.canonical.version,
            scoreBreakdown: { dimensions: score.canonical.dimensions, reasons: score.canonical.reasons, watchOut: score.canonical.watchOut }, jobFacts: facts,
          })
        } catch (scoreErr) {
          console.warn('[upwork-extract] score persist failed:', scoreErr instanceof Error ? scoreErr.message : scoreErr)
        }

        // Dataset: permanent, versioned sample for this Upwork analysis.
        // Uses service role client (bypasses RLS) for system-level capture.
        void (async () => {
          try {
            const client = createServiceSupabase()
            const orgId = store.organizationId
            if (!orgId) return
            const sampleId = await createSample(client, {
              platform: 'upwork',
              upworkJobId: savedJob.id,
              rawInput: body.rawText,
              organizationId: orgId,
              isTest: body.isTest === true,
            })
            if (sampleId && score) {
              await captureScore(client, sampleId, {
                canonicalScore: score.canonical.score,
                displayScore: score.canonical.score / 10,
                qualification: score.verdict === 'apply' ? 'STRONG' : score.verdict === 'apply_if_connects' ? 'MAYBE' : 'LOW',
                scoreDimensions: score.canonical.dimensions ?? [],
                confidence: 0.8,
                recommendedAction: score.verdict,
                scoringVersion: score.canonical.version,
              })
            }
          } catch (captureErr) {
            // A completed analysis must never leave an incomplete sample silently.
            const message = captureErr instanceof Error ? captureErr.message : JSON.stringify(captureErr)
            console.error('[upwork-extract] dataset capture failed:', message)
            try {
              await store.emitRelayEvent({
                eventType: 'DATASET_CAPTURE_ERROR',
                entityType: 'intelligence_sample',
                actorType: 'system',
                payload: { platform: 'upwork', stage: 'SCORE', error: message.slice(0, 500) },
                source: 'app',
                sourceEventId: `dataset_capture_error:upwork:${Date.now()}`,
              })
            } catch { /* non-fatal */ }
          }
        })()

        send({
          type: 'done',
          jobId: savedJob.id,
          extracted: {
            title: job.title,
            description: job.description,
            budgetMin: fixedBudget?.toString() ?? '',
            budgetMax: '',
            hourlyRateMin: hourlyMin?.toString() ?? '',
            hourlyRateMax: hourlyMax?.toString() ?? '',
            requiredSkills: skills,
            urgencySignal: urgencySignal ?? '',
            tags,
            screeningQuestions,
            applicationRequirements,
            engagementType: job.engagementType ?? facts.engagement ?? '',
            weeklyHours: job.weeklyHours ?? facts.weeklyHours.label ?? '',
            duration: job.duration ?? facts.duration.label ?? '',
            experienceLevel: job.experienceLevel ?? facts.experience.level ?? '',
            proposalCount: proposalCount != null ? String(Math.round(proposalCount)) : '',
            proposalEvidence: facts.proposals.evidence ?? '',
            proposalRange: facts.proposals.range ?? null,
            connectsCost: connectsCost != null ? String(connectsCost) : '',
          },
          facts: {
            rate: facts.rate, client: facts.client, proposals: facts.proposals, start: facts.start, posted: facts.posted,
            suspicious: facts.suspicious, completeness: facts.completeness, rejectedSignals: facts.rejectedSignals, language: facts.language,
          },
          score: { total: score.total, verdict: score.verdict, canonical: score.canonical.score, qualification: score.canonical.qualification, reasons: score.canonical.reasons, watchOut: score.canonical.watchOut, version: score.canonical.version },
          degraded: result.degraded,
          demoMode: false,
        })
      } catch (err) {
        console.error('[upwork-extract] Unexpected error:', err instanceof Error ? err.stack : JSON.stringify(err))
        send({ type: 'error', message: 'Unexpected error. Please retry.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

function buildTags(job: ExtractedUpworkJob): string[] {
  const tags: string[] = []
  const text = job.description.toLowerCase()

  // Domain tags
  if (/\b(mobile|ios|android|react native|flutter)\b/.test(text)) tags.push('mobile')
  if (/\b(web|frontend|backend|full[- ]?stack)\b/.test(text)) tags.push('web')
  if (/\b(devops|ci\/cd|cloud|aws|gcp|azure)\b/.test(text)) tags.push('devops')
  if (/\b(erp|crm|admin|dashboard)\b/.test(text)) tags.push('enterprise')
  if (/\b(maintenance|support|troubleshoot|bug fix)\b/.test(text)) tags.push('maintenance')
  if (/\b(launch|mvp|beta|pre[- ]?launch)\b/.test(text)) tags.push('launch')

  // Engagement tags
  if (job.engagementType) tags.push(job.engagementType.toLowerCase().replace(/[\s-]/g, '_'))
  if (job.experienceLevel?.toLowerCase().includes('expert')) tags.push('senior')

  return [...new Set(tags)]
}

/**
 * Urgency is a fact or nothing. A job with no start-timing evidence gets
 * null, not a default "medium" that used to award every job urgency points.
 */
function deriveUrgency(job: ExtractedUpworkJob, start: 'asap' | 'soon' | 'scheduled' | 'ongoing' | 'none'): string | null {
  const text = job.description.toLowerCase()
  if (start === 'asap' || /\b(urgent|asap|immediately|right now|this week)\b/.test(text)) return 'urgent'
  if (/\b(incident response|emergency|production (?:down|issue|problem))\b/.test(text)) return 'high'
  if (/\b(pre[- ]?launch|commercial launch|going live|production (?:ready|preparation))\b/.test(text)) return 'high'
  if (start === 'soon') return 'high'
  if (start === 'scheduled') return 'medium'
  return null
}
