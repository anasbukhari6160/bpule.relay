import { Users, Calendar, Target, Clock, CheckCircle2 } from 'lucide-react'
import { cn } from 'cn'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { isProductAdmin } from '@/lib/auth/admin-page'
import { createScoutStore } from '@/lib/store'
import { createServerSupabase } from '@/lib/supabase/server'
import { getTeamCalendar, getRepAccountability } from '@/lib/accountability/metrics'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

function getWeekRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now)
  const day = start.getDay()
  const diff = start.getDate() - day + (day === 0 ? -6 : 1)
  start.setDate(diff)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export default async function AccountabilityPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const authCtx = await getAuthContext()
  if (!authCtx || !isProductAdmin(user, authCtx)) redirect('/dashboard')

  const store = await createScoutStore()
  const client = await createServerSupabase()
  const reps = await store.listAllReps()
  const repIds = reps.map((r) => r.id)
  const repNames = new Map(reps.map((r) => [r.id, r.name]))

  const today = new Date().toISOString().slice(0, 10)
  const { start: weekStart, end: weekEnd } = getWeekRange()

  const [calendar, repDetails] = await Promise.all([
    getTeamCalendar(client, repIds, repNames, weekStart, weekEnd),
    Promise.all(repIds.map((id) => getRepAccountability(client, id, repNames.get(id) ?? id.slice(0, 8)))),
  ])

  const todayView = calendar.find((d) => d.date === today)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team Accountability"
        description="Complete visibility into who is working on what. One action = one meaningful outreach step."
      />

      {/* Today Summary */}
      <section className="rounded-2xl border border-line bg-bone-raised/20 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Target className="size-4 text-cobalt" />
          <h2 className="text-sm font-medium text-ink">Today — {today}</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <MetricCard label="Connections" value={todayView?.teamTotal.connectionsSent ?? 0} />
          <MetricCard label="DMs Sent" value={todayView?.teamTotal.dmsSent ?? 0} />
          <MetricCard label="Follow-ups" value={todayView?.teamTotal.followupsSent ?? 0} />
          <MetricCard label="Replies Received" value={todayView?.teamTotal.repliesReceived ?? 0} />
          <MetricCard label="Leads Won" value={todayView?.teamTotal.leadsWon ?? 0} highlight />
        </div>
      </section>

      {/* Rep Detail Table */}
      <section className="rounded-2xl border border-line overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-center gap-2">
          <Users className="size-4 text-cobalt" />
          <h2 className="text-sm font-medium text-ink">Rep Performance</h2>
        </div>
        <div className="divide-y divide-line">
          {repDetails.map((rep) => (
            <div key={rep.repId} className="px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cobalt/10 text-xs font-semibold text-cobalt">
                    {rep.repName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink">{rep.repName}</p>
                    <p className="text-[11px] text-stone">{rep.activeLeads} active leads today</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-ink">{rep.today.totalActions} actions</p>
                  <p className="text-[11px] text-stone">{rep.today.responseRate}% response rate</p>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-3 mt-2">
                <MiniStat label="Conn" value={rep.today.connectionsSent} />
                <MiniStat label="DM" value={rep.today.dmsSent} />
                <MiniStat label="Follow" value={rep.today.followupsSent} />
                <MiniStat label="Replies" value={rep.today.repliesSent} />
                <MiniStat label="Won" value={rep.today.leadsWon} />
              </div>
              {/* Week/Month */}
              <div className="flex items-center gap-4 mt-3 text-[11px] text-stone">
                <span>Week: <strong className="text-ink">{rep.week.totalActions} actions</strong></span>
                <span>Month: <strong className="text-ink">{rep.month.totalActions} actions</strong></span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Weekly Calendar */}
      <section className="rounded-2xl border border-line overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-center gap-2">
          <Calendar className="size-4 text-cobalt" />
          <h2 className="text-sm font-medium text-ink">Weekly Activity — {weekStart} to {weekEnd}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line bg-bone-raised/30">
                <th className="text-left px-4 py-2 font-medium text-stone">Rep</th>
                {calendar.map((day) => (
                  <th key={day.date} className="text-center px-2 py-2 font-medium text-stone">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(day.date + 'T12:00:00').getDay()]}
                    <br />
                    <span className="text-[10px]">{day.date.slice(5)}</span>
                  </th>
                ))}
                <th className="text-center px-4 py-2 font-medium text-ink">Total</th>
              </tr>
            </thead>
            <tbody>
              {repIds.map((repId, idx) => {
                const name = repNames.get(repId) ?? ''
                return (
                  <tr key={repId} className="border-b border-line/50">
                    <td className="px-4 py-2 font-medium text-ink whitespace-nowrap">{name || `Rep ${idx + 1}`}</td>
                    {calendar.map((day) => {
                      const repMetric = day.reps.find((r) => r.repId === repId)
                      const actions = repMetric?.totalActions ?? 0
                      return (
                        <td key={day.date} className="text-center px-2 py-2">
                          <span className={actions > 0 ? 'font-medium text-ink' : 'text-stone/40'}>
                            {actions || '—'}
                          </span>
                        </td>
                      )
                    })}
                    <td className="text-center px-4 py-2 font-semibold text-ink">
                      {calendar.reduce((sum, day) => sum + (day.reps.find((r) => r.repId === repId)?.totalActions ?? 0), 0)}
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-bone-raised/30 font-semibold">
                <td className="px-4 py-2 text-ink">Team</td>
                {calendar.map((day) => (
                  <td key={day.date} className="text-center px-2 py-2 text-ink">
                    {day.teamTotal.totalActions || '—'}
                  </td>
                ))}
                <td className="text-center px-4 py-2 text-cobalt">
                  {calendar.reduce((sum, day) => sum + day.teamTotal.totalActions, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Action Definitions */}
      <section className="rounded-2xl border border-line bg-bone-raised/20 p-5">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="size-4 text-cobalt" />
          <h2 className="text-sm font-medium text-ink">What counts as an action</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-cobalt shrink-0" />
            <div>
              <span className="font-medium text-ink">Connection sent</span>
              <p className="text-stone">Rep sent a LinkedIn connection note to a lead</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-cobalt shrink-0" />
            <div>
              <span className="font-medium text-ink">DM sent</span>
              <p className="text-stone">Rep sent a first message after connection accepted</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-cobalt shrink-0" />
            <div>
              <span className="font-medium text-ink">Follow-up sent</span>
              <p className="text-stone">Rep sent a follow-up message to a non-responsive lead</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-cobalt shrink-0" />
            <div>
              <span className="font-medium text-ink">Reply sent</span>
              <p className="text-stone">Rep responded to a client's inbound message</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 rounded-full bg-status-success shrink-0" />
            <div>
              <span className="font-medium text-ink">Lead won</span>
              <p className="text-stone">Lead status changed to won — full cycle complete</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn('rounded-xl border p-3', highlight ? 'border-status-success/30 bg-status-success/5' : 'border-line bg-bone')}>
      <p className="text-[11px] text-stone">{label}</p>
      <p className={cn('text-xl font-semibold mt-1', highlight ? 'text-status-success' : 'text-ink')}>{value}</p>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bone-raised/40 px-2 py-1.5 text-center">
      <p className="text-[10px] text-stone">{label}</p>
      <p className="text-sm font-medium text-ink">{value}</p>
    </div>
  )
}


