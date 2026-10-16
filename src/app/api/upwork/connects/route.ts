import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/upwork/connects
 * Returns connects usage stats for the current rep:
 * - total used this week / this month
 * - per-profile breakdown
 * - per-job history
 * - remaining balance (if tracked)
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const client = await createServerSupabase()
  const repId = authCtx.repId

  // Get all applied jobs with connects cost
  const { data: jobs } = await client
    .from('upwork_jobs')
    .select('id, title, connects_cost, connects_used, status, updated_at, profile:profiles(id, label)')
    .eq('owner_rep_id', repId)
    .eq('organization_id', authCtx.orgId)
    .in('status', ['applied', 'shortlisted', 'interviewing', 'offer_sent', 'awarded'])
    .order('updated_at', { ascending: false })
    .limit(50)

  // Calculate totals
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)
  const monthStart = new Date(now)
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  let totalUsed = 0
  let weekUsed = 0
  let monthUsed = 0
  const perProfile: Record<string, { name: string; used: number; jobs: number }> = {}

  for (const job of (jobs ?? [])) {
    const used = (job as any).connects_used ?? (job as any).connects_cost ?? 0
    const updatedAt = new Date((job as any).updated_at ?? now)
    totalUsed += used
    if (updatedAt >= weekStart) weekUsed += used
    if (updatedAt >= monthStart) monthUsed += used

    const profileName = (job as any).profile?.label ?? 'Unknown'
    if (!perProfile[profileName]) {
      perProfile[profileName] = { name: profileName, used: 0, jobs: 0 }
    }
    perProfile[profileName].used += used
    perProfile[profileName].jobs++
  }

  return NextResponse.json({
    totalUsed,
    weekUsed,
    monthUsed,
    appliedCount: jobs?.length ?? 0,
    perProfile: Object.values(perProfile),
    recentJobs: (jobs ?? []).slice(0, 10).map((j: any) => ({
      id: j.id,
      title: j.title.slice(0, 60),
      connects: j.connects_used ?? j.connects_cost ?? 0,
      status: j.status,
      date: j.updated_at,
    })),
  })
}
