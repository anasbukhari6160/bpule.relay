import { describe, it, expect } from 'vitest'
import {
  computeExecutionResult,
  computeEligibleTargets,
  computeActionCompletions,
  computeExecutionHealth,
  computeFunnelWarnings,
  computeSLAHealth,
  determinePerformanceState,
  DEFAULT_CONFIG,
  type ActionTarget,
  type EligibleWork,
} from '@/lib/performance/execution-score'

function makeTargets(partial: Record<string, { target: number; actual: number }>): ActionTarget[] {
  return Object.entries(partial).map(([action, { target, actual }]) => ({
    action: action as any,
    target,
    actual,
    eligibleTarget: target,
  }))
}

const emptyEligible: EligibleWork = {
  connectionsAccepted: 0,
  dmsSent: 0,
  followupsSent: 0,
  repliesReceived: 0,
  meetingsBooked: 0,
  inboundRepliesWaiting: 0,
  connectionsWaitingForDm: 0,
  leadsReadyForFollowup: 0,
}

function makeParams(overrides: {
  targets: Record<string, { target: number; actual: number }>
  eligible?: Partial<EligibleWork>
  pending?: any[]
}) {
  return {
    repId: 'rep-1',
    repName: 'Test Rep',
    date: '2026-10-19',
    targets: makeTargets(overrides.targets),
    eligible: { ...emptyEligible, ...overrides.eligible },
    pending: overrides.pending ?? [],
    outcomeData: {
      connectionsSent: overrides.targets['CONNECTION_SENT']?.actual ?? 0,
      connectionsAccepted: overrides.eligible?.connectionsAccepted ?? 0,
      dmsSent: overrides.targets['FIRST_DM_SENT']?.actual ?? 0,
      dmReplies: 0,
      followupsSent: overrides.targets['FOLLOWUP_SENT']?.actual ?? 0,
      followupReplies: 0,
      meetingsBooked: 0,
      leadsContacted: 10,
      wins: 0,
    },
  }
}

