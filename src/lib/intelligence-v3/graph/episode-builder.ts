/**
 * Opportunity Episode Builder — V3
 *
 * Groups related evidence/events into OpportunityEpisode objects.
 *
 * Each episode represents a distinct commercial opportunity scoped to
 * a specific organization, event type, and time window.
 *
 * Key principle: if multiple opportunities exist, they are scored separately.
 * The lead display score reflects the best relevant active episode, not an
 * average over unrelated history.
 */

import type {
  V3OpportunityEpisode,
  V3Event,
  V3Evidence,
  V3EpisodeStatus,
  V3NeedOwner,
} from '../types'
import { EPISODE_STALENESS } from '../types'
import { getActiveEvents, getEvidenceForOrganization, type V3EvidenceGraph } from './evidence-graph'


export interface EpisodeBuildOptions {
  /** Reference date for staleness calculations (defaults to now) */
  referenceDate?: Date
  /** Minimum evidence count to form an episode */
  minEvidenceCount?: number
}

export function buildEpisodes(
  graph: V3EvidenceGraph,
  options: EpisodeBuildOptions = {},
): V3OpportunityEpisode[] {
  const refDate = options.referenceDate ?? new Date()
  const minEvidence = options.minEvidenceCount ?? 1
  const episodes: V3OpportunityEpisode[] = []

  const activeEvents = getActiveEvents(graph)

  const eventGroups = groupEventsByOrganizationAndType(activeEvents)

  for (const [, events] of eventGroups) {
    // Further group by temporal proximity (events within 30 days)
    const temporalGroups = groupEventsByTimeProximity(events, 30)

    for (const group of temporalGroups) {
      const episode = buildEpisodeFromEvents(graph, group, refDate)
      if (episode && episode.evidenceRefs.length >= minEvidence) {
        episodes.push(episode)
      }
    }
  }

  // Evidence an event episode already absorbed is part of that opportunity;
  // re-grouping it produced a duplicate synthetic episode for the same need.
  const absorbed = new Set(episodes.flatMap((e) => e.evidenceRefs))
  const evidenceOnlyEpisodes = buildEpisodesFromEvidenceOnly(graph, refDate, minEvidence, absorbed)
  episodes.push(...evidenceOnlyEpisodes)

  // Sort: most recent first. Ties break on a content key, never on insertion
  // timing or generated ids, so the same source always yields the same order.
  episodes.sort((a, b) => {
    const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0
    const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0
    if (bTime !== aTime) return bTime - aTime
    return episodeContentKey(a).localeCompare(episodeContentKey(b))
  })

  return episodes
}

function buildEpisodeFromEvents(
  graph: V3EvidenceGraph,
  events: V3Event[],
  refDate: Date,
): V3OpportunityEpisode | null {
  if (events.length === 0) return null

  // Anchor event is the most explicit one (or first)
  const anchorEvent = events.find((e) => e.explicitness === 'EXPLICIT')
    ?? events.find((e) => e.explicitness === 'IMPLIED')
    ?? events[0]

  const orgId = anchorEvent.organizationId
  const allEvidenceIds: string[] = []
  const allCapabilities: Set<string> = new Set()
  const allChannels: Set<string> = new Set()
  let explicitRequest = false
  let needOwner: V3NeedOwner = 'UNKNOWN'

  // Collect all evidence and capabilities from events
  for (const event of events) {
    for (const evRef of event.evidenceRefs) {
      if (!allEvidenceIds.includes(evRef)) allEvidenceIds.push(evRef)
    }
    event.requestedCapability.forEach((c) => allCapabilities.add(c))
    event.applyInstructions.forEach((ch) => allChannels.add(ch))

    if (event.explicitness === 'EXPLICIT') explicitRequest = true

    needOwner = eventNeedOwner(event.eventType)
  }

  if (orgId) {
    const orgEvidence = getEvidenceForOrganization(graph, orgId)
    for (const ev of orgEvidence) {
      if (ev.polarity !== 'ACTIVE' && ev.polarity !== 'FUTURE') continue
      // Only include evidence with compatible need ownership
      if (isCompatibleNeedOwner(ev.needOwner, needOwner)) {
        if (!allEvidenceIds.includes(ev.id)) {
          allEvidenceIds.push(ev.id)
        }
      }
    }
  }

  const lastActivity = getLastActivityDate(events, allEvidenceIds, graph)
  const ageDays = lastActivity
    ? daysBetween(lastActivity, refDate)
    : null
  const status = determineEpisodeStatus(ageDays, events)

  const personId = anchorEvent.personId

  return {
    id: `ep_${anchorEvent.id}`,
    anchorEvent,
    organizationId: orgId,
    organizationName: anchorEvent.organizationName,
    needOwnerPersonId: personId,
    needOwnerType: needOwner,
    explicitRequest,
    requestedCapabilities: Array.from(allCapabilities),
    applicationChannels: Array.from(allChannels),
    evidenceRefs: allEvidenceIds,
    eventRefs: events.map((e) => e.id),
    status,
    detectedAt: events[0].occurredAt || refDate.toISOString(),
    lastActivityAt: lastActivity?.toISOString() ?? null,
    ageDays,
  }
}

