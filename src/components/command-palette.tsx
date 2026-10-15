'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Search,
  Plus,
  Target,
  Briefcase,
  MessageSquare,
  Shuffle,
  PenLine,
  Sparkles,
  Users,
  Settings,
  Command,
  ArrowRight,
  Shield,
  BarChart3,
  UserCircle2,
  TrendingUp,
  Layers,
} from 'lucide-react'
import { cn } from 'cn'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  shortcut?: string
  action: () => void
  group: string
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return { open, setOpen }
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const commands: CommandItem[] = useMemo(() => [
    {
      id: 'check-prospect',
      label: 'Check a prospect',
      description: 'Run a fit check instantly',
      icon: Search,
      shortcut: '',
      group: 'Relay',
      action: () => { router.push('/prospect'); onOpenChange(false) },
    },
    {
      id: 'find-leads',
      label: 'Find leads',
      description: 'Open and filter lead pipeline',
      icon: Target,
      group: 'Relay',
      action: () => { router.push('/leads'); onOpenChange(false) },
    },
    {
      id: 'find-jobs',
      label: 'Find jobs',
      description: 'Open Upwork opportunities',
      icon: Briefcase,
      group: 'Relay',
      action: () => { router.push('/upwork'); onOpenChange(false) },
    },
    {
      id: 'open-conversations',
      label: 'Open conversations',
      description: 'Jump to active queue conversations',
      icon: MessageSquare,
      group: 'Relay',
      action: () => { router.push('/relay'); onOpenChange(false) },
    },
    {
      id: 'search-lead',
      label: 'Search lead',
      description: 'Search lead and proof archive',
      icon: Search,
      group: 'Relay',
      action: () => { router.push('/archive'); onOpenChange(false) },
    },
    {
      id: 'add-upwork',
      label: 'Add Upwork job',
      description: 'Paste a new job posting',
      icon: Briefcase,
      group: 'Relay',
      action: () => { router.push('/upwork/new'); onOpenChange(false) },
    },
    {
      id: 'view-replies',
      label: 'View replies',
      description: 'Leads with client replies waiting',
      icon: MessageSquare,
      group: 'Relay',
      action: () => { router.push('/leads?filter=reply'); onOpenChange(false) },
    },
    {
      id: 'view-followups',
      label: 'View follow-ups',
      description: 'Overdue follow-ups',
      icon: MessageSquare,
      group: 'Relay',
      action: () => { router.push('/leads?filter=followup'); onOpenChange(false) },
    },
    {
      id: 'view-referred',
      label: 'View referred leads',
      description: 'Leads referred to you',
      icon: Shuffle,
      group: 'Relay',
      action: () => { router.push('/leads?filter=referred'); onOpenChange(false) },
    },
    {
      id: 'switch-identity',
      label: 'Switch Revenue Identity',
      description: 'Choose an authorized identity',
      icon: Shuffle,
      group: 'Relay',
      action: () => { router.push('/rep/assigned-profiles'); onOpenChange(false) },
    },
    {
      id: 'quick-capture',
      label: 'Quick Capture',
      description: 'Turn a raw thought into angles',
      icon: PenLine,
      group: 'Studio',
      action: () => { router.push('/content'); onOpenChange(false) },
    },
    {
      id: 'studio-idea',
      label: 'Create Studio idea',
      description: 'Open today\'s editorial directions',
      icon: Sparkles,
      group: 'Studio',
      action: () => { router.push('/content'); onOpenChange(false) },
    },
    {
      id: 'search-profile',
      label: 'Search profile',
      description: 'Open profile intelligence',
      icon: Users,
      group: 'Studio',
      action: () => { router.push('/profiles'); onOpenChange(false) },
    },
    {
      id: 'today',
      label: 'Today',
      description: 'Go to your daily decision engine',
      icon: Command,
      group: 'Navigation',
      action: () => { router.push('/dashboard'); onOpenChange(false) },
    },
    {
      id: 'new-lead',
      label: 'New lead',
      description: 'Add a company to your pipeline',
      icon: Plus,
      group: 'Navigation',
      action: () => { router.push('/leads/new'); onOpenChange(false) },
    },
    {
      id: 'studio',
      label: 'Studio',
      description: 'Go to create demand workspace',
      icon: PenLine,
      group: 'Navigation',
      action: () => { router.push('/content'); onOpenChange(false) },
    },
    {
      id: 'team',
      label: 'Team',
      description: 'Team performance',
      icon: Users,
      group: 'Navigation',
      action: () => { router.push('/team'); onOpenChange(false) },
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Account and preferences',
      icon: Settings,
      group: 'Navigation',
      action: () => { router.push('/account'); onOpenChange(false) },
    },
    {
      id: 'inbound',
      label: 'Inbound',
      description: 'Messages from clients',
      icon: MessageSquare,
      group: 'Relay',
      action: () => { router.push('/inbound'); onOpenChange(false) },
    },
    {
      id: 'proof',
      label: 'Proof',
      description: 'Proof items and facts',
      icon: Shield,
      group: 'Studio',
      action: () => { router.push('/facts'); onOpenChange(false) },
    },
    {
      id: 'growth',
      label: 'Relay Growth',
      description: 'Growth engine',
      icon: TrendingUp,
      group: 'Studio',
      action: () => { router.push('/content-v2/growth'); onOpenChange(false) },
    },
    {
      id: 'usage',
      label: 'Usage',
      description: 'AI usage and limits',
      icon: Layers,
      group: 'Navigation',
      action: () => { router.push('/usage'); onOpenChange(false) },
    },
    {
      id: 'command-center',
      label: 'Command Center',
      description: 'Admin ops dashboard',
      icon: Shield,
      group: 'Admin',
      action: () => { router.push('/admin/command-center'); onOpenChange(false) },
    },
    {
      id: 'people',
      label: 'People',
      description: 'Org hierarchy',
      icon: Users,
      group: 'Admin',
      action: () => { router.push('/admin/people'); onOpenChange(false) },
    },
    {
      id: 'revenue',
      label: 'Revenue Intelligence',
      description: 'Revenue analytics',
      icon: BarChart3,
      group: 'Admin',
      action: () => { router.push('/admin/revenue-intelligence'); onOpenChange(false) },
    },
    {
      id: 'identities',
      label: 'Revenue Identities',
      description: 'Manage identities',
      icon: UserCircle2,
      group: 'Admin',
      action: () => { router.push('/admin/revenue-identities'); onOpenChange(false) },
    },
    {
      id: 'targets',
      label: 'Targets',
      description: 'Daily targets',
      icon: Target,
      group: 'Admin',
      action: () => { router.push('/admin/targets'); onOpenChange(false) },
    },
  ], [router, onOpenChange])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q),
    )
  }, [commands, query])

  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {}
    for (const item of filtered) {
      if (!groups[item.group]) groups[item.group] = []
      groups[item.group].push(item)
    }
    return groups
  }, [filtered])

  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    setSelectedIndex(0)
  }

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setQuery('')
      setSelectedIndex(0)
    }
  }

  const execute = useCallback((item: CommandItem) => {
    item.action()
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) {
        execute(filtered[selectedIndex])
      }
    }
  }

  let flatIndex = -1

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]">
      <div
        className="absolute inset-0 bg-ink/20 fade-in"
        style={{ backdropFilter: 'blur(4px)' }}
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
      />
      <div
        className="relative w-full max-w-lg rounded-xl border border-line bg-bone-raised shadow-xl scale-in overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Command className="size-4 shrink-0 text-stone" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-[14px] text-ink placeholder:text-stone outline-none"
            autoFocus
            aria-label="Command search"
          />
          <kbd className="rounded bg-bone px-1.5 py-0.5 text-mono-medium text-[10px] text-stone">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-[13px] text-stone">No results</p>
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-2">
                <p className="px-2 py-1 text-label text-stone">{group}</p>
                {items.map((item) => {
                  flatIndex++
                  const isSelected = flatIndex === selectedIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => execute(item)}
                      onMouseEnter={() => setSelectedIndex(flatIndex)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                        isSelected ? 'bg-bone' : 'hover:bg-bone',
                      )}
                    >
                      <item.icon className="size-4 shrink-0 text-stone" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-ink">{item.label}</p>
                        {item.description && (
                          <p className="truncate text-[11px] text-graphite">{item.description}</p>
                        )}
                      </div>
                      {isSelected && (
                        <ArrowRight className="size-3 shrink-0 text-stone" aria-hidden="true" />
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-line px-4 py-2">
          <span className="text-mono-medium text-[10px] text-stone">
            <kbd className="rounded bg-bone px-1 py-0.5">↑↓</kbd> navigate
          </span>
          <span className="text-mono-medium text-[10px] text-stone">
            <kbd className="rounded bg-bone px-1 py-0.5">↵</kbd> select
          </span>
          <span className="text-mono-medium text-[10px] text-stone">
            <kbd className="rounded bg-bone px-1 py-0.5">esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