describe('Execution Score — spec test cases', () => {
  // Test A: 20 connections / 3 DMs → high connection completion, low DM, warning
  it('A: high connections + low DM → warning, not excellent', () => {
    const result = computeExecutionResult(makeParams({
      targets: {
        CONNECTION_SENT: { target: 10, actual: 20 },
        FIRST_DM_SENT: { target: 15, actual: 3 },
        FOLLOWUP_SENT: { target: 10, actual: 0 },
        REPLY_SENT: { target: 5, actual: 0 },
      },
      eligible: { connectionsAccepted: 20, connectionsWaitingForDm: 17 },
    }))

    expect(result.completions.find(c => c.action === 'CONNECTION_SENT')!.cappedRatio).toBe(DEFAULT_CONFIG.capRatio)
    expect(result.completions.find(c => c.action === 'FIRST_DM_SENT')!.rawRatio).toBeCloseTo(0.2, 1)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].stage).toBe('first_dm')
    expect(result.executionHealth).toBeLessThan(70)
  })

  // Test B: 8/8/5 → balanced execution, high score
  it('B: balanced execution → high score', () => {
    const result = computeExecutionResult(makeParams({
      targets: {
        CONNECTION_SENT: { target: 10, actual: 8 },
        FIRST_DM_SENT: { target: 10, actual: 8 },
        FOLLOWUP_SENT: { target: 10, actual: 8 },
        REPLY_SENT: { target: 5, actual: 5 },
      },
      eligible: { connectionsAccepted: 8, connectionsWaitingForDm: 0, inboundRepliesWaiting: 0 },
    }))

    expect(result.executionHealth).toBeGreaterThan(70)
    expect(result.state).toBe('ON_TRACK')
  })

  // Test C: 0 replies received → rep not penalized for reply count
  it('C: no inbound replies → no penalty on reply target', () => {
    const result = computeExecutionResult(makeParams({
      targets: {
        CONNECTION_SENT: { target: 10, actual: 5 },
        FIRST_DM_SENT: { target: 15, actual: 8 },
        REPLY_SENT: { target: 5, actual: 0 },
      },
      eligible: { inboundRepliesWaiting: 0 },
    }))

    // REPLY_SENT should have eligibleTarget = 0 (no inbound waiting), so no penalty
    const replyCompletion = result.completions.find(c => c.action === 'REPLY_SENT')!
    expect(replyCompletion.eligibleTarget).toBe(0)
  })

  // Test D: 5 inbound / 0 replies sent → critical warning
  it('D: inbound waiting but no replies → urgent warning', () => {
    const result = computeExecutionResult(makeParams({
      targets: {
        REPLY_SENT: { target: 5, actual: 0 },
      },
      eligible: { inboundRepliesWaiting: 5 },
    }))

    expect(result.warnings.some(w => w.level === 'urgent')).toBe(true)
  })

  // Test E: duplicates don't inflate → idempotency is caller's responsibility
  it('E: raw values passed in are counted as-is (idempotency upstream)', () => {
    // If caller passes 20 (deduped), we count 20
    const result = computeExecutionResult(makeParams({
      targets: {
        CONNECTION_SENT: { target: 10, actual: 20 },
      },
    }))

    const conn = result.completions.find(c => c.action === 'CONNECTION_SENT')!
    expect(conn.actual).toBe(20)
    expect(conn.cappedRatio).toBe(DEFAULT_CONFIG.capRatio) // capped
  })

  // Test F: no eligible work → CAUGHT_UP, not BEHIND
  it('F: no eligible work → CAUGHT_UP', () => {
    const result = computeExecutionResult(makeParams({
      targets: {
        CONNECTION_SENT: { target: 10, actual: 10 },
        FIRST_DM_SENT: { target: 15, actual: 15 },
        FOLLOWUP_SENT: { target: 10, actual: 10 },
        REPLY_SENT: { target: 5, actual: 5 },
      },
      eligible: { connectionsWaitingForDm: 0, inboundRepliesWaiting: 0, leadsReadyForFollowup: 0 },
    }))

    expect(result.state).toBe('CAUGHT_UP')
  })

  // Test G: lead won → outcome credit, doesn't erase poor daily
  it('G: wins boost outcomes but not execution health', () => {
    const result = computeExecutionResult({
      ...makeParams({
        targets: {
          CONNECTION_SENT: { target: 10, actual: 2 },
          FIRST_DM_SENT: { target: 15, actual: 1 },
        },
      }),
      outcomeData: {
        connectionsSent: 2,
        connectionsAccepted: 2,
        dmsSent: 1,
        dmReplies: 0,
        followupsSent: 0,
        followupReplies: 0,
        meetingsBooked: 0,
        leadsContacted: 10,
        wins: 3,
      },
    })

    expect(result.outcomes.winRate).toBeCloseTo(0.3, 1)
    expect(result.executionHealth).toBeLessThan(50)
  })

  // Weighted importance: LEAD_WON (8.0) matters more than CONNECTION_SENT (1.0)
  it('weights: LEAD_WON has 8x impact of CONNECTION_SENT', () => {
    const connWeight = DEFAULT_CONFIG.weights['CONNECTION_SENT']
    const winWeight = DEFAULT_CONFIG.weights['LEAD_WON']
    expect(winWeight / connWeight).toBe(8)
  })

  // Capped completion: 200% actual/target → capped at 125%
  it('caps completion ratio at config.capRatio', () => {
    const targets = makeTargets({ CONNECTION_SENT: { target: 10, actual: 50 } })
    const completions = computeActionCompletions(targets, DEFAULT_CONFIG)
    expect(completions[0].cappedRatio).toBe(DEFAULT_CONFIG.capRatio)
    expect(completions[0].rawRatio).toBe(5)
  })

  // Funnel balance: connections high + DM low → specific warning
  it('funnel balance: top-heavy triggers warning', () => {
    const completions = [
      { action: 'CONNECTION_SENT' as const, actual: 20, target: 10, eligibleTarget: 10, rawRatio: 2, cappedRatio: 1.25, weight: 1, weightedScore: 1.25 },
      { action: 'FIRST_DM_SENT' as const, actual: 2, target: 20, eligibleTarget: 20, rawRatio: 0.1, cappedRatio: 0.1, weight: 1.5, weightedScore: 0.15 },
    ]
    const eligible: EligibleWork = { ...emptyEligible, connectionsWaitingForDm: 18 }
    const warnings = computeFunnelWarnings(completions, eligible, DEFAULT_CONFIG)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].message).toContain('first DM')
  })

  // SLA health: pending replies reduce score
  it('SLA: overdue replies reduce health score', () => {
    const pending = [
      { replyWaitMs: 5 * 60 * 60 * 1000 }, // 5h — over urgent (2h)
    ]
    const sla = computeSLAHealth(pending, DEFAULT_CONFIG)
    expect(sla.urgentReplies).toBe(1)
    expect(sla.score).toBe(0) // 1 pending, 1 issue = 0%
  })

  // Eligible targets: DM target capped by connections waiting
  it('eligible: DM target reduced to connections waiting', () => {
    const targets = makeTargets({ FIRST_DM_SENT: { target: 15, actual: 0 } })
    const eligible: EligibleWork = { ...emptyEligible, connectionsWaitingForDm: 6 }
    const result = computeEligibleTargets(targets, eligible)
    expect(result[0].eligibleTarget).toBe(6)
  })

  // Performance state: BEHIND when urgent warning
  it('state: urgent warning → BEHIND', () => {
    const state = determinePerformanceState(30, [{ level: 'urgent', stage: 'reply', message: 'test' }], emptyEligible)
    expect(state).toBe('BEHIND')
  })

  // Performance state: CAUGHT_UP when health >= 90
  it('state: high health → CAUGHT_UP', () => {
    const state = determinePerformanceState(95, [], emptyEligible)
    expect(state).toBe('CAUGHT_UP')
  })
})
