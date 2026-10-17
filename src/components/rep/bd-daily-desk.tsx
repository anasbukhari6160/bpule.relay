'use client'

import { getLeadDisplayScore } from '@/lib/scoring/display-score'
import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Clock,
  MessageSquare,
  Search,
  Sparkles,
  UserPlus,
  Users,
  Briefcase,
  Handshake,
  AlertCircle,
  Link2,
  ClipboardList,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from 'cn'
import { readSse } from '@/lib/sse/client'
import type { RelayTodayAction } from '@/components/relay-today-workspace'

interface BdDailyDeskProps {
  yourMove: RelayTodayAction[]
  theirMove: RelayTodayAction[]
  repliesWaiting: number
  followUpsDue: number
  referredLeads: Array<{ id: string; company: string; score: number | null; canonicalScore: number | null; displayQualification?: string | null; displayIntelligenceVersion?: string | null; referredAt: string | null; referrerName?: string | null; reason?: string | null }>
  recentLeads: Array<{ id: string; company: string; score: number | null; canonicalScore: number | null; displayQualification?: string | null; displayIntelligenceVersion?: string | null; createdAt: string }>
  hasAnyWork: boolean
}

function channelIcon(kind: string) {
  if (kind === 'job_worth_apply') return <Briefcase className="size-3 text-cobalt" />
  if (kind === 'reply_needed' || kind === 'followup_due' || kind === 'connection_dm_due') return <Link2 className="size-3 text-cobalt/70" />
  return null
}

function channelLabel(kind: string): string | null {
  if (kind === 'job_worth_apply') return 'Upwork'
  if (kind === 'reply_needed' || kind === 'followup_due' || kind === 'connection_dm_due') return 'LinkedIn'
  if (kind === 'inbound_opportunity') return 'Inbound'
  return null
}

function whyThisIsNext(action: RelayTodayAction): string {
  switch (action.kind) {
    case 'reply_needed':
      return action.whatHappened || 'Client responded — reply while fresh'
    case 'followup_due':
      return action.whatHappened || 'No reply after 5d — time to follow up'
    case 'connection_dm_due':
      return 'Connection accepted — send first message'
    case 'high_fit_lead':
      return action.whyItMatters || 'Strong opportunity worth pursuing'
    case 'new_opportunity':
      return 'New lead saved — start outreach'
    case 'job_worth_apply':
      return action.whyItMatters || 'Strong fit — worth applying'
    case 'inbound_opportunity':
      return action.whatHappened || 'Inbound message — review and respond'
    default:
      return action.whatHappened || action.whyItMatters || ''
  }
}

interface InlinePreview {
  score: number | null
  label: string
  name: string
  title: string
  company: string
  verdict: string
}

