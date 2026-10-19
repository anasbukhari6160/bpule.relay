import { cache } from 'react'
import { createScoutStore } from '@/lib/store'
import { getAuthContext } from '@/lib/auth/organization'
import { isDemoMode } from '@/lib/ai/config'
import { createServerSupabase } from '@/lib/supabase/server'

export type PersonStatus = 'completed' | 'on_track' | 'at_risk' | 'missed' | 'no_target'

export interface PersonWork {
  repId: string
  repName: string
  productRole: string
  orgRole: string
  teamNames: string[]
  profiles: number
  leads: number
  extractions: number
  identities: number
  identityNames: string[]
  totalTarget: number
  totalCompleted: number
  totalRemaining: number
  status: PersonStatus
}

export interface AttentionItem {
  id: string
  title: string
  detail: string
  href: string
  severity: 'warning' | 'critical'
}

export interface IdentityCoverage {
  id: string
  name: string
  channel: string
  status: string
  assignedRepNames: string[]
  targetCount: number
}

export interface TeamSnapshot {
  teamId: string
  teamName: string
  managerNames: string[]
  people: PersonWork[]
  remaining: number
  needsAttention: number
}

export interface OrgCommandSnapshot {
  orgName: string
  today: string
  isOwner: boolean
  isAdmin: boolean
  totals: {
    people: number
    profiles: number
    leads: number
    extractions: number
    identities: number
    plays: number
    remaining: number
    attention: number
    peopleWithWork: number
  }
  people: PersonWork[]
  identities: IdentityCoverage[]
  teams: TeamSnapshot[]
  unteamed: PersonWork[]
  attention: AttentionItem[]
}

function emptySnapshot(orgName: string, today: string, isOwner: boolean, isAdmin: boolean): OrgCommandSnapshot {
  return {
    orgName,
    today,
    isOwner,
    isAdmin,
    totals: {
      people: 0,
      profiles: 0,
      leads: 0,
      extractions: 0,
      identities: 0,
      plays: 0,
      remaining: 0,
      attention: 0,
      peopleWithWork: 0,
    },
    people: [],
    identities: [],
    teams: [],
    unteamed: [],
    attention: [],
  }
}

async function loadExtractionCounts(orgId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (isDemoMode()) return counts
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('extraction_runs')
      .select('rep_id')
      .eq('organization_id', orgId)
    if (error || !data) return counts
    for (const row of data) {
      const repId = row.rep_id as string | null
      if (!repId) continue
      counts.set(repId, (counts.get(repId) ?? 0) + 1)
    }
  } catch {
    return counts
  }
  return counts
}

