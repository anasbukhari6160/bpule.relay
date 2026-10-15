'use client'

import { useState, useCallback } from 'react'
import { MessageCircle, Send, Reply, Loader2 } from 'lucide-react'
import { cn } from 'cn'
import type { UpworkJob } from '@/lib/domain/types'

interface Message {
  id: string
  type: string
  sentText?: string | null
  draftText?: string | null
  createdAt: string
}

export function UpworkCommunication({ jobId, job }: { jobId: string; job: UpworkJob }) {
  const [messages, setMessages] = useState<Message[]>(job.messages ?? [])
  const [showInbound, setShowInbound] = useState(false)
  const [inboundText, setInboundText] = useState('')
  const [replyGenerating, setReplyGenerating] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [lastClientMsg, setLastClientMsg] = useState('')

  const logInbound = useCallback(async () => {
    if (!inboundText.trim()) return
    try {
      await fetch(`/api/upwork/jobs/${jobId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inboundText.trim(), direction: 'inbound' }),
      })
      setMessages((prev) => [
        {
          id: `inbound-${Date.now()}`,
          type: 'reply',
          sentText: inboundText.trim(),
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ])
      setLastClientMsg(inboundText.trim())
      setInboundText('')
      setShowInbound(false)
    } catch { /* ignore */ }
  }, [inboundText, jobId])

  const generateReply = useCallback(async () => {
    if (!lastClientMsg) return
    setReplyGenerating(true)
    setReplyError(null)
    try {
      const res = await fetch(`/api/upwork/jobs/${jobId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientMessage: lastClientMsg,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        setReplyText(json.reply ?? '')
      } else {
        const err = await res.json().catch(() => ({}))
        setReplyError(err.error || 'Failed to generate reply')
      }
    } catch {
      setReplyError('Network error')
    }
    setReplyGenerating(false)
  }, [lastClientMsg, jobId])

  const saveReply = useCallback(async () => {
    if (!replyText.trim()) return
    try {
      await fetch(`/api/upwork/jobs/${jobId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: replyText.trim(), direction: 'outbound' }),
      })
      setMessages((prev) => [
        {
          id: `outbound-${Date.now()}`,
          type: 'reply',
          sentText: replyText.trim(),
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ])
      setReplyText('')
    } catch { /* ignore */ }
  }, [replyText, jobId])

  return (
    <section className="reveal-up stagger-5 rounded border border-line bg-bone-raised p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <MessageCircle className="size-3.5 text-cobalt" />
          Communication
        </h2>
        <button
          onClick={() => setShowInbound(!showInbound)}
          className="rounded-lg bg-bone px-2.5 py-1 text-[11px] text-ink hover:bg-bone-raised"
        >
          + Log client message
        </button>
      </div>

      {/* Inbound message capture */}
      {showInbound && (
        <div className="mb-4 rounded-lg border border-line bg-bone p-3 space-y-2">
          <textarea
            value={inboundText}
            onChange={(e) => setInboundText(e.target.value)}
            rows={3}
            className="w-full rounded border border-line bg-bone-raised px-3 py-2 text-[12px] placeholder:text-stone"
            placeholder="Paste the client's message here..."
          />
          <div className="flex gap-2">
            <button
              onClick={logInbound}
              disabled={!inboundText.trim()}
              className="rounded bg-cobalt px-3 py-1.5 text-[11px] text-on-accent disabled:opacity-50"
            >
              Log message
            </button>
            <button
              onClick={() => { setShowInbound(false); setInboundText('') }}
              className="rounded border border-line px-3 py-1.5 text-[11px] text-stone"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Last client message + reply generation */}
      {lastClientMsg && (
        <div className="mb-4 rounded-lg border border-orange/20 bg-orange/5 p-3">
          <p className="text-[10px] uppercase tracking-wide text-orange">Last client message</p>
          <p className="mt-1 text-[12px] text-ink/80 whitespace-pre-wrap">{lastClientMsg}</p>
          <button
            onClick={generateReply}
            disabled={replyGenerating}
            className="mt-2 flex items-center gap-1.5 rounded bg-orange/10 px-2.5 py-1 text-[11px] font-medium text-orange hover:bg-orange/20 disabled:opacity-50"
          >
            {replyGenerating ? <Loader2 className="size-3 animate-spin" /> : <Reply className="size-3" />}
            {replyGenerating ? 'Generating...' : 'Generate reply'}
          </button>
        </div>
      )}

      {/* Generated reply */}
      {replyText && (
        <div className="mb-4 rounded-lg border border-cobalt/20 bg-cobalt/5 p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-cobalt">Suggested reply</p>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={5}
            className="w-full rounded border border-line bg-bone-raised px-3 py-2 text-[12px]"
          />
          <button
            onClick={saveReply}
            className="flex items-center gap-1.5 rounded bg-cobalt px-3 py-1.5 text-[11px] text-on-accent"
          >
            <Send className="size-3" /> Save & send
          </button>
        </div>
      )}

      {replyError && (
        <p className="mb-3 text-[11px] text-status-danger">{replyError}</p>
      )}

      {/* Message history */}
      {messages.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={m.id} className={cn(
                'rounded-lg p-3',
                m.type === 'reply' ? 'bg-bone' : 'bg-bone-raised/50'
              )}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wide text-stone">{m.type}</span>
                  <span className="text-[10px] text-stone">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {(m.sentText || m.draftText) && (
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink/80">
                    {m.sentText || m.draftText}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-stone">
          No messages yet. Paste a client message when they reply.
        </p>
      )}
    </section>
  )
}
