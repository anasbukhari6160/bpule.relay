import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Target, Search } from 'lucide-react'
import { createScoutStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { isProductAdmin } from '@/lib/auth/admin-page'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonText, SkeletonCircle } from '@/components/ui/skeleton'
import { LeadsBoardV2 } from '@/components/leads/leads-board-v2'
import type { Lead } from '@/lib/domain/types'
import { computeLifecycleState, type LifecycleResult } from '@/lib/leads/lifecycle-policy'

export const dynamic = 'force-dynamic'

type LeadRow = Lead & {
  ownerName?: string
  lastActivityAt?: string | null
  senderProfileName?: string | null
  lastOutboundText?: string | null
  lastOutboundAt?: string | null
  lastInboundText?: string | null
  lastInboundAt?: string | null
  followupCount?: number
  lifecycle?: LifecycleResult
}
type LeadsPayload = { leads: LeadRow[]; orgView: boolean }

async function loadLeads(): Promise<LeadsPayload> {
  const user = await getCurrentUser()
  const authCtx = await getAuthContext()
  const store = await createScoutStore()
  const orgView = isProductAdmin(user, authCtx)
  const ownedLeads = orgView ? await store.fetchLeadsAll() : await store.listOwnedLeads()
  const leadIds = ownedLeads.map((l) => l.id)

  const [repsRes, messagesRes, followupCountsRes] = await Promise.all([
    orgView ? store.listAllReps() : Promise.resolve([]),
    (async () => {
      if (!authCtx || leadIds.length === 0) return []
      try {
        const client = await (await import('@/lib/supabase/server')).createServerSupabase()
        const { data: outbound } = await client
          .from('messages')
          .select('lead_id, sent_at, created_at, sent_text, direction, type')
          .eq('organization_id', authCtx.orgId)
          .in('lead_id', leadIds)
          .neq('direction', 'inbound')
          .order('sent_at', { ascending: false })
        const { data: inbound } = await client
          .from('messages')
          .select('lead_id, sent_at, created_at, sent_text, direction, type')
          .eq('organization_id', authCtx.orgId)
          .in('lead_id', leadIds)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false })
        return [...(outbound ?? []), ...(inbound ?? [])]
      } catch {
        return []
      }
    })(),
    (async () => {
      if (!authCtx || leadIds.length === 0) return []
      try {
        const client = await (await import('@/lib/supabase/server')).createServerSupabase()
        const { data } = await client
          .from('conversation_states')
          .select('lead_id, followup_count')
          .eq('organization_id', authCtx.orgId)
          .in('lead_id', leadIds)
        return data ?? []
      } catch {
        return []
      }
    })(),
  ])

  const reps = Array.isArray(repsRes) ? repsRes : []
  const ownerByRepId = Object.fromEntries(reps.map((rep) => [rep.id, rep.name]))

  const messages = Array.isArray(messagesRes) ? messagesRes : []

  const lastActivityByLead = new Map<string, string>()
  const lastOutboundByLead = new Map<string, { text: string; at: string }>()
  const lastInboundByLead = new Map<string, { text: string; at: string }>()

  for (const m of messages) {
    const leadId = m.lead_id as string
    const ts = (m.sent_at ?? m.created_at) as string
    if (ts && !lastActivityByLead.has(leadId)) lastActivityByLead.set(leadId, ts)

    const direction = m.direction as string
    const text = m.sent_text as string
    const at = (m.sent_at ?? m.created_at) as string

    if (direction !== 'inbound' && text && !lastOutboundByLead.has(leadId)) {
      lastOutboundByLead.set(leadId, { text, at })
    }
    if (direction === 'inbound' && text && !lastInboundByLead.has(leadId)) {
      lastInboundByLead.set(leadId, { text, at })
    }
  }

  const followupCountByLead = new Map<string, number>()
  const followupCounts = Array.isArray(followupCountsRes) ? followupCountsRes : []
  for (const fc of followupCounts) {
    followupCountByLead.set(fc.lead_id as string, (fc.followup_count as number) ?? 0)
  }

  const senderProfileIds = [...new Set(ownedLeads.map((l) => l.senderProfileId).filter(Boolean) as string[])]
  const profileById = new Map<string, string>()
  if (senderProfileIds.length > 0 && authCtx) {
    try {
      const client = await (await import('@/lib/supabase/server')).createServerSupabase()
      const { data: profiles } = await client
        .from('profiles')
        .select('id, display_name, full_name')
        .eq('organization_id', authCtx.orgId)
        .in('id', senderProfileIds)
      if (profiles) {
        for (const p of profiles) {
          profileById.set(p.id as string, (p.display_name ?? p.full_name ?? 'Profile') as string)
        }
      }
    } catch { }
  }

  const rows: LeadRow[] = ownedLeads.map((lead) => {
    const outbound = lastOutboundByLead.get(lead.id)
    const inbound = lastInboundByLead.get(lead.id)
    const lifecycle = computeLifecycleState({
      status: lead.status,
      createdAt: lead.createdAt,
      connectionAcceptedAt: lead.connectionAcceptedAt,
      lockedReason: lead.lockedReason,
      lockedUntil: lead.lockedUntil,
      lastOutboundAt: outbound?.at ?? null,
      lastInboundAt: inbound?.at ?? null,
      followupCount: followupCountByLead.get(lead.id) ?? 0,
      archived: lead.archived,
    })
    return {
      ...lead,
      ownerName: orgView && lead.ownerRepId ? ownerByRepId[lead.ownerRepId] : undefined,
      lastActivityAt: lastActivityByLead.get(lead.id) ?? null,
      senderProfileName: lead.senderProfileId ? profileById.get(lead.senderProfileId) ?? undefined : undefined,
      lastOutboundText: outbound?.text ?? null,
      lastOutboundAt: outbound?.at ?? null,
      lastInboundText: inbound?.text ?? null,
      lastInboundAt: inbound?.at ?? null,
      followupCount: followupCountByLead.get(lead.id) ?? 0,
      lifecycle,
    }
  })

  return { leads: rows, orgView }
}

