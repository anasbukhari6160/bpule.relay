'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Archive, RotateCcw } from 'lucide-react'

export interface ArchivedLeadRow {
  id: string
  company: string | null
  contactName: string | null
  archivedAt: string | null
}

/**
 * Manual lead archive / restore (QA RQA-019).
 *
 * Archived leads leave the active pipeline but keep every field. Restore puts a
 * lead back in its original place. This is distinct from the Won/Lost
 * conversation archive and from the automatic stale-lead sweep.
 */
export function ArchivedLeadsList({ leads }: { leads: ArchivedLeadRow[] }) {
  const [busyId, setBusyId] = useState<string | null>(null)

  if (leads.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-bone-raised/40 px-4 py-3 text-[12px] text-graphite">
        <Archive className="size-3.5" /> No archived leads. Archive a lead from its detail page.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {leads.map((lead) => (
        <div
          key={lead.id}
          className="flex items-center gap-3 rounded-xl border border-line bg-bone-raised/40 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <Link href={`/leads/${lead.id}`} className="text-[13px] font-medium text-ink hover:underline">
              {lead.company ?? 'Unknown company'}
            </Link>
            <p className="text-[11px] text-graphite">
              {lead.contactName ?? 'Unknown contact'}
              {lead.archivedAt ? ` · archived ${new Date(lead.archivedAt).toLocaleDateString()}` : ''}
            </p>
          </div>
          <button
            type="button"
            disabled={busyId === lead.id}
            onClick={async () => {
              setBusyId(lead.id)
              try {
                const res = await fetch(`/api/leads/${lead.id}/archive`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'restore' }),
                })
                if (res.ok) window.location.reload()
              } finally {
                setBusyId(null)
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-orange/10 px-2.5 py-1 text-[11px] font-medium text-orange transition-colors hover:bg-orange/20 disabled:opacity-50"
          >
            <RotateCcw className="size-3" /> {busyId === lead.id ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      ))}
    </div>
  )
}
