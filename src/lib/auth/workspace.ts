import { cache } from 'react'
import { getCurrentUser } from './current'
import { createScoutStore } from '@/lib/store'
import { isDemoMode } from '@/lib/ai/config'
import { createServerSupabase } from '@/lib/supabase/server'


/**
 * Centralized authorization for the Rep Workspace.
 *
 * Single source of truth for:
 * - Which revenue identities a rep is authorized to represent
 * - Whether a specific revenue identity is assigned to the current rep
 * - The full daily workspace context for the current rep
 *
 * Every server endpoint that touches identity-dependent data should
 * go through these helpers. Never trust a client-supplied identity ID
 * without calling assertRevenueIdentityAssignedToRep.
 */

export interface AuthorizedIdentity {
  assignmentId: string
  revenueIdentityId: string
  identityName: string
  title: string | null
  channel: string
  profileId: string | null
  profileUrl: string | null
}

export interface RepWorkspace {
  repId: string
  repName: string
  orgId: string
  timezone: string
  isWorkingDay: boolean
  identities: AuthorizedIdentity[]
  hasAssignments: boolean
}

function isWorkingDay(date: Date, workingDays: number[] = [1, 2, 3, 4, 5]): boolean {
  return workingDays.includes(date.getDay())
}

/**
 * Get all authorized revenue identities for the current rep.
 * Server-side only. Uses the authenticated session.
 * Works in both demo and supabase modes via the store.
 */
async function resolveAuthorizedIdentities(): Promise<AuthorizedIdentity[]> {
  const store = await createScoutStore()
  const assigned = await store.listMyAssignedIdentities()

  return assigned.map((identity) => ({
    assignmentId: identity.assignmentId,
    revenueIdentityId: identity.id,
    identityName: identity.identityName,
    title: identity.title,
    channel: identity.channel,
    profileId: identity.profileId,
    profileUrl: identity.profileUrl,
  }))
}

export const getAuthorizedIdentities = cache(resolveAuthorizedIdentities)

/**
 * Assert that a specific revenue identity is assigned to the current rep.
 * Returns the authorized identity on success, throws on violation.
 *
 * Use this before any identity-dependent operation.
 */
export async function assertRevenueIdentityAssignedToRep(
  _userId: string,
  revenueIdentityId: string,
): Promise<AuthorizedIdentity> {
  const identities = await getAuthorizedIdentities()
  const match = identities.find((i) => i.revenueIdentityId === revenueIdentityId)
  if (!match) {
    throw new UnauthorizedError(revenueIdentityId)
  }
  return match
}

/**
 * Check if the given identity is assigned to the current rep (boolean).
 * Non-throwing variant for conditional UI logic.
 */
export async function isRevenueIdentityAssignedToRep(
  _userId: string,
  revenueIdentityId: string,
): Promise<boolean> {
  const identities = await getAuthorizedIdentities()
  return identities.some((i) => i.revenueIdentityId === revenueIdentityId)
}

/**
 * Get the full workspace context for the current rep.
 * Includes authorized identities and working day info.
 */
async function resolveCurrentRepWorkspace(): Promise<RepWorkspace | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const identities = await getAuthorizedIdentities()

  return {
    repId: user.rep.id,
    repName: user.rep.name,
    orgId: user.organization.id,
    timezone: user.rep.timezone || user.organization.timezone,
    isWorkingDay: isWorkingDay(new Date(), user.organization.workingDays),
    identities,
    hasAssignments: identities.length > 0,
  }
}

export const getCurrentRepWorkspace = cache(resolveCurrentRepWorkspace)

/**
 * Get the daily workspace with targets, accountability, and progress.
 * This is the canonical API response for the rep's Today page.
 * Uses the store layer so it works in both demo and supabase modes.
 */
