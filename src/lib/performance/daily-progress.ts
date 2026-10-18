/**
 * Today's Progress — single source of truth.
 *
 * Invariant: zero completed real actions → 0% progress.
 * Unavailable / empty stages never contribute fake credit.
 * Eligibility ≠ completion.
 *
 * Progress = real completed execution / (completed + all pending)
 */

export interface DailyProgressInput {
  totalTarget: number
  totalCompleted: number
  totalRemaining: number
  repliesWaiting: number
  followUpsDue: number
  outreachRemaining: number
}

export interface DailyProgressResult {
  /** 0–100, real execution only */
  progressPct: number
  /** Canonical completed actions today */
  completedActions: number
  /** All outstanding work (target remaining + queue items) */
  pendingWork: number
  /** Total work that exists today */
  totalWork: number
  /** Status label for UI states */
  status: 'CAUGHT_UP' | 'NO_WORK' | 'IN_PROGRESS' | 'COMPLETE'
}

export function computeDailyProgress(input: DailyProgressInput): DailyProgressResult {
  const { totalCompleted, repliesWaiting, followUpsDue, totalRemaining } = input

  const completedActions = totalCompleted

  // Pending = target remaining + queue items not captured in targets
  const pendingWork = totalRemaining + repliesWaiting + followUpsDue
  const totalWork = completedActions + pendingWork

  // ── Core invariant: no actions done → 0% ──
  let progressPct: number
  if (completedActions === 0 || totalWork === 0) {
    progressPct = 0
  } else {
    progressPct = Math.round((completedActions / totalWork) * 100)
  }

  // ── Status for UI messaging ──
  let status: DailyProgressResult['status']
  if (pendingWork === 0 && completedActions > 0) {
    status = 'COMPLETE'
  } else if (pendingWork === 0 && completedActions === 0) {
    status = 'CAUGHT_UP'
  } else if (completedActions === 0) {
    status = 'NO_WORK'
  } else {
    status = 'IN_PROGRESS'
  }

  return { progressPct, completedActions, pendingWork, totalWork, status }
}
