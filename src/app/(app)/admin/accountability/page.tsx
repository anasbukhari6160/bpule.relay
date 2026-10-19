import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight, Send, MessageSquare, Bell, Reply, Trophy, Activity } from 'lucide-react'
import { cn } from 'cn'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { isProductAdmin } from '@/lib/auth/admin-page'
import { createScoutStore } from '@/lib/store'
import { createServerSupabase } from '@/lib/supabase/server'
import { getTeamCalendar, getRepAccountability, type RepAccountability, type TeamDayView } from '@/lib/accountability/metrics'
import { DashHeader, EmptyNote, Initials, Panel, Pill, StatTile } from '@/components/dashboard/kit'

export const dynamic = 'force-dynamic'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Monday→Sunday of the week `offset` weeks from this one (0 = this week). */
function getWeekRange(offset: number): { start: string; end: string } {
  const start = new Date()
  const day = start.getDay()
  start.setDate(start.getDate() - day + (day === 0 ? -6 : 1) + offset * 7)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: isoDate(start), end: isoDate(end) }
}

function fmtDay(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function AccountabilityPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const authCtx = await getAuthContext()
  if (!authCtx || !isProductAdmin(user, authCtx)) redirect('/dashboard')

  const raw = Number.parseInt((await searchParams).week ?? '0', 10)
  const offset = Number.isFinite(raw) ? Math.min(0, Math.max(-12, raw)) : 0

  const store = await createScoutStore()
  const reps = await store.listAllReps()
  const repIds = reps.map((r) => r.id)
  const repNames = new Map(reps.map((r) => [r.id, r.name]))
  const today = isoDate(new Date())
  const { start: weekStart, end: weekEnd } = getWeekRange(offset)

  let calendar: TeamDayView[] = []
  let repDetails: RepAccountability[] = []
  let loadError = false
  try {
    const client = await createServerSupabase()
    ;[calendar, repDetails] = await Promise.all([
      getTeamCalendar(client, repIds, repNames, weekStart, weekEnd),
      Promise.all(repIds.map((id) => getRepAccountability(client, id, repNames.get(id) ?? 'Teammate'))),
    ])
  } catch (err) {
    console.error('admin accountability failed:', err instanceof Error ? err.message : 'unknown error')
    loadError = true
  }

  const week = calendar.reduce((acc, d) => ({
    total: acc.total + d.teamTotal.totalActions,
    connections: acc.connections + d.teamTotal.connectionsSent,
    dms: acc.dms + d.teamTotal.dmsSent,
    followups: acc.followups + d.teamTotal.followupsSent,
    replies: acc.replies + d.teamTotal.repliesReceived,
    won: acc.won + d.teamTotal.leadsWon,
  }), { total: 0, connections: 0, dms: 0, followups: 0, replies: 0, won: 0 })

  const rowsByRep = repIds.map((repId) => {
    const days = calendar.map((d) => d.reps.find((r) => r.repId === repId)?.totalActions ?? 0)
    return { repId, name: repNames.get(repId) ?? 'Teammate', days, total: days.reduce((s, n) => s + n, 0) }
  }).sort((a, b) => b.total - a.total)
  const maxCell = Math.max(1, ...rowsByRep.flatMap((r) => r.days))
  const workdays = calendar.filter((d) => {
    const dow = new Date(d.date + 'T12:00:00').getDay()
    return dow !== 0 && dow !== 6 && d.date <= today
  }).length

  const todayRows = [...repDetails].sort((a, b) => b.today.totalActions - a.today.totalActions)
  const idleToday = todayRows.filter((r) => r.today.totalActions === 0).length
  const weekLabel = offset === 0 ? 'This week' : offset === -1 ? 'Last week' : `Week of ${fmtDay(weekStart)}`

  return (
    <div className="space-y-6">
      <DashHeader
        eyebrow="Team accountability"
        title={weekLabel}
        subtitle={`${fmtDay(weekStart)} – ${fmtDay(weekEnd)} · one action = one real outreach step a client can see.`}
        actions={
          <nav aria-label="Week" className="inline-flex items-center rounded-lg border border-line bg-bone p-0.5">
            <Link href={`/admin/accountability?week=${offset - 1}`} className="rounded-md p-1.5 text-stone hover:text-ink" aria-label="Previous week"><ChevronLeft className="size-4" /></Link>
            <Link href="/admin/accountability" aria-current={offset === 0 ? 'page' : undefined} className={cn('rounded-md px-3 py-1 text-[12px] font-medium', offset === 0 ? 'bg-bone-raised text-ink shadow-sm' : 'text-stone hover:text-ink')}>This week</Link>
            {offset < 0 ? (
              <Link href={`/admin/accountability?week=${offset + 1}`} className="rounded-md p-1.5 text-stone hover:text-ink" aria-label="Next week"><ChevronRight className="size-4" /></Link>
            ) : (
              <span className="p-1.5 text-line" aria-hidden="true"><ChevronRight className="size-4" /></span>
            )}
          </nav>
        }
      />

      {loadError && (
        <p role="alert" className="rounded-lg border border-status-warning/30 bg-status-warning/5 px-4 py-3 text-[12px] text-graphite">Activity could not load. Refresh to try again.</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Team actions" value={week.total} tone="orange" icon={<Activity className="size-3.5" />} sub={workdays > 0 ? `${Math.round(week.total / workdays)} per workday` : weekLabel.toLowerCase()} />
        <StatTile label="Connections" value={week.connections} icon={<Send className="size-3.5" />} />
        <StatTile label="First DMs" value={week.dms} icon={<MessageSquare className="size-3.5" />} />
        <StatTile label="Follow-ups" value={week.followups} icon={<Bell className="size-3.5" />} />
        <StatTile label="Client replies" value={week.replies} tone={week.replies > 0 ? 'cobalt' : 'neutral'} icon={<Reply className="size-3.5" />} />
        <StatTile label="Won" value={week.won} tone={week.won > 0 ? 'success' : 'neutral'} icon={<Trophy className="size-3.5" />} />
      </div>

      <Panel title="Activity by day" subtitle="Darker means more actions · open a person for their timeline" flush>
        {rowsByRep.length === 0 ? (
          <EmptyNote>No people in this workspace yet.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.1em] text-stone">
                  <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">Person</th>
                  {calendar.map((d) => (
                    <th key={d.date} scope="col" className={cn('px-1 py-2 text-center font-medium', d.date === today && 'text-orange')}>
                      {DAY_NAMES[new Date(d.date + 'T12:00:00').getDay()]}
                      <span className="block text-[9px] font-normal normal-case tracking-normal">{d.date.slice(8)}</span>
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2 text-right font-medium sm:px-5">Week</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rowsByRep.map((row) => (
                  <tr key={row.repId} className="hover:bg-bone/60">
                    <th scope="row" className="px-4 py-1.5 text-left font-normal sm:px-5">
                      <Link href={`/team/${row.repId}`} className="flex items-center gap-2 hover:underline">
                        <Initials name={row.name} size="sm" tone={row.total === 0 ? 'warning' : 'neutral'} />
                        <span className="truncate text-[13px] text-ink">{row.name}</span>
                      </Link>
                    </th>
                    {row.days.map((n, i) => {
                      const future = calendar[i] && calendar[i].date > today
                      return (
                        <td key={i} className="px-1 py-1.5">
                          <HeatCell value={n} max={maxCell} future={future} label={`${row.name}, ${calendar[i] ? fmtDay(calendar[i].date) : ''}: ${n} actions`} />
                        </td>
                      )
                    })}
                    <td className="px-4 py-1.5 text-right text-[13px] font-medium tabular-nums text-ink sm:px-5">{row.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-bone/60 text-[12px]">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-ink sm:px-5">Team</th>
                  {calendar.map((d) => (
                    <td key={d.date} className="px-1 py-2 text-center font-medium tabular-nums text-ink">{d.date > today ? '' : d.teamTotal.totalActions}</td>
                  ))}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-orange sm:px-5">{week.total}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Today by person"
        subtitle={idleToday > 0 ? `${idleToday} ${idleToday === 1 ? 'person has' : 'people have'} no activity yet today` : 'Everyone has logged activity today'}
        flush
      >
        {todayRows.length === 0 ? (
          <EmptyNote>No people in this workspace yet.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-right text-[10px] uppercase tracking-[0.1em] text-stone">
                  <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">Person</th>
                  <th scope="col" className="px-2 py-2 font-medium">Conn.</th>
                  <th scope="col" className="px-2 py-2 font-medium">DMs</th>
                  <th scope="col" className="px-2 py-2 font-medium">Follow-ups</th>
                  <th scope="col" className="px-2 py-2 font-medium">Replies</th>
                  <th scope="col" className="px-2 py-2 font-medium">Won</th>
                  <th scope="col" className="px-2 py-2 font-medium">Today</th>
                  <th scope="col" className="px-2 py-2 font-medium">Response</th>
                  <th scope="col" className="px-2 py-2 font-medium">Week</th>
                  <th scope="col" className="px-4 py-2 font-medium sm:px-5">Month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 text-right tabular-nums text-graphite">
                {todayRows.map((rep) => (
                  <tr key={rep.repId} className="hover:bg-bone/60">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal sm:px-5">
                      <Link href={`/team/${rep.repId}`} className="group flex items-center gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-ink group-hover:underline">{rep.repName}</span>
                          <span className="block text-[11px] text-stone">{rep.activeLeads} leads touched</span>
                        </span>
                        {rep.today.totalActions === 0 && <Pill tone="warning">idle</Pill>}
                      </Link>
                    </th>
                    <td className="px-2 py-2.5">{rep.today.connectionsSent}</td>
                    <td className="px-2 py-2.5">{rep.today.dmsSent}</td>
                    <td className="px-2 py-2.5">{rep.today.followupsSent}</td>
                    <td className="px-2 py-2.5">{rep.today.repliesSent}</td>
                    <td className={cn('px-2 py-2.5', rep.today.leadsWon > 0 && 'font-medium text-status-success')}>{rep.today.leadsWon}</td>
                    <td className="px-2 py-2.5 text-[13px] font-medium text-ink">{rep.today.totalActions}</td>
                    <td className="px-2 py-2.5">{rep.today.outreachActions > 0 ? `${rep.today.responseRate}%` : '—'}</td>
                    <td className="px-2 py-2.5">{rep.week.totalActions}</td>
                    <td className="px-4 py-2.5 sm:px-5">{rep.month.totalActions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <details className="group rounded-xl border border-line bg-bone-raised px-5 py-3 text-[12px]">
        <summary className="cursor-pointer list-none font-medium text-ink marker:hidden">
          <span className="inline-flex items-center gap-1.5"><ChevronRight className="size-3.5 text-stone transition-transform group-open:rotate-90" aria-hidden="true" />What counts as an action</span>
        </summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-graphite sm:grid-cols-2">
          <div><dt className="inline font-medium text-ink">Connection</dt> <dd className="inline">— a LinkedIn connection note sent to a lead</dd></div>
          <div><dt className="inline font-medium text-ink">First DM</dt> <dd className="inline">— the first message after a connection is accepted</dd></div>
          <div><dt className="inline font-medium text-ink">Follow-up</dt> <dd className="inline">— a nudge to a lead that has not answered</dd></div>
          <div><dt className="inline font-medium text-ink">Reply</dt> <dd className="inline">— an answer to a client&apos;s message</dd></div>
          <div><dt className="inline font-medium text-ink">Won</dt> <dd className="inline">— a lead marked won, the full cycle</dd></div>
        </dl>
      </details>
    </div>
  )
}

function HeatCell({ value, max, future, label }: { value: number; max: number; future?: boolean; label: string }) {
  if (future) return <div className="mx-auto h-7 w-full min-w-[34px] rounded-md border border-dashed border-line/70" aria-hidden="true" />
  const ratio = value / max
  const strength = value === 0 ? 0 : Math.round(18 + ratio * 82)
  return (
    <div
      className={cn(
        'mx-auto flex h-7 w-full min-w-[34px] items-center justify-center rounded-md text-[11px] tabular-nums',
        value === 0 ? 'bg-ink/[0.06] text-stone' : strength > 60 ? 'text-on-accent' : 'text-ink',
      )}
      style={value > 0 ? { background: `color-mix(in srgb, var(--orange) ${strength}%, transparent)` } : undefined}
      title={label}
      aria-label={label}
    >
      {value > 0 ? value : '·'}
    </div>
  )
}
