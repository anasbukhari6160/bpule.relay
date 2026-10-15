'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  CalendarDays,
  Target,
  Briefcase,
  Search,
  MessageSquare,
  PenLine,
  UserCircle2,
  Shield,
  Settings,
  LogOut,
  ChevronDown,
  Command,
  Menu,
  X,
  BarChart3,
  TrendingUp,
  Users,
  Layers,
  Activity,
} from 'lucide-react'
import { cn } from 'cn'
import { RelayBrand } from '@/components/brand'
import { IdentityChip } from '@/components/identity-chip'
import { NotificationCenter } from '@/components/notification-center'
import { ThemeToggle } from '@/components/theme-toggle'
import { APP_VERSION } from '@/lib/version'
import type { RepRole } from '@/lib/domain/types'

const PRIMARY_NAV = [
  { href: '/dashboard', label: 'Today', icon: CalendarDays, exact: true },
  { href: '/leads', label: 'Leads', icon: Target, exact: false },
  { href: '/prospect', label: 'Prospect', icon: Search, exact: false },
  { href: '/accountability', label: 'My Numbers', icon: TrendingUp, exact: true },
]

const TEAM_NAV = [
  { href: '/team', label: 'My Team', icon: Users, exact: false },
]

const STUDIO_NAV = [
  { href: '/content', label: 'Studio', icon: PenLine, exact: false, studio: true },
]

const MORE_NAV: Array<{
  href: string
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  exact: boolean
  roles?: RepRole[]
  adminOnly?: boolean
  group: string
}> = [
  { href: '/upwork', label: 'Jobs', icon: Briefcase, exact: false, group: 'Work' },
  { href: '/relay', label: 'Conversations', icon: MessageSquare, exact: false, group: 'Work' },
  { href: '/inbound', label: 'Inbox', icon: Search, exact: false, group: 'Work' },
  { href: '/archive', label: 'Archive', icon: Target, exact: false, group: 'Work' },
  { href: '/content-v2/growth', label: 'Relay Growth', icon: TrendingUp, exact: true, adminOnly: true, group: 'Create' },
  { href: '/profile-intelligence', label: 'Profiles', icon: UserCircle2, exact: false, group: 'Intelligence' },
  { href: '/facts', label: 'Proof', icon: Shield, exact: false, group: 'Intelligence' },
  { href: '/admin/accountability', label: 'Accountability', icon: TrendingUp, exact: true, adminOnly: true, group: 'Admin' },
  { href: '/admin/command-center', label: 'Command', icon: Shield, exact: true, adminOnly: true, group: 'Admin' },
  { href: '/admin/people', label: 'People', icon: Users, exact: true, adminOnly: true, group: 'Admin' },
  { href: '/admin/revenue-intelligence', label: 'Revenue', icon: BarChart3, exact: true, adminOnly: true, group: 'Admin' },
  { href: '/admin/revenue-identities', label: 'Identities', icon: UserCircle2, exact: true, adminOnly: true, group: 'Admin' },
  { href: '/admin/targets', label: 'Targets', icon: Target, exact: true, adminOnly: true, group: 'Admin' },
  { href: '/admin/ai-usage', label: 'AI Usage', icon: Activity, exact: true, adminOnly: true, group: 'Admin' },
  { href: '/usage', label: 'Usage', icon: Layers, exact: false, group: 'Account' },
  { href: '/account', label: 'Settings', icon: Settings, exact: false, group: 'Account' },
]

const ROLE_LABEL: Record<RepRole, string> = {
  admin: 'Admin',
  rep: 'Rep',
  sourcer: 'Sourcer',
  manager: 'Manager',
}

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; exact: boolean; studio?: boolean }
type NavSectionProps = { label?: string; items: NavItem[]; isActive: (href: string, exact: boolean) => boolean; studio?: boolean }

function NavSection({ label, items, isActive, studio }: NavSectionProps) {
  return (
    <div>
      {label && (
        <div className="mb-1 px-2 pt-1">
          <span className="text-label text-stone">{label}</span>
        </div>
      )}
      {items.map(({ href, label: itemLabel, icon: Icon, exact }) => {
        const active = isActive(href, exact)
        return (
          <Link
            key={href}
            href={href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-all duration-150',
              active
                ? studio
                  ? 'bg-cobalt text-on-accent shadow-cobalt'
                  : 'bg-solid text-on-solid'
                : 'text-graphite hover:bg-bone-raised hover:text-ink',
            )}
          >
            <Icon
              className={cn(
                'size-3.5 shrink-0 transition-colors',
                active
                  ? studio
                    ? 'text-on-accent'
                    : 'text-on-solid'
                  : studio
                    ? 'text-cobalt/60 group-hover:text-cobalt'
                    : 'text-stone group-hover:text-ink',
              )}
              aria-hidden="true"
              strokeWidth={active ? 2 : 1.7}
            />
            <span>{itemLabel}</span>
          </Link>
        )
      })}
    </div>
  )
}