export default function LeadsPage() {
  const leadsPromise = loadLeads()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads Pipeline"
        description="Every prospect. Organized by where they are in your outreach lifecycle."
        action={
          <Link
            href="/leads/new"
            className="inline-flex items-center gap-2 rounded-md bg-orange px-3 py-2 text-[13px] font-medium text-on-accent transition-colors hover:bg-orange-dark"
          >
            <Plus className="size-4" aria-hidden="true" />
            New lead
          </Link>
        }
      />

      <Suspense fallback={<LeadsBodySkeleton />}>
        <LeadsBody leadsPromise={leadsPromise} />
      </Suspense>
    </div>
  )
}

async function LeadsBody({ leadsPromise }: { leadsPromise: Promise<LeadsPayload> }) {
  const { leads, orgView } = await leadsPromise

  if (leads.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="No leads yet"
        description="Paste a LinkedIn profile, add a company, or import from Upwork. Relay scores them and tells you who is worth contacting."
        action={
          <Link
            href="/prospect"
            className="inline-flex items-center gap-2 rounded-md bg-orange px-3 py-2 text-[13px] font-medium text-on-accent transition-colors hover:bg-orange-dark"
          >
            <Search className="size-4" aria-hidden="true" />
            Check a prospect
          </Link>
        }
      />
    )
  }

  return <LeadsBoardV2 leads={leads} />
}

function LeadsBodySkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-8 w-full rounded-md bg-bone-raised" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-[280px] shrink-0 rounded-xl border border-line bg-bone">
            <div className="border-b border-line/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <SkeletonCircle className="size-2" />
                <SkeletonText className="h-3 w-20" />
              </div>
            </div>
            <div className="space-y-2 p-2">
              {Array.from({ length: 2 }).map((__, j) => (
                <div key={j} className="rounded-lg border border-line/60 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <SkeletonCircle className="size-8" />
                    <SkeletonText className="h-3 w-24" />
                  </div>
                  <SkeletonText className="h-2.5 w-full" />
                  <SkeletonText className="h-2.5 w-3/4" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
