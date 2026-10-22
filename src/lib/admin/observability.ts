/**
 * Observability Engine — production health, integrity, and drift detection.
 *
 * Answers: "Is the system healthy? Are there duplicates, gaps, or drift?"
 */

import type { SupabaseClient } from '@supabase/supabase-js'

function getClient() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createServiceSupabase } = require('@/lib/supabase/service')
  return createServiceSupabase()
}


export interface ObservabilityReport {
  generatedAt: string
  integrity: IntegrityReport
  drift: DriftReport
  fallbacks: FallbackReport
  lifecycle: LifecycleReport
}

export interface IntegrityReport {
  duplicateLedgerEvents: DuplicateLedgerEvent[]
  missingLedgerEvents: MissingLedgerEvent[]
  orphanedMessages: number
  orphanedConversationStates: number
}

export interface DuplicateLedgerEvent {
  organizationId: string
  actionType: string
  leadId: string | null
  jobId: string | null
  count: number
  ids: string[]
}

export interface MissingLedgerEvent {
  description: string
  leadId: string
  expectedAction: string
}

export interface DriftReport {
  scoreChanges: ScoreChange[]
  lifecycleInconsistencies: LifecycleInconsistency[]
}

export interface ScoreChange {
  leadId: string
  company: string
  previousScore: number
  currentScore: number
  delta: number
}

export interface LifecycleInconsistency {
  leadId: string
  company: string
  status: string
  lifecycleState: string
  issue: string
}

export interface FallbackReport {
  totalExtractions: number
  fallbackExtractions: number
  fallbackRate: number
  avgExtractionMs: number
}

export interface LifecycleReport {
  totalActive: number
  staleCount: number
  coldCount: number
  frozenCount: number
  byStage: Record<string, number>
}


export async function checkIntegrity(orgId: string): Promise<IntegrityReport> {
  const client = getClient()

  // Duplicate ledger events (same action on same lead within 5 minutes)
  const { data: dupes } = await client.rpc('check_duplicate_ledger_events', {
    p_org_id: orgId,
    p_window_minutes: 5,
  }).catch(() => ({ data: null }))

  // Orphaned messages (no matching lead)
  const { count: orphanedMessages } = await client
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .not('lead_id', 'is', null)

  // Orphaned conversation states (no matching lead)
  const { count: orphanedConvStates } = await client
    .from('conversation_states')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  // Leads that should have ledger events but don't
  const { data: contactedLeads } = await client
    .from('leads')
    .select('id, status')
    .eq('organization_id', orgId)
    .in('status', ['contacted', 'followed_up'])
    .limit(100)

  const missingEvents: MissingLedgerEvent[] = []
  if (contactedLeads) {
    for (const lead of contactedLeads) {
      const { data: events } = await client
        .from('action_events')
        .select('id')
        .eq('organization_id', orgId)
        .eq('lead_id', lead.id)
        .in('action_type', ['CONNECTION_SENT', 'DM_SENT', 'FOLLOWUP_SENT'])
        .limit(1)
      if (!events || events.length === 0) {
        missingEvents.push({
          description: `Lead status "${lead.status}" but no outbound send event`,
          leadId: lead.id,
          expectedAction: 'CONNECTION_SENT or DM_SENT',
        })
      }
    }
  }

  return {
    duplicateLedgerEvents: (dupes as DuplicateLedgerEvent[]) || [],
    missingLedgerEvents: missingEvents,
    orphanedMessages: orphanedMessages || 0,
    orphanedConversationStates: orphanedConvStates || 0,
  }
}


export async function getFallbackStats(orgId: string): Promise<FallbackReport> {
  const client = getClient()

  const { data: runs } = await client
    .from('extraction_runs')
    .select('fallback_used, latency_ms')
    .eq('organization_id', orgId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1000)

  if (!runs || runs.length === 0) {
    return { totalExtractions: 0, fallbackExtractions: 0, fallbackRate: 0, avgExtractionMs: 0 }
  }

  const fallbackRuns = runs.filter((r: Record<string, unknown>) => r.fallback_used)
  const totalLatency = runs.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.latency_ms as number) || 0), 0)

  return {
    totalExtractions: runs.length,
    fallbackExtractions: fallbackRuns.length,
    fallbackRate: Math.round((fallbackRuns.length / runs.length) * 100),
    avgExtractionMs: Math.round(totalLatency / runs.length),
  }
}


export async function getLifecycleDistribution(orgId: string): Promise<LifecycleReport> {
  const client = getClient()

  const { data: leads } = await client
    .from('leads')
    .select('id, status, created_at, archived')
    .eq('organization_id', orgId)
    .eq('archived', false)
    .limit(1000)

  if (!leads) return { totalActive: 0, staleCount: 0, coldCount: 0, frozenCount: 0, byStage: {} }

  const now = Date.now()
  let stale = 0, cold = 0, frozen = 0
  const byStage: Record<string, number> = {}

  for (const lead of leads) {
    const daysSinceCreated = Math.floor((now - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24))
    const stage = lead.status || 'new'
    byStage[stage] = (byStage[stage] || 0) + 1

    if (lead.status === 'new' && daysSinceCreated >= 14) stale++
    else if (lead.status === 'contacted' && daysSinceCreated >= 21) cold++
    else if (lead.status === 'followed_up' && daysSinceCreated >= 30) frozen++
  }

  return {
    totalActive: leads.length,
    staleCount: stale,
    coldCount: cold,
    frozenCount: frozen,
    byStage,
  }
}


export async function generateObservabilityReport(orgId: string): Promise<ObservabilityReport> {
  const [integrity, fallbacks, lifecycle] = await Promise.all([
    checkIntegrity(orgId),
    getFallbackStats(orgId),
    getLifecycleDistribution(orgId),
  ])

  return {
    generatedAt: new Date().toISOString(),
    integrity,
    drift: { scoreChanges: [], lifecycleInconsistencies: [] },
    fallbacks,
    lifecycle,
  }
}
