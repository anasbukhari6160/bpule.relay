import { UserPlus } from 'lucide-react'
import { createScoutStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { isProductAdmin } from '@/lib/auth/admin-page'
import { EmptyState } from '@/components/ui/empty-state'
import { ProfilesManager } from '@/components/profiles-manager'


export const dynamic = 'force-dynamic'

export default async function ProfilesPage() {
  const user = await getCurrentUser()
  const authCtx = await getAuthContext()
  const store = await createScoutStore()
  const isAdmin = isProductAdmin(user, authCtx)
  const [profiles, reps] = await Promise.all([
    isAdmin ? store.listAllProfiles() : store.listProfiles(),
    isAdmin ? store.listAllReps() : Promise.resolve([]),
  ])
  const linkedinCount = profiles.filter((profile) => profile.platform === 'linkedin').length
  const upworkCount = profiles.filter((profile) => profile.platform === 'upwork').length
  const ownerByRepId = Object.fromEntries(reps.map((rep) => [rep.id, rep.name]))

  return (
    <div className="space-y-5">
      <section className="srf-console srf-console-edge overflow-hidden px-5 py-5 sm:px-6">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Identity / Execution Profiles</p>
        <h1 className="mt-2 text-[30px] leading-[1.05] tracking-[-0.03em] text-[color:var(--console-text)]">
          Manage who your team writes as.
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] text-[color:var(--console-mute)]">
          {isAdmin
            ? 'Every profile the org owns, grouped by who added it. Client names surface only when permission is on file.'
            : 'Profiles define sender voice and proof eligibility. Client names surface only when permission is on file.'}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Total profiles" value={profiles.length} />
          <Stat label="LinkedIn" value={linkedinCount} />
          <Stat label="Upwork" value={upworkCount} />
        </div>
      </section>
      {profiles.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No profiles yet"
          description="Create your first Revenue Identity to start outreach. Profiles define who your team writes as."
          action={
            <a href="/onboarding" className="relay-cta text-[12px]">
              Create profile
            </a>
          }
        />
      ) : (
        <ProfilesManager
          initialProfiles={profiles}
          ownerByRepId={isAdmin ? ownerByRepId : undefined}
          isAdmin={isAdmin}
          reps={isAdmin ? reps.map((r) => ({ id: r.id, name: r.name })) : undefined}
        />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-orange/20 bg-orange/5 px-3 py-2">
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light/80">{label}</p>
      <p className="mt-1 text-[20px] font-medium text-[color:var(--console-text)]">{value}</p>
    </div>
  )
}
