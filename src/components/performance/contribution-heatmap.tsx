'use client'

import { useRef, useState } from 'react'
import { cn } from 'cn'
import type { DailyActivity } from '@/lib/performance/activity-model'

interface HeatmapProps {
  daily: DailyActivity[]
  timezone?: string
  onDayClick?: (day: DailyActivity) => void
  filter?: 'all' | keyof DailyActivity['breakdown']
  /** Small, label-free strip for table rows. */
  compact?: boolean
  /** Largest a cell may grow to, in px. Cells shrink to fit narrow panels. */
  maxCell?: number
  /** Word used in the tooltip, e.g. "actions" or "messages". */
  unit?: string
  /** Server-safe alternative to onDayClick: a URL with `{date}` in it. */
  dayHref?: string
}

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const GAP = 3

/**
 * GitHub-style contribution heatmap for Relay BD activity.
 * Columns are weeks (Mon→Sun rows), one orange ramp light→dark, fluid width.
 */
export function ContributionHeatmap({ daily, onDayClick, filter = 'all', compact = false, maxCell, unit = 'actions', dayHref }: HeatmapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ day: DailyActivity; x: number; y: number } | null>(null)

  if (daily.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-6 text-center">
        <p className="text-[12px] text-stone">No activity yet</p>
      </div>
    )
  }

  const weeks = organizeIntoWeeks(daily)
  const maxActivity = Math.max(...daily.map((d) => getActivityValue(d, filter)), 1)
  const cell = maxCell ?? (compact ? 10 : 22)
  const labelCol = compact ? 0 : 26
  const gridMax = labelCol + weeks.length * (cell + GAP)
  const months = monthLabels(weeks)

  function showTip(e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>, day: DailyActivity) {
    const wrap = wrapRef.current?.getBoundingClientRect()
    const r = e.currentTarget.getBoundingClientRect()
    if (!wrap) return
    setHover({ day, x: r.left - wrap.left + r.width / 2, y: r.top - wrap.top })
  }

  return (
    <div className={cn('min-w-0', !compact && 'space-y-3')}>
      <div ref={wrapRef} className="relative w-full" style={{ maxWidth: gridMax }} onMouseLeave={() => setHover(null)}>
        {!compact && (
          <div className="mb-1 grid text-[10px] text-stone" style={{ gridTemplateColumns: `${labelCol}px repeat(${weeks.length}, minmax(0, 1fr))`, columnGap: GAP }} aria-hidden="true">
            <span />
            {months.map((m, i) => (
              <span key={i} className="overflow-visible whitespace-nowrap">{m}</span>
            ))}
          </div>
        )}
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${labelCol ? `${labelCol}px ` : ''}repeat(${weeks.length}, minmax(0, 1fr))`,
            gridTemplateRows: 'repeat(7, auto)',
            gridAutoFlow: 'column',
            gap: GAP,
          }}
          role="grid"
          aria-label={`Daily ${unit}, ${weeks.length} weeks`}
        >
          {labelCol > 0 && DAY_LABELS.map((l, i) => (
            <span key={`l${i}`} className="flex items-center text-[10px] leading-none text-stone" aria-hidden="true">{l}</span>
          ))}
          {weeks.map((week, w) =>
            week.map((day, d) => {
              if (!day) return <span key={`${w}-${d}`} className="aspect-square" aria-hidden="true" />
              const value = getActivityValue(day, filter)
              const level = getIntensity(value, maxActivity)
              const clickable = Boolean((onDayClick || dayHref) && day.active)
              return (
                <button
                  key={`${w}-${d}`}
                  type="button"
                  tabIndex={clickable ? 0 : -1}
                  className={cn(
                    'aspect-square w-full rounded-[3px] transition-shadow',
                    'hover:ring-2 hover:ring-ink/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50',
                    getIntensityClass(level),
                    clickable ? 'cursor-pointer' : 'cursor-default',
                  )}
                  onClick={() => {
                    if (!clickable) return
                    if (onDayClick) onDayClick(day)
                    else if (dayHref) window.location.href = dayHref.replace('{date}', day.date)
                  }}
                  onMouseEnter={(e) => showTip(e, day)}
                  onFocus={(e) => showTip(e, day)}
                  onBlur={() => setHover(null)}
                  aria-label={formatDayTooltip(day, filter, unit)}
                />
              )
            }),
          )}
        </div>

        {hover && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-bone-raised px-2 py-1 text-[11px] text-ink shadow-md"
            style={{ left: hover.x, top: hover.y - 6 }}
            role="tooltip"
          >
            {formatDayTooltip(hover.day, filter, unit)}
          </div>
        )}
      </div>

      {!compact && (
        <div className="flex items-center gap-1.5 text-[10px] text-stone" aria-hidden="true">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className={cn('size-[10px] rounded-[2px]', getIntensityClass(level))} />
          ))}
          <span>More</span>
        </div>
      )}
    </div>
  )
}

function organizeIntoWeeks(daily: DailyActivity[]): (DailyActivity | null)[][] {
  if (daily.length === 0) return []
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
  const weeks: (DailyActivity | null)[][] = []
  let currentWeek: (DailyActivity | null)[] = []

  // Pad the first week so rows are always Mon→Sun.
  const firstDayOfWeek = new Date(sorted[0].date + 'T12:00:00').getDay() // 0=Sun
  const padDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1
  for (let i = 0; i < padDays; i++) currentWeek.push(null)

  for (const day of sorted) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null)
    weeks.push(currentWeek)
  }
  return weeks
}

/** One label per column, set only where a new month starts. */
function monthLabels(weeks: (DailyActivity | null)[][]): string[] {
  let last = -1
  return weeks.map((week, i) => {
    const first = week.find(Boolean)
    if (!first) return ''
    const month = new Date(first.date + 'T12:00:00').getMonth()
    if (month === last) return ''
    last = month
    // Skip a label squeezed against the right edge.
    if (i === weeks.length - 1 && weeks.length > 2) return ''
    return new Date(first.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })
  })
}

function getActivityValue(day: DailyActivity, filter: string): number {
  if (filter === 'all') return day.totalActions
  return day.breakdown[filter as keyof DailyActivity['breakdown']] ?? 0
}

function getIntensity(value: number, max: number): number {
  if (value === 0) return 0
  if (max <= 1) return 2
  const ratio = value / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function getIntensityClass(level: number): string {
  switch (level) {
    case 1: return 'bg-orange/25'
    case 2: return 'bg-orange/45'
    case 3: return 'bg-orange/70'
    case 4: return 'bg-orange'
    default: return 'bg-ink/[0.08]'
  }
}

function formatDayTooltip(day: DailyActivity, filter: string, unit: string): string {
  const date = new Date(day.date + 'T12:00:00')
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const value = getActivityValue(day, filter)
  const label = filter === 'all' ? unit : filter
  return `${dateStr} · ${value} ${value === 1 && label.endsWith('s') ? label.slice(0, -1) : label}`
}