async function resolveDailyWorkspace(): Promise<{
  rep: { id: string; name: string }
  isWorkingDay: boolean
  hasAssignments: boolean
  identities: AuthorizedIdentity[]
  targetSummary: {
    totalTarget: number
    totalCompleted: number
    totalRemaining: number
    overallStatus: 'on_track' | 'at_risk' | 'completed' | 'missed'
    byIdentity: Array<{
      assignmentId: string
      revenueIdentityId: string
      identityName: string
      title: string | null
      channel: string
      targets: Array<{
        targetId: string
        activityType: string
        targetCount: number
        completedCount: number
        remaining: number
        status: string
      }>
      outreachRemaining: number
    }>
  }
  day: {
    totalRemaining: number
    repliesWaiting: number
    followUpsDue: number
    outreachRemaining: number
    isComplete: boolean
  }
}> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Not signed in')
  }

  const store = await createScoutStore()
  const org = user.organization
  const rep = user.rep
  const now = new Date()
  const workingDay = isWorkingDay(now, org.workingDays)
  const identities = await getAuthorizedIdentities()

  if (identities.length === 0) {
    return {
      rep: { id: rep.id, name: rep.name },
      isWorkingDay: workingDay,
      hasAssignments: false,
      identities: [],
      targetSummary: {
        totalTarget: 0,
        totalCompleted: 0,
        totalRemaining: 0,
        overallStatus: 'on_track',
        byIdentity: [],
      },
      day: {
        totalRemaining: 0,
        repliesWaiting: 0,
        followUpsDue: 0,
        outreachRemaining: 0,
        isComplete: false,
      },
    }
  }

  const accountability = await store.getMyTodayAccountability()

  let repliesWaiting = 0
  let followUpsDue = 0
  if (!isDemoMode()) {
    const client = await createServerSupabase()
    const [{ count: repliesCount }, { count: followUpsCount }] = await Promise.all([
      client
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('owner_rep_id', rep.id)
        .eq('status', 'replied')
        .eq('archived', false),
      client
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('owner_rep_id', rep.id)
        .eq('status', 'followed_up')
        .eq('archived', false),
    ])
    repliesWaiting = repliesCount ?? 0
    followUpsDue = followUpsCount ?? 0
  }

  const byIdentity = accountability.assignedIdentities.map((ai) => {
    const targets = ai.targets.map((t) => ({
      targetId: t.targetId,
      activityType: t.activityType,
      targetCount: t.targetCount,
      completedCount: t.completedCount,
      remaining: t.remaining,
      status: t.status,
    }))
    const outreachRemaining = targets
      .filter((t) => t.activityType === 'dm' || t.activityType === 'connection_request')
      .reduce((s, t) => s + t.remaining, 0)
    return {
      assignmentId: ai.assignmentId,
      revenueIdentityId: ai.identity.id,
      identityName: ai.identity.identityName,
      title: ai.identity.title,
      channel: ai.identity.channel,
      targets,
      outreachRemaining,
    }
  })

  const outreachRemaining = byIdentity.reduce((sum, ident) => sum + ident.outreachRemaining, 0)

  return {
    rep: { id: rep.id, name: rep.name },
    isWorkingDay: workingDay,
    hasAssignments: true,
    identities,
    targetSummary: {
      totalTarget: accountability.totalTarget,
      totalCompleted: accountability.totalCompleted,
      totalRemaining: accountability.totalRemaining,
      overallStatus: accountability.overallStatus,
      byIdentity,
    },
    day: {
      totalRemaining: accountability.totalRemaining + repliesWaiting + followUpsDue,
      repliesWaiting,
      followUpsDue,
      outreachRemaining,
      isComplete: accountability.totalRemaining === 0 && repliesWaiting === 0 && followUpsDue === 0,
    },
  }
}

export const getDailyWorkspace = cache(resolveDailyWorkspace)

export class UnauthorizedError extends Error {
  constructor(public revenueIdentityId: string) {
    super(`Not authorized to access revenue identity: ${revenueIdentityId}`)
    this.name = 'UnauthorizedError'
  }
}
