"use client"

import { useEffect } from "react"
import { ToastProvider } from "@/components/ui/toast"
import { CommandPaletteProvider } from "@/components/command-palette-provider"
import { ThemeProvider } from "@/components/theme-provider"

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return

    const isProduction = process.env.NODE_ENV === "production"

    const syncServiceWorker = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations()

        await Promise.all(
          registrations.map(async (registration) => {
            await registration.unregister().catch(() => undefined)
          }),
        )

        if ("caches" in window) {
          const keys = await caches.keys()
          await Promise.all(keys.filter((key) => key.startsWith("relay-")).map((key) => caches.delete(key)))
        }

        if (!isProduction) {
          return
        }

        await navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined)
      } catch {
        // Ignore SW setup failures.
      }
    }

    void syncServiceWorker()
  }, [])

  return (
    <ThemeProvider>
      <ToastProvider>
        <CommandPaletteProvider>
          {children}
        </CommandPaletteProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
