'use client'

import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { cn } from 'cn'

const PARENTS: Array<{ test: (path: string) => boolean; href: string; label: string }> = [
  { test: (path) => path.startsWith('/upwork/') && path !== '/upwork', href: '/upwork', label: 'Jobs' },
  { test: (path) => path.startsWith('/leads/') && path !== '/leads', href: '/leads', label: 'Leads' },
  { test: (path) => path.startsWith('/content-v2/'), href: '/content', label: 'Studio' },
  { test: (path) => path.startsWith('/content/') && path !== '/content', href: '/content', label: 'Studio' },
  { test: (path) => path.startsWith('/admin/'), href: '/dashboard', label: 'Today' },
  { test: (path) => path.startsWith('/settings/'), href: '/settings', label: 'Settings' },
  { test: (path) => path.startsWith('/team/'), href: '/team', label: 'My Team' },
  { test: (path) => path.startsWith('/profile-intelligence/'), href: '/profile-intelligence', label: 'Profiles' },
]

function parentFor(pathname: string): { href: string; label: string } | null {
  return PARENTS.find((item) => item.test(pathname)) ?? null
}

export function AppBackButton({ className }: { className?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const parent = parentFor(pathname)

  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push(parent?.href ?? '/dashboard')
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className={cn('inline-flex items-center gap-0.5 text-[13px] font-medium text-ink hover:text-orange', className)}
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Back
    </button>
  )
}
