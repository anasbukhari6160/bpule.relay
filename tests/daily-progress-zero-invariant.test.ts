import { describe, it, expect } from 'vitest'
import { computeDailyProgress } from '@/lib/performance/daily-progress'

describe('Today\'s Progress — zero-action invariant', () => {
  it('A: 0 real actions, 45 prospects, 0 replies/followups → 0%', () => {
    const result = computeDailyProgress({
      totalTarget: 45,
      totalCompleted: 0,
      totalRemaining: 45,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 45,
    })
    expect(result.progressPct).toBe(0)
    expect(result.completedActions).toBe(0)
    expect(result.status).toBe('NO_WORK')
  })

  it('B: 5/10 connections, nothing else → 50%', () => {
    const result = computeDailyProgress({
      totalTarget: 10,
      totalCompleted: 5,
      totalRemaining: 5,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 5,
    })
    expect(result.progressPct).toBe(50)
    expect(result.completedActions).toBe(5)
    expect(result.status).toBe('IN_PROGRESS')
  })

  it('C: 10/10 connections, 0/5 eligible DMs → weighted result reflects DM deficit', () => {
    const result = computeDailyProgress({
      totalTarget: 15,
      totalCompleted: 10,
      totalRemaining: 5,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 5,
    })
    expect(result.completedActions).toBe(10)
    expect(result.pendingWork).toBe(5)
    expect(result.progressPct).toBe(67) // 10 / 15 * 100
  })

  it('D: 10/10 connections, DMs not eligible → connections can reach 100%', () => {
    const result = computeDailyProgress({
      totalTarget: 10,
      totalCompleted: 10,
      totalRemaining: 0,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 0,
    })
    expect(result.progressPct).toBe(100)
    expect(result.status).toBe('COMPLETE')
  })

  it('E: 0 eligible work anywhere, 0 completed → 0% CAUGHT_UP', () => {
    const result = computeDailyProgress({
      totalTarget: 0,
      totalCompleted: 0,
      totalRemaining: 0,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 0,
    })
    expect(result.progressPct).toBe(0)
    expect(result.status).toBe('CAUGHT_UP')
  })

  it('F: 5 replies pending, 0 replies sent → progress reflects only real actions', () => {
    const result = computeDailyProgress({
      totalTarget: 10,
      totalCompleted: 0,
      totalRemaining: 10,
      repliesWaiting: 5,
      followUpsDue: 0,
      outreachRemaining: 10,
    })
    expect(result.progressPct).toBe(0)
    expect(result.completedActions).toBe(0)
    expect(result.pendingWork).toBe(15) // 10 remaining (incl outreach) + 5 replies + 0 followups
  })

  it('G: duplicate connection event counted once → uses pre-deduplicated totalCompleted', () => {
    // totalCompleted must come from pre-deduplicated Action Ledger count
    const result = computeDailyProgress({
      totalTarget: 10,
      totalCompleted: 1, // ledger already deduplicated
      totalRemaining: 9,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 9,
    })
    expect(result.progressPct).toBe(10)
    expect(result.completedActions).toBe(1)
  })

  it('H: generated 10 drafts but sent nothing → 0 completed actions', () => {
    const result = computeDailyProgress({
      totalTarget: 20,
      totalCompleted: 0, // drafts are NOT execution events
      totalRemaining: 20,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 20,
    })
    expect(result.progressPct).toBe(0)
    expect(result.completedActions).toBe(0)
  })

  it('zero completed with non-zero pending always returns 0 regardless of queue size', () => {
    // Any configuration where totalCompleted = 0 must yield 0%
    const configs = [
      { totalTarget: 100, totalRemaining: 100, repliesWaiting: 20, followUpsDue: 5, outreachRemaining: 100 },
      { totalTarget: 50, totalRemaining: 50, repliesWaiting: 0, followUpsDue: 0, outreachRemaining: 50 },
      { totalTarget: 200, totalRemaining: 200, repliesWaiting: 50, followUpsDue: 30, outreachRemaining: 200 },
    ]
    for (const c of configs) {
      const result = computeDailyProgress({ totalCompleted: 0, ...c })
      expect(result.progressPct).toBe(0)
    }
  })

  it('INVARIANT: progress never increases unless completed action count increases', () => {
    // Property: for any fixed totalCompleted, changing pending work must never increase progressPct.
    // And progressPct must be monotonically non-decreasing with totalCompleted.
    const base = { totalTarget: 50, totalCompleted: 10, totalRemaining: 40, repliesWaiting: 0, followUpsDue: 0, outreachRemaining: 40 }
    const baseResult = computeDailyProgress(base)

    // Vary pending work — progress must NOT increase
    const pendingVariants = [
      { repliesWaiting: 20, followUpsDue: 10 },
      { repliesWaiting: 50, followUpsDue: 30 },
      { repliesWaiting: 100, followUpsDue: 100 },
      { totalRemaining: 200, outreachRemaining: 200 },
    ]
    for (const v of pendingVariants) {
      const variant = computeDailyProgress({ ...base, ...v })
      expect(variant.progressPct).toBeLessThanOrEqual(baseResult.progressPct)
    }

    // Increase completed — progress must NOT decrease
    const completedVariants = [15, 20, 30, 50]
    let prev = baseResult.progressPct
    for (const completed of completedVariants) {
      const variant = computeDailyProgress({ ...base, totalCompleted: completed })
      expect(variant.progressPct).toBeGreaterThanOrEqual(prev)
      prev = variant.progressPct
    }
  })

  it('0 pending + 0 completed → CAUGHT_UP', () => {
    const result = computeDailyProgress({
      totalTarget: 0,
      totalCompleted: 0,
      totalRemaining: 0,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 0,
    })
    expect(result.status).toBe('CAUGHT_UP')
    expect(result.progressPct).toBe(0)
  })

  it('over-target credit does not exceed 100% without real pending', () => {
    const result = computeDailyProgress({
      totalTarget: 10,
      totalCompleted: 20,
      totalRemaining: 0,
      repliesWaiting: 0,
      followUpsDue: 0,
      outreachRemaining: 0,
    })
    expect(result.completedActions).toBe(20)
    expect(result.pendingWork).toBe(0)
    expect(result.progressPct).toBe(100) // 20/20 = 100%
    expect(result.status).toBe('COMPLETE')
  })
})
