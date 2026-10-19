import { ChevronRight, Send, MessageSquare, Bell, Reply, Trophy, Activity } from 'lucide-react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { isProductAdmin } from '@/lib/auth/admin-page'
import { createServerSupabase } from '@/lib/supabase/server'
import { getRepAccountability, type DailyMetrics, type LeadJourney } from '@/lib/accountability/metrics'
import { DashHeader, EmptyNote, Panel, Pill, StatTile } from '@/components/dashboard/kit'

export const dynamic = 'force-dynamic'

export default async function RepAccountabilityPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const authCtx = await getAuthContext()
  if (!authCtx) redirect('/login')
  // Admins track the team, not a personal scorecard.
  if (isProductAdmin(user, authCtx)) redirect('/admin/accountability')

  const client = await createServerSupabase()
  const accountability = await getRepAccountability(client, authCtx.repId, user.rep.name)
  const { today, week, month } = accountability

  const needsReply = accountability.openLeads.filter((l) => l.hasReply)
  const needsFollowup = accountability.openLeads.filter((l) => l.dmSent && !l.hasReply)
  const pendingDm = accountability.openLeads.filter((l) => !l.hasReply && l.connectionSent && !l.dmSent)

  return (
    <div className="space-y-6">
      <DashHeader
        eyebrow="My numbers"
        title={today.totalActions > 0 ? `${today.totalActions} actions today` : 'No actions yet today'}
        subtitle="One action = one real outreach step a client can see. Here is where you stand."
        actions={<Link href="/performance" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bone-raised px-3 py-1.5 text-[12px] font-medium text-ink hover:border-ink/20">Full history<ChevronRight className="size-3.5" aria-hidden="true" /></Link>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Connections" value={today.connectionsSent} icon={<Send className="size-3.5" />} />
        <StatTile label="First DMs" value={today.dmsSent} icon={<MessageSquare className="size-3.5" />} />
        <StatTile label="Follow-ups" value={today.followupsSent} icon={<Bell className="size-3.5" />} />
        <StatTile label="Replies sent" value={today.repliesSent} icon={<Reply className="size-3.5" />} />
        <StatTile label="Won" value={today.leadsWon} tone={today.leadsWon > 0 ? 'success' : 'neutral'} icon={<Trophy className="size-3.5" />} />
        <StatTile label="Response rate" value={today.outreachActions > 0 ? `${today.responseRate}%` : '—'} tone="cobalt" icon={<Activity className="size-3.5" />} sub="Client replies ÷ outreach" />
      </div>

      <Panel title="Today, this week, this month" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-right text-[10px] uppercase tracking-[0.1em] text-stone">
                <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">Period</th>
                <th scope="col" className="px-2 py-2 font-medium">Conn.</th>
                <th scope="col" className="px-2 py-2 font-medium">DMs</th>
                <th scope="col" className="px-2 py-2 font-medium">Follow-ups</th>
                <th scope="col" className="px-2 py-2 font-medium">Replies</th>
                <th scope="col" className="px-2 py-2 font-medium">Client replies</th>
                <th scope="col" className="px-2 py-2 font-medium">Won</th>
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              <PeriodRow label="Today" m={today} />
              <PeriodRow label="This week" m={week} />
              <PeriodRow label="This month" m={month} />
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <LeadQueue title="Needs your reply" hint="Clients who answered" leads={needsReply} cta="Reply" tone="orange" />
        <LeadQueue title="Follow-up due" hint="Messaged, no answer yet" leads={needsFollowup} cta="Follow up" tone="cobalt" />
        <LeadQueue title="Send first DM" hint="Connected, not messaged" leads={pendingDm} cta="Send DM" tone="neutral" />
      </div>

      <details className="group rounded-xl border border-line bg-bone-raised px-5 py-3 text-[12px]">
        <summary className="cursor-pointer list-none font-medium text-ink marker:hidden">
          <span className="inline-flex items-center gap-1.5"><ChevronRight className="size-3.5 text-stone transition-transform group-open:rotate-90" aria-hidden="true" />What counts as an action</span>
        </summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-graphite sm:grid-cols-2">
          <div><dt className="inline font-medium text-ink">Connection</dt> <dd className="inline">— you sent a LinkedIn connection note</dd></div>
          <div><dt className="inline font-medium text-ink">First DM</dt> <dd className="inline">— your first message to a connected lead</dd></div>
          <div><dt className="inline font-medium text-ink">Follow-up</dt> <dd className="inline">— you re-engaged a lead that went quiet</dd></div>
          <div><dt className="inline font-medium text-ink">Reply</dt> <dd className="inline">— you answered a client&apos;s message</dd></div>
          <div><dt className="inline font-medium text-ink">Won</dt> <dd className="inline">— a lead you converted</dd></div>
        </dl>
      </details>
    </div>
  )
}

function PeriodRow({ label, m }: { label: string; m: DailyMetrics }) {
  return (
    <tr className="text-right tabular-nums text-graphite">
      <th scope="row" className="px-4 py-2.5 text-left text-[13px] font-medium text-ink sm:px-5">{label}</th>
      <td className="px-2 py-2.5">{m.connectionsSent}</td>
      <td className="px-2 py-2.5">{m.dmsSent}</td>
      <td className="px-2 py-2.5">{m.followupsSent}</td>
      <td className="px-2 py-2.5">{m.repliesSent}</td>
      <td className="px-2 py-2.5">{m.repliesReceived}</td>
      <td className={m.leadsWon > 0 ? 'px-2 py-2.5 font-medium text-status-success' : 'px-2 py-2.5'}>{m.leadsWon}</td>
      <td className="px-4 py-2.5 text-[13px] font-medium text-ink sm:px-5">{m.totalActions}</td>
    </tr>
  )
}

function LeadQueue({ title, hint, leads, cta, tone }: { title: string; hint: string; leads: LeadJourney[]; cta: string; tone: 'orange' | 'cobalt' | 'neutral' }) {
  return (
    <Panel title={title} subtitle={hint} action={<Pill tone={leads.length > 0 ? tone : 'neutral'}>{leads.length}</Pill>} flush>
      {leads.length === 0 ? (
        <EmptyNote>Nothing here right now.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line/70">
          {leads.slice(0, 6).map((lead) => (
            <li key={lead.leadId}>
              <Link href={`/leads/${lead.leadId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bone sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">{lead.company}</p>
                  <p className="truncate text-[11px] text-stone">{lead.contactName || 'Contact'} · score {lead.score}</p>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-cobalt">{cta}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
