import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getAuthContext, can } from '@/lib/auth/organization'
import { validateFunnelOrdering, computeCostCoverage, validateLatencyConsistency, overallFunnelHealth, classifyFallback } from '@/lib/revenue-intelligence/metrics-health'
import { generateInsights } from '@/lib/revenue-intelligence/insights'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'

export const maxDuration = 30

function dateRange(range: string): { start: string; end: string } {
  const now = new Date()
  const end = now.toISOString()
  let start: string
  switch (range) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      break
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 3600000).toISOString()
      break
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 3600000).toISOString()
      break
    case '90d':
      start = new Date(now.getTime() - 90 * 24 * 3600000).toISOString()
      break
    default:
      start = new Date(now.getTime() - 30 * 24 * 3600000).toISOString()
  }
  return { start, end }
}

export async function GET(request: Request) {
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(authCtx, 'ACCESS_REVENUE_INTELLIGENCE')) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const supabase = await createServerSupabase()
  const { searchParams } = new URL(request.url)
  const range = searchParams.get('range') ?? '30d'
  const { start, end } = dateRange(range)
  const startStr = start.slice(0, 10)
  const endStr = end.slice(0, 10)

  const [
    eventsResult,
    leadsResult,
    messagesResult,
    conversationsResult,
    aiTracesResult,
    targetsResult,
    accountabilityResult,
    identitiesResult,
    extractionRunsResult,
    repsResult,
  ] = await Promise.all([
    supabase.from('relay_events').select('id, event_type, entity_id, entity_type, actor_id, actor_type, revenue_identity_id, payload, occurred_at, source_event_id').eq('organization_id', authCtx.orgId).gte('occurred_at', start).lte('occurred_at', end).order('occurred_at', { ascending: false }).limit(5000),
    supabase.from('leads').select('id, company, contact_name, contact_title, status, score, verdict, canonical_score, canonical_intelligence, direction, source, owner_rep_id, revenue_identity_id, signal_type, signal_evidence, tags, created_at, updated_at').eq('organization_id', authCtx.orgId).gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false }).limit(2000),
    supabase.from('messages').select('id, lead_id, rep_id, type, send_disposition, reject_reasons, model_used, sent_at, created_at').eq('organization_id', authCtx.orgId).gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false }).limit(2000),
    supabase.from('conversation_states').select('lead_id, stage, last_sent_at, last_reply_at, followup_count, won_at, lost_at, lost_reason, commercial_state').eq('organization_id', authCtx.orgId),
    supabase.from('ai_traces').select('id, task_class, provider, model, latency_ms, estimated_cost_usd, fallback, fallback_reason, error, quality, created_at').eq('organization_id', authCtx.orgId).gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false }).limit(5000),
    supabase.from('daily_targets').select('id, rep_id, revenue_identity_id, activity_type, target_count, active').eq('organization_id', authCtx.orgId).eq('active', true),
    supabase.from('daily_accountability').select('id, rep_id, revenue_identity_id, activity_type, target_date, target_count, completed_count, status').eq('organization_id', authCtx.orgId).gte('target_date', startStr).lte('target_date', endStr),
    supabase.from('revenue_identities').select('id, slug, identity_name, title, channel, status').eq('organization_id', authCtx.orgId),
    supabase.from('extraction_runs').select('id, rep_id, success, latency_ms, model, error_message, created_at').eq('organization_id', authCtx.orgId).gte('created_at', start).lte('created_at', end).limit(5000),
    supabase.from('reps').select('id, name').eq('organization_id', authCtx.orgId),
  ])

  const events = eventsResult.data ?? []
  const leads = leadsResult.data ?? []
  const messages = messagesResult.data ?? []
  const conversations = conversationsResult.data ?? []
  const aiTraces = aiTracesResult.data ?? []
  const targets = targetsResult.data ?? []
  const accountability = accountabilityResult.data ?? []
  const identities = identitiesResult.data ?? []
  const extractionRuns = extractionRunsResult.data ?? []
  const repNames = new Map((repsResult.data ?? []).map((r) => [r.id as string, r.name as string]))

  const leadMap = new Map(leads.map((l) => [l.id, l]))
  const identityMap = new Map(identities.map((i) => [i.id, i]))

  const funnelEvents = events.filter((e) =>
    ['PROSPECT_ANALYZED', 'PROSPECT_CAPTURED', 'LEAD_QUALIFIED', 'OUTREACH_RECORDED', 'FOLLOWUP_RECORDED', 'CLIENT_REPLIED', 'INTENT_DETECTED', 'CONVERSATION_ADVANCED', 'OUTCOME_RECORDED'].includes(e.event_type),
  )
  const eventsByEntity = new Map<string, typeof funnelEvents>()
  for (const ev of funnelEvents) {
    const key = ev.entity_id ?? 'orphan'
    if (!eventsByEntity.has(key)) eventsByEntity.set(key, [])
    eventsByEntity.get(key)!.push(ev)
  }
  const funnelStages = new Map<string, string[]>()
  for (const [entityId, evs] of eventsByEntity) {
    const stagesReached = new Set<string>()
    for (const ev of evs) {
      if (ev.event_type === 'PROSPECT_ANALYZED' || ev.event_type === 'PROSPECT_CAPTURED') stagesReached.add('ANALYZED')
      if (ev.event_type === 'LEAD_QUALIFIED') stagesReached.add('QUALIFIED')
      if (ev.event_type === 'OUTREACH_RECORDED' || ev.event_type === 'FOLLOWUP_RECORDED') stagesReached.add('CONTACTED')
      if (ev.event_type === 'CLIENT_REPLIED') stagesReached.add('REPLIED')
      if (ev.event_type === 'INTENT_DETECTED' || ev.event_type === 'CONVERSATION_ADVANCED') stagesReached.add('QUALIFIED_CONVERSATION')
      if (ev.event_type === 'OUTCOME_RECORDED') {
        const outcome = String(ev.payload?.outcome ?? ev.payload?.status ?? '')
        if (outcome === 'lost') stagesReached.add('LOST')
        else stagesReached.add('WON')
      }
      if (ev.event_type === 'CONVERSATION_ADVANCED') {
        const stage = String(ev.payload?.stage ?? ev.payload?.newStage ?? '')
        if (stage === 'meeting') stagesReached.add('CALL')
        if (stage === 'proposal' || stage === 'negotiation') stagesReached.add('PROPOSAL')
        if (stage === 'won') stagesReached.add('WON')
        if (stage === 'lost') stagesReached.add('LOST')
      }
    }
    funnelStages.set(entityId, [...stagesReached])
  }
  const stageCounts = new Map<string, number>()
  for (const stages of funnelStages.values()) {
    for (const s of stages) {
      stageCounts.set(s, (stageCounts.get(s) ?? 0) + 1)
    }
  }

  const canonicalFunnel = {
    extracted: stageCounts.get('ANALYZED') ?? 0,
    qualified: stageCounts.get('QUALIFIED') ?? 0,
    contacted: stageCounts.get('CONTACTED') ?? 0,
    replied: stageCounts.get('REPLIED') ?? 0,
    qualifiedConversations: stageCounts.get('QUALIFIED_CONVERSATION') ?? 0,
    calls: stageCounts.get('CALL') ?? 0,
    proposals: stageCounts.get('PROPOSAL') ?? 0,
    won: stageCounts.get('WON') ?? 0,
    lost: stageCounts.get('LOST') ?? 0,
  }

  const convStageCounts = new Map<string, number>()
  for (const conv of conversations) {
    convStageCounts.set(conv.stage, (convStageCounts.get(conv.stage) ?? 0) + 1)
  }

  const extractionCounts = {
    total: extractionRuns.length,
    successful: extractionRuns.filter((r) => r.success).length,
    failed: extractionRuns.filter((r) => !r.success).length,
  }

  const fallbackExtractions = extractionRuns.filter((r) => r.model === 'demo' || r.model === 'fallback').length
  const aiExtractions = extractionRuns.filter((r) => r.model !== 'demo' && r.model !== 'fallback' && r.success).length
  const extractionLatencies = extractionRuns.map((r) => r.latency_ms ?? 0).filter((l) => l > 0)
  const avgExtractionTime = extractionLatencies.length > 0 ? Math.round(extractionLatencies.reduce((s, l) => s + l, 0) / extractionLatencies.length) : 0
  const failedExtractions = extractionCounts.failed

  const providerCounts = new Map<string, { total: number; fallback: number; errors: number; totalLatency: number; totalCost: number }>()
  for (const trace of aiTraces) {
    const p = trace.provider ?? 'unknown'
    if (!providerCounts.has(p)) providerCounts.set(p, { total: 0, fallback: 0, errors: 0, totalLatency: 0, totalCost: 0 })
    const entry = providerCounts.get(p)!
    entry.total++
    if (trace.fallback) entry.fallback++
    if (trace.error) entry.errors++
    entry.totalLatency += trace.latency_ms ?? 0
    entry.totalCost += trace.estimated_cost_usd ?? 0
  }
  const latencies = aiTraces.map((t) => t.latency_ms ?? 0).filter((l) => l > 0).sort((a, b) => a - b)
  const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0
  const latencyHealth = validateLatencyConsistency(Math.round(latencies.reduce((s, l) => s + l, 0) / (latencies.length || 1)), p50, p95, latencies.length)

  const fallbackReasonCounts = new Map<string, number>()
  for (const trace of aiTraces) {
    if (trace.fallback || trace.model === 'demo' || trace.provider === 'fallback') {
      const reason = (trace.fallback_reason as string) ?? (trace.model === 'demo' ? 'DEMO_MODE' : trace.provider === 'fallback' ? 'NO_CREDENTIALS' : 'UNKNOWN')
      fallbackReasonCounts.set(reason, (fallbackReasonCounts.get(reason) ?? 0) + 1)
    }
  }
  const fallbackReasons = [...fallbackReasonCounts.entries()].map(([reason, count]) => ({ reason, count }))

  const totalAiCalls = aiTraces.length
  const callsWithCost = aiTraces.filter((t) => t.estimated_cost_usd !== null && t.estimated_cost_usd !== undefined).length
  const totalAiCost = aiTraces.reduce((sum, t) => sum + (t.estimated_cost_usd ?? 0), 0)
  const costCoverage = totalAiCalls > 0 ? callsWithCost / totalAiCalls : 0
  const costHealth = computeCostCoverage(callsWithCost, totalAiCalls)

  const funnelIssues = validateFunnelOrdering(canonicalFunnel.contacted, canonicalFunnel.extracted, canonicalFunnel.qualified, canonicalFunnel.replied)

  const insights = generateInsights({
    funnel: canonicalFunnel,
    extractionTotal: extractionCounts.total,
    extractionSuccessful: extractionCounts.successful,
    fallbackCount: fallbackExtractions,
    aiCount: aiExtractions,
    avgLatency: latencies.length > 0 ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length) : 0,
    p50Latency: p50,
    p95Latency: p95,
    avgLatencySampleSize: latencies.length,
    aiCost: totalAiCost,
    costCoverage,
    messageCount: messages.length,
    unchangedCount: messages.filter((m) => m.send_disposition === 'SENT_UNCHANGED').length,
    heavyEditCount: messages.filter((m) => m.send_disposition === 'HEAVY_EDIT').length,
    rejectedCount: messages.filter((m) => m.send_disposition === 'REJECTED').length,
    funnelIssues: funnelIssues.map((i) => ({ ...i, health: i.health as 'TRUSTED' | 'PARTIAL' | 'SUSPICIOUS' | 'UNAVAILABLE' })),
  })

  // Separate generated-only drafts from actual send dispositions
  const generatedOnly = messages.filter((m) => !m.send_disposition && !m.sent_at).length
  const reviewedMessages = messages.filter((m) => m.send_disposition || m.sent_at)
  const unchangedMsg = messages.filter((m) => m.send_disposition === 'SENT_UNCHANGED').length
  const heavyEditMsg = messages.filter((m) => m.send_disposition === 'HEAVY_EDIT').length
  const rejectedMsg = messages.filter((m) => m.send_disposition === 'REJECTED').length
  const lightEditMsg = messages.filter((m) => m.send_disposition === 'LIGHT_EDIT').length

  const dispositionCounts = new Map<string, number>()
  dispositionCounts.set('GENERATED_ONLY', generatedOnly)
  for (const msg of messages) {
    const d = msg.send_disposition ?? 'PENDING'
    dispositionCounts.set(d, (dispositionCounts.get(d) ?? 0) + 1)
  }

  const relayActionCounts = new Map<string, number>()
  const humanActionCounts = new Map<string, number>()
  for (const lead of leads) {
    const action = lead.verdict ?? 'UNKNOWN'
    relayActionCounts.set(action, (relayActionCounts.get(action) ?? 0) + 1)
    const contacted = lead.status === 'contacted' || lead.status === 'replied' || lead.status === 'followed_up' || lead.status === 'won' || lead.status === 'lost'
    const rejected = lead.status === 'no' || lead.status === 'dead'
    const humanAction = contacted ? 'contacted' : rejected ? 'rejected' : 'no_action'
    humanActionCounts.set(humanAction, (humanActionCounts.get(humanAction) ?? 0) + 1)
  }

  const repPerformance = new Map<string, { extracted: number; qualified: number; contacted: number; replies: number; qualifiedConversations: number; calls: number; proposals: number; wins: number; losses: number; targetProgress: number }>()

  for (const [, lead] of leadMap) {
    const repId = lead.owner_rep_id
    if (!repId) continue
    if (!repPerformance.has(repId)) repPerformance.set(repId, { extracted: 0, qualified: 0, contacted: 0, replies: 0, qualifiedConversations: 0, calls: 0, proposals: 0, wins: 0, losses: 0, targetProgress: 0 })
    const entry = repPerformance.get(repId)!
    const stages = funnelStages.get(lead.id) ?? []
    if (stages.includes('ANALYZED')) entry.extracted++
    if (stages.includes('QUALIFIED')) entry.qualified++
    if (stages.includes('CONTACTED')) entry.contacted++
    if (stages.includes('REPLIED')) entry.replies++
    if (stages.includes('QUALIFIED_CONVERSATION')) entry.qualifiedConversations++
    if (stages.includes('CALL')) entry.calls++
    if (stages.includes('PROPOSAL')) entry.proposals++
    if (stages.includes('WON')) entry.wins++
    if (stages.includes('LOST')) entry.losses++
  }

  const repTargets = new Map<string, { target: number; completed: number }>()
  for (const t of targets) {
    const key = t.rep_id
    if (!repTargets.has(key)) repTargets.set(key, { target: 0, completed: 0 })
    const entry = repTargets.get(key)!
    entry.target += t.target_count ?? 0
  }
  for (const a of accountability) {
    const key = a.rep_id
    if (!repTargets.has(key)) repTargets.set(key, { target: 0, completed: 0 })
    repTargets.get(key)!.completed += a.completed_count ?? 0
  }
  for (const [repId, progress] of repTargets) {
    if (repPerformance.has(repId)) {
      repPerformance.get(repId)!.targetProgress = progress.target > 0 ? Math.round((progress.completed / progress.target) * 100) : 0
    }
  }

  const sourceCounts = new Map<string, { extracted: number; qualified: number; contacted: number; replies: number }>()
  for (const lead of leads) {
    const src = lead.source ?? 'unknown'
    if (!sourceCounts.has(src)) sourceCounts.set(src, { extracted: 0, qualified: 0, contacted: 0, replies: 0 })
    const entry = sourceCounts.get(src)!
    const stages = funnelStages.get(lead.id) ?? []
    if (stages.includes('ANALYZED')) entry.extracted++
    if (stages.includes('QUALIFIED')) entry.qualified++
    if (stages.includes('CONTACTED')) entry.contacted++
    if (stages.includes('REPLIED')) entry.replies++
  }

  const fitCounts = new Map<string, number>()
  const intentCounts = new Map<string, number>()
  const qualificationCounts = new Map<string, number>()
  const confidenceBuckets = { high: 0, medium: 0, low: 0 }
  for (const lead of leads) {
    const ci = lead.canonical_intelligence as Record<string, unknown> | null
    // Canonical bands only; a legacy 0-12 score is scaled before banding.
    const score = lead.canonical_score ?? (lead.score != null ? Math.round((lead.score / 12) * 100) : 0)
    const fit = qualifyCanonicalScore(score).headline
    fitCounts.set(fit, (fitCounts.get(fit) ?? 0) + 1)
    const confidence = (ci?.confidence as number) ?? 0
    if (confidence >= 80) confidenceBuckets.high++
    else if (confidence >= 50) confidenceBuckets.medium++
    else confidenceBuckets.low++
    const qualification = (ci?.qualification as string) ?? 'unknown'
    qualificationCounts.set(qualification, (qualificationCounts.get(qualification) ?? 0) + 1)
  }

  const activityFeed = events.slice(0, 100).map((ev) => {
    const lead = ev.entity_id ? leadMap.get(ev.entity_id) : null
    const rep = ev.actor_id
    return {
      id: ev.id,
      timestamp: ev.occurred_at,
      eventType: ev.event_type,
      actorId: rep,
      actorName: rep ? repNames.get(rep) ?? null : null,
      entityId: ev.entity_id,
      prospectName: lead?.contact_name ?? lead?.company ?? null,
      company: lead?.company ?? null,
      revenueIdentityId: ev.revenue_identity_id,
      revenueIdentityName: ev.revenue_identity_id ? identityMap.get(ev.revenue_identity_id)?.identity_name ?? null : null,
      payload: ev.payload,
    }
  })

  const sourcePerformance = [...sourceCounts.entries()].map(([source, counts]) => ({ source, ...counts }))

  const identityCounts = new Map<string, { contacted: number; replies: number; wins: number; leads: number }>()
  for (const lead of leads) {
    if (!lead.revenue_identity_id) continue
    const entry = identityCounts.get(lead.revenue_identity_id) ?? { contacted: 0, replies: 0, wins: 0, leads: 0 }
    const stages = funnelStages.get(lead.id) ?? []
    entry.leads++
    if (stages.includes('CONTACTED')) entry.contacted++
    if (stages.includes('REPLIED')) entry.replies++
    if (stages.includes('WON')) entry.wins++
    identityCounts.set(lead.revenue_identity_id, entry)
  }
  const identityPerformance = [...identityCounts.entries()].map(([id, counts]) => ({
    id,
    name: identityMap.get(id)?.identity_name ?? 'Unknown identity',
    channel: identityMap.get(id)?.channel ?? 'other',
    ...counts,
  })).sort((a, b) => b.contacted - a.contacted)

  const dailyMap = new Map<string, { outreach: number; replies: number; wins: number }>()
  for (let t = new Date(startStr + 'T00:00:00Z').getTime(); t <= new Date(endStr + 'T00:00:00Z').getTime(); t += 86_400_000) {
    dailyMap.set(new Date(t).toISOString().slice(0, 10), { outreach: 0, replies: 0, wins: 0 })
  }
  for (const ev of funnelEvents) {
    const day = dailyMap.get(String(ev.occurred_at).slice(0, 10))
    if (!day) continue
    if (ev.event_type === 'OUTREACH_RECORDED' || ev.event_type === 'FOLLOWUP_RECORDED') day.outreach++
    else if (ev.event_type === 'CLIENT_REPLIED') day.replies++
    else if (ev.event_type === 'OUTCOME_RECORDED' && String(ev.payload?.outcome ?? ev.payload?.status ?? '') !== 'lost') day.wins++
  }
  const daily = [...dailyMap.entries()].map(([date, v]) => ({ date, ...v }))

  const providers = [...providerCounts.entries()].map(([provider, data]) => ({
    provider,
    total: data.total,
    fallback: data.fallback,
    errors: data.errors,
    avgLatency: data.total > 0 ? Math.round(data.totalLatency / data.total) : 0,
    totalCost: Math.round(data.totalCost * 100) / 100,
  }))

  const dataHealth = {
    funnel: {
      health: overallFunnelHealth(funnelIssues),
      reason: funnelIssues.length > 0 ? funnelIssues.map((i) => i.reason).join('; ') : undefined,
    },
    latency: {
      health: latencyHealth,
      reason: latencyHealth === 'SUSPICIOUS' ? 'Percentile contradicts observed non-zero durations' : latencyHealth === 'UNAVAILABLE' ? 'No valid latency samples' : undefined,
    },
    cost: {
      health: costHealth,
      reason: costHealth === 'UNAVAILABLE' ? 'No cost telemetry' : costHealth !== 'TRUSTED' ? `${Math.round(costCoverage * 100)}% coverage` : undefined,
    },
    extraction: {
      health: extractionCounts.total > 0 ? 'TRUSTED' : 'UNAVAILABLE',
      reason: extractionCounts.total === 0 ? 'No extraction runs recorded' : undefined,
    },
    provider: {
      health: providers.length > 0 ? 'TRUSTED' : 'UNAVAILABLE',
      reason: providers.length === 0 ? 'No AI traces recorded' : undefined,
    },
  }

  const fallbackBreakdown = classifyFallback(fallbackReasons)

  return NextResponse.json({
    range: { start, end },
    insights,
    dataHealth,
    latencyHealth,
    costCoverage,
    fallbackReasons,
    fallbackBreakdown,
    funnel: canonicalFunnel,
    conversationStages: Object.fromEntries(convStageCounts),
    extraction: {
      ...extractionCounts,
      aiExtractions,
      fallbackExtractions,
      avgExtractionTime,
      failedExtractions,
    },
    ai: {
      totalCalls: totalAiCalls,
      totalCost: Math.round(totalAiCost * 100) / 100,
      avgExtractionTime,
      p50Latency: p50,
      p95Latency: p95,
      providers,
    },
    messages: {
      total: messages.length,
      generatedOnly,
      reviewed: reviewedMessages.length,
      unchanged: unchangedMsg,
      lightEdit: lightEditMsg,
      heavyEdit: heavyEditMsg,
      rejected: rejectedMsg,
      dispositions: Object.fromEntries(dispositionCounts),
    },
    relayVsHuman: {
      relayActions: Object.fromEntries(relayActionCounts),
      humanActions: Object.fromEntries(humanActionCounts),
    },
    reps: [...repPerformance.entries()].map(([repId, data]) => ({ repId, repName: repNames.get(repId) ?? 'Former teammate', ...data })),
    identityPerformance,
    daily,
    identities: identities.map((i) => ({ id: i.id, name: i.identity_name, slug: i.slug, title: i.title, channel: i.channel, status: i.status })),
    sourcePerformance,
    fitDistribution: Object.fromEntries(fitCounts),
    confidenceDistribution: confidenceBuckets,
    qualificationDistribution: Object.fromEntries(qualificationCounts),
    activityFeed,
    targets: { total: targets.length, totalTarget: targets.reduce((s, t) => s + t.target_count, 0), totalCompleted: accountability.reduce((s, a) => s + a.completed_count, 0) },
  })
}
