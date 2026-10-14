import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current'
import { createScoutStore } from '@/lib/store'
import { generateContent } from '@/lib/ai/content'
import { sseStream } from '@/lib/sse/sse'
import { injectStyleCard } from '@/lib/style/inject'
import { buildContentDnaPromptBlock } from '@/lib/content/content-dna'
import type { ContentGenerationInput } from '@/lib/ai/content'
import type { TrendingAngle, ContentResearchFinding, ContentDraftFeedback } from '@/lib/domain/types'
import { normalizeCaptionTypography } from '@/lib/facts/sanitize'

export const dynamic = 'force-dynamic'

/**
 * Generate a content draft.
 *
 * Body: { personaId, topicClusterId, sourceMaterial, platform }
 * Returns: SSE stream with { type: 'done', result: ContentGenerationResult }
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { personaId, pillarId, topicClusterId, sourceMaterial, platform, angleId, personalLine, findingId, useStoredOpinion, structureId } = body as {
    personaId: string
    pillarId: string | null
    topicClusterId?: string | null
    sourceMaterial?: string
    platform: 'linkedin' | 'x'
    angleId?: string | null
    personalLine?: string
    findingId?: string | null
    useStoredOpinion?: boolean
    structureId?: string | null
  }

  if (!personaId?.trim()) return NextResponse.json({ error: 'personaId is required' }, { status: 400 })
  if (!['linkedin', 'x'].includes(platform)) return NextResponse.json({ error: 'platform must be linkedin or x' }, { status: 400 })

  const store = await createScoutStore()

  const persona = await store.getContentPersona(personaId)
  if (!persona) return NextResponse.json({ error: 'Persona not found' }, { status: 404 })

  if (persona.repId !== user.rep.id && user.rep.role !== 'admin') {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const generatedToday = await store.countContentDraftsToday(personaId)
  if (generatedToday >= 2) {
    return NextResponse.json({ error: 'Daily cap reached: up to 2 generated drafts per persona.' }, { status: 429 })
  }

  let angle: TrendingAngle | null = null
  const clusters = await store.listTopicClusters(personaId)

  let resolvedTopicClusterId = topicClusterId?.trim() || null
  let finding: ContentResearchFinding | null = null

  if (findingId) {
    const findings = await store.listResearchFindings(personaId, { unusedOnly: false, limit: 50 })
    finding = findings.find((f) => f.id === findingId) ?? null
    if (!finding) return NextResponse.json({ error: 'Research finding not found' }, { status: 404 })
    resolvedTopicClusterId = finding.topicClusterId
  }

  // Backward compatibility path for v3 angle + pillar flow.
  let pillar = null
  if (angleId) {
    angle = await store.getTrendingAngle(angleId)
    if (!angle) return NextResponse.json({ error: 'Trending angle not found' }, { status: 404 })
    const anglePillarId = angle.pillarId
    const pillars = await store.listContentPillars(personaId)
    pillar = pillars.find((p) => p.id === anglePillarId) ?? null
    if (!pillar) {
      return NextResponse.json({ error: 'Trending angle does not belong to this persona' }, { status: 400 })
    }
    resolvedTopicClusterId = angle.topicClusterId ?? resolvedTopicClusterId
  } else if (pillarId) {
    const pillars = await store.listContentPillars(personaId)
    pillar = pillars.find((p) => p.id === pillarId) ?? null
  }

  let topicCluster = resolvedTopicClusterId
    ? clusters.find((c) => c.id === resolvedTopicClusterId) ?? null
    : (clusters[0] ?? null)

  if (!pillar && !topicCluster) {
    const pillars = await store.listContentPillars(personaId)
    if (pillars.length > 0) {
      pillar = pillars[0]
    } else {
      topicCluster = await store.createTopicCluster({
        personaId,
        clusterName: 'Core perspective',
        description: 'Default topic created automatically so drafting can start from real input.',
        sourceType: 'system',
      })
    }
  }

  let structure: { id: string; structureName: string; shape: string } | null = null
  if (structureId) {
    const structures = await store.listPostStructures()
    const found = structures.find((s) => s.id === structureId)
    if (found) structure = { id: found.id, structureName: found.structureName, shape: found.shape }
  }

  let styleCard: string | null = null
  if (persona.voiceProfileId) {
    const voiceProfile = await store.getVoiceProfile()
    if (voiceProfile) {
      styleCard = injectStyleCard(voiceProfile.styleCard)
    }
  }

  const history = await store.listContentHistory(personaId, 10)
  const recentOpenings = history.map((h) => h.openingLine).filter(Boolean)

  let contentDnaBlock: string | null = null
  if (persona.contentProfileId) {
    const contentProfile = await store.getContentProfile(persona.contentProfileId)
    if (contentProfile) {
      contentDnaBlock = buildContentDnaPromptBlock(contentProfile)
    }
  }

  const material = sourceMaterial?.trim() ?? ''
  const realLine = personalLine?.trim() ?? ''
  const feedback = await store.listContentDraftFeedback(personaId, 80)
  const preferenceHints = derivePreferenceHints(feedback)
  const generationMode: 'personal' | 'opinion' = (angle || finding || useStoredOpinion)
    ? (realLine || material ? 'personal' : 'opinion')
    : 'personal'

  if (!angle && !finding && !useStoredOpinion && !material) {
    return NextResponse.json({ error: 'sourceMaterial is required - the system never invents a post' }, { status: 400 })
  }

  if ((angle || finding || useStoredOpinion) && generationMode === 'opinion' && persona.valuesAndOpinions.length === 0) {
    return NextResponse.json({
      error: 'No values/opinions stored for this persona yet. Add convictions first or provide one real line.',
    }, { status: 400 })
  }

  const sourceForGeneration = angle
    ? buildSourceFromAngle({
      angle: angle.angleDescription,
      personalLine: realLine || material,
      valuesAndOpinions: persona.valuesAndOpinions,
    })
    : finding
      ? buildSourceFromFinding({
        finding: finding.finding,
        sourceLabel: finding.sourceLabel,
        sourceUrl: finding.sourceUrl,
        personalLine: realLine || material,
        valuesAndOpinions: persona.valuesAndOpinions,
      })
      : (useStoredOpinion
        ? buildSourceFromStoredOpinion({
          topicName: topicCluster?.clusterName ?? pillar?.pillarName ?? 'Core theme',
          valuesAndOpinions: persona.valuesAndOpinions,
        })
        : material)

  const input: ContentGenerationInput = {
    personaName: persona.displayName,
    topic: {
      id: topicCluster?.id ?? pillar?.id ?? 'legacy-topic',
      name: topicCluster?.clusterName ?? pillar?.pillarName ?? 'General',
      description: topicCluster?.description ?? pillar?.description ?? '',
    },
    sourceMaterial: sourceForGeneration,
    platform,
    styleCard,
    recentOpenings,
    humorStyle: persona.humorStyle,
    valuesAndOpinions: persona.valuesAndOpinions,
    generationMode,
    trendingAngle: angle?.angleDescription ?? finding?.finding ?? null,
    preferenceHints,
    structure: structure ? { structureName: structure.structureName, shape: structure.shape } : null,
    contentDnaBlock,
  }

  return sseStream(async (emit) => {
    try {
      const result = await generateContent(input, (msg) => emit({ type: 'status', message: msg }), async (log) => {
        try {
          await store.logHostCall({ task: 'extract', host: log.host, model: log.model, costTier: log.costTier, success: log.success, failureReason: log.failureReason ?? undefined, errorMessage: log.errorMessage, latencyMs: log.latencyMs })
        } catch {
          // Logging must never break generation.
        }
      })
           const draft = await store.createContentDraft({
          personaId,
          pillarId: pillar?.id ?? null,
          topicClusterId: topicCluster?.id ?? finding?.topicClusterId ?? null,
          researchFindingId: finding?.id ?? null,
          structureId: structure?.id ?? null,
          sourceKind: finding ? 'field_update' : (useStoredOpinion ? 'conviction' : 'answer'),
          sourceMaterial: sourceForGeneration,
          platform,
          caption: normalizeCaptionTypography(result.caption),
        hookScore: result.hookScore,
        hookFeedback: result.hookFeedback,
          selfCheckPassed: result.selfCheckPassed,
          selfCheckNote: result.selfCheckNote,
          specificityHit: result.specificityHit,
          status: result.selfCheckPassed ? 'ready' : 'draft',
        })

        if (angle && result.selfCheckPassed) {
          await store.markTrendingAngleUsed(angle.id)
        }
        if (finding && result.selfCheckPassed) {
          await store.markResearchFindingUsed(finding.id)
        }
        if (topicCluster && material) {
          await store.touchTopicCluster({ topicClusterId: topicCluster.id, lastInputAt: new Date().toISOString() })
        }

        emit({ type: 'done', result: { ...result, draftId: draft.id } })
    } catch (err) {
      emit({ type: 'error', message: 'Generation failed.' })
    }
  })
}

function derivePreferenceHints(feedback: ContentDraftFeedback[]): string[] {
  if (!Array.isArray(feedback) || feedback.length === 0) return []
  const accepted = feedback.filter((f) => f.reaction === 'posting' || f.reaction === 'posting_after_edit').length
  const rejected = feedback.filter((f) => f.reaction === 'not_for_me').length
  const edited = feedback.filter((f) => f.edited)
  const signals = new Set<string>()

  if (accepted > rejected) {
    signals.add('Keep the overall style close to previously accepted drafts.')
  }
  if (rejected > accepted) {
    signals.add('Avoid the patterns that feel generic or forced; keep it direct.')
  }
  if (edited.length > 0) {
    const signalCounts = new Map<string, number>()
    for (const row of edited) {
      for (const s of row.editSignals) signalCounts.set(s, (signalCounts.get(s) ?? 0) + 1)
    }
    const top = [...signalCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([label]) => label)
    for (const label of top) signals.add(`Frequent edit pattern: ${label}.`)
  }

  return [...signals].slice(0, 3)
}

function buildSourceFromFinding(input: {
  finding: string
  sourceLabel: string
  sourceUrl: string
  personalLine: string
  valuesAndOpinions: string[]
}): string {
  if (input.personalLine) {
    return `Research finding: ${input.finding}\nSource: ${input.sourceLabel} (${input.sourceUrl})\n\nReal reaction from today:\n${input.personalLine}`
  }

  const convictions = input.valuesAndOpinions.length > 0
    ? input.valuesAndOpinions.map((v, i) => `${i + 1}. ${v}`).join('\n')
    : 'None supplied.'

  return `Research finding: ${input.finding}\nSource: ${input.sourceLabel} (${input.sourceUrl})\n\nOpinion mode: no personal anecdote supplied today. Build from real convictions only:\n${convictions}`
}

function buildSourceFromStoredOpinion(input: {
  topicName: string
  valuesAndOpinions: string[]
}): string {
  const convictions = input.valuesAndOpinions.length > 0
    ? input.valuesAndOpinions.map((v, i) => `${i + 1}. ${v}`).join('\n')
    : 'None supplied.'

  return `Topic cluster: ${input.topicName}\n\nOpinion-only day. Build from stored real convictions only:\n${convictions}`
}

function buildSourceFromAngle(input: {
  angle: string
  personalLine: string
  valuesAndOpinions: string[]
}): string {
  if (input.personalLine) {
    return `Trending angle: ${input.angle}\n\nReal line from today:\n${input.personalLine}`
  }

  const convictions = input.valuesAndOpinions.length > 0
    ? input.valuesAndOpinions.map((v, i) => `${i + 1}. ${v}`).join('\n')
    : 'None supplied.'

  return `Trending angle: ${input.angle}\n\nOpinion mode: no personal anecdote supplied today. Build from real convictions only:\n${convictions}`
}