export function BdDailyDesk({
  yourMove,
  theirMove,
  repliesWaiting,
  followUpsDue,
  referredLeads,
  recentLeads,
  hasAnyWork,
}: BdDailyDeskProps) {
  const [quickPasted, setQuickPasted] = useState('')
  const [inlinePreview, setInlinePreview] = useState<InlinePreview | null>(null)
  const [inlineAnalyzing, setInlineAnalyzing] = useState(false)

  const handleQuickAnalyze = async () => {
    if (quickPasted.trim().length < 24) return
    setInlineAnalyzing(true)
    setInlinePreview(null)
    try {
      const res = await fetch('/api/prospect/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: quickPasted }),
      })
      if (!res.ok) throw new Error('Analysis failed')
      let preview: InlinePreview | null = null
      await readSse<{ type: string; extracted?: Record<string, unknown>; score?: Record<string, unknown> }>(res, {
        onEvent: (ev) => {
          if (ev.type === 'done' && ev.score) {
            preview = {
              score: (ev.score as Record<string, unknown>).total as number | null ?? null,
              label: (ev.score as Record<string, unknown>).qualification as string ?? '',
              name: (ev.extracted as Record<string, unknown>)?.name as string ?? '',
              title: ((ev.extracted as Record<string, unknown>)?.titleRaw ?? (ev.extracted as Record<string, unknown>)?.title) as string ?? '',
              company: (ev.extracted as Record<string, unknown>)?.company as string ?? '',
              verdict: (ev.score as Record<string, unknown>).qualification as string ?? '',
            }
          }
        },
      })
      if (preview) {
        setInlinePreview(preview)
      } else {
        // No preview data, go to full page
        window.location.href = `/prospect?paste=${encodeURIComponent(quickPasted)}`
      }
    } catch {
      window.location.href = `/prospect?paste=${encodeURIComponent(quickPasted)}`
    } finally {
      setInlineAnalyzing(false)
    }
  }

  const goToFullAnalysis = () => {
    window.location.href = `/prospect?paste=${encodeURIComponent(quickPasted)}`
  }

  // Separate highest-value actions
  const replyActions = yourMove.filter(a => a.kind === 'reply_needed')
  const followupActions = yourMove.filter(a => a.kind === 'followup_due')
  const otherActions = yourMove.filter(a => a.kind !== 'reply_needed' && a.kind !== 'followup_due')

  return (
    <div className="space-y-5">
      {/* Quick Analyze — prominent paste input */}
      <section className="rounded-lg border border-line bg-bone-raised p-4">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-orange" />
          <h2 className="text-sm font-medium text-ink">Analyze a prospect</h2>
        </div>
        <p className="mt-1 text-xs text-graphite">
          Paste a LinkedIn profile, Upwork job, or conversation. Relay identifies the source and starts the right flow.
        </p>
        <Textarea
          value={quickPasted}
          onChange={(e) => setQuickPasted(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              handleQuickAnalyze()
            }
          }}
          placeholder="Paste a prospect, job, profile or conversation..."
          rows={5}
          className="mt-3 max-h-[16rem] overflow-y-auto font-mono text-[13px]"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-graphite">Cmd / Ctrl + Enter</span>
          <Button
            variant="orange"
            size="sm"
            onClick={handleQuickAnalyze}
            disabled={quickPasted.trim().length < 24 || inlineAnalyzing}
            loading={inlineAnalyzing}
          >
            <Sparkles className="size-3.5" />
            Analyze
          </Button>
        </div>

        {/* Inline analysis preview */}
        {inlinePreview && !inlineAnalyzing && (
          <div className="mt-3 rounded-lg border border-orange/20 bg-orange/[0.02] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">
                  {inlinePreview.name || 'Prospect'}
                  {inlinePreview.company ? ` · ${inlinePreview.company}` : ''}
                </p>
                {inlinePreview.title && (
                  <p className="text-[11px] text-graphite">{inlinePreview.title}</p>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  {inlinePreview.score != null && (
                    <span className="rounded-full bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange">
                      {Math.round(inlinePreview.score)}/100
                    </span>
                  )}
                  {inlinePreview.label && (
                    <span className="text-[11px] text-graphite">{inlinePreview.label}</span>
                  )}
                </div>
              </div>
              <Button
                variant="orange"
                size="sm"
                className="shrink-0"
                onClick={goToFullAnalysis}
              >
                <ExternalLink className="size-3" />
                Open
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Empty state for new reps */}
      {!hasAnyWork && yourMove.length === 0 && referredLeads.length === 0 && (
        <section className="rounded-lg border border-dashed border-line bg-bone-raised/40 p-6 text-center">
          <ClipboardList className="mx-auto size-8 text-stone" />
          <p className="mt-3 text-[14px] font-medium text-ink">Nothing needs your attention yet</p>
          <p className="mt-1 max-w-xs mx-auto text-[13px] text-graphite">
            Start by analyzing a prospect. Paste a LinkedIn profile above and Relay will extract, score, and recommend next steps.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/prospect"
              className="inline-flex items-center gap-2 rounded-md bg-orange px-3 py-2 text-[12px] font-medium text-on-accent hover:bg-orange-dark"
            >
              <UserPlus className="size-3.5" />
              Extract a profile
            </Link>
            <Link
              href="/upwork/new"
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[12px] font-medium text-ink hover:bg-bone"
            >
              <Briefcase className="size-3.5" />
              Paste Upwork job
            </Link>
          </div>
        </section>
      )}

      {/* Quick action tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link
          href="/prospect"
          className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-bone-raised p-3 transition-all duration-300 hover:border-orange/40 hover:bg-orange/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/30 focus-visible:border-orange/40"
        >
          <UserPlus className="size-5 text-orange" />
          <span className="text-[11px] font-medium text-ink">Extract Profile</span>
        </Link>
        <Link
          href="/leads?filter=followup"
          className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-bone-raised p-3 transition-all duration-300 hover:border-orange/40 hover:bg-orange/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/30 focus-visible:border-orange/40"
        >
          <MessageSquare className="size-5 text-orange" />
          <span className="text-[11px] font-medium text-ink">Follow-ups</span>
          {followUpsDue > 0 && (
            <span className="text-[10px] font-medium text-status-warning">{followUpsDue} due</span>
          )}
        </Link>
        <Link
          href="/leads?filter=reply"
          className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-bone-raised p-3 transition-all duration-300 hover:border-orange/40 hover:bg-orange/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/30 focus-visible:border-orange/40"
        >
          <Handshake className="size-5 text-orange" />
          <span className="text-[11px] font-medium text-ink">Replies</span>
          {repliesWaiting > 0 && (
            <span className="text-[10px] font-medium text-status-warning">{repliesWaiting} waiting</span>
          )}
        </Link>
        <Link
          href="/upwork/new"
          className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-bone-raised p-3 transition-all duration-300 hover:border-orange/40 hover:bg-orange/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/30 focus-visible:border-orange/40"
        >
          <Briefcase className="size-5 text-orange" />
          <span className="text-[11px] font-medium text-ink">Add Upwork</span>
        </Link>
      </div>

      {/* Referred to you — high visibility */}
      {referredLeads.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Users className="size-3.5 text-orange" />
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Referred to you</h3>
            <span className="rounded-full bg-orange/10 px-1.5 py-0.5 text-[9px] font-medium text-orange">{referredLeads.length}</span>
          </div>
          <div className="space-y-1.5">
            {referredLeads.slice(0, 3).map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="flex items-center gap-3 rounded-lg border border-orange/20 bg-orange/[0.02] p-3 transition-colors hover:border-orange/40"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium text-ink">{lead.company}</span>
                  {lead.referrerName && (
                    <p className="mt-0.5 text-[11px] text-graphite">
                      From {lead.referrerName}{lead.reason ? ` — ${lead.reason}` : ''}
                    </p>
                  )}
                  {!lead.referrerName && lead.reason && (
                    <p className="mt-0.5 text-[11px] text-graphite">{lead.reason}</p>
                  )}
                </div>
                <ArrowRight className="size-4 shrink-0 text-stone" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Replies waiting — highest value */}
      {replyActions.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-3.5 text-orange" />
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Replies waiting</h3>
          </div>
          <div className="space-y-1.5">
            {replyActions.slice(0, 3).map((action) => (
              <Link
                key={action.id}
                href={action.href}
                className="flex items-center gap-3 rounded-lg border border-orange/30 bg-orange/[0.03] p-3 transition-colors hover:border-orange/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {channelIcon(action.kind)}
                    <span className="text-[13px] font-medium text-ink">{action.title}</span>
                    {channelLabel(action.kind) && (
                      <span className="rounded bg-bone-raised px-1.5 py-0.5 text-[9px] font-medium text-stone">{channelLabel(action.kind)}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-graphite">{whyThisIsNext(action)}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-stone" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Follow-ups due — second highest value */}
      {followupActions.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="size-3.5 text-status-warning" />
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Follow-ups due</h3>
          </div>
          <div className="space-y-1.5">
            {followupActions.slice(0, 3).map((action) => (
              <Link
                key={action.id}
                href={action.href}
                className="flex items-center gap-3 rounded-lg border border-status-warning/20 bg-status-warning/[0.02] p-3 transition-colors hover:border-status-warning/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {channelIcon(action.kind)}
                    <span className="text-[13px] font-medium text-ink">{action.title}</span>
                    {channelLabel(action.kind) && (
                      <span className="rounded bg-bone-raised px-1.5 py-0.5 text-[9px] font-medium text-stone">{channelLabel(action.kind)}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-graphite">{whyThisIsNext(action)}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-stone" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Other your-move items */}
      {otherActions.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-3.5 text-stone" />
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Your move</h3>
          </div>
          <div className="space-y-1.5">
            {otherActions.slice(0, 3).map((action) => (
              <Link
                key={action.id}
                href={action.href}
                className="flex items-center gap-3 rounded-lg border border-line bg-bone-raised p-3 transition-colors hover:border-orange/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {channelIcon(action.kind)}
                    <span className="text-[13px] font-medium text-ink">{action.title}</span>
                    {channelLabel(action.kind) && (
                      <span className="rounded bg-bone-raised px-1.5 py-0.5 text-[9px] font-medium text-stone">{channelLabel(action.kind)}</span>
                    )}
                    {action.priority === 'urgent' && (
                      <span className="rounded-full bg-status-danger/10 px-1.5 py-0.5 text-[9px] font-medium text-status-danger">
                        URGENT
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-graphite">{whyThisIsNext(action)}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-stone" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* THEIR MOVE queue */}
      {theirMove.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="size-3.5 text-stone" />
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Their move</h3>
          </div>
          <div className="space-y-1.5">
            {theirMove.slice(0, 3).map((action) => (
              <div
                key={action.id}
                className="flex items-center gap-3 rounded-lg border border-line/60 bg-bone-raised/60 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {channelIcon(action.kind)}
                    <span className="text-[12px] text-ink">{action.title}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-graphite">{action.subtitle}</p>
                </div>
                <span className="shrink-0 text-[10px] text-stone">Waiting</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent work */}
      {recentLeads.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Recent work</h3>
            <Link href="/leads" className="text-[11px] text-graphite hover:text-ink">All leads →</Link>
          </div>
          <div className="space-y-1">
            {recentLeads.slice(0, 5).map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="flex items-center justify-between rounded-lg border border-line/60 bg-bone-raised/40 px-3 py-2 transition-colors hover:bg-bone"
              >
                <span className="text-[12px] text-ink truncate">{lead.company}</span>
                {getLeadDisplayScore(lead).value != null ? (
                  <span className="shrink-0 text-[11px] font-mono text-stone">{getLeadDisplayScore(lead).text}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
