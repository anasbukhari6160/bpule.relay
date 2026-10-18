import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'

export type SignalEventType =
  | 'ROLE_CHANGE'
  | 'HIRING'
  | 'FUNDING'
  | 'PRODUCT_LAUNCH'
  | 'NEW_PRODUCT_ACTIVITY'
  | 'NEW_POST'
  | 'BUYER_REQUEST'
  | 'COMPANY_CHANGE'
  | 'NEW_TECH_ACTIVITY'
  | 'NEW_INBOUND'
  | 'WEBSITE_CHANGE'
  | 'SCORE_INCREASED'
  | 'SCORE_DECREASED'
  | 'OTHER_VERIFIED_EVENT'

export type SignalSeverity = 'info' | 'notable' | 'urgent'

export interface SignalEvent {
  id: string
  leadId: string
  company: string
  contactName: string | null
  type: SignalEventType
  severity: SignalSeverity
  title: string
  detail: string
  previousValue: string | null
  newValue: string | null
  evidence: string | null
  confidence: number
  impact: string
  recommendedAction: string
  source: string
  actor: string | null
  organization: string | null
  verified: boolean
  createdAt: string
}

export interface SignalFeedItem {
  id: string
  leadId: string
  company: string
  contactName: string | null
  title: string
  detail: string
  severity: SignalSeverity
  type: SignalEventType
  createdAt: string
  rankScore: number
  cta: string
}

export interface SignalSnapshot {
  score: number | null
  events: string[]
  verdict: string | null
  intent: string | null
  capturedAt: string
}

/**
 * Diff two intelligence snapshots and produce signal events.
 * Pure function — no I/O.
 */
export function diffSignalSnapshots(
  leadId: string,
  company: string,
  contactName: string | null,
  previous: SignalSnapshot | null,
  current: SignalSnapshot,
): SignalEvent[] {
  const events: SignalEvent[] = []
  const now = new Date().toISOString()

  if (!previous) {
    if (current.score != null && current.score >= 70) {
      events.push({
        id: `sig-${leadId}-init-${Date.now()}`,
        leadId, company, contactName,
        type: current.score >= 70 ? 'BUYER_REQUEST' : 'OTHER_VERIFIED_EVENT',
        severity: current.score >= 80 ? 'urgent' : 'notable',
        title: `High-value lead (${current.score}/100)`,
        detail: `New lead scored ${current.score}/100 — ${current.verdict ?? 'unscored'}`,
        previousValue: null,
        newValue: `${current.score}/100`,
        evidence: null,
        confidence: current.score,
        impact: 'New high-value opportunity',
        recommendedAction: current.score >= 80 ? 'Connect' : 'Review',
        source: 'v3_intelligence',
        actor: contactName,
        organization: company,
        verified: true,
        createdAt: now,
      })
    }
    return events
  }

  // Score change
  if (previous.score != null && current.score != null) {
    const delta = current.score - previous.score
    if (delta >= 15) {
      events.push({
        id: `sig-${leadId}-score-up-${Date.now()}`,
        leadId, company, contactName,
        type: 'SCORE_INCREASED',
        severity: delta >= 25 ? 'urgent' : 'notable',
        title: `Score jumped +${delta} (${previous.score} → ${current.score})`,
        detail: 'Significant score increase detected',
        previousValue: `${previous.score}`,
        newValue: `${current.score}`,
        evidence: null,
        confidence: Math.min(100, 50 + delta),
        impact: 'Higher commercial potential',
        recommendedAction: 'Review',
        source: 'v3_intelligence',
        actor: contactName,
        organization: company,
        verified: true,
        createdAt: now,
      })
    } else if (delta <= -15) {
      events.push({
        id: `sig-${leadId}-score-down-${Date.now()}`,
        leadId, company, contactName,
        type: 'SCORE_DECREASED',
        severity: 'info',
        title: `Score dropped ${delta} (${previous.score} → ${current.score})`,
        detail: 'Score decrease detected — signals may have weakened',
        previousValue: `${previous.score}`,
        newValue: `${current.score}`,
        evidence: null,
        confidence: 60,
        impact: 'Lower commercial potential',
        recommendedAction: 'Refresh Intelligence',
        source: 'v3_intelligence',
        actor: contactName,
        organization: company,
        verified: true,
        createdAt: now,
      })
    }
  }

  // Crossing high-value threshold
  if (previous.score != null && current.score != null) {
    if (previous.score < 70 && current.score >= 70) {
      events.push({
        id: `sig-${leadId}-high-value-${Date.now()}`,
        leadId, company, contactName,
        type: 'BUYER_REQUEST',
        severity: 'urgent',
        title: `Became high-value (${current.score}/100)`,
        detail: `Lead crossed from ${previous.score} to ${current.score}`,
        previousValue: `${previous.score}`,
        newValue: `${current.score}`,
        evidence: null,
        confidence: current.score,
        impact: 'New high-value opportunity',
        recommendedAction: 'Connect',
        source: 'v3_intelligence',
        actor: contactName,
        organization: company,
        verified: true,
        createdAt: now,
      })
    }
  }

  // New events detected
  const newEvents = current.events.filter(e => !previous.events.includes(e))
  const buyingSignals = ['HIRING', 'FREELANCE_REQUEST', 'PROJECT_REQUEST', 'AGENCY_REQUEST', 'VENDOR_EVALUATION']

  for (const newEvent of newEvents) {
    const isBuying = buyingSignals.includes(newEvent)
    const signalType = mapEventTypeToSignal(newEvent)
    events.push({
      id: `sig-${leadId}-event-${newEvent}-${Date.now()}`,
      leadId, company, contactName,
      type: signalType,
      severity: isBuying ? 'urgent' : 'notable',
      title: `New signal: ${newEvent.replace(/_/g, ' ')}`,
      detail: `Detected new commercial event: ${newEvent}`,
      previousValue: null,
      newValue: newEvent,
      evidence: null,
      confidence: 70,
      impact: isBuying ? 'Active buying intent' : 'Activity change',
      recommendedAction: isBuying ? 'Connect' : 'Review',
      source: 'v3_intelligence',
      actor: contactName,
      organization: company,
      verified: true,
      createdAt: now,
    })
  }

  return events
}