function MobileNavSection({ label, items, isActive, studio, onNavigate }: NavSectionProps & { onNavigate?: () => void }) {
  return (
    <div>
      {label && (
        <div className="mb-1 px-2 pt-1">
          <span className="text-label text-stone">{label}</span>
        </div>
      )}
      {items.map(({ href, label: itemLabel, icon: Icon, exact }) => {
        const active = isActive(href, exact)
        return (
          <Link
            key={href}
            href={href}
            prefetch={false}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-all duration-150',
              active
                ? studio
                  ? 'bg-cobalt text-on-accent'
                  : 'bg-solid text-on-solid'
                : 'text-graphite hover:bg-bone-raised hover:text-ink',
            )}
          >
            <Icon
              className={cn(
                'size-4 shrink-0 transition-colors',
                active
                  ? studio
                    ? 'text-on-accent'
                    : 'text-on-solid'
                  : studio
                    ? 'text-cobalt/60 group-hover:text-cobalt'
                    : 'text-stone group-hover:text-ink',
              )}
              aria-hidden="true"
              strokeWidth={active ? 2 : 1.7}
            />
            <span>{itemLabel}</span>
          </Link>
        )
      })}
    </div>
  )
}

export interface AppRailProps {
  repName: string
  organizationName: string
  role: RepRole
  calibrated: boolean
  demo: boolean
  todaySends: number
  dailyLimit: number
  revenueIdentities: Array<{
    id: string
    identityName: string
    title: string | null
    channel: string
  }>
}

