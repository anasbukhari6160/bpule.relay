import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { createScoutStore } from '@/lib/store'
import { Account360View } from '@/components/account/account-360-view'
import { buildDecisionTrace } from '@/lib/relay/decision-trace'

export const dynamic = 'force-dynamic'

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; companyKey?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const authCtx = await getAuthContext()
  if (!authCtx) redirect('/login')

  const { companyKey } = await searchParams
  // Without a company this route used to dead-end; Settings lives at /settings.
  if (!companyKey) redirect('/settings')
  const store = await createScoutStore()

  // Find leads by company — ONLY use companyKey for exact dedup
  const allLeads = await store.listOwnedLeads()
  const companyLeads = allLeads.filter(l => l.companyKey === companyKey)

  const companyName = companyLeads[0]?.company ?? 'Unknown'

  // Fetch messages for all company leads
  const leadIds = companyLeads.map(l => l.id)
  const messages = await Promise.all(
    leadIds.map(id => store.listMessages(id).catch(() => []))
  ).then(arrays => arrays.flat())

  // Fetch profiles for routing
  const profiles = await store.listProfiles()

  // Build decision traces for top leads
  const topLeads = companyLeads.slice(0, 3)
  const traces = topLeads.map(lead => ({
    leadId: lead.id,
    trace: buildDecisionTrace(lead.id, lead.company, lead.canonicalIntelligence as Record<string, unknown>),
  }))

  return (
    <Suspense fallback={<div className="text-[13px] text-graphite">Loading Account 360...</div>}>
      <Account360View
        company={companyName}
        companyKey={companyLeads[0]?.companyKey ?? companyKey}
        leads={companyLeads}
        messages={messages}
        profiles={profiles}
        traces={traces}
      />
    </Suspense>
  )
}
