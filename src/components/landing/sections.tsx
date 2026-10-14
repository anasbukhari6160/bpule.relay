'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { cn } from 'cn'
import { motion } from 'motion/react'
import { SignalField, type FieldPhase } from './signal-field'
import { DoThisNext } from './do-this-next'
import {
  CONTEXT_SIGNALS,
  TODAY_QUEUE,
  TODAY_CONVERSATIONS,
  PRIORITY_SIGNALS,
  CONVERSATION_STEPS,
  REFINEMENT_CHIPS,
} from './data'
import { useInViewOnce, useReducedMotion } from './hooks'

/* ═══════════════════════════════════════════════════════════
   Shared section shell
   ═══════════════════════════════════════════════════════════ */
function SectionShell({
  id,
  index,
  label,
  title,
  lede,
  children,
  wide = false,
}: {
  id: string
  index: string
  label: string
  title: React.ReactNode
  lede?: string
  children: React.ReactNode
  wide?: boolean
}) {
  const [ref, inView] = useInViewOnce<HTMLElement>(0.2)

  return (
    <section ref={ref} id={id} className={cn('lg3-section', wide && 'lg3-section--wide')} data-section={id}>
      <div className="lg3-section__inner">
        <motion.header
          className="lg3-section__head"
          initial={false}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="lg3-section__meta">
            <span className="lg3-section__index">{index}</span>
            {label}
          </p>
          <h2 className="lg3-section__title">{title}</h2>
          {lede && <p className="lg3-section__lede">{lede}</p>}
        </motion.header>
        {children}
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════
   02 · Context — "Context before action."
   The signal ledger on the left, the real Today surface on the
   right. Hovering a signal lights up where it lands in the product.
   ═══════════════════════════════════════════════════════════ */
export function ContextSection() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.2)
  const [active, setActive] = useState<string | null>(null)

  const isLinked = (rowId: string) => active !== null && CONTEXT_SIGNALS.some((s) => s.id === active && s.linksTo.includes(rowId))

  return (
    <SectionShell
      id="product"
      index="02"
      label="Context"
      title={<>Context before action.</>}
      lede="Every signal Relay reads — replies, prospects, jobs, team activity — lands in one place, already understood."
    >
      <div ref={ref} className="lg3-context">
        {/* Signal ledger */}
        <motion.ul
          className="lg3-ledger"
          initial={false}
          animate={inView ? 'show' : 'hidden'}
          variants={{ show: { transition: { staggerChildren: 0.06 } }, hidden: {} }}
          aria-label="Signals Relay is reading"
        >
          {CONTEXT_SIGNALS.map((signal) => (
            <motion.li
              key={signal.id}
              className={cn(
                'lg3-ledger__row',
                active === signal.id && 'lg3-ledger__row--active',
              )}
              variants={{
                hidden: { opacity: 0, x: -10 },
                show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
              }}
              onMouseEnter={() => setActive(signal.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(signal.id)}
              onBlur={() => setActive(null)}
              data-signal={signal.id}
            >
              <span className={cn('lg3-ledger__dot', signal.tone === 'orange' && 'lg3-ledger__dot--orange', signal.tone === 'cobalt' && 'lg3-ledger__dot--cobalt')} />
              <span className="lg3-ledger__label">{signal.label}</span>
              <span className="lg3-ledger__source">{signal.source}</span>
              <span className="lg3-ledger__time">{signal.time}</span>
            </motion.li>
          ))}
        </motion.ul>

        {/* Today console — reconstructed product surface */}
        <motion.div
          className="lg3-console"
          initial={false}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          data-console="today"
        >
          <div className="lg3-console__header">
            <div className="flex items-center gap-2">
              <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Your Relay</p>
              <span className="size-1 rounded-full bg-line" />
              <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Today</p>
            </div>
            <span className="text-mono-medium text-[10px] text-stone">{new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </div>
          <div className="lg3-console__progress">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-line/60">
              <div className="h-full rounded-full bg-orange" style={{ width: '40%' }} />
            </div>
            <span className="shrink-0 text-mono-medium text-[10px] text-stone">2/5</span>
          </div>

          {/* Do This Next — compact */}
          <div className={cn('lg3-console__dtn', isLinked('action-sarah') && 'is-linked')}>
            <div className="flex items-center gap-2">
              <span className="rounded-sm bg-orange px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-on-accent">Reply</span>
              <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Do This Next</p>
            </div>
            <p className="mt-2 text-[15px] font-medium text-ink">Reply to Sarah</p>
            <p className="mt-0.5 text-[12px] text-graphite">She asked for proof · draft ready</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-orange px-2.5 py-1.5 text-[11px] font-medium text-on-accent">
                Review reply
                <ArrowRight className="size-3" />
              </span>
              <span className="rounded-md border border-line px-2 py-1.5 text-[10px] text-graphite">Snooze</span>
            </div>
          </div>

          {/* Action queue */}
          <div className="lg3-console__block">
            <div className="flex items-center justify-between">
              <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Action queue</p>
              <span className="text-[10px] text-graphite">6 active</span>
            </div>
            <div className="mt-2 overflow-hidden rounded-lg border border-line">
              {TODAY_QUEUE.map((row, i) => (
                <div
                  key={row.id}
                  className={cn(
                    'lg3-qrow',
                    isLinked(row.id) && 'is-linked',
                    i === 0 && 'lg3-qrow--primary',
                  )}
                  data-queue={row.id}
                >
                  <span className="w-5 text-mono-medium text-[10px] text-stone/75">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-[12px] font-medium text-ink">{row.kind}</span>
                      <span className="truncate text-[11px] text-graphite">{row.who}</span>
                    </div>
                    <p className="truncate text-[10px] text-stone">{row.why}</p>
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5 text-mono-medium text-[8px] uppercase tracking-[0.1em]',
                    row.stage === 'NOW' && 'bg-orange text-on-accent',
                    row.stage === 'NEXT' && 'bg-orange/10 text-orange',
                    row.stage === 'TODAY' && 'bg-bone text-graphite',
                    row.stage === 'LATER' && 'bg-bone text-stone',
                  )}>
                    {row.stage}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Conversations moving */}
          <div className="lg3-console__block">
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Conversations moving</p>
            <div className="mt-1">
              {TODAY_CONVERSATIONS.map((conv) => (
                <div key={conv.id} className={cn('lg3-convrow', isLinked(conv.id) && 'is-linked')} data-conv={conv.id}>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-ink">{conv.name}</p>
                    <p className="truncate text-[10px] text-graphite">{conv.signal}</p>
                  </div>
                  <span className={cn('shrink-0 text-[10px] font-medium', conv.next === 'Reply' ? 'text-orange' : 'text-stone')}>
                    {conv.next === 'Reply' ? 'Next: Reply' : 'Waiting'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </SectionShell>
  )
}

/* ═══════════════════════════════════════════════════════════
   03 · Priority — "Not everything is urgent."
   Labeled chips stay visible but recede; one becomes the action.
   Context is never hidden — only deprioritized.
   ═══════════════════════════════════════════════════════════ */
export function PrioritySection() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.3)
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<FieldPhase>(0)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!inView || startedRef.current) return
    startedRef.current = true
    if (reduced) {
      setPhase(4)
      return
    }
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1300),
      setTimeout(() => setPhase(4), 2000),
    ]
    return () => timers.forEach(clearTimeout)
  }, [inView, reduced])

  return (
    <SectionShell
      id="priority"
      index="03"
      label="Priority"
      title={<>Not everything is urgent.</>}
      lede="Relay doesn’t hide your context. It ranks it — and hands you one move."
    >
      <div ref={ref} className="lg3-priority">
        <SignalField signals={PRIORITY_SIGNALS} phase={phase} variant="chips" fieldId="priority">
          <DoThisNext compact visible={phase >= 4} />
        </SignalField>
      </div>
    </SectionShell>
  )
}