export function AppRail({
  repName,
  organizationName,
  role,
  demo,
  todaySends,
  dailyLimit,
  revenueIdentities,
}: AppRailProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [sends, setSends] = useState(todaySends)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [activeIdentityId, setActiveIdentityId] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    const key = 'relay-active-identity'
    try {
      const saved = localStorage.getItem(key)
      if (saved && revenueIdentities.some((identity) => identity.id === saved)) {
        setActiveIdentityId(saved)
        return
      }
    } catch {
      // Ignore local storage failures.
    }

    if (revenueIdentities[0]) {
      setActiveIdentityId(revenueIdentities[0].id)
    }
  }, [revenueIdentities])

  const activeIdentity = revenueIdentities.find((identity) => identity.id === activeIdentityId) ?? revenueIdentities[0] ?? null

  useEffect(() => {
    let cancelled = false
    const fetchStatus = () => {
      fetch('/api/me/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d && typeof d.todaySends === 'number') {
            setSends(d.todaySends)
          }
        })
        .catch(() => {})
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 30_000)
    window.addEventListener('focus', fetchStatus)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('focus', fetchStatus)
    }
  }, [])

  const atCeiling = sends >= dailyLimit
  const isAdmin = role === 'admin'

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  async function signOut() {
    if (!demo) {
      const { getBrowserSupabase } = await import('@/lib/supabase/client')
      const supabase = getBrowserSupabase()
      await supabase.auth.signOut()
    }
    router.replace('/login')
    router.refresh()
  }

  const sendPct = Math.min(sends / dailyLimit, 1)
  const circumference = 2 * Math.PI * 11

  function selectIdentity(identityId: string) {
    setActiveIdentityId(identityId)
    setIdentityOpen(false)
    try {
      localStorage.setItem('relay-active-identity', identityId)
    } catch {
      // Ignore local storage failures.
    }
  }

  const sendCounter = (
    <div className="flex items-center gap-2" title={`${sends} of ${dailyLimit} sends used today`}>
      <div className="relative size-7">
        <svg className="size-7 -rotate-90" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="11" fill="none" stroke="var(--line)" strokeWidth="2" />
          <circle
            cx="14"
            cy="14"
            r="11"
            fill="none"
            stroke={atCeiling ? 'var(--status-warning)' : 'var(--orange)'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - sendPct)}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-mono-medium text-[7px] font-medium text-ink">
          {sends}
        </span>
      </div>
    </div>
  )

  const handleMobileNavigate = () => {
    setMobileMenuOpen(false)
  }

  const moreItems = MORE_NAV.filter((item) => {
    if (item.adminOnly && !isAdmin) return false
    if (item.roles && !item.roles.includes(role)) return false
    return true
  })
  const moreGroups: Array<{ group: string; items: typeof moreItems }> = []
  for (const item of moreItems) {
    const existing = moreGroups.find((g) => g.group === item.group)
    if (existing) existing.items.push(item)
    else moreGroups.push({ group: item.group, items: [item] })
  }

  const moreActive = moreItems.some((item) => isActive(item.href, item.exact))

  const identityPicker = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIdentityOpen((open) => !open)}
        aria-expanded={identityOpen}
        aria-label={`Working as ${activeIdentity ? `${activeIdentity.identityName}${activeIdentity.title ? `, ${activeIdentity.title}` : ''}` : 'no identity'}. Click to change.`}
        title={activeIdentity
          ? `${activeIdentity.identityName}${activeIdentity.title ? ` · ${activeIdentity.title}` : ''}${activeIdentity.channel ? ` · ${activeIdentity.channel.toUpperCase()}` : ''}`
          : 'No identity assigned'
        }
        className="group flex w-full items-center gap-2 rounded-md border border-line bg-bone-raised px-2 py-2 text-left hover:border-orange/30 focus-visible:outline-2 focus-visible:outline-orange/50"
      >
        <span className="mt-0.5 size-2 shrink-0 rounded-full bg-orange" role="presentation" />
        <div className="min-w-0 flex-1">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em]" style={{ color: 'color-mix(in srgb, var(--orange) 60%, var(--stone))' }}>Working as</p>
          {activeIdentity ? (
            <>
              <p className="truncate text-[13px] font-medium text-ink">{activeIdentity.identityName}</p>
              <p className="truncate text-[10px] text-graphite">
                {[activeIdentity.title, activeIdentity.channel.toUpperCase()].filter(Boolean).join(' / ')}
              </p>
            </>
          ) : (
            <p className="truncate text-[11px] text-graphite">No identity assigned</p>
          )}
        </div>
        <ChevronDown className={cn('size-3.5 shrink-0 text-stone transition-transform', identityOpen && 'rotate-180')} />
      </button>
      {activeIdentity && (
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
        >
          Working as {activeIdentity.identityName}{activeIdentity.title ? `, ${activeIdentity.title}` : ''}{activeIdentity.channel ? `, ${activeIdentity.channel}` : ''}
        </div>
      )}

      {identityOpen && (
        <div className="absolute right-0 bottom-[calc(100%+0.4rem)] z-20 w-full rounded-md border border-line bg-bone-raised p-1.5 shadow-lg">
          {revenueIdentities.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-graphite">
              {role === 'admin' ? 'No active identities yet.' : 'No assigned identities yet.'}
            </p>
          ) : (
            <div className="space-y-1">
              {revenueIdentities.map((identity) => {
                const selected = identity.id === activeIdentity?.id
                return (
                  <button
                    key={identity.id}
                    type="button"
                    onClick={() => selectIdentity(identity.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                      selected ? 'bg-solid text-on-solid' : 'hover:bg-bone',
                    )}
                  >
                    <span className={cn('size-1.5 shrink-0 rounded-full', selected ? 'bg-orange' : 'bg-stone/40')} />
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium">{identity.identityName}</p>
                      <p className={cn('truncate text-[10px]', selected ? 'text-on-solid/70' : 'text-graphite')}>
                        {[identity.title, identity.channel.toUpperCase()].filter(Boolean).join(' / ')}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {role === 'admin' && (
            <Link
              href="/admin/revenue-identities"
              onClick={() => setIdentityOpen(false)}
              className="mt-1.5 block rounded border border-line px-2 py-1 text-center text-[11px] font-medium text-ink hover:bg-bone"
            >
              Manage identities
            </Link>
          )}
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-bone/95 backdrop-blur-sm lg:hidden">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="rounded-md p-1.5 text-graphite transition-colors hover:bg-bone-raised hover:text-ink"
            >
              <Menu className="size-5" />
            </button>
            <RelayBrand />
          </div>
          <div className="flex items-center gap-1.5">
            {sendCounter}
            <NotificationCenter />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md p-1.5 text-graphite transition-colors hover:bg-bone-raised hover:text-ink"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        {activeIdentity && (
          <div className="flex items-center gap-2 border-t border-line/60 px-4 py-1.5">
            <span className="size-1.5 shrink-0 rounded-full bg-orange" />
            <p className="min-w-0 truncate text-[11px] font-medium text-ink">
              {activeIdentity.identityName}
              <span className="text-graphite">
                {[activeIdentity.title, activeIdentity.channel?.toUpperCase()].filter(Boolean).join(' / ')}
              </span>
            </p>
          </div>
        )}
      </header>

      {/* Mobile navigation drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30 fade-in"
            style={{ backdropFilter: "blur(4px)" }}
            aria-hidden="true"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-bone-raised shadow-xl slide-in-right">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <RelayBrand />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1 text-graphite transition-colors hover:bg-bone hover:text-ink"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Mobile">
              <MobileNavSection items={PRIMARY_NAV} isActive={isActive} onNavigate={handleMobileNavigate} />
              <div className="mt-3">
                <MobileNavSection items={STUDIO_NAV} isActive={isActive} studio onNavigate={handleMobileNavigate} />
              </div>
              {isAdmin && (
                <div className="mt-3">
                  <MobileNavSection items={TEAM_NAV} isActive={isActive} onNavigate={handleMobileNavigate} />
                </div>
              )}
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1 px-2">
                  <span className="text-label text-stone">More</span>
                </div>
                {moreGroups.map((g) => (
                  <div key={g.group}>
                    <div className="mb-0.5 px-2 pt-1">
                      <span className="text-[10px] uppercase tracking-wide text-stone">{g.group}</span>
                    </div>
                    <MobileNavSection items={g.items} isActive={isActive} onNavigate={handleMobileNavigate} />
                  </div>
                ))}
              </div>
            </nav>
            <div className="border-t border-line px-3 py-3 space-y-2">
              {identityPicker}
              <div className="flex items-center justify-between gap-2 px-1">
                <IdentityChip name={repName} subtitle={`${ROLE_LABEL[role]} · ${organizationName}`} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:flex-col lg:border-r lg:border-line">
        <div className="space-y-1 px-4 py-4">
          <div className="flex items-center justify-between">
            <RelayBrand />
            <kbd className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-mono-medium text-[9px] text-stone">
              <Command className="size-2.5" />K
            </kbd>
          </div>
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-stone">Relay / Capture</p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
          <NavSection items={PRIMARY_NAV} isActive={isActive} />
          <div className="mt-3">
            <NavSection items={STUDIO_NAV} isActive={isActive} studio />
          </div>
          {isAdmin && (
            <div className="mt-3">
              <NavSection items={TEAM_NAV} isActive={isActive} />
            </div>
          )}
          <div className="mt-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                moreActive ? 'text-ink' : 'text-stone hover:text-ink',
              )}
            >
              <span>More</span>
              <ChevronDown className={cn('size-3 transition-transform', moreOpen && 'rotate-180')} />
            </button>
            {moreOpen && (
              <div className="mt-1 space-y-2">
                {moreGroups.map((g) => (
                  <div key={g.group}>
                    <div className="px-2 pt-1">
                      <span className="text-[10px] uppercase tracking-wide text-stone">{g.group}</span>
                    </div>
                    <NavSection items={g.items} isActive={isActive} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="border-t border-line px-3 py-3 space-y-2">
          {identityPicker}

          <div className="flex items-center justify-between gap-2 px-1">
            <IdentityChip name={repName} subtitle={`${ROLE_LABEL[role]} · ${organizationName}`} />
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md p-1.5 text-graphite transition-colors hover:bg-bone-raised hover:text-ink"
              title="Sign out"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            {sendCounter}
            <ThemeToggle className="rounded-md p-1 text-graphite transition-colors hover:bg-bone-raised hover:text-ink" />
            <span className="text-mono-medium text-[9px] text-stone/50">v{APP_VERSION}</span>
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bone/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Primary"
      >
        <div className="flex items-stretch">
          {[
            { href: '/dashboard', label: 'Today', icon: CalendarDays, exact: true },
            { href: '/leads', label: 'Leads', icon: Target, exact: false },
            { href: '/content', label: 'Studio', icon: PenLine, exact: false, studio: true },
            { href: '/account', label: 'Account', icon: Settings, exact: false },
          ].map(({ href, label, icon: Icon, exact, studio }) => {
            const active = isActive(href, exact)
            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
                  active ? 'text-ink' : 'text-graphite hover:text-ink',
                )}
              >
                {active && (
                  <span className={cn('absolute top-0 left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full', studio ? 'bg-cobalt' : 'bg-ink')} />
                )}
                <Icon
                  className={cn('size-[18px] transition-all', active ? (studio ? 'text-cobalt' : 'text-ink') : '')}
                  aria-hidden="true"
                  strokeWidth={active ? 2 : 1.7}
                />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