function buildEpisodesFromEvidenceOnly(
  graph: V3EvidenceGraph,
  refDate: Date,
  minEvidence: number,
  absorbed: ReadonlySet<string> = new Set(),
): V3OpportunityEpisode[] {
  const episodes: V3OpportunityEpisode[] = []
  const processedEvidence = new Set<string>()

  const allEvidence = Array.from(graph.evidence.values()).filter(
    (e: V3Evidence) => !e.eventId && !absorbed.has(e.id) && (e.polarity === 'ACTIVE' || e.polarity === 'FUTURE')
  )

  const orgGroups = new Map<string, V3Evidence[]>()
  for (const ev of allEvidence) {
    if (!ev.subjectOrganizationId) continue
    const group = orgGroups.get(ev.subjectOrganizationId) || []
    group.push(ev)
    orgGroups.set(ev.subjectOrganizationId, group)
  }

  for (const [orgId, evidence] of orgGroups) {
    if (evidence.length < minEvidence) continue

    const needGroups = new Map<V3NeedOwner, V3Evidence[]>()
    for (const ev of evidence) {
      const group = needGroups.get(ev.needOwner) || []
      group.push(ev)
      needGroups.set(ev.needOwner, group)
    }

    for (const [needOwner, needEvidence] of needGroups) {
      if (needEvidence.length < 1) continue

      const syntheticEvent: V3Event = {
        id: `evt_synthetic_${orgId}_${needOwner}`,
        eventType: eventTypeFromNeedOwner(needOwner),
        personId: needEvidence[0].subjectPersonId,
        organizationId: orgId,
        organizationName: needEvidence[0].subjectOrganizationName,
        occurredAt: needEvidence[0].occurredAt,
        channel: null,
        requestedCapability: [],
        targetAudience: 'UNKNOWN',
        explicitness: 'INFERRED',
        applyInstructions: [],
        evidenceRefs: needEvidence.map((e) => e.id),
        polarity: 'ACTIVE',
      }

      const lastActivity = needEvidence
        .map((e) => e.occurredAt)
        .filter(Boolean)
        .map((d) => new Date(d!))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

      const ageDays = lastActivity ? daysBetween(lastActivity, refDate) : null

      for (const ev of needEvidence) {
        processedEvidence.add(ev.id)
      }

      episodes.push({
        id: `ep_${syntheticEvent.id}`,
        anchorEvent: syntheticEvent,
        organizationId: orgId,
        organizationName: needEvidence[0].subjectOrganizationName,
        needOwnerPersonId: needEvidence[0].subjectPersonId,
        needOwnerType: needOwner,
        explicitRequest: false,
        requestedCapabilities: [],
        applicationChannels: [],
        evidenceRefs: needEvidence.map((e) => e.id),
        eventRefs: [syntheticEvent.id],
        status: determineEpisodeStatus(ageDays, [syntheticEvent]),
        detectedAt: needEvidence[0].occurredAt || refDate.toISOString(),
        lastActivityAt: lastActivity?.toISOString() ?? null,
        ageDays,
      })
    }
  }

  return episodes
}


function groupEventsByOrganizationAndType(
  events: V3Event[],
): Map<string, V3Event[]> {
  const groups = new Map<string, V3Event[]>()
  for (const event of events) {
    const key = `${event.organizationId ?? 'unknown'}_${event.eventType}`
    const group = groups.get(key) || []
    group.push(event)
    groups.set(key, group)
  }
  return groups
}

function groupEventsByTimeProximity(
  events: V3Event[],
  maxDaysGap: number,
): V3Event[][] {
  const sorted = [...events].sort((a, b) => {
    const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : 0
    const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : 0
    return aTime - bTime
  })

  if (sorted.length === 0) return []

  const groups: V3Event[][] = [[sorted[0]]]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const lastGroup = groups[groups.length - 1]
    const lastEvent = lastGroup[lastGroup.length - 1]

    const currentTime = current.occurredAt ? new Date(current.occurredAt).getTime() : 0
    const lastTime = lastEvent.occurredAt ? new Date(lastEvent.occurredAt).getTime() : 0

    if (currentTime > 0 && lastTime > 0 && (currentTime - lastTime) / (1000 * 60 * 60 * 24) <= maxDaysGap) {
      lastGroup.push(current)
    } else {
      groups.push([current])
    }
  }

  return groups
}


