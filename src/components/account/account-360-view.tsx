import Link from 'next/link'
import {
  Building2, Users, MessageSquare, Clock, ChevronRight,
  Target, Zap, Briefcase, TrendingUp, AlertCircle,
} from 'lucide-react'
import { cn } from 'cn'
import type { Lead, Message, Profile } from '@/lib/domain/types'
import type { DecisionTrace } from '@/lib/relay/decision-trace'
import { DecisionTraceView } from '@/components/leads/decision-trace-view'
import { getLeadDisplayScore } from '@/lib/scoring/display-score'

interface Account360ViewProps {
  company: string
  companyKey: string
  leads: Lead[]
  messages: Message[]
  profiles: Profile[]
  traces: Array<{ leadId: string; trace: DecisionTrace }>
}

/**
 * Account 360 — lightweight company intelligence view.
 * Not a CRM. Answers: What do we know? Who are we talking to? What's happening? Who should act?
 */
export function Account360View({ company, companyKey, leads, messages, profiles, traces }: Account360ViewProps) {
  const inboundMessages = messages.filter(m => m.direction === 'inbound' && m.sentText)
  const outboundMessages = messages.filter(m => m.direction !== 'inbound' && m.sentText)
  const openLeads = leads.filter(l => !['won', 'lost', 'dead'].includes(l.status))
  const wonLeads = leads.filter(l => l.status === 'won')
  const avgScore = leads.length > 0
    ? Math.round(leads.reduce((sum, l) => sum + (l.canonicalScore ?? 0), 0) / leads.length)
    : 0

  // Unique decision makers
  const decisionMakers = [...new Map(
    leads
      .filter(l => l.contactName && l.contactTitle)
      .map(l => [`${l.contactName}|${l.contactTitle}`, { name: l.contactName!, title: l.contactTitle!, leadId: l.id }])
  ).values()]

  // Active conversations (leads with messages)
  const activeConversations = openLeads.filter(l => messages.some(m => m.leadId === l.id))

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <header className="space-y-1.5">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange">Account 360</p>
        <div className="flex items-center gap-3">
          <Building2 className="size-5 text-orange" />
          <h1 className="text-display text-[28px] font-light tracking-[-0.02em] text-ink">{company}</h1>
        </div>
        <p className="text-[13px] text-graphite">{companyKey}</p>
      </header>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <MiniStat label="Leads" value={leads.length} icon={<Users className="size-3.5" />} />
        <MiniStat label="Open" value={openLeads.length} icon={<Target className="size-3.5" />} />
        <MiniStat label="Won" value={wonLeads.length} icon={<TrendingUp className="size-3.5" />} variant="success" />
        <MiniStat label="Avg Score" value={avgScore} icon={<Zap className="size-3.5" />} />
        <MiniStat label="Messages" value={outboundMessages.length + inboundMessages.length} icon={<MessageSquare className="size-3.5" />} />
      </div>

      {/* Decision makers */}
      {decisionMakers.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Decision Makers</h3>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {decisionMakers.slice(0, 6).map((dm, i) => (
              <Link
                key={i}
                href={`/leads/${dm.leadId}`}
                className="flex items-center gap-3 rounded-lg border border-line bg-bone-raised p-3 transition-colors hover:border-orange/40"
              >
                <div className="flex size-8 items-center justify-center rounded-full bg-cobalt/10 text-[12px] font-medium text-cobalt">
                  {dm.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{dm.name}</p>
                  <p className="truncate text-[11px] text-graphite">{dm.title}</p>
                </div>
                <ChevronRight className="size-3.5 shrink-0 text-stone" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Active conversations */}
      {activeConversations.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Active Conversations</h3>
          <div className="space-y-1.5">
            {activeConversations.slice(0, 5).map(lead => {
              const leadMsgs = messages.filter(m => m.leadId === lead.id)
              const lastMsg = leadMsgs.at(-1)
              const score = getLeadDisplayScore(lead)
              return (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center gap-3 rounded-lg border border-line bg-bone-raised p-3 transition-colors hover:border-orange/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">{lead.contactName ?? lead.company}</span>
                      {score.value != null && (
                        <span className="rounded-full bg-orange/10 px-1.5 py-0.5 text-[9px] font-medium text-orange">
                          {score.text}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-graphite">
                      {lastMsg?.sentText?.slice(0, 80) ?? 'No messages yet'}
                    </p>
                  </div>
                  <ChevronRight className="size-3.5 shrink-0 text-stone" />
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Top lead decision traces */}
      {traces.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Decision Reasoning (Top Leads)</h3>
          <div className="space-y-2">
            {traces.map(({ leadId, trace }) => {
              const lead = leads.find(l => l.id === leadId)
              return (
                <div key={leadId} className="space-y-1">
                  <p className="text-[11px] font-medium text-ink">{lead?.contactName ?? lead?.company}</p>
                  <DecisionTraceView trace={trace} />
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function MiniStat({ label, value, icon, variant }: {
  label: string
  value: number
  icon: React.ReactNode
  variant?: 'success' | 'default'
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-bone-raised p-3">
      <div className={cn('text-stone', variant === 'success' && 'text-status-success')}>{icon}</div>
      <div>
        <p className={cn('text-[18px] font-medium text-ink', variant === 'success' && 'text-status-success')}>{value}</p>
        <p className="text-[10px] text-stone">{label}</p>
      </div>
    </div>
  )
}
