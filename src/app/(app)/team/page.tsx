import { Users } from 'lucide-react'
import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current'
import { can, getAuthContext } from '@/lib/auth/organization'
import { loadTeamLive } from '@/lib/admin/load-team-live'
import { filterTeamLive, type TeamLivePayload } from '@/lib/admin/team-live'
import { EmptyState } from '@/components/ui/empty-state'
import { TeamLiveBoard } from '@/components/admin/team-live-board'

export const dynamic = 'force-dynamic'

export default async function TeamPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const authCtx = await getAuthContext()
  const canSeeTeam = Boolean(authCtx && can(authCtx, 'VIEW_TEAM_ANALYTICS'))

  const live: TeamLivePayload | null = authCtx
    ? await loadTeamLive(authCtx.orgId)
        .then((full) => filterTeamLive(full, { repId: authCtx.repId, canSeeTeam }))
        .catch(() => null)
    : null

  return (
    <div className="space-y-5">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Team</p>
        <h1 className="mt-1 text-[28px] font-light tracking-[-0.02em] text-ink">
          {canSeeTeam ? 'Who is covering their numbers' : 'Your numbers'}
        </h1>
        <p className="mt-1 text-[14px] text-graphite">
          Pulled, sent, and what is still left. Open a person to see the jobs.
        </p>
      </header>

      {!live || !live.people?.length ? (
        <EmptyState
          icon={Users}
          title="No team activity yet"
          description={canSeeTeam ? 'Invite reps and assign profiles to start tracking team performance.' : 'Your activity will appear here once you complete your first actions.'}
          action={
            canSeeTeam ? (
              <Link href="/admin/people" className="relay-cta text-[12px]">
                Invite team
              </Link>
            ) : (
              <Link href="/prospect" className="relay-cta text-[12px]">
                Start prospecting
              </Link>
            )
          }
        />
      ) : (
        <Suspense fallback={<div className="h-40 animate-pulse rounded-lg border border-line bg-bone-raised" />}>
          <TeamLiveBoard initial={live} />
        </Suspense>
      )}

      {canSeeTeam && (
        <Link href="/team/eval" className="inline-flex text-[13px] font-medium text-ink">
          Reply quality and system health
        </Link>
      )}
    </div>
  )
}