export function eventNeedOwner(eventType: V3Event['eventType']): V3NeedOwner {
  switch (eventType) {
    case 'HIRING':
      return 'HIRING_NEED'
    case 'FREELANCE_REQUEST':
    case 'AGENCY_REQUEST':
    case 'PROJECT_REQUEST':
    case 'VENDOR_EVALUATION':
      return 'ORGANIZATION_NEED'
    case 'CUSTOMER_PROBLEM':
      return 'CUSTOMER_NEED'
    case 'MARKET_COMMENTARY':
      return 'MARKET_PROBLEM'
    case 'SERVICE_OFFERING':
      return 'SERVICE_OFFERING'
    case 'JOB_SEEKING':
      return 'SELF_NEED'
    case 'PRODUCT_LAUNCH':
    case 'FUNDING':
    case 'TECHNICAL_BUILD':
      return 'ORGANIZATION_NEED'
    case 'PARTNERSHIP':
      return 'ORGANIZATION_NEED'
    default:
      return 'UNKNOWN'
  }
}

function eventTypeFromNeedOwner(needOwner: V3NeedOwner): V3Event['eventType'] {
  switch (needOwner) {
    case 'HIRING_NEED':
      return 'HIRING'
    case 'ORGANIZATION_NEED':
      return 'PROJECT_REQUEST'
    case 'CUSTOMER_NEED':
      return 'CUSTOMER_PROBLEM'
    case 'MARKET_PROBLEM':
      return 'MARKET_COMMENTARY'
    case 'SERVICE_OFFERING':
      return 'SERVICE_OFFERING'
    case 'SELF_NEED':
      return 'PROJECT_REQUEST'
    case 'PRODUCT_PROBLEM':
      return 'TECHNICAL_BUILD'
    default:
      return 'OTHER'
  }
}

function isCompatibleNeedOwner(evidence: V3NeedOwner, episode: V3NeedOwner): boolean {
  if (evidence === episode) return true
  if (evidence === 'UNKNOWN') return true
  if (episode === 'UNKNOWN') return true
  // HIRING_NEED and ORGANIZATION_NEED are compatible
  if (
    (evidence === 'HIRING_NEED' && episode === 'ORGANIZATION_NEED') ||
    (evidence === 'ORGANIZATION_NEED' && episode === 'HIRING_NEED')
  ) return true
  return false
}

function determineEpisodeStatus(
  ageDays: number | null,
  events: V3Event[],
): V3EpisodeStatus {
  const hasClosed = events.some((e) => e.polarity === 'CLOSED' || e.polarity === 'NEGATED')
  if (hasClosed) return 'CLOSED'

  if (ageDays === null) return 'UNKNOWN'
  // Age alone never closes an episode: CLOSED means negated or filled. An old
  // request is STALE — its timing credit falls, its intent stays on record.
  if (ageDays >= EPISODE_STALENESS.STALE_DAYS) return 'STALE'
  if (ageDays >= EPISODE_STALENESS.AGING_DAYS) return 'AGING'
  return 'CURRENT'
}

function getLastActivityDate(
  events: V3Event[],
  evidenceIds: string[],
  graph: V3EvidenceGraph,
): Date | null {
  const dates: Date[] = []

  for (const event of events) {
    if (event.occurredAt) dates.push(new Date(event.occurredAt))
  }

  for (const evId of evidenceIds) {
    const ev = graph.evidence.get(evId)
    if (ev?.occurredAt) dates.push(new Date(ev.occurredAt))
  }

  if (dates.length === 0) return null
  return dates.sort((a, b) => b.getTime() - a.getTime())[0]
}

function daysBetween(date: Date, ref: Date): number {
  return Math.floor((ref.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
}

/** Stable, content-derived ordering key for an episode (no ids, no clocks). */
export function episodeContentKey(ep: V3OpportunityEpisode): string {
  return [
    ep.organizationName ?? '',
    ep.anchorEvent?.eventType ?? '',
    ep.anchorEvent?.explicitness ?? '',
    (ep.anchorEvent?.requestedCapability ?? []).join(','),
    ep.anchorEvent?.channel ?? '',
    ep.needOwnerType,
    ep.explicitRequest ? '1' : '0',
  ].join('|')
}
