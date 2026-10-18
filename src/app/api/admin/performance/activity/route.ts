import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { can } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getRepDailyActivity } from '@/lib/performance/activity-model'

export const maxDuration = 15

/**
 * GET /api/admin/performance/activity?repId=...&range=12w
 * Admin view: fetch activity for any rep in the org.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(ctx, 'VIEW_TEAM_ANALYTICS')) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const url = new URL(req.url)
  const repId = url.searchParams.get('repId')
  const range = url.searchParams.get('range') ?? '12w'

  if (!repId) return NextResponse.json({ error: 'repId required.' }, { status: 400 })

  const { start, end } = parseRange(range)
  const supabase = createServiceSupabase()
  const result = await getRepDailyActivity({
    repId,
    orgId: ctx.orgId,
    startDate: start,
    endDate: end,
    timezone: 'UTC', // Admin view defaults to UTC; reps see their own timezone
    supabase,
  })

  return NextResponse.json(result)
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
