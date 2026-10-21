import Link from 'next/link'
import { createScoutStore } from '@/lib/store'
import { loadConversationArchive } from '@/lib/conversation/archive'
import { ConversationArchive } from '@/components/conversation/conversation-archive'
import { ArchivedLeadsList } from '@/components/leads/archived-leads-list'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

export default async function ArchivePage() {
  let threads: Awaited<ReturnType<typeof loadConversationArchive>> = []
  let failed = false
  let archivedLeads: Array<{ id: string; company: string | null; contactName: string | null; archivedAt: string | null }> = []
  try {
    const store = await createScoutStore()
    const all = await store.fetchLeadsAll(false, true)
    archivedLeads = all
      .filter((l) => l.archived)
      .map((l) => ({ id: l.id, company: l.company, contactName: l.contactName, archivedAt: l.archivedAt ?? null }))
    threads = await loadConversationArchive(store)
  } catch {
    failed = true
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Conversation archive"
        description="Every thread you own, including closed ones. Filter by what happened, then open the conversation."
        action={<Link href="/chats" className="text-[13px] font-medium text-orange">Open chats that need you</Link>}
      />
      <ConversationArchive threads={threads} failed={failed} />

      <section className="space-y-2">
        <h2 className="text-[13px] font-medium text-ink">Archived leads</h2>
        <ArchivedLeadsList leads={archivedLeads} />
      </section>
    </div>
  )
}
