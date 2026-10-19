import Link from 'next/link'
import { cn } from 'cn'

/* ═══════════════════════════════════════════════════════════
   Dashboard kit — the one set of surfaces every rep and admin
   page uses, so headers, panels and stat tiles line up.
   Server-safe: no hooks, no client-only APIs.
   ═══════════════════════════════════════════════════════════ */

export function DashHeader({ eyebrow, title, subtitle, actions, className }: {
  eyebrow?: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-mono-medium text-[10px] uppercase tracking-[0.16em] text-stone">{eyebrow}</p>}
        <h1 className="mt-1 text-display text-[26px] font-light leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13px] text-graphite">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Panel({ title, subtitle, action, children, className, bodyClassName, flush, id }: {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  /** Body has no padding — for tables and row lists that run edge to edge. */
  flush?: boolean
  id?: string
}) {
  return (
    <section
      id={id}
      data-panel
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn('flex min-w-0 flex-col rounded-xl border border-line bg-bone-raised', className)}
    >
      {(title || action) && (
        <header className={cn('flex items-start justify-between gap-3 px-4 pt-4 sm:px-5', flush ? 'pb-3 border-b border-line' : 'pb-0')}>
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-medium text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11px] text-stone">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1', flush ? '' : 'p-4 sm:p-5', !flush && (title || action) && 'pt-3 sm:pt-4', bodyClassName)}>
        {children}
      </div>
    </section>
  )
}

export type Tone = 'neutral' | 'orange' | 'cobalt' | 'success' | 'warning' | 'danger'

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink',
  orange: 'text-orange',
  cobalt: 'text-cobalt',
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
}

const TONE_ICON: Record<Tone, string> = {
  neutral: 'bg-bone text-stone',
  orange: 'bg-orange/10 text-orange',
  cobalt: 'bg-cobalt/10 text-cobalt',
  success: 'bg-status-success/10 text-status-success',
  warning: 'bg-status-warning/10 text-status-warning',
  danger: 'bg-status-danger/10 text-status-danger',
}

export function StatTile({ label, value, sub, tone = 'neutral', icon, href, className }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: Tone
  icon?: React.ReactNode
  href?: string
  className?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-mono-medium truncate text-[10px] uppercase tracking-[0.12em] text-stone">{label}</p>
        {icon && <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', TONE_ICON[tone])}>{icon}</span>}
      </div>
      <p className={cn('mt-2 text-[24px] font-light leading-none tracking-[-0.02em] tabular-nums', tone === 'neutral' ? 'text-ink' : TONE_TEXT[tone])}>{value}</p>
      {sub && <p className="mt-1.5 truncate text-[11px] text-graphite">{sub}</p>}
    </>
  )
  const cls = cn('block min-w-0 rounded-xl border border-line bg-bone-raised px-4 py-3.5', href && 'transition-colors hover:border-ink/20', className)
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}

export function Meter({ value, max, tone, className }: { value: number; max: number; tone?: Tone; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const auto: Tone = pct >= 100 ? 'success' : pct >= 60 ? 'cobalt' : pct > 0 ? 'orange' : 'neutral'
  const t = tone ?? auto
  const fill = t === 'success' ? 'bg-status-success' : t === 'cobalt' ? 'bg-cobalt' : t === 'orange' ? 'bg-orange' : t === 'warning' ? 'bg-status-warning' : t === 'danger' ? 'bg-status-danger' : 'bg-stone-light'
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line/60', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', fill)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Initials({ name, tone = 'neutral', size = 'md' }: { name: string; tone?: Tone; size?: 'sm' | 'md' }) {
  const letters = name.split(/\s+/).filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
      size === 'sm' ? 'size-6 text-[9px]' : 'size-8 text-[11px]',
      TONE_ICON[tone],
    )} aria-hidden="true">
      {letters}
    </span>
  )
}

export function Pill({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium', TONE_ICON[tone], tone === 'neutral' && 'text-graphite', className)}>
      {children}
    </span>
  )
}

export function EmptyNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('flex min-h-[96px] items-center justify-center px-4 text-center text-[12px] text-stone', className)}>{children}</p>
}

/** Segmented links for ?range= style filters. */
export function Segmented({ options, value, hrefFor, label }: {
  options: Array<{ value: string; label: string }>
  value: string
  hrefFor: (value: string) => string
  label: string
}) {
  return (
    <nav aria-label={label} className="inline-flex rounded-lg border border-line bg-bone p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={hrefFor(o.value)}
          scroll={false}
          aria-current={o.value === value ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
            o.value === value ? 'bg-bone-raised text-ink shadow-sm' : 'text-stone hover:text-ink',
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  )
}
