'use client'

import { useSyncExternalStore } from 'react'
import { ArrowRight } from 'lucide-react'
import { StudioMark } from '@/components/studio-brand'

const SESSION_KEY = 'studio-intro-seen'

const listeners = new Set<() => void>()

function readSeen(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getServerSnapshot(): boolean {
  return true
}

function markSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch { /* no-op */ }
  listeners.forEach((l) => l())
}

export function StudioIntro({ children }: { children: React.ReactNode }) {
  const seen = useSyncExternalStore(subscribe, readSeen, getServerSnapshot)

  if (seen) {
    return (
      <div className="-m-5 bg-cobalt-wash p-5 lg:-m-8 lg:p-8">
        {children}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-console px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 30% 20%, color-mix(in srgb, var(--cobalt) 20%, transparent) 0%, transparent 55%), radial-gradient(ellipse at 70% 80%, color-mix(in srgb, var(--cobalt-light) 12%, transparent) 0%, transparent 45%)',
        }}
      />

      <div className="reveal-up relative z-10 flex max-w-md flex-col items-center text-center">
        <div className="mb-6 flex size-14 items-center justify-center rounded-xl bg-cobalt shadow-cobalt">
          <StudioMark className="size-8 bg-transparent" />
        </div>

        <p className="text-label text-cobalt-light">Part of Relay</p>
        <h1 className="text-display mt-3 text-4xl text-bone sm:text-5xl">Studio</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-bone/80">
          A quieter room for your writing. Answer a few real questions,
          get one real post, decide what stays.
        </p>

        <button
          onClick={markSeen}
          className="group mt-8 inline-flex items-center gap-2 rounded-md bg-cobalt px-5 py-2.5 text-sm font-medium text-on-accent transition-all hover:bg-cobalt-dark active:scale-[0.97]"
        >
          Continue
          <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
