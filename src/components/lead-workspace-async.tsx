'use client'

import { use, useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LayoutList, MessagesSquare } from 'lucide-react'
import { LeadWorkspace } from './lead-workspace-simple'
import { LeadConversation } from './conversation/lead-conversation'
import { Tabs } from './ui/tabs'
import type { LeadDetail } from '@/lib/store/types'
import type { Profile } from '@/lib/domain/types'

interface LeadData {
  lead: LeadDetail
  profiles: Profile[]
  dailyLimit: number
  todaySends: number
}

/** The chat view can be switched off per deployment without touching Overview. */
const CONVERSATION_UI = process.env.NEXT_PUBLIC_CONVERSATION_UI !== 'false'

type Tab = 'overview' | 'conversation'

export function LeadWorkspaceAsync({ dataPromise }: { dataPromise: Promise<LeadData> }) {
  const { lead, dailyLimit, todaySends } = use(dataPromise)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (CONVERSATION_UI && searchParams?.get('tab') === 'conversation' ? 'conversation' : 'overview'))

  const changeTab = useCallback((next: string) => {
    const value: Tab = next === 'conversation' ? 'conversation' : 'overview'
    setTab(value)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (value === 'conversation') params.set('tab', 'conversation')
    else params.delete('tab')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }, [router, searchParams])

  if (!CONVERSATION_UI) {
    return <LeadWorkspace lead={lead} dailyLimit={dailyLimit} todaySends={todaySends} />
  }

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { value: 'overview', label: 'Overview', icon: LayoutList },
          { value: 'conversation', label: 'Conversation', icon: MessagesSquare },
        ]}
        value={tab}
        onChange={changeTab}
      />
      {tab === 'overview' ? (
        <LeadWorkspace lead={lead} dailyLimit={dailyLimit} todaySends={todaySends} />
      ) : (
        <LeadConversation leadId={lead.id} onChanged={() => router.refresh()} />
      )}
    </div>
  )
}
