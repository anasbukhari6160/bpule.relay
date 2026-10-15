'use client'

import { ReactNode } from 'react'
import { cn } from 'cn'

/* ═══════════════════════════════════════════════════════════
   Admin Design System — shared primitives for all admin pages
   ═══════════════════════════════════════════════════════════ */

interface AdminCardProps {
  children: ReactNode
  className?: string
  variant?: 'console' | 'sheet' | 'dossier' | 'proof'
}

export function AdminCard({ children, className, variant = 'console' }: AdminCardProps) {
  const base = {
    console: 'srf-console srf-console-edge overflow-hidden',
    sheet: 'srf-sheet overflow-hidden',
    dossier: 'srf-dossier overflow-hidden',
    proof: 'srf-proof overflow-hidden',
  }[variant]
  return <div className={cn(base, className)}>{children}</div>
}

interface MetricCardProps {
  label: string
  value: string | number
  subtext?: string
  trend?: 'up' | 'down' | 'neutral'
  accent?: 'orange' | 'cobalt' | 'success' | 'danger' | 'neutral'
}

export function MetricCard({ label, value, subtext, trend, accent = 'neutral' }: MetricCardProps) {
  const accentColors = {
    orange: 'border-orange/20 bg-orange/5',
    cobalt: 'border-cobalt/20 bg-cobalt/5',
    success: 'border-status-success/20 bg-status-success/5',
    danger: 'border-status-danger/20 bg-status-danger/5',
    neutral: 'border-line',
  }
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : ''
  const trendColor = trend === 'up' ? 'text-status-success' : trend === 'down' ? 'text-status-danger' : ''

  return (
    <div className={cn('rounded border px-4 py-3', accentColors[accent])}>
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-stone">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[22px] font-medium text-ink">{typeof value === 'number' ? value.toLocaleString() : value}</span>
        {trendIcon && <span className={cn('text-[11px] font-medium', trendColor)}>{trendIcon}</span>}
      </div>
      {subtext && <p className="mt-0.5 text-[11px] text-graphite">{subtext}</p>}
    </div>
  )
}

interface SectionHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange">{title}</p>
        {subtitle && <p className="mt-0.5 text-[12px] text-graphite">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Eyebrow({ children, color = 'orange' }: { children: ReactNode; color?: 'orange' | 'cobalt' | 'stone' }) {
  const colors = { orange: 'text-orange', cobalt: 'text-cobalt', stone: 'text-stone' }
  return (
    <span className={cn('text-mono-medium text-[10px] uppercase tracking-[0.14em]', colors[color])}>
      {children}
    </span>
  )
}

export function ProgressBar({ value, max, color = 'bg-status-success' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-line/40 overflow-hidden">
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function StatusDot({ status }: { status: 'active' | 'warning' | 'danger' | 'neutral' }) {
  const colors = {
    active: 'bg-status-success',
    warning: 'bg-status-warning',
    danger: 'bg-status-danger',
    neutral: 'bg-stone',
  }
  return <span className={cn('size-2 rounded-full', colors[status])} />
}

export function AdminPageHeader({ title, subtitle, eyebrow }: { title: string; subtitle?: string; eyebrow?: string }) {
  return (
    <header className="space-y-2">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className="text-display text-[28px] font-light tracking-[-0.02em] text-ink sm:text-[32px]">{title}</h1>
      {subtitle && <p className="text-[13px] text-graphite">{subtitle}</p>}
    </header>
  )
}
