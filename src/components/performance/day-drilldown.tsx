'use client'

import { useState } from 'react'
import { X, MessageSquare, UserPlus, Send, Briefcase, Users, Award } from 'lucide-react'
import { cn } from 'cn'
import type { DailyActivity } from '@/lib/performance/activity-model'

interface DayDrilldownProps {
  day: DailyActivity
  timezone: string
}

/**
 * Day drilldown panel — shows exact events for a clicked heatmap day.
 * Auditable: every event links to its lead/job.
 */
export function DayDrilldown({ day, timezone }: DayDrilldownProps) {
  const [expanded, setExpanded] = useState(true)

  if (!day.active) return null

  const date = new Date(day.date + 'T12:00:00')
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <section className="rounded-lg border border-line bg-bone-raised overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div>
          <h3 className="text-[13px] font-medium text-ink">{dateStr}</h3>
          <p className="text-[11px] text-graphite">{day.totalActions} actions</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-stone hover:text-ink transition-colors"
        >
          {expanded ? <X className="size-4" /> : <span className="text-[11px]">Expand</span>}
        </button>
      </div>

      {expanded && (
        <div className="p-4 space-y-2">
          {/* Breakdown chips */}
          <div className="flex flex-wrap gap-2 mb-3">
            {day.breakdown.connections > 0 && <Chip icon={<UserPlus className="size-3" />} label={`${day.breakdown.connections} connections`} />}
            {day.breakdown.firstDMs > 0 && <Chip icon={<Send className="size-3" />} label={`${day.breakdown.firstDMs} first DMs`} />}
            {day.breakdown.followups > 0 && <Chip icon={<MessageSquare className="size-3" />} label={`${day.breakdown.followups} follow-ups`} />}
            {day.breakdown.replies > 0 && <Chip icon={<MessageSquare className="size-3" />} label={`${day.breakdown.replies} replies`} />}
            {day.breakdown.upworkApplications > 0 && <Chip icon={<Briefcase className="size-3" />} label={`${day.breakdown.upworkApplications} Upwork`} />}
            {day.breakdown.meetings > 0 && <Chip icon={<Users className="size-3" />} label={`${day.breakdown.meetings} meetings`} />}
            {day.breakdown.wins > 0 && <Chip icon={<Award className="size-3" />} label={`${day.breakdown.wins} wins`} highlight />}
          </div>

          {/* Event timeline */}
          <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
            {day.events.map((event, i) => (
              <div
                key={event.id ?? i}
                className="flex items-center gap-3 rounded-md border border-line/60 bg-bone-raised/40 px-3 py-2"
              >
                <span className="text-[10px] text-stone w-12 shrink-0">
                  {formatTime(event.occurredAt, timezone)}
                </span>
                <span className="text-[11px] text-ink flex-1">
                  {formatEventType(event.type)}
                  {event.leadCompany && (
                    <span className="text-graphite"> — {event.leadCompany}</span>
                  )}
                </span>
                {event.leadId && (
                  <a
                    href={`/leads/${event.leadId}`}
                    className="text-[10px] text-cobalt hover:underline shrink-0"
                  >
                    Open →
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function Chip({ icon, label, highlight }: { icon: React.ReactNode; label: string; highlight?: boolean }) {
  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px]',
      highlight ? 'bg-status-success/10 text-status-success' : 'bg-bone text-graphite'
    )}>
      {icon}
      {label}
    </div>
  )
}

function formatTime(iso: string, timezone: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return '??:??'
  }
}

function formatEventType(type: string): string {
  const labels: Record<string, string> = {
    'LEAD_ANALYZED': 'Lead analyzed',
    'LEAD_SAVED': 'Lead saved',
    'CONNECTION_SENT': 'Connection sent',
    'FIRST_DM_SENT': 'First DM sent',
    'FOLLOWUP_SENT': 'Follow-up sent',
    'REPLY_SENT': 'Reply sent',
    'UPWORK_APPLIED': 'Upwork applied',
    'MEETING_BOOKED': 'Meeting booked',
    'LEAD_WON': 'Won',
    'LEAD_REFERRED': 'Referred',
  }
  return labels[type] ?? type
}
