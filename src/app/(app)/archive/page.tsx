import Link from 'next/link'
import { createScoutStore } from '@/lib/store'
import { loadConversationArchive } from '@/lib/conversation/archive'
import { ConversationArchive } from '@/components/conversation/conversation-archive'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

export default async function ArchivePage() {
  let threads: Awaited<ReturnType<typeof loadConversationArchive>> = []
  let failed = false
  try {
    const store = await createScoutStore()
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
    </div>
  )
}
