import Link from 'next/link'
import { MessagesSquare } from 'lucide-react'
import { createScoutStore } from '@/lib/store'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { loadInbox, type InboxBucket, type InboxItem } from '@/lib/conversation/inbox'
import { cn } from 'cn'

export const dynamic = 'force-dynamic'

const BUCKETS: Array<{ key: InboxBucket; title: string; hint: string }> = [
  { key: 'reply', title: 'Waiting on you', hint: 'The client wrote last. Answer these first.' },
  { key: 'followup', title: 'Follow-up due', hint: 'No answer yet and the follow-up gap has passed.' },
  { key: 'active', title: 'Active conversations', hint: 'The client has replied before. Waiting on them now.' },
]

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default async function ChatsPage() {
  const store = await createScoutStore()
  let items: InboxItem[] = []
  let failed = false
  try {
    items = await loadInbox(store)
  } catch {
    failed = true
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Chats"
        description="Every LinkedIn conversation that needs you, with the AI composer one click away."
      />
      {failed ? (
        <p className="text-[13px] text-status-danger">Conversations could not be loaded. Refresh to try again.</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No conversations need you"
          description="When a client replies or a follow-up is due, it shows up here."
        />
      ) : (
        BUCKETS.map((bucket) => {
          const rows = items.filter((i) => i.bucket === bucket.key)
          if (rows.length === 0) return null
          return (
            <section key={bucket.key} aria-label={bucket.title}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className={cn('text-[13px] font-medium', bucket.key === 'active' ? 'text-ink' : 'text-orange')}>
                  {bucket.title} <span className="text-stone">({rows.length})</span>
                </h2>
                <p className="text-[11px] text-stone">{bucket.hint}</p>
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bone-raised/20">
                {rows.map((item) => (
                  <li key={item.leadId}>
                    <Link
                      href={`/leads/${item.leadId}?tab=conversation`}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-bone-raised/60"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cobalt/10 text-[13px] font-semibold text-cobalt">
                        {(item.contactName ?? item.company).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="truncate text-[13px] font-medium text-ink">{item.contactName ?? 'Unnamed'}</p>
                          <p className="truncate text-[12px] text-graphite">{item.company}</p>
                          {item.stageLabel && (
                            <span className="shrink-0 rounded-full bg-cobalt/10 px-1.5 py-px text-[10px] text-cobalt">{item.stageLabel}</span>
                          )}
                          <span className="ml-auto shrink-0 text-[11px] text-stone">{timeAgo(item.lastAt)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[12px] text-graphite">
                          <span className="text-stone">{item.lastFrom === 'me' ? 'You: ' : ''}</span>
                          {item.lastText}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}
