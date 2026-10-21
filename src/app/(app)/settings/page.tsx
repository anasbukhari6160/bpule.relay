import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Activity, BookOpen, Building2, ChevronRight, Clock, Palette, Shield, Sparkles,
  Target, TrendingUp, User, UserCircle2, Users,
} from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { isProductAdmin } from '@/lib/auth/admin-page'
import { createScoutStore } from '@/lib/store'
import { ThemeToggle } from '@/components/theme-toggle'
import { SignOutButton } from '@/components/sign-out-button'
import { DashHeader, Meter, Panel, Pill } from '@/components/dashboard/kit'

export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', rep: 'Rep', sourcer: 'Sourcer', manager: 'Manager' }

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const authCtx = await getAuthContext()
  const isAdmin = isProductAdmin(user, authCtx)

  const store = await createScoutStore()
  const queue = await store.getTodayDashboard().catch(() => null)
  const budgets = queue?.sendBudgets ?? []
  const totalLimit = budgets.reduce((sum, b) => sum + b.limit, 0)
  const totalUsed = budgets.reduce((sum, b) => sum + b.used, 0)
  const remaining = Math.max(0, totalLimit - totalUsed)

  const planLabel = user.organization.plan === 'active' ? 'Pro' : 'Free'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <DashHeader eyebrow="Account" title="Settings" subtitle="Your account, today’s send budget and how Relay looks." />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <Panel className="md:col-span-3" title="Your account" flush>
          <dl className="divide-y divide-line/70">
            <Row icon={<User className="size-4" />} label="Name" value={user.rep.name} />
            <Row icon={<Shield className="size-4" />} label="Role" value={<Pill tone={isAdmin ? 'orange' : 'cobalt'}>{ROLE_LABEL[user.rep.role] ?? user.rep.role}</Pill>} />
            <Row icon={<Building2 className="size-4" />} label="Organization" value={<span className="flex items-center gap-2">{user.organization.name}<Pill>{planLabel}</Pill></span>} />
            <Row icon={<Clock className="size-4" />} label="Timezone" value={user.rep.timezone || 'UTC'} />
          </dl>
        </Panel>

        <div className="space-y-4 md:col-span-2">
          <Panel title="Appearance">
            <div className="flex items-center gap-3">
              <Palette className="size-4 text-stone" aria-hidden="true" />
              <p className="flex-1 text-[13px] text-ink">Light or dark theme</p>
              <ThemeToggle />
            </div>
          </Panel>
          <Panel title="Writing voice" subtitle="Shapes the tone of every draft">
            <div className="flex items-center gap-2 rounded-md border border-line bg-bone px-3 py-2 text-[12px] font-medium text-ink">
              <Sparkles className="size-3.5 text-orange" aria-hidden="true" />
              <span className="flex-1">Voice calibration not available yet</span>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        id="send-budget"
        title="Today’s send budget"
        subtitle="Daily limits keep accounts safe. They reset at midnight."
        action={<span className="text-[13px] font-medium tabular-nums text-ink">{totalUsed}<span className="text-stone"> / {totalLimit}</span></span>}
      >
        {budgets.length === 0 ? (
          <p className="text-[12px] text-stone">No send limits configured.</p>
        ) : (
          <div className="space-y-4">
            <Meter value={totalUsed} max={totalLimit} tone={remaining === 0 ? 'warning' : 'orange'} className="h-2" />
            <p className="text-[12px] text-graphite">{remaining > 0 ? `${remaining} sends left today. Spend them on replies and high-fit leads first.` : 'Daily limit reached — sends unlock at midnight.'}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {budgets.map((b) => (
                <li key={b.label} className="rounded-lg border border-line/70 bg-bone px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-[12px]">
                    <span className="text-graphite">{b.label}</span>
                    <span className="font-medium tabular-nums text-ink">{b.used}<span className="text-stone">/{b.limit}</span></span>
                  </div>
                  <Meter value={b.used} max={b.limit} tone={b.used >= b.limit ? 'warning' : 'cobalt'} className="h-1" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {isAdmin && (
        <Panel title="Workspace" subtitle="Admin controls for your team" flush>
          <ul className="grid divide-y divide-line/70 sm:grid-cols-2 sm:divide-y-0">
            <LinkRow href="/admin/people" icon={<Users className="size-4" />} label="People" detail="Roles, teams and managers" />
            <LinkRow href="/profile-intelligence" icon={<UserCircle2 className="size-4" />} label="Profiles & identities" detail="Who your team sends as" />
            <LinkRow href="/admin/targets" icon={<Target className="size-4" />} label="Targets" detail="Daily activity per person" />
            <LinkRow href="/admin/accountability" icon={<TrendingUp className="size-4" />} label="Accountability" detail="Weekly activity by person" />
            <LinkRow href="/admin/ai-usage" icon={<Activity className="size-4" />} label="AI usage" detail="Spend, errors and speed" />
            <LinkRow href="/docs" icon={<BookOpen className="size-4" />} label="Docs" detail="How Relay works" />
          </ul>
        </Panel>
      )}

      <Panel flush>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-[12px]">
          <Link href="/docs" className="text-graphite hover:text-ink">Docs</Link>
          <Link href="/pricing" className="text-graphite hover:text-ink">Plans</Link>
          <Link href="/privacy" className="text-graphite hover:text-ink">Privacy</Link>
          <Link href="/terms" className="text-graphite hover:text-ink">Terms</Link>
        </div>
        <SignOutButton />
      </Panel>
    </div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span className="text-stone" aria-hidden="true">{icon}</span>
      <dt className="w-28 shrink-0 text-[12px] text-graphite">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{value}</dd>
    </div>
  )
}

function LinkRow({ href, icon, label, detail }: { href: string; icon: React.ReactNode; label: string; detail: string }) {
  return (
    <li className="sm:border-b sm:border-line/70 sm:odd:border-r">
      <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-bone sm:px-5">
        <span className="text-stone" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">{label}</span>
          <span className="block truncate text-[11px] text-stone">{detail}</span>
        </span>
        <ChevronRight className="size-4 text-stone" aria-hidden="true" />
      </Link>
    </li>
  )
}
