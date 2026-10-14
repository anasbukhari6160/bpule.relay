'use client'

import { cn } from 'cn'

interface PageShellProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
  maxWidth?: 'default' | 'narrow' | 'wide' | 'full'
  className?: string
  contentClassName?: string
}

const MAX_WIDTHS: Record<NonNullable<PageShellProps['maxWidth']>, string> = {
  narrow: 'max-w-2xl',
  default: 'max-w-4xl',
  wide: 'max-w-6xl',
  full: 'max-w-full',
}

export function PageShell({ children, title, subtitle, maxWidth = 'default', className, contentClassName }: PageShellProps) {
  return (
    <div className={cn('mx-auto w-full space-y-6 pb-8', MAX_WIDTHS[maxWidth], className)}>
      {(title || subtitle) && (
        <div className="space-y-1">
          {title && <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{title}</h1>}
          {subtitle && <p className="text-[13px] text-graphite">{subtitle}</p>}
        </div>
      )}
      <div className={cn('space-y-4', contentClassName)}>{children}</div>
    </div>
  )
}

interface ConsoleCardProps {
  children: React.ReactNode
  edge?: boolean
  className?: string
}

export function ConsoleCard({ children, edge, className }: ConsoleCardProps) {
  return (
    <div className={cn('srf-console p-5', edge && 'srf-console-edge', className)}>
      {children}
    </div>
  )
}

interface DossierCardProps {
  children: React.ReactNode
  className?: string
}

export function DossierCard({ children, className }: DossierCardProps) {
  return (
    <div className={cn('srf-dossier p-4 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[8px_8px_0_var(--bone-200)]', className)}>
      {children}
    </div>
  )
}

interface ProofChipProps {
  children: React.ReactNode
  tone?: 'default' | 'cobalt'
  className?: string
}

export function ProofChip({ children, tone = 'default', className }: ProofChipProps) {
  return (
    <div className={cn(
      tone === 'cobalt' ? 'srf-proof-cobalt' : 'srf-proof',
      'px-3 py-2',
      className
    )}>
      {children}
    </div>
  )
}
