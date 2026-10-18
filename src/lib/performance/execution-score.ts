/**
 * Weighted Action Performance System — Execution Score
 *
 * Builds a performance layer on top of the Action Ledger.
 * Does NOT modify action_events. Does NOT change daily_targets.
 *
 * Pure functions only — reads data, computes scores. No I/O.
 */

// ── Canonical Action Categories ────────────────────────────────────────────

export type CanonicalAction =
  | 'CONNECTION_SENT'
  | 'FIRST_DM_SENT'
  | 'FOLLOWUP_SENT'
  | 'REPLY_SENT'
  | 'MEETING_BOOKED'
  | 'LEAD_WON'
  | 'UPWORK_APPLIED'
  | 'UPWORK_REPLY'
  | 'UPWORK_INTERVIEW'
  | 'UPWORK_WON'

// ── Config Validation ────────────────────────────────────────────────────────

const VALID_ACTIONS = new Set<string>([
  'CONNECTION_SENT', 'FIRST_DM_SENT', 'FOLLOWUP_SENT', 'REPLY_SENT',
  'MEETING_BOOKED', 'LEAD_WON', 'UPWORK_APPLIED', 'UPWORK_REPLY',
  'UPWORK_INTERVIEW', 'UPWORK_WON',
])

export interface ConfigValidationResult {
  valid: boolean
  errors: string[]
  sanitized: Record<CanonicalAction, number>
}

export function validatePerformanceConfig(input: {
  weights?: Record<string, unknown>
  capRatio?: unknown
  funnelBalanceThreshold?: unknown
  slaThresholdsMs?: Record<string, unknown>
}): ConfigValidationResult {
  const errors: string[] = []
  const sanitized: Record<CanonicalAction, number> = { ...DEFAULT_WEIGHTS }

  if (input.weights && typeof input.weights === 'object') {
    let hasValidWeight = false
    let hasPositiveWeight = false
    for (const [key, val] of Object.entries(input.weights)) {
      if (!VALID_ACTIONS.has(key)) {
        continue // skip unknown actions silently
      }
      if (typeof val !== 'number' || Number.isNaN(val)) {
        errors.push(`Weight for "${key}" is not a valid number`)
        continue
      }
      if (val < 0) {
        errors.push(`Weight for "${key}" is negative (${val})`)
        continue
      }
      sanitized[key as CanonicalAction] = val
      hasValidWeight = true
      if (val > 0) hasPositiveWeight = true
    }
    if (!hasValidWeight) {
      errors.push('All weights are invalid — using defaults')
    } else if (!hasPositiveWeight) {
      errors.push('All weights are zero — at least one must be positive')
    }
  }

  if (input.capRatio !== undefined) {
    const cap = Number(input.capRatio)
    if (Number.isNaN(cap) || cap < 1 || cap > 5) {
      errors.push(`capRatio must be 1–5, got ${cap}`)
    }
  }

  const valid = errors.length === 0 && Object.values(sanitized).some((v) => v > 0)
  return {
    valid,
    errors,
    sanitized: valid ? sanitized : { ...DEFAULT_WEIGHTS },
  }
}

// ── Default Weights ─────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: Record<CanonicalAction, number> = {
  CONNECTION_SENT: 1.0,
  FIRST_DM_SENT: 1.5,
  FOLLOWUP_SENT: 1.3,
  REPLY_SENT: 2.0,
  MEETING_BOOKED: 4.0,
  LEAD_WON: 8.0,
  UPWORK_APPLIED: 1.2,
  UPWORK_REPLY: 2.0,
  UPWORK_INTERVIEW: 4.0,
  UPWORK_WON: 8.0,
}

// ── Configuration ──────────────────────────────────────────────────────────

export interface PerformanceConfig {
  weights: Record<CanonicalAction, number>
  capRatio: number
  slaThresholdsMs: {
    replyUrgent: number
    replyOverdue: number
    followupOverdue: number
    connectionDmWaiting: number
  }
  funnelBalanceThreshold: number
}

