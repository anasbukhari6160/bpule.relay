import Link from 'next/link'
import { createScoutStore } from '@/lib/store'
import { loadInboundQueue, type InboundQueueItem } from '@/lib/conversation/archive'
import { InboundDesk } from '@/components/inbound/inbound-desk'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

export default async function InboundPage() {
  let queue: InboundQueueItem[] = []
  let failed = false
  try {
    const store = await createScoutStore()
    queue = await loadInboundQueue(store)
  } catch {
    failed = true
  }
  const waiting = queue.filter((item) => item.needsReply).length

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Inbound"
        description={waiting > 0 ? `${waiting} ${waiting === 1 ? 'message still needs' : 'messages still need'} a reply. Read one, or log a new one.` : 'Messages that came to you. Read them, save a lead, and reply from the conversation.'}
        action={<Link href="/archive" className="text-[13px] font-medium text-orange">Open the archive</Link>}
      />
      <InboundDesk queue={queue} failed={failed} />
    </div>
  )
}
