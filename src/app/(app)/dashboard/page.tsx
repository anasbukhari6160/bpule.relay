import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { createScoutStore } from '@/lib/store'
import { createServerSupabase } from '@/lib/supabase/server'
import { buildRoleContext } from '@/lib/relay/role-intelligence'
import { buildRelayQueue } from '@/lib/relay/queue-engine'
import { rankNextActions, type NextBestAction } from '@/lib/relay/next-best-action'
import { logRecommendation } from '@/lib/action-ledger'
import { loadAccountabilityDashboard } from '@/lib/relay/dashboard-loader'
import type { RelayTodayAction } from '@/components/relay-today-workspace'
import type { RelayTaskKind } from '@/lib/domain/types'
import { RepWorkspace, type RepWorkspaceData } from '@/components/rep/rep-workspace'
import { AdminDashboard } from '@/components/dashboard/admin-dashboard'
import { RepDashboard } from '@/components/dashboard/rep-dashboard'
import { PipelineAnalyticsView } from '@/components/dashboard/analytics/pipeline-analytics-view'
import { buildDashboardAnalytics, parseRange, type RangeDays } from '@/lib/analytics/pipeline-analytics'
import { loadBoardData } from '@/lib/leads/board-rows'

export const dynamic = 'force-dynamic'

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const range = parseRange((await searchParams).range)
  const timeZone = user.rep.timezone || 'UTC'
  const analytics = (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsSection range={range} timeZone={timeZone} />
    </Suspense>
  )

  const authCtx = await getAuthContext()
  if (!authCtx) redirect('/login')

  const acData = await loadAccountabilityDashboard()

  if (authCtx.isOwner || authCtx.isAdmin) {
    return (
      <div className="space-y-10">
        <Suspense fallback={<DashboardShellSkeleton />}>
          <AdminDashboard data={acData} />
        </Suspense>
        {analytics}
      </div>
    )
  }

  if (authCtx.isManager && authCtx.managedTeamIds.length > 0) {
    const [repData, teamData] = await Promise.all([
      loadRepWorkspaceData(user.rep.id),
      loadManagerTeamTab(),
    ])

    return (
      <>
        <Suspense fallback={<DashboardShellSkeleton />}>
          <ManagerTodayView
            repData={repData}
            teamData={teamData}
          />
        </Suspense>
        <div className="mt-10">{analytics}</div>
      </>
    )
  }

  // Rep view
  const [repData] = await Promise.all([
    loadRepWorkspaceData(user.rep.id),
  ])

  return (
    <Suspense fallback={<DashboardShellSkeleton />}>
      <RepDashboard data={repData} />
      <div className="mt-10">{analytics}</div>
    </Suspense>
  )
}


function ManagerTodayView({
  repData,
  teamData,
}: {
  repData: RepWorkspaceData
  teamData: { teams: any[]; isOwner: boolean; error?: boolean }
}) {
  return (
    <div className="space-y-6 pb-8">
      <header className="space-y-1.5">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Command Center</p>
        <h1 className="text-display text-[28px] font-light tracking-[-0.02em] text-ink">Team overview</h1>
        <p className="text-[13px] text-graphite">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </header>

      {teamData.error && (
        <div className="flex items-center gap-3 rounded-lg border border-status-warning/30 bg-status-warning/5 px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-status-warning" />
          <p className="text-[12px] text-graphite">Could not load team data. Refresh or try again later.</p>
        </div>
      )}

      <RepWorkspace data={repData} teamData={teamData} mode="manager" />
    </div>
  )
}


async function loadManagerTeamTab() {
  try {
    const authCtx = await getAuthContext()
    if (!authCtx || authCtx.managedTeamIds.length === 0) return { teams: [], isOwner: false }
    const store = await createScoutStore()
    const today = new Date().toISOString().slice(0, 10)
    const teams = await Promise.all(authCtx.managedTeamIds.map(async (teamId) => {
      const [teamInfo, members, targets] = await Promise.all([
        store.getTeamInfo(teamId),
        store.getTeamMembers(teamId),
        store.getTeamTargets(teamId, today),
      ])
      const memberDetails = members.map((member) => {
        const memberTargets = targets.filter((target) => target.repId === member.repId)
        const totalTarget = memberTargets.reduce((sum, target) => sum + target.targetCount, 0)
        const totalCompleted = memberTargets.reduce((sum, target) => sum + target.completedCount, 0)
        return {
          repId: member.repId,
          repName: member.repName,
          role: member.role,
          revenueIdentities: memberTargets.map((target) => ({
            identityName: target.identityName,
            channel: target.channel,
            targets: [{
              activityType: target.activityType,
              targetCount: target.targetCount,
              completedCount: target.completedCount,
              remaining: target.remaining,
              status: target.status,
            }],
          })),
          totalTarget,
          totalCompleted,
          totalRemaining: Math.max(0, totalTarget - totalCompleted),
          attentionReason: memberTargets.some((target) => target.status === 'at_risk' || target.status === 'missed')
            ? `${Math.max(0, totalTarget - totalCompleted)} remaining`
            : null,
        }
      })
      return {
        teamId,
        teamName: teamInfo?.name ?? 'My Team',
        memberCount: members.length,
        totalTarget: memberDetails.reduce((sum, member) => sum + member.totalTarget, 0),
        totalCompleted: memberDetails.reduce((sum, member) => sum + member.totalCompleted, 0),
        totalRemaining: memberDetails.reduce((sum, member) => sum + member.totalRemaining, 0),
        needsAttention: memberDetails.filter((member) => member.attentionReason).length,
        members: memberDetails,
      }
    }))
    return { teams, isOwner: false }
  } catch (err) {
    console.error('loadManagerTeamTab failed:', err)
    return { teams: [], isOwner: false, error: true }
  }
}

