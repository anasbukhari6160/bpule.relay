'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { cn } from 'cn'
import { StatusBadge } from '@/components/ui/status-badge'
import { qualifyCanonicalScore, displayScoreForCanonical } from '@/lib/scoring/qualification'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  MessageSquare,
  Target,
  UserPlus,
  Briefcase,
  AlertTriangle,
  Send,
  CornerUpLeft,
} from 'lucide-react'

interface RepDayEvent {
  id: string
  action_type: string
  execution_status: string
  channel: string | null
  occurred_at: string
  metadata: Record<string, unknown>
  sender_profiles?: { identity_name: string } | null
  leads?: { id: string; company: string; contact_name: string | null; status: string } | null
  upwork_jobs?: { title: string } | null
}

interface RepDayData {
  repId: string
  repName: string
  date: string
  events: RepDayEvent[]
  assignedLeads: Array<{
    id: string
    company: string
    contact_name: string | null
    status: string
    canonical_score: number | null
    conversation_states?: { stage: string; last_sent_at: string | null; next_followup_at: string | null }[]
  }>
  accountability: {
    status: string
    completion_snapshot: Record<string, number>
    total_target: number
    total_completed: number
  } | null
}

const ACTION_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; variant: 'success' | 'info' | 'warning' | 'neutral' }> = {
  LEAD_EXTRACTED: { label: 'Lead extracted', icon: Target, variant: 'info' },
  CONNECTION_SENT: { label: 'Connection sent', icon: UserPlus, variant: 'success' },
  CONNECTION_PREPARED: { label: 'Connection drafted', icon: UserPlus, variant: 'neutral' },
  DM_SENT: { label: 'DM sent', icon: MessageSquare, variant: 'success' },
  DM_PREPARED: { label: 'DM drafted', icon: MessageSquare, variant: 'neutral' },
  FOLLOWUP_SENT: { label: 'Follow-up sent', icon: CornerUpLeft, variant: 'success' },
  REPLY_SENT: { label: 'Reply sent', icon: ArrowUpRight, variant: 'success' },
  REPLY_RECEIVED: { label: 'Reply received', icon: Send, variant: 'info' },
  LEAD_REFERRED: { label: 'Lead referred', icon: UserPlus, variant: 'warning' },
  PROFILE_RECOMMENDED: { label: 'Profile recommended', icon: UserPlus, variant: 'neutral' },
  UPWORK_JOB_EXTRACTED: { label: 'Upwork job extracted', icon: Briefcase, variant: 'info' },
  UPWORK_PROPOSAL_PREPARED: { label: 'Proposal drafted', icon: Briefcase, variant: 'neutral' },
  UPWORK_APPLIED: { label: 'Upwork applied', icon: Briefcase, variant: 'success' },
  OPPORTUNITY_CREATED: { label: 'Opportunity created', icon: CheckCircle2, variant: 'success' },
  CLIENT_WON: { label: 'Client won', icon: CheckCircle2, variant: 'success' },
  LEAD_ARCHIVED: { label: 'Lead archived', icon: AlertTriangle, variant: 'neutral' },
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function RepDayTimeline({ repId, date }: { repId: string; date: string }) {
  const [data, setData] = useState<RepDayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/rep-day?repId=${repId}&date=${date}`)
        if (res.ok && !cancelled) {
          setData(await res.json())
        }
      } catch {
        // silent
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [repId, date])

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-8 animate-pulse rounded bg-bone-raised" />
        <div className="h-8 animate-pulse rounded bg-bone-raised" />
        <div className="h-8 animate-pulse rounded bg-bone-raised" />
      </div>
    )
  }

  if (!data) {
    return <p className="py-4 text-center text-graphite">No data available.</p>
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      {data.accountability && (
        <div className="flex items-center gap-4 rounded-lg border border-line bg-bone-raised px-4 py-3">
          <div>
            <p className="text-mono-medium text-[9px] uppercase tracking-[0.12em] text-stone">Accountability</p>
            <p className="mt-0.5 text-[14px] font-medium text-ink">
              {data.accountability.total_completed}/{data.accountability.total_target || '—'}
            </p>
          </div>
          <StatusBadge
            status={data.accountability.status.replace('_', ' ')}
            variant={data.accountability.status === 'completed' ? 'success' : data.accountability.status === 'missed' ? 'danger' : 'neutral'}
          />
        </div>
      )}

      {/* Timeline */}
      {data.events.length === 0 ? (
        <p className="py-8 text-center text-graphite">No recorded actions on this date.</p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-line/60" />

          <div className="space-y-1">
            {data.events.map((event) => {
              const config = ACTION_CONFIG[event.action_type] || { label: event.action_type.replace(/_/g, ' ').toLowerCase(), icon: Clock, variant: 'neutral' as const }
              const Icon = config.icon
              const lead = event.leads as { id: string; company: string; contact_name: string } | null
              const job = event.upwork_jobs as { title: string } | null
              const targetName = lead?.company || lead?.contact_name || job?.title || null

              return (
                <div key={event.id} className="relative flex gap-3 py-2">
                  {/* Dot */}
                  <div className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-bone">
                    <Icon className={cn(
                      'size-3.5',
                      config.variant === 'success' ? 'text-status-success' :
                      config.variant === 'info' ? 'text-orange' :
                      config.variant === 'warning' ? 'text-status-warning' :
                      'text-stone',
                    )} />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-stone">{formatTime(event.occurred_at)}</span>
                      <span className="text-[13px] font-medium text-ink">{config.label}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-graphite">
                      {event.sender_profiles?.identity_name && (
                        <span>via {event.sender_profiles.identity_name}</span>
                      )}
                      {targetName && (
                        <>
                          <span>·</span>
                          {lead?.id ? (
                            <Link href={`/leads/${lead.id}`} className="hover:text-ink hover:underline">
                              {targetName}
                            </Link>
                          ) : (
                            <span>{targetName}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Assigned leads needing attention */}
      {data.assignedLeads.length > 0 && (
        <div className="mt-4">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">
            Assigned leads · {data.assignedLeads.length}
          </p>
          <div className="mt-2 space-y-1">
            {data.assignedLeads.slice(0, 5).map(lead => {
              const cs = lead.conversation_states?.[0]
              const isWaiting = cs?.next_followup_at && new Date(cs.next_followup_at).getTime() < now
              return (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center gap-2 rounded border border-line/60 px-3 py-2 text-[12px] hover:border-ink/20"
                >
                  <span className="truncate text-ink">{lead.company || 'Untitled'}</span>
                  <span className="text-stone">{lead.contact_name}</span>
                  {lead.canonical_score != null && ['STRONG', 'WORTH_PURSUING'].includes(qualifyCanonicalScore(lead.canonical_score).qualification) && (
                    <span className="text-orange">{displayScoreForCanonical(lead.canonical_score)}/10</span>
                  )}
                  {isWaiting && <span className="text-status-warning">follow-up due</span>}
                  <span className="ml-auto shrink-0 text-stone">{cs?.stage || lead.status}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
