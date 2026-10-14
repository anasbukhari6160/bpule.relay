'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { cn } from 'cn'

const NAV_ITEMS = [
  { href: '/#product', label: 'Product' },
  { href: '/#priority', label: 'Intelligence' },
  { href: '/#conversation', label: 'Conversations' },
  { href: '/pricing', label: 'Pricing' },
]

/** Signal color shifts orange → cobalt inside the Studio chapter. */
const SECTION_TONE: Record<string, 'orange' | 'cobalt'> = {
  hero: 'orange',
  product: 'orange',
  priority: 'orange',
  moves: 'orange',
  conversation: 'orange',
  'studio-relay': 'cobalt',
  close: 'orange',
}

/**
 * LandingNav — dark, minimal, signal-aware.
 * Transparent over the hero; ink scrim once scrolled.
 */
export function LandingNav() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [tone, setTone] = useState<'orange' | 'cobalt'>('orange')
  const onHome = pathname === '/'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  useEffect(() => {
    if (!onHome) return
    const sections = Object.keys(SECTION_TONE)
      .map((id) => document.querySelector(`[data-section="${id}"]`))
      .filter((el): el is Element => Boolean(el))
    if (!sections.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const id = top?.target.getAttribute('data-section')
        if (id && SECTION_TONE[id]) setTone(SECTION_TONE[id])
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.1, 0.25, 0.5] },
    )
    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [onHome])

  const signalColor = tone === 'orange' ? 'var(--orange-signal)' : 'var(--cobalt-signal)'

  return (
    <header className={cn('lg3-nav', scrolled && 'lg3-nav--scrolled')}>
      <div className="lg3-nav__inner">
        <Link href="/" className="lg3-nav__logo" aria-label="Relay home">
          <span className="lg3-nav__mark" aria-hidden="true">
            <span className="lg3-nav__dot" style={{ background: signalColor }} />
          </span>
          <span className="lg3-nav__wordmark">RELAY</span>
        </Link>

        <nav className="lg3-nav__links" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="lg3-nav__link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="lg3-nav__right">
          <Link href="/login" className="lg3-nav__signin">
            Sign in
          </Link>
          <Link href="/signup" className="lg3-nav__cta" data-landing-cta="nav">
            Start with Relay
          </Link>
        </div>

        <button
          type="button"
          className="lg3-nav__toggle"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg3-nav__mobile">
          <nav aria-label="Mobile">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="lg3-nav__mobile-link"
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <hr className="lg3-nav__mobile-divider" />
            <Link href="/login" className="lg3-nav__mobile-link" onClick={() => setMobileOpen(false)}>
              Sign in
            </Link>
            <Link href="/signup" className="lg3-nav__mobile-cta" onClick={() => setMobileOpen(false)}>
              Start with Relay
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