async function loadRepWorkspaceData(repId: string): Promise<RepWorkspaceData> {
  const user = await getCurrentUser()
  if (!user || user.rep.id !== repId) {
    throw new Error('Not signed in')
  }

  const store = await createScoutStore()

  const { getDailyWorkspace } = await import('@/lib/auth/workspace')
  const workspace = await getDailyWorkspace()

  const [dash, relayData] = await Promise.all([
    store.getTodayDashboard(),
    store.getRelayQueueData(),
  ])

  const roleContext = buildRoleContext(user.rep, user.organization)
  const queue = buildRelayQueue({
    roleContext,
    queueData: dash.mine,
    followupsDue: dash.followupsDue,
    upwork: dash.upwork,
    conversations: relayData.conversations,
    messagesByLead: relayData.messagesByLead,
    messagesByJob: relayData.messagesByJob,
    assignedProfiles: relayData.assignedProfiles,
    allReps: undefined,
    allLeads: [],
  })

  const { filterQueueByRole } = await import('@/lib/relay/queue-engine')
  const visibleTasks = filterQueueByRole(queue, roleContext.role)

  const profilesPulled = await countProfilesPulled(user.organization.id, user.rep.id)
  const [referredLeads, recentLeads, allUpworkJobs] = await Promise.all([
    store.getReferredLeads(user.rep.id),
    store.getRecentLeads(user.rep.id, 5),
    store.listUpworkJobs().catch(() => []),
  ])
  const upworkJobs = allUpworkJobs
    .filter((j) => j.verdict === 'apply' && j.status !== 'applied')
    .slice(0, 3)
    .map((j) => ({
      id: j.id,
      title: j.title,
      company: j.clientName ?? j.tags[0] ?? 'Client',
      canonicalScore: j.score,
      fitScore: j.score,
    }))

  const totalTarget = workspace.targetSummary?.totalTarget ?? 0
  const totalRemaining = workspace.targetSummary?.totalRemaining ?? 0
  const completionDone = Math.max(0, totalTarget - totalRemaining)

  // Derive resume work: leads with drafts started but not yet sent
  const resumeWork = recentLeads
    .filter((l) => {
      const hasDraft = (l as any).messages?.some((m: any) => m.draftText && !m.sentText)
      const isTerminal = l.status === 'won' || l.status === 'lost' || l.status === 'dead'
      return hasDraft && !isTerminal
    })
    .slice(0, 3)
    .map((l) => ({
      id: l.id,
      company: l.company,
      contactName: (l as any).contactName ?? null,
      lastAction: (l as any).messages?.find((m: any) => m.draftText && !m.sentText)?.type ?? 'draft',
      state: (l as any).status === 'new' ? 'Draft started' : 'In progress',
    }))

  // Canonical ranking via next-best-action.ts — single source of truth
  // Use role-filtered queue so reps don't see admin tasks
  const filteredQueue: typeof queue = {
    ...queue,
    tasks: visibleTasks,
    summary: {
      total: visibleTasks.length,
      urgent: visibleTasks.filter(t => t.priority === 'urgent').length,
      byKind: queue.summary.byKind,
    },
  }
  const rankedActions = rankNextActions({
    queue: filteredQueue,
    leads: dash.mine?.queue ?? [],
    messagesByLead: relayData.messagesByLead,
  })

  // Apply live conversation override — active conversations supersede cold prospect score
  const { evaluateLiveOpportunity, getEffectiveAction } = await import('@/lib/relay/live-opportunity')
  const actions: RelayTodayAction[] = rankedActions.slice(0, 10).map((nba) => {
    const action = nbaToRelayAction(nbaToActionKind, workspace)(nba)

    // Check if this lead has an active live conversation that should override
    const leadId = action.id.replace(/^(reply-|followup-|highfit-|opportunity-|connection-dm-)/, '')
    const messages = (relayData.messagesByLead.get(leadId) ?? []).map(m => ({
      direction: m.direction ?? 'outbound',
      sentText: m.sentText,
      sentAt: m.sentAt,
    }))
    const lead = dash.mine?.queue.find(l => l.id === leadId)

    if (lead && messages.length > 0) {
      const liveState = evaluateLiveOpportunity({
        leadId,
        messages,
        initialAction: action.humanAction,
        initialScore: lead.canonicalScore ?? lead.score ?? 0,
      })

      if (liveState.supersedesInitialScore && liveState.liveAction === 'REPLY_NOW') {
        action.priority = 'urgent'
        action.humanAction = 'REPLY_NOW'
        action.whatHappened = liveState.reason
      }
    }

    return action
  })

  // Log recommendations for observability (non-blocking)
  if (actions.length > 0 && user.organization?.id) {
    Promise.all(actions.slice(0, 5).map(action =>
      logRecommendation({
        orgId: user.organization.id,
        repId: user.rep.id,
        leadId: action.id.startsWith('reply-') || action.id.startsWith('followup-') ? action.id.replace(/^(reply-|followup-|highfit-|opportunity-|connection-dm-)/, '') : null,
        action: action.humanAction,
        priority: action.priority === 'urgent' ? 90 : action.priority === 'high' ? 70 : action.priority === 'medium' ? 50 : 30,
        reason: action.whatHappened,
      })
    )).catch(() => { /* observability failure is non-fatal */ })
  }

  return {
    rep: workspace.rep,
    isWorkingDay: workspace.isWorkingDay,
    hasAssignments: workspace.hasAssignments,
    identities: workspace.targetSummary.byIdentity,
    targetSummary: workspace.targetSummary,
    day: workspace.day,
    nextAction: actions[0] ?? null,
    upNext: actions.slice(1),
    notifications: [],
    profilesPulled,
    referredLeads: referredLeads.map(l => ({
      id: l.id,
      company: l.company,
      score: l.score,
      canonicalScore: l.canonicalScore ?? null,
      displayQualification: l.displayQualification ?? null,
      displayIntelligenceVersion: l.displayIntelligenceVersion ?? null,
      referredAt: l.referralAt ?? null,
    })),
    recentLeads: recentLeads.map(l => ({
      id: l.id,
      company: l.company,
      score: l.score,
      canonicalScore: l.canonicalScore ?? null,
      displayQualification: l.displayQualification ?? null,
      displayIntelligenceVersion: l.displayIntelligenceVersion ?? null,
      createdAt: l.createdAt,
    })),
    upworkJobs,
    completion: { done: completionDone, remaining: totalRemaining },
    resumeWork: resumeWork.map(r => ({
      id: r.id,
      company: r.company,
      contactName: r.contactName,
      lastAction: r.lastAction,
      state: r.state,
    })),
    signalFeed: buildSignalFeedFromActionEvents(dash, recentLeads),
  }
}

