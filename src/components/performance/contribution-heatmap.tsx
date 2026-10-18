'use client'

import { useState } from 'react'
import { cn } from 'cn'
import type { DailyActivity } from '@/lib/performance/activity-model'

interface HeatmapProps {
  daily: DailyActivity[]
  timezone?: string
  onDayClick?: (day: DailyActivity) => void
  filter?: 'all' | keyof DailyActivity['breakdown']
}

/**
 * GitHub-style contribution heatmap for Relay BD activity.
 * Dark palette, intensity-based, workday-aware.
 */
export function ContributionHeatmap({ daily, onDayClick, filter = 'all' }: HeatmapProps) {
  const [hoveredDay, setHoveredDay] = useState<DailyActivity | null>(null)

  if (daily.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-bone-raised/40 p-8 text-center">
        <p className="text-[13px] text-graphite">No activity yet</p>
      </div>
    )
  }

  // Organize into weeks (columns) with Mon-Sun rows
  const weeks = organizeIntoWeeks(daily)
  const maxActivity = Math.max(...daily.map(d => getActivityValue(d, filter)), 1)

  return (
    <div className="space-y-3">
      {/* Heatmap grid */}
      <div className="overflow-x-auto">
        <div className="inline-flex gap-[3px]">
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className="flex flex-col gap-[3px]">
              {Array.from({ length: 7 }, (_, dayIdx) => {
                const day = week[dayIdx]
                if (!day) return <div key={dayIdx} className="size-[13px]" />

                const value = getActivityValue(day, filter)
                const intensity = getIntensity(value, maxActivity)

                return (
                  <button
                    key={dayIdx}
                    className={cn(
                      'size-[13px] rounded-[2px] transition-all duration-150',
                      'hover:ring-1 hover:ring-orange/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/30',
                      getIntensityClass(intensity),
                      day.active && 'cursor-pointer',
                    )}
                    onClick={() => day.active && onDayClick?.(day)}
                    onMouseEnter={() => setHoveredDay(day)}
                    onMouseLeave={() => setHoveredDay(null)}
                    aria-label={`${day.date}: ${value} actions`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] text-stone">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map(level => (
            <div
              key={level}
              className={cn('size-[10px] rounded-[2px]', getIntensityClass(level))}
            />
          ))}
          <span>More</span>
        </div>
        {hoveredDay && (
          <div className="text-[11px] text-graphite">
            {formatDayTooltip(hoveredDay, filter)}
          </div>
        )}
      </div>
    </div>
  )
}

function organizeIntoWeeks(daily: DailyActivity[]): (DailyActivity | null)[][] {
  if (daily.length === 0) return []

  const weeks: (DailyActivity | null)[][] = []
  let currentWeek: (DailyActivity | null)[] = []

  // Start from the first day, pad to Monday
  const firstDate = new Date(daily[0].date + 'T12:00:00')
  const firstDayOfWeek = firstDate.getDay() // 0=Sun, 1=Mon
  const padDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1

  for (let i = 0; i < padDays; i++) {
    currentWeek.push(null)
  }

  for (const day of daily) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }

  // Pad last week
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null)
    weeks.push(currentWeek)
  }

  return weeks
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
    case 0: return 'bg-bone/40'
    case 1: return 'bg-orange/20'
    case 2: return 'bg-orange/40'
    case 3: return 'bg-orange/70'
    case 4: return 'bg-orange'
    default: return 'bg-bone/40'
  }
}

function formatDayTooltip(day: DailyActivity, filter: string): string {
  const date = new Date(day.date + 'T12:00:00')
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  if (filter === 'all') {
    return `${dateStr}: ${day.totalActions} actions`
  }
  const value = day.breakdown[filter as keyof DailyActivity['breakdown']] ?? 0
  return `${dateStr}: ${value} ${filter}`
}
