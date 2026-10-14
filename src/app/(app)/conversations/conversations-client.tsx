'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from 'cn'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import type { RelationshipState } from '@/lib/relay/relationship-state'


interface ConversationSummary {
  id: string
  company: string
  contactName: string | null
  contactTitle: string | null
  source: string | null
  status: string
  relationshipState: RelationshipState
  lastMessageText: string | null
  lastMessageAt: string | null
  messageCount: number
}

interface ConversationsClientProps {
  conversations: ConversationSummary[]
  now: number
}

/**
 * ConversationsClient — client-side conversation list + detail view.
 *
 * Desktop: split view (list | workspace)
 * Mobile: single conversation at a time with back navigation
 */
export function ConversationsClient({ conversations }: ConversationsClientProps) {
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id ?? null)

  const selected = conversations.find((c) => c.id === selectedId)

  if (conversations.length === 0) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[12px] text-graphite transition-colors hover:text-ink w-fit">
          <ArrowLeft className="size-3.5" />
          Back to Today
        </Link>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-bone-raised mb-4">
            <MessageSquare className="size-5 text-stone" />
          </div>
          <p className="text-[14px] font-medium text-ink">No conversations yet</p>
          <p className="mt-1 text-[12px] text-graphite">
            When you send a message and get a reply, the conversation shows up here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[12px] text-graphite transition-colors hover:text-ink w-fit">
        <ArrowLeft className="size-3.5" />
        Back to Today
      </Link>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Conversation list */}
        <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-12rem)]">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              onClick={() => setSelectedId(conv.id)}
              className={cn(
                'w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-150',
                selectedId === conv.id
                  ? 'border-orange/30 bg-orange/[0.04]'
                  : 'border-line bg-bone-raised/20 hover:bg-bone-raised/40',
              )}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-ink truncate">{conv.company}</span>
                {conv.relationshipState.kind === 'your_move' && (
                  <span className="shrink-0 size-1.5 rounded-full bg-orange gentle-pulse" />
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-graphite truncate">
                {conv.lastMessageText ?? 'No messages yet'}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-stone">
                <span className="capitalize">{conv.relationshipState.phase.replace(/_/g, ' ')}</span>
                <span aria-hidden="true">·</span>
                <span>{conv.messageCount} messages</span>
              </div>
            </button>
          ))}
        </div>

        {/* Selected conversation workspace */}
        <div className="min-w-0 srf-console p-4 min-h-[60vh]">
          {selected ? (
            <div className="h-full flex flex-col">
              <div className="pb-3 border-b border-line mb-3">
                <Link
                  href={`/leads/${selected.id}`}
                  className="text-[13px] font-medium text-ink hover:text-orange transition-colors"
                >
                  {selected.company}
                </Link>
                {selected.contactName && (
                  <p className="text-[11px] text-graphite">{selected.contactName}</p>
                )}
              </div>
              <div className="flex-1">
                <p className="text-[12px] text-graphite text-center py-8">
                  Select a conversation to view the full workspace.
                  This uses the same components as Lead Detail.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-[12px] text-stone">Select a conversation</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