async function countProfilesPulled(orgId: string, repId: string): Promise<number> {
  try {
    const supabase = await createServerSupabase()
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const { count } = await supabase
      .from('extraction_runs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('rep_id', repId)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
    return count ?? 0
  } catch {
    return 0
  }
}

/**
 * Maps canonical NextBestAction to RelayTaskKind for UI compatibility.
 * Preserves existing kind values that BdDailyDesk / DoThisNext / UpNext expect.
 */
function nbaToActionKind(action: NextBestAction['action']): RelayTaskKind {
  switch (action) {
    case 'REPLY_NOW': return 'reply_needed'
    case 'SEND_CONNECTION': return 'connection_dm_due'
    case 'SEND_FIRST_DM': return 'connection_dm_due'
    case 'SEND_FOLLOWUP': return 'followup_due'
    case 'RESEARCH': return 'high_fit_lead'
    case 'REVIEW_REFERRAL': return 'admin_review'
    case 'APPLY_UPWORK': return 'job_worth_apply'
    case 'RESUME_DRAFT': return 'proposal_ready'
    case 'WAIT': return 'lead_going_cold'
    default: return 'new_opportunity'
  }
}

/**
 * Maps a NextBestAction to the RelayTodayAction format consumed by BdDailyDesk.
 * No new state model — pure presentation mapping over canonical ranking.
 */
function nbaToRelayAction(
  toKind: typeof nbaToActionKind,
  workspace: { identities: Array<{ identityName: string; title: string | null; channel: string | null }> },
) {
  return (nba: NextBestAction): RelayTodayAction => ({
    id: nba.leadId ?? nba.jobId ?? 'unknown',
    kind: toKind(nba.action),
    priority: nba.priority >= 80 ? 'urgent' as const : nba.priority >= 60 ? 'high' as const : nba.priority >= 40 ? 'medium' as const : 'low' as const,
    title: nba.title,
    subtitle: nba.subtitle,
    href: nba.leadId ? `/leads/${nba.leadId}` : nba.jobId ? `/upwork/${nba.jobId}` : '/dashboard',
    whatHappened: nba.reason,
    whyItMatters: nba.reason,
    whyLines: [nba.reason],
    prepared: null,
    humanAction: nba.action,
    createdAt: nba.dueAt ?? new Date().toISOString(),
    fitScore: null,
    identity: {
      id: null,
      name: workspace.identities[0]?.identityName ?? '',
      title: workspace.identities[0]?.title ?? null,
      channel: workspace.identities[0]?.channel ?? null,
    },
    proof: null,
    inbound: nba.channel === 'INBOUND',
  })
}

async function loadAnalytics(range: RangeDays, timeZone: string) {
  try {
    const board = await loadBoardData()
    const data = buildDashboardAnalytics({
      leads: board.leads,
      events: board.events,
      reps: board.orgView ? board.reps : undefined,
      range,
      timeZone,
    })
    return { data, scope: board.orgView ? ('team' as const) : ('mine' as const) }
  } catch (err) {
    console.error('dashboard analytics failed:', err instanceof Error ? err.message : 'unknown error')
    return null
  }
}

async function AnalyticsSection({ range, timeZone }: { range: RangeDays; timeZone: string }) {
  const result = await loadAnalytics(range, timeZone)
  if (!result) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-lg border border-status-warning/30 bg-status-warning/5 px-4 py-3">
        <AlertTriangle className="size-4 shrink-0 text-status-warning" />
        <p className="text-[12px] text-graphite">Performance charts could not load. Your tasks above are unaffected. Refresh to try again.</p>
      </div>
    )
  }
  return <PipelineAnalyticsView data={result.data} scope={result.scope} />
}