/* ═══════════════════════════════════════════════════════════
   05 · Conversation — "AI prepares. People make the move."
   The real Conversation Copilot surface: reply arrives → Relay
   understands → draft prepared → a human sends it.
   ═══════════════════════════════════════════════════════════ */
export function ConversationSection() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.25)
  const [sent, setSent] = useState(false)

  return (
    <SectionShell
      id="conversation"
      index="05"
      label="Conversation"
      title={<>AI prepares. People make the move.</>}
      lede="Relay reads the reply, holds the context, and readies your words. The send is yours."
    >
      <div ref={ref} className="lg3-convo">
        {/* Context rail — reconstructed copilot context */}
        <motion.aside
          className="lg3-convo__rail"
          initial={false}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Context</p>
          <p className="mt-2 text-[14px] font-medium text-ink">Sarah Chen</p>
          <p className="text-[11px] text-graphite">VP Engineering · Acme Corp</p>
          <div className="mt-4 space-y-2 border-t border-line pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-stone">Channel</span>
              <span className="text-[11px] text-ink">LinkedIn</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-stone">Stage</span>
              <span className="text-[11px] text-ink">Conversation</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-stone">Move</span>
              <span className={cn('text-[11px] font-medium', sent ? 'text-stone' : 'text-orange')}>
                {sent ? 'Theirs · waiting' : 'Yours'}
              </span>
            </div>
          </div>
          <div className="mt-4 rounded-md border border-line bg-bone px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-[0.12em] text-stone">Objective</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink">Move toward a call</p>
          </div>
        </motion.aside>

        {/* Thread */}
        <motion.div
          className="lg3-convo__thread"
          initial={false}
          animate={inView ? 'show' : 'hidden'}
          variants={{ show: { transition: { staggerChildren: 0.35 } }, hidden: {} }}
          data-thread="sarah"
        >
          {CONVERSATION_STEPS.map((step) => (
            <motion.div
              key={step.id}
              variants={{
                hidden: { opacity: 0, y: 10 },
                show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
              }}
            >
              {step.type === 'inbound' && (
                <div className="flex justify-end">
                  <div className="max-w-[85%]">
                    <div className="rounded-md border border-cobalt/20 bg-cobalt/8 px-3.5 py-2.5">
                      <p className="text-[13px] leading-relaxed text-ink">{step.text}</p>
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-1.5 px-1 text-[10px] text-stone">
                      <span className="font-medium">{step.who}</span>
                      <span aria-hidden="true">·</span>
                      <span>{step.time}</span>
                    </div>
                  </div>
                </div>
              )}

              {step.type === 'relay' && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-md border border-line bg-bone-raised/40 px-3.5 py-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="lg3-relaydot" aria-hidden="true" />
                      <span className="text-[10px] uppercase tracking-[0.12em] text-stone">Relay</span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-ink">{step.text}</p>
                  </div>
                </div>
              )}

              {step.type === 'draft' && (
                <div className="flex justify-start">
                  <div className="max-w-[90%]">
                    <div className="rounded-md border border-dashed border-orange/30 bg-orange/[0.03] px-3.5 py-2.5">
                      <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-orange">
                        Draft · {step.goal}
                      </p>
                      <p className="text-[13px] leading-relaxed text-ink">{step.text}</p>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {REFINEMENT_CHIPS.map((chip) => (
                          <span key={chip} className="font-mono text-[9px] tracking-[0.04em] text-stone/70">
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 px-1 text-[10px] text-stone">
                      <span className="font-medium text-orange/70">Relay prepared</span>
                      <span aria-hidden="true">·</span>
                      <span>you send it</span>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ))}

          {/* Human action */}
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 10 },
              show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
            }}
            className="lg3-convo__action"
          >
            <button
              type="button"
              className={cn(
                'lg3-button lg3-button--primary',
                sent && 'lg3-button--sent',
              )}
              onClick={() => setSent(s => !s)}
              data-convo-send=""
              aria-live="polite"
            >
              {sent ? (
                <>
                  <Check className="size-4" />
                  Sent · now their move
                </>
              ) : (
                <>
                  Send reply
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
            <p className="lg3-convo__actionnote">
              {sent
                ? 'YOUR MOVE → THEIR MOVE · Waiting for Sarah'
                : 'Relay prepared this. You decide to send.'}
            </p>
          </motion.div>
        </motion.div>
      </div>
    </SectionShell>
  )
}

/* ═══════════════════════════════════════════════════════════
   07 · Close — "Bring your signals."
   ═══════════════════════════════════════════════════════════ */
export function CloseSection() {
  const [ref, inView] = useInViewOnce<HTMLElement>(0.3)

  return (
    <section ref={ref} id="start" className="lg3-close" data-section="close">
      <div className="lg3-close__field" aria-hidden="true">
        <span className="lg3-close__node lg3-close__node--a" />
        <span className="lg3-close__node lg3-close__node--b" />
        <span className="lg3-close__node lg3-close__node--c" />
        <span className="lg3-close__node lg3-close__node--d" />
        <span className="lg3-close__node lg3-close__node--e" />
        <span className="lg3-close__node lg3-close__node--featured" />
      </div>
      <motion.div
        className="lg3-close__inner"
        initial={false}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="lg3-section__meta">
          <span className="lg3-section__index">07</span>
          Start
        </p>
        <h2 className="lg3-close__title">Bring your signals.</h2>
        <p className="lg3-close__sub">
          Connect your leads and conversations. Tomorrow morning you&apos;ll know
          exactly where to start.
        </p>
        <div className="lg3-close__ctas">
          <Link href="/signup" className="lg3-button lg3-button--primary lg3-button--large" data-landing-cta="close-primary">
            Start with Relay
            <ArrowRight className="size-4" />
          </Link>
          <Link href="/login" className="lg3-button lg3-button--quiet lg3-button--large">
            Sign in
          </Link>
        </div>
      </motion.div>
    </section>
  )
}