function mapEventTypeToSignal(eventType: string): SignalEventType {
  const map: Record<string, SignalEventType> = {
    'HIRING': 'HIRING',
    'FREELANCE_REQUEST': 'BUYER_REQUEST',
    'PROJECT_REQUEST': 'BUYER_REQUEST',
    'AGENCY_REQUEST': 'BUYER_REQUEST',
    'VENDOR_EVALUATION': 'BUYER_REQUEST',
    'FUNDING': 'FUNDING',
    'PRODUCT_LAUNCH': 'PRODUCT_LAUNCH',
    'TECHNICAL_BUILD': 'NEW_TECH_ACTIVITY',
    'SERVICE_OFFERING': 'NEW_PRODUCT_ACTIVITY',
    'PARTNERSHIP': 'COMPANY_CHANGE',
    'CUSTOMER_PROBLEM': 'NEW_PRODUCT_ACTIVITY',
    'OTHER': 'OTHER_VERIFIED_EVENT',
  }
  return map[eventType] ?? 'OTHER_VERIFIED_EVENT'
}

export function buildSignalSnapshot(packet: V3LeadDecisionPacket | null): SignalSnapshot {
  return {
    score: packet?.score ?? null,
    events: packet?.episodes?.map(e => e.anchorEvent?.eventType).filter(Boolean) as string[] ?? [],
    verdict: packet?.action ?? null,
    intent: packet?.decision?.buyerRequestProbability != null
      ? (packet.decision.buyerRequestProbability > 0.5 ? 'high' : 'low') : null,
    capturedAt: new Date().toISOString(),
  }
}

export function qualifiesForWatching(score: number | null): boolean {
  return score != null && score >= 60
}

/**
 * Rank signal feed items by commercial relevance × freshness × confidence.
 */
export function rankSignalFeed(items: SignalFeedItem[], now: number = Date.now()): SignalFeedItem[] {
  return items
    .map(item => {
      const ageHours = (now - new Date(item.createdAt).getTime()) / (1000 * 60 * 60)
      const freshness = Math.max(0, 1 - ageHours / 168) // 1 week decay
      const severityScore = item.severity === 'urgent' ? 1.0 : item.severity === 'notable' ? 0.7 : 0.4
      item.rankScore = severityScore * freshness * 100
      return item
    })
    .sort((a, b) => b.rankScore - a.rankScore)
}
