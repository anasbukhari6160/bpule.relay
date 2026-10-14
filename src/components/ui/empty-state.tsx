import * as React from "react"
import { cn } from "cn"

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  size?: 'default' | 'compact'
}

export function EmptyState({ icon: Icon, title, description, action, className, size = 'default' }: EmptyStateProps) {
  const isCompact = size === 'compact'
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        isCompact ? "srf-dossier p-6" : "srf-dossier p-10",
        className
      )}
    >
      {Icon && (
        <div className={cn(
          "flex items-center justify-center rounded-full",
          isCompact ? "size-9 bg-orange/[0.08]" : "size-12 bg-orange/10"
        )}>
          <Icon className={cn(isCompact ? "size-4" : "size-5", "text-orange")} />
        </div>
      )}
      <p className={cn("font-medium text-ink", isCompact ? "text-[13px]" : "text-sm")}>{title}</p>
      {description && (
        <p className={cn("max-w-xs text-graphite", isCompact ? "text-[11px]" : "text-[13px]")}>{description}</p>
      )}
      {action && <div className={cn(isCompact ? "mt-1" : "mt-2")}>{action}</div>}
    </div>
  )
}

interface OnboardingGuideProps {
  steps: Array<{ label: string; href: string; done: boolean }>
  className?: string
}

export function OnboardingGuide({ steps, className }: OnboardingGuideProps) {
  const completed = steps.filter(s => s.done).length
  const pct = Math.round((completed / steps.length) * 100)
  return (
    <div className={cn("srf-console p-5 space-y-4", className)}>
      <div className="flex items-center justify-between">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Setup Progress</p>
        <span className="text-[11px] font-medium text-orange">{completed}/{steps.length}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/40">
        <div className="h-full rounded-full bg-orange transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-2">
        {steps.map((step) => (
          <a key={step.label} href={step.href} className="flex items-center gap-2.5 group">
            <span className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium transition-colors",
              step.done ? "bg-status-success/15 text-status-success" : "bg-line text-stone group-hover:bg-orange/10 group-hover:text-orange"
            )}>
              {step.done ? "✓" : "○"}
            </span>
            <span className={cn("text-[13px] transition-colors", step.done ? "text-graphite line-through" : "text-ink group-hover:text-orange")}>{step.label}</span>
          </a>
        ))}
      </div>
    </div>
  )
}