/**
 * Build signal feed items from recent leads with high scores.
 * Uses stored intelligence to surface meaningful changes.
 */
function buildSignalFeedFromActionEvents(
  dash: { followupsDue: { lead: { id: string; company: string; contactName?: string | null; canonicalScore?: number | null } }[] },
  recentLeads: Array<{ id: string; company: string; canonicalScore?: number | null; createdAt: string }>,
) {
  const items = recentLeads
    .filter(l => (l.canonicalScore ?? 0) >= 70)
    .slice(0, 3)
    .map((l, i) => ({
      id: `feed-${l.id}`,
      leadId: l.id,
      company: l.company,
      contactName: null,
      title: `High-value lead (${l.canonicalScore}/100)`,
      detail: `Score ${l.canonicalScore}/100 — worth pursuing`,
      severity: 'notable' as const,
      type: 'BUYER_REQUEST' as const,
      createdAt: l.createdAt,
      rankScore: (l.canonicalScore ?? 0) * (1 - i * 0.1),
      cta: 'Review',
    }))
  return items
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading performance charts">
      <div className="h-6 w-56 rounded bg-bone" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[132px] rounded-xl border border-line bg-bone-raised" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-[320px] rounded-xl border border-line bg-bone-raised lg:col-span-2" />
        <div className="h-[320px] rounded-xl border border-line bg-bone-raised" />
      </div>
    </div>
  )
}

function DashboardShellSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <header className="space-y-2">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Your Relay / Today</p>
        <div className="h-8 w-72 max-w-full rounded bg-bone" />
        <div className="h-3.5 w-64 max-w-full rounded bg-bone" />
      </header>
      <div className="srf-console srf-console-edge hero-console-pulse overflow-hidden p-5 sm:p-6">
        <div className="h-3 w-16 rounded bg-bone" />
        <div className="mt-4 h-7 w-80 max-w-full rounded bg-bone" />
        <div className="mt-2 h-3.5 w-64 max-w-full rounded bg-bone" />
        <div className="mt-4 h-24 w-full rounded bg-bone" />
      </div>
      <section className="space-y-3">
        <div className="h-3 w-24 rounded bg-bone" />
        <div className="overflow-hidden rounded border border-line bg-bone-raised">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line/70 px-3 py-3 last:border-b-0">
              <span className="w-7 text-mono-medium text-[11px] text-stone/75">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-40 max-w-full rounded bg-bone" />
                <div className="h-3 w-56 max-w-full rounded bg-bone" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
