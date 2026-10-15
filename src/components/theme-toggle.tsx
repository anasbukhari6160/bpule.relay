"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "./theme-provider"

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={className ?? "relative flex h-8 w-8 items-center justify-center rounded-lg border border-line transition-colors hover:bg-bone-raised"}
    >
      {theme === "dark" ? (
        <Sun className="h-3.5 w-3.5 text-ink/60" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-ink/60" />
      )}
    </button>
  )
}
