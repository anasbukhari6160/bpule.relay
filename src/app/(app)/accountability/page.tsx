import { Target, TrendingUp, CheckCircle2, Clock, ArrowRight } from 'lucide-react'
import { cn } from 'cn'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { createScoutStore } from '@/lib/store'
import { createServerSupabase } from '@/lib/supabase/server'
import { getRepAccountability } from '@/lib/accountability/metrics'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

export default async function RepAccountabilityPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const authCtx = await getAuthContext()
  if (!authCtx) redirect('/login')

  const store = await createScoutStore()
  const client = await createServerSupabase()
  const accountability = await getRepAccountability(client, authCtx.repId, user.rep.name)

  const pendingLeads = accountability.openLeads.filter(
    (l) => !l.hasReply && l.connectionSent && !l.dmSent,
  )
  const needsReply = accountability.openLeads.filter((l) => l.hasReply)
  const needsFollowup = accountability.openLeads.filter(
    (l) => l.dmSent && !l.hasReply,
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your Accountability"
        description="One action = one meaningful outreach step. Here's where you stand."
      />

      {/* Today Stats */}
      <section className="rounded-2xl border border-line bg-bone-raised/20 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Target className="size-4 text-cobalt" />
          <h2 className="text-sm font-medium text-ink">Today</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Connections" value={accountability.today.connectionsSent} />
          <StatCard label="DMs" value={accountability.today.dmsSent} />
          <StatCard label="Follow-ups" value={accountability.today.followupsSent} />
          <StatCard label="Replies" value={accountability.today.repliesSent} />
          <StatCard label="Won" value={accountability.today.leadsWon} highlight />
        </div>
        <div className="mt-4 pt-4 border-t border-line flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-ink">{accountability.today.totalActions} total actions</p>
            <p className="text-[12px] text-stone">Response rate: {accountability.today.responseRate}%</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-stone">Week: <strong className="text-ink">{accountability.week.totalActions}</strong></p>
            <p className="text-sm text-stone">Month: <strong className="text-ink">{accountability.month.totalActions}</strong></p>
          </div>
        </div>
      </section>

      {/* What to do next */}
      {needsReply.length > 0 && (
        <Section icon={<TrendingUp className="size-4 text-orange" />} title="Needs Your Reply">
          {needsReply.slice(0, 5).map((lead) => (
            <LeadRow key={lead.leadId} lead={lead} label="Reply" href={`/leads/${lead.leadId}`} />
          ))}
        </Section>
      )}

      {needsFollowup.length > 0 && (
        <Section icon={<Clock className="size-4 text-cobalt" />} title="Follow-Up Due">
          {needsFollowup.slice(0, 5).map((lead) => (
            <LeadRow key={lead.leadId} lead={lead} label="Follow up" href={`/leads/${lead.leadId}`} />
          ))}
        </Section>
      )}

      {pendingLeads.length > 0 && (
        <Section icon={<ArrowRight className="size-4 text-stone" />} title="Send First DM">
          {pendingLeads.slice(0, 5).map((lead) => (
            <LeadRow key={lead.leadId} lead={lead} label="Send DM" href={`/leads/${lead.leadId}`} />
          ))}
        </Section>
      )}

      {/* Action Definition */}
      <section className="rounded-2xl border border-line bg-bone-raised/20 p-5">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="size-4 text-cobalt" />
          <h2 className="text-sm font-medium text-ink">What counts as an action</h2>
        </div>
        <ul className="space-y-2 text-[12px] text-graphite">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-cobalt shrink-0" />
            <span><strong className="text-ink">Connection sent</strong> — You sent a LinkedIn connection note</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-cobalt shrink-0" />
            <span><strong className="text-ink">DM sent</strong> — You sent a first message to a connected lead</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-cobalt shrink-0" />
            <span><strong className="text-ink">Follow-up sent</strong> — You re-engaged a non-responsive lead</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-cobalt shrink-0" />
            <span><strong className="text-ink">Reply sent</strong> — You responded to a client's message</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-status-success shrink-0" />
            <span><strong className="text-ink">Lead won</strong> — Lead converted successfully</span>
          </li>
        </ul>
      </section>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-medium text-ink">{title}</h2>
      </div>
      <div className="divide-y divide-line/50">{children}</div>
    </section>
  )
}

function LeadRow({ lead, label, href }: { lead: { leadId: string; company: string; contactName: string; score: number }; label: string; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between px-5 py-3 hover:bg-bone-raised/30 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink truncate">{lead.company}</p>
        <p className="text-[11px] text-stone truncate">{lead.contactName}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[11px] text-stone">Score: {lead.score}</span>
        <span className="rounded-full bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange">{label}</span>
      </div>
    </Link>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn('rounded-xl border p-3', highlight ? 'border-status-success/30 bg-status-success/5' : 'border-line bg-bone')}>
      <p className="text-[11px] text-stone">{label}</p>
      <p className={cn('text-xl font-semibold mt-1', highlight ? 'text-status-success' : 'text-ink')}>{value}</p>
    </div>
  )
}