async function resolveSnapshot(): Promise<OrgCommandSnapshot> {
  const authCtx = await getAuthContext()
  const today = new Date().toISOString().slice(0, 10)
  if (!authCtx) return emptySnapshot('Organization', today, false, false)

  try {
    const store = await createScoutStore()
    const [
      allReps,
      teams,
      identities,
      assignments,
      targets,
      orgRoles,
      memberships,
      profiles,
      leads,
      plays,
      accountability,
      extractionCounts,
    ] = await Promise.all([
      store.listAllReps(),
      store.listTeams().catch(() => []),
      store.listRevenueIdentitiesAdmin().catch(() => []),
      store.listIdentityAssignmentsAdmin().catch(() => []),
      store.listDailyTargetsAdmin().catch(() => []),
      store.getOrganizationRoles().catch(() => []),
      store.getActiveTeamMemberships().catch(() => []),
      store.listAllProfiles().catch(() => []),
      store.fetchLeadsAll().catch(() => []),
      store.listPlays().catch(() => []),
      store.getTeamAccountabilityAdmin(today).catch(() => null),
      loadExtractionCounts(authCtx.orgId),
    ])

    const roleMap = new Map(orgRoles.map((r) => [r.personId, r.role]))
    const teamNameById = new Map(teams.map((t) => [t.id, t.name]))
    const accByRep = new Map((accountability?.summaries ?? []).map((s) => [s.repId, s]))

    const identityById = new Map(identities.map((i) => [i.id, i]))
    const assignmentsByRep = new Map<string, string[]>()
    for (const assignment of assignments) {
      const names = assignmentsByRep.get(assignment.repId) ?? []
      const identityName = identityById.get(assignment.revenueIdentityId)?.identityName
      if (identityName) names.push(identityName)
      assignmentsByRep.set(assignment.repId, names)
    }

    const people: PersonWork[] = allReps.map((rep) => {
      const acc = accByRep.get(rep.id)
      const repTargets = targets.filter((t) => t.active && t.repId === rep.id)
      const totalTarget = acc?.totalTarget ?? repTargets.reduce((sum, t) => sum + t.targetCount, 0)
      const totalCompleted = acc?.totalCompleted ?? 0
      const totalRemaining = Math.max(0, totalTarget - totalCompleted)
      const identityNames = assignmentsByRep.get(rep.id) ?? []
      const status: PersonStatus =
        totalTarget === 0
          ? 'no_target'
          : acc?.status === 'missed' || acc?.status === 'at_risk'
            ? acc.status
            : totalCompleted >= totalTarget
              ? 'completed'
              : 'on_track'

      const teamNames = memberships
        .filter((m) => m.personId === rep.id)
        .map((m) => teamNameById.get(m.teamId) ?? 'Team')
        .filter((name, index, list) => list.indexOf(name) === index)

      return {
        repId: rep.id,
        repName: rep.name,
        productRole: rep.role,
        // organization_roles is canonical; reps.role is display-only fallback
        orgRole: roleMap.get(rep.id) ?? (rep.role === 'admin' ? 'ADMIN' : 'MEMBER'),
        teamNames,
        profiles: profiles.filter((p) => p.repId === rep.id).length,
        leads: leads.filter((l) => l.ownerRepId === rep.id).length,
        extractions: extractionCounts.get(rep.id) ?? 0,
        identities: identityNames.length,
        identityNames,
        totalTarget,
        totalCompleted,
        totalRemaining,
        status,
      }
    })

    people.sort((a, b) => {
      const aWork = a.profiles + a.leads + a.extractions
      const bWork = b.profiles + b.leads + b.extractions
      if (bWork !== aWork) return bWork - aWork
      if (b.totalRemaining !== a.totalRemaining) return b.totalRemaining - a.totalRemaining
      return a.repName.localeCompare(b.repName)
    })

    const peopleById = new Map(people.map((p) => [p.repId, p]))

    const teamSnapshots: TeamSnapshot[] = teams.map((team) => {
      const teamPeopleIds = memberships.filter((m) => m.teamId === team.id).map((m) => m.personId)
      const teamPeople = teamPeopleIds.map((id) => peopleById.get(id)).filter((p): p is PersonWork => Boolean(p))
      const managerNames = memberships
        .filter((m) => m.teamId === team.id && m.membershipRole === 'MANAGER')
        .map((m) => peopleById.get(m.personId)?.repName)
        .filter((name): name is string => Boolean(name))
      return {
        teamId: team.id,
        teamName: team.name,
        managerNames,
        people: teamPeople,
        remaining: teamPeople.reduce((sum, p) => sum + p.totalRemaining, 0),
        needsAttention: teamPeople.filter((p) => p.status === 'at_risk' || p.status === 'missed').length,
      }
    })

    const teamedIds = new Set(memberships.map((m) => m.personId))
    const unteamed = people.filter((p) => !teamedIds.has(p.repId))

    const identityCoverage: IdentityCoverage[] = identities
      .filter((i) => i.status !== 'archived')
      .map((identity) => {
        const assigned = assignments.filter((a) => a.revenueIdentityId === identity.id)
        return {
          id: identity.id,
          name: identity.identityName,
          channel: identity.channel,
          status: identity.status,
          assignedRepNames: assigned
            .map((a) => peopleById.get(a.repId)?.repName)
            .filter((name): name is string => Boolean(name)),
          targetCount: targets.filter((t) => t.active && t.revenueIdentityId === identity.id).length,
        }
      })

    const attention: AttentionItem[] = []
    for (const person of people) {
      if (person.status === 'missed' || person.status === 'at_risk') {
        attention.push({
          id: `behind-${person.repId}`,
          title: `${person.repName} is behind today`,
          detail: `${person.totalCompleted}/${person.totalTarget} actions · ${person.totalRemaining} remaining`,
          href: `/team/${person.repId}`,
          severity: person.status === 'missed' ? 'critical' : 'warning',
        })
      }
      if (person.identities === 0 && person.productRole !== 'admin') {
        attention.push({
          id: `identity-${person.repId}`,
          title: `${person.repName} has no identity`,
          detail: 'Assign a revenue identity so they can execute.',
          href: '/profile-intelligence?tab=identities',
          severity: 'warning',
        })
      }
    }
    for (const identity of identityCoverage) {
      if (identity.assignedRepNames.length === 0) {
        attention.push({
          id: `unassigned-${identity.id}`,
          title: `${identity.name} is unassigned`,
          detail: 'No rep can work this identity until someone is assigned.',
          href: '/profile-intelligence?tab=identities',
          severity: 'critical',
        })
      } else if (identity.targetCount === 0) {
        attention.push({
          id: `notarget-${identity.id}`,
          title: `${identity.name} has no daily target`,
          detail: `${identity.assignedRepNames.join(', ')} assigned, but nothing is measured.`,
          href: '/admin/targets',
          severity: 'warning',
        })
      }
    }

    const totals = {
      people: people.length,
      profiles: profiles.length,
      leads: leads.length,
      extractions: [...extractionCounts.values()].reduce((sum, n) => sum + n, 0),
      identities: identityCoverage.length,
      plays: plays.length,
      remaining: people.reduce((sum, p) => sum + p.totalRemaining, 0),
      attention: attention.length,
      peopleWithWork: people.filter((p) => p.profiles + p.leads + p.extractions > 0).length,
    }

    return {
      orgName: authCtx.orgName,
      today,
      isOwner: authCtx.isOwner,
      isAdmin: authCtx.isAdmin,
      totals,
      people,
      identities: identityCoverage,
      teams: teamSnapshots,
      unteamed,
      attention: attention.slice(0, 12),
    }
  } catch (error) {
    console.warn('[command-center] failed to load org snapshot', {
      message: error instanceof Error ? error.message : 'unknown error',
    })
    return emptySnapshot(authCtx.orgName, today, authCtx.isOwner, authCtx.isAdmin)
  }
}

export const loadOrgCommandSnapshot = cache(resolveSnapshot)
