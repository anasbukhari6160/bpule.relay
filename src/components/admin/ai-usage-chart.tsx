'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function shortDate(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Daily AI spend. One measure, one axis — call counts live in the tooltip. */
export function AiUsageChart({ data }: { data: Array<{ date: string; calls: number; cost: number; errors: number }> }) {
  return (
    <div className="h-[220px]" role="img" aria-label="Daily AI spend in US dollars">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: 'var(--stone)' }} tickLine={false} axisLine={false} minTickGap={20} />
          <YAxis tickFormatter={(v: number) => `$${v < 1 ? v.toFixed(2) : Math.round(v)}`} tick={{ fontSize: 10, fill: 'var(--stone)' }} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            cursor={{ fill: 'var(--line)', opacity: 0.35 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as { date: string; calls: number; cost: number; errors: number }
              return (
                <div className="rounded-lg border border-line bg-bone-raised px-3 py-2 text-[11px] shadow-md">
                  <p className="mb-1 font-medium text-ink">{shortDate(p.date)}</p>
                  <p className="text-graphite">Spend <span className="font-medium text-ink">${p.cost.toFixed(2)}</span></p>
                  <p className="text-graphite">Calls <span className="font-medium text-ink">{p.calls}</span></p>
                  {p.errors > 0 && <p className="text-status-danger">{p.errors} failed</p>}
                </div>
              )
            }}
          />
          <Bar dataKey="cost" name="Spend" fill="var(--cobalt)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
