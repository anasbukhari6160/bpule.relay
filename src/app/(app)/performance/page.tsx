import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getRepDailyActivity } from '@/lib/performance/activity-model'
import { ContributionHeatmap } from '@/components/performance/contribution-heatmap'
import { DayDrilldown } from '@/components/performance/day-drilldown'

export const dynamic = 'force-dynamic'

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; date?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const authCtx = await getAuthContext()
  if (!authCtx) redirect('/login')

  const { range = '12w', date } = await searchParams
  const timezone = user.rep.timezone ?? 'UTC'
  const { start, end } = parseRange(range)

  const supabase = createServiceSupabase()
  const result = await getRepDailyActivity({
    repId: user.rep.id,
    orgId: authCtx.orgId,
    startDate: start,
    endDate: end,
    timezone,
    supabase,
  })

  const selectedDay = date
    ? result.daily.find(d => d.date === date) ?? null
    : null

  return (
    <div className="space-y-6 pb-8">
      <header className="space-y-1.5">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange">
          Your Consistency
        </p>
        <h1 className="text-display text-[28px] font-light tracking-[-0.02em] text-ink">
          Activity
        </h1>
      </header>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Active days" value={result.summary.activeDays} suffix={`/ ${result.summary.totalDays}`} />
        <StatCard label="Total actions" value={result.summary.totalActions} />
        <StatCard label="Per active day" value={result.summary.averagePerActiveDay} />
        <StatCard label="Current streak" value={result.summary.currentStreak} suffix=" days" />
      </div>

      {/* Heatmap */}
      <section className="rounded-lg border border-line bg-bone-raised p-4">
        <ContributionHeatmap
          daily={result.daily}
          timezone={timezone}
          dayHref={`/performance?range=${encodeURIComponent(range)}&date={date}`}
        />
      </section>

      {/* Action breakdown */}
      <section className="rounded-lg border border-line bg-bone-raised p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone mb-3">
          Breakdown
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <BreakdownItem label="Connections" value={result.summary.breakdown.connections} />
          <BreakdownItem label="First DMs" value={result.summary.breakdown.firstDMs} />
          <BreakdownItem label="Follow-ups" value={result.summary.breakdown.followups} />
          <BreakdownItem label="Replies" value={result.summary.breakdown.replies} />
          <BreakdownItem label="Upwork" value={result.summary.breakdown.upworkApplications} />
          <BreakdownItem label="Meetings" value={result.summary.breakdown.meetings} />
          <BreakdownItem label="Wins" value={result.summary.breakdown.wins} highlight />
          <BreakdownItem label="Referrals" value={result.summary.breakdown.referrals} />
        </div>
      </section>

      {/* Day drilldown */}
      {selectedDay && (
        <DayDrilldown day={selectedDay} timezone={timezone} />
      )}
    </div>
  )
}

function StatCard({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bone-raised p-3">
      <p className="text-[18px] font-medium text-ink">{value}{suffix}</p>
      <p className="text-[10px] text-stone">{label}</p>
    </div>
  )
}

function BreakdownItem({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-line/60 bg-bone-raised/40 px-3 py-2">
      <span className="text-[12px] text-graphite">{label}</span>
      <span className={cn('text-[13px] font-medium', highlight ? 'text-status-success' : 'text-ink')}>{value}</span>
    </div>
  )
}

function parseRange(range: string): { start: Date; end: Date } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  if (range.endsWith('w')) {
    const weeks = parseInt(range, 10) || 12
    start.setDate(start.getDate() - weeks * 7)
  } else if (range.endsWith('m')) {
    const months = parseInt(range, 10) || 3
    start.setMonth(start.getMonth() - months)
  } else {
    start.setDate(start.getDate() - 84)
  }
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}
