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

  const { company, companyKey } = await searchParams
  const store = await createScoutStore()

  // Find leads by company — ONLY use companyKey for exact dedup
  const allLeads = await store.listOwnedLeads()
  const companyLeads = companyKey
    ? allLeads.filter(l => l.companyKey === companyKey)
    : []

  if (companyLeads.length === 0 && !companyKey) {
    // Empty state — user needs to search by companyKey (from lead detail link)
    return (
      <div className="space-y-6 pb-8">
        <header className="space-y-1.5">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange">Account 360</p>
          <h1 className="text-display text-[28px] font-light tracking-[-0.02em] text-ink">Company Intelligence</h1>
        </header>
        <div className="rounded-lg border border-dashed border-line bg-bone-raised/40 p-8 text-center">
          <p className="text-[14px] text-graphite">No company selected. Open any lead and click the company link to view Account 360.</p>
        </div>
      </div>
    )
  }

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
        companyKey={companyLeads[0]?.companyKey ?? companyKey ?? ''}
        leads={companyLeads}
        messages={messages}
        profiles={profiles}
        traces={traces}
      />
    </Suspense>
  )
}
