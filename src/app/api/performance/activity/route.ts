import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getRepDailyActivity } from '@/lib/performance/activity-model'

export const maxDuration = 15

/**
 * GET /api/performance/activity?range=12w&repId=...
 * Returns daily activity heatmap data.
 * Reps see their own data; admins can specify repId.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })

  const url = new URL(req.url)
  const range = url.searchParams.get('range') ?? '12w'
  const repId = url.searchParams.get('repId') ?? user.rep.id
  const timezone = url.searchParams.get('timezone') ?? user.rep.timezone ?? 'UTC'

  // Permission check: reps can only see their own data
  if (repId !== user.rep.id && !authCtx.isAdmin && !authCtx.isOwner) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 400 })
  }

  // Parse range
  const { start, end } = parseRange(range)

  const supabase = createServiceSupabase()
  const result = await getRepDailyActivity({
    repId,
    orgId: authCtx.orgId,
    startDate: start,
    endDate: end,
    timezone,
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
    start.setDate(start.getDate() - 84) // Default 12 weeks
  }
  start.setHours(0, 0, 0, 0)

  return { start, end }
}