export const DEFAULT_CONFIG: PerformanceConfig = {
  weights: { ...DEFAULT_WEIGHTS },
  capRatio: 1.25,
  slaThresholdsMs: {
    replyUrgent: 2 * 60 * 60 * 1000,
    replyOverdue: 4 * 60 * 60 * 1000,
    followupOverdue: 24 * 60 * 60 * 1000,
    connectionDmWaiting: 12 * 60 * 60 * 1000,
  },
  funnelBalanceThreshold: 0.4,
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ActionTarget {
  action: CanonicalAction
  target: number
  actual: number
  eligibleTarget: number
}

export interface ActionCompletion {
  action: CanonicalAction
  actual: number
  target: number
  eligibleTarget: number
  rawRatio: number
  cappedRatio: number
  weight: number
  weightedScore: number
}

export interface FunnelWarning {
  level: 'urgent' | 'warning' | 'info'
  stage: string
  message: string
  eligibleCount?: number
}

export interface SLAHealth {
  score: number
  urgentReplies: number
  overdueFollowups: number
  waitingConnections: number
  totalPending: number
}

export interface OutcomeMetrics {
  connectionAcceptanceRate: number
  dmReplyRate: number
  followupReplyRate: number
  meetingRate: number
  winRate: number
}

export interface ExecutionResult {
  repId: string
  repName: string
  date: string
  period: 'daily' | 'weekly' | 'monthly'
  completions: ActionCompletion[]
  executionHealth: number
  totalWeight: number
  weightedScoreSum: number
  warnings: FunnelWarning[]
  sla: SLAHealth
  outcomes: OutcomeMetrics
  state: PerformanceState
  primaryBottleneck: string | null
  primaryNextAction: string | null
  explainability: string
}

export type PerformanceState =
  | 'ON_TRACK'
  | 'NEEDS_ATTENTION'
  | 'BEHIND'
  | 'BLOCKED'
  | 'CAUGHT_UP'

// ── Eligible Targets ────────────────────────────────────────────────────────

export interface EligibleWork {
  connectionsAccepted: number
  dmsSent: number
  followupsSent: number
  repliesReceived: number
  meetingsBooked: number
  inboundRepliesWaiting: number
  connectionsWaitingForDm: number
  leadsReadyForFollowup: number
}

export function computeEligibleTargets(
  targets: ActionTarget[],
  eligible: EligibleWork,
): ActionTarget[] {
  return targets.map((t) => {
    let eligibleTarget = t.target
    switch (t.action) {
      case 'FIRST_DM_SENT':
        eligibleTarget = Math.min(t.target, eligible.connectionsWaitingForDm)
        break
      case 'FOLLOWUP_SENT':
        eligibleTarget = Math.min(t.target, eligible.leadsReadyForFollowup)
        break
      case 'REPLY_SENT':
        eligibleTarget = Math.min(t.target, eligible.inboundRepliesWaiting)
        break
      default:
        eligibleTarget = t.target
    }
    return { ...t, eligibleTarget }
  })
}

// ── Execution Health Score ──────────────────────────────────────────────────

export function computeActionCompletions(
  targets: ActionTarget[],
  config: PerformanceConfig,
): ActionCompletion[] {
  return targets.map((t) => {
    const effectiveTarget = t.eligibleTarget > 0 ? t.eligibleTarget : t.target
    const rawRatio = effectiveTarget > 0 ? t.actual / effectiveTarget : 0
    const cappedRatio = Math.min(rawRatio, config.capRatio)
    const weight = config.weights[t.action] ?? 1.0
    const weightedScore = weight * cappedRatio
    return {
      action: t.action,
      actual: t.actual,
      target: t.target,
      eligibleTarget: t.eligibleTarget,
      rawRatio,
      cappedRatio,
      weight,
      weightedScore,
    }
  })
}

export function computeExecutionHealth(completions: ActionCompletion[]): {
  score: number
  totalWeight: number
  weightedScoreSum: number
} {
  const totalWeight = completions.reduce((s, c) => s + c.weight, 0)
  const weightedScoreSum = completions.reduce((s, c) => s + c.weightedScore, 0)
  const score = totalWeight > 0 ? Math.round((weightedScoreSum / totalWeight) * 100) : 0
  return { score, totalWeight, weightedScoreSum }
}

// ── Funnel Balance Warnings ─────────────────────────────────────────────────

export function computeFunnelWarnings(
  completions: ActionCompletion[],
  eligible: EligibleWork,
  config: PerformanceConfig,
): FunnelWarning[] {
  const warnings: FunnelWarning[] = []
  const find = (a: CanonicalAction) => completions.find((c) => c.action === a)

  const conn = find('CONNECTION_SENT')
  const dm = find('FIRST_DM_SENT')
  const followup = find('FOLLOWUP_SENT')
  const reply = find('REPLY_SENT')

  // Top-heavy: connections high, DMs low
  if (conn && dm && conn.cappedRatio >= 0.8 && dm.rawRatio < config.funnelBalanceThreshold) {
    warnings.push({
      level: 'warning',
      stage: 'first_dm',
      message: `Strong prospecting volume, but first DMs are behind target (${Math.round(dm.rawRatio * 100)}%).`,
      eligibleCount: eligible.connectionsWaitingForDm,
    })
  }

  // DM high, followup low
  if (dm && followup && dm.cappedRatio >= 0.7 && followup.rawRatio < config.funnelBalanceThreshold) {
    warnings.push({
      level: 'warning',
      stage: 'followup',
      message: `First DMs healthy, but follow-ups are behind (${Math.round(followup.rawRatio * 100)}%).`,
    })
  }

  // Replies waiting critically
  if (eligible.inboundRepliesWaiting > 0 && (!reply || reply.actual === 0)) {
    warnings.push({
      level: 'urgent',
      stage: 'reply',
      message: `${eligible.inboundRepliesWaiting} inbound replies waiting — no replies sent yet.`,
      eligibleCount: eligible.inboundRepliesWaiting,
    })
  }

  // Connections waiting for DM
  if (eligible.connectionsWaitingForDm >= 3) {
    warnings.push({
      level: 'warning',
      stage: 'first_dm',
      message: `${eligible.connectionsWaitingForDm} accepted connections are waiting for a first DM.`,
      eligibleCount: eligible.connectionsWaitingForDm,
    })
  }

  return warnings
}

// ── SLA Health ──────────────────────────────────────────────────────────────

export interface SLAItem {
  replyWaitMs?: number
  followupDueMs?: number
  connectionAcceptedMs?: number
}

export function computeSLAHealth(
  pending: SLAItem[],
  config: PerformanceConfig,
): SLAHealth {
  let urgentReplies = 0
  let overdueFollowups = 0
  let waitingConnections = 0

  for (const item of pending) {
    if (item.replyWaitMs !== undefined) {
      if (item.replyWaitMs > config.slaThresholdsMs.replyOverdue) urgentReplies++
      else if (item.replyWaitMs > config.slaThresholdsMs.replyUrgent) urgentReplies++
    }
    if (item.followupDueMs !== undefined && item.followupDueMs > config.slaThresholdsMs.followupOverdue) {
      overdueFollowups++
    }
    if (item.connectionAcceptedMs !== undefined && item.connectionAcceptedMs > config.slaThresholdsMs.connectionDmWaiting) {
      waitingConnections++
    }
  }

  const totalPending = pending.length
  const totalIssues = urgentReplies + overdueFollowups + waitingConnections
  const score = totalPending > 0 ? Math.round(((totalPending - totalIssues) / totalPending) * 100) : 100

  return { score, urgentReplies, overdueFollowups, waitingConnections, totalPending }
}

// ── Outcome Metrics ─────────────────────────────────────────────────────────

export function computeOutcomes(data: {
  connectionsSent: number
  connectionsAccepted: number
  dmsSent: number
  dmReplies: number
  followupsSent: number
  followupReplies: number
  meetingsBooked: number
  leadsContacted: number
  wins: number
}): OutcomeMetrics {
  return {
    connectionAcceptanceRate: data.connectionsSent > 0 ? data.connectionsAccepted / data.connectionsSent : 0,
    dmReplyRate: data.dmsSent > 0 ? data.dmReplies / data.dmsSent : 0,
    followupReplyRate: data.followupsSent > 0 ? data.followupReplies / data.followupsSent : 0,
    meetingRate: data.leadsContacted > 0 ? data.meetingsBooked / data.leadsContacted : 0,
    winRate: data.leadsContacted > 0 ? data.wins / data.leadsContacted : 0,
  }
}

// ── Performance State ───────────────────────────────────────────────────────

export function determinePerformanceState(
  executionHealth: number,
  warnings: FunnelWarning[],
  eligible: EligibleWork,
  hasOpenTargets: boolean = true,
): PerformanceState {
  if (executionHealth >= 90) return 'CAUGHT_UP'
  if (!hasOpenTargets) return 'CAUGHT_UP'
  if (executionHealth >= 70) return 'ON_TRACK'
  if (warnings.some((w) => w.level === 'urgent')) return 'BEHIND'
  if (executionHealth >= 40) return 'NEEDS_ATTENTION'
  return 'BEHIND'
}

// ── Explainability ──────────────────────────────────────────────────────────

export function buildExplainability(result: Omit<ExecutionResult, 'explainability'>): string {
  const parts: string[] = []
  for (const c of result.completions) {
    const label = c.action.replace(/_/g, ' ').toLowerCase()
    parts.push(`${label}: ${Math.round(c.rawRatio * 100)}%`)
  }
  const primaryWarning = result.warnings[0]
  if (primaryWarning) {
    parts.push(`Issue: ${primaryWarning.message}`)
  }
  return parts.join(' • ')
}

// ── Main Entry Point ────────────────────────────────────────────────────────

export interface ComputeExecutionParams {
  repId: string
  repName: string
  date: string
  targets: ActionTarget[]
  eligible: EligibleWork
  pending: SLAItem[]
  outcomeData: {
    connectionsSent: number
    connectionsAccepted: number
    dmsSent: number
    dmReplies: number
    followupsSent: number
    followupReplies: number
    meetingsBooked: number
    leadsContacted: number
    wins: number
  }
  config?: Partial<PerformanceConfig>
}

export function computeExecutionResult(params: ComputeExecutionParams): ExecutionResult {
  const config: PerformanceConfig = {
    ...DEFAULT_CONFIG,
    ...params.config,
    weights: { ...DEFAULT_CONFIG.weights, ...params.config?.weights },
    slaThresholdsMs: { ...DEFAULT_CONFIG.slaThresholdsMs, ...params.config?.slaThresholdsMs },
  }

  const eligibleTargets = computeEligibleTargets(params.targets, params.eligible)
  const completions = computeActionCompletions(eligibleTargets, config)
  const { score, totalWeight, weightedScoreSum } = computeExecutionHealth(completions)
  const warnings = computeFunnelWarnings(completions, params.eligible, config)
  const sla = computeSLAHealth(params.pending, config)
  const outcomes = computeOutcomes(params.outcomeData)
  const hasOpenTargets = params.targets.some((t) => t.target > 0)
  const state = determinePerformanceState(score, warnings, params.eligible, hasOpenTargets)

  const primaryWarning = warnings[0] ?? null
  const primaryBottleneck = primaryWarning ? primaryWarning.stage : null
  const primaryNextAction = primaryWarning
    ? primaryWarning.message.replace(/\d+%/, 'behind').replace(/^(\d+)\s/, '$1 leads ')
    : null

  const result: Omit<ExecutionResult, 'explainability'> = {
    repId: params.repId,
    repName: params.repName,
    date: params.date,
    period: 'daily',
    completions,
    executionHealth: score,
    totalWeight,
    weightedScoreSum,
    warnings,
    sla,
    outcomes,
    state,
    primaryBottleneck,
    primaryNextAction,
  }

  return {
    ...result,
    explainability: buildExplainability(result),
  }
}

// ── Helper: Map action_events to canonical ──────────────────────────────────

export function mapActionEventToCanonical(actionType: string): CanonicalAction | null {
  const map: Record<string, CanonicalAction> = {
    CONNECTION_SENT: 'CONNECTION_SENT',
    DM_SENT: 'FIRST_DM_SENT',
    FOLLOWUP_SENT: 'FOLLOWUP_SENT',
    REPLY_SENT: 'REPLY_SENT',
    UPWORK_APPLIED: 'UPWORK_APPLIED',
  }
  return map[actionType] ?? null
}
