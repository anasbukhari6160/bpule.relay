import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Send, Users } from 'lucide-react'
import { cn } from 'cn'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { isProductAdmin } from '@/lib/auth/admin-page'
import { ProfileIntelligenceDashboard } from '@/components/profile-intelligence/dashboard'
import { RevenueIdentityManager } from '@/components/revenue-identity-manager'
import { DashHeader } from '@/components/dashboard/kit'
import { profileAccess } from '@/lib/profile-intelligence/access'

export const dynamic = 'force-dynamic'

/**
 * One home for people and the identities they send as:
 *  - People: profiles built from CVs and proof (Profile Intelligence)
 *  - Sending identities: the company-owned personas reps send outreach as,
 *    each linked back to a profile and assigned to reps.
 */
export default async function ProfileIntelligencePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const authCtx = await getAuthContext()
  if (!authCtx) redirect('/login')

  const access = profileAccess(authCtx)
  const isAdmin = isProductAdmin(user, authCtx)
  const params = await searchParams
  const tab = isAdmin && params.tab === 'identities' ? 'identities' : 'people'

  return (
    <div className="space-y-5">
      <DashHeader
        eyebrow={isAdmin ? 'Admin · Profiles' : 'Profiles'}
        title={isAdmin ? 'People & sending identities' : 'Your profiles'}
        subtitle={isAdmin
          ? 'Profiles hold who someone is — experience, skills and proof. Sending identities are how your reps show up in outreach, each built from a profile.'
          : 'Open a profile to see its skills, proof and projects for your outreach. Your admins keep this data up to date.'}
      />

      {isAdmin && (
        <nav aria-label="Profiles sections" className="flex gap-1 border-b border-line">
          <TabLink href="/profile-intelligence" active={tab === 'people'} icon={<Users className="size-3.5" />}>People</TabLink>
          <TabLink href="/profile-intelligence?tab=identities" active={tab === 'identities'} icon={<Send className="size-3.5" />}>Sending identities</TabLink>
        </nav>
      )}

      {tab === 'identities' ? (
        <Suspense fallback={<div className="h-[280px] animate-pulse rounded-xl border border-line bg-bone-raised" />}>
          <RevenueIdentityManager />
        </Suspense>
      ) : (
        <ProfileIntelligenceDashboard orgId={authCtx.orgId} isAdmin={access.canMerge} canManage={access.canManage} />
      )}
    </div>
  )
}

function TabLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
        active ? 'border-orange text-ink' : 'border-transparent text-stone hover:text-ink',
      )}
    >
      {icon}{children}
    </Link>
  )
}
