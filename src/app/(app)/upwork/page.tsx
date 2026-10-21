import Link from 'next/link'
import { Plus, Briefcase, ArrowRight } from 'lucide-react'
import { createScoutStore } from '@/lib/store'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ConnectsPanel } from '@/components/upwork-connects-panel'
import { upworkStageLabel } from '@/lib/upwork/pipeline'

export const dynamic = 'force-dynamic'

export default async function UpworkPage() {
  const store = await createScoutStore()
  const jobs = await store.listUpworkJobs()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Upwork"
        description="Extract jobs, generate proposals, apply — all in one flow."
        action={
          <Link
            href="/upwork/new"
            className="inline-flex items-center gap-2 rounded-md bg-orange px-3 py-2 text-[13px] font-medium text-on-accent transition-colors hover:bg-orange-dark"
          >
            <Plus className="size-4" aria-hidden="true" />
            Extract job
          </Link>
        }
      />

      {/* Connects usage */}
      <ConnectsPanel />

      {jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No Upwork jobs yet"
          description="Paste a Upwork job URL or text. Relay extracts the details, scores fit, and helps you write a proposal."
          action={
            <Link
              href="/upwork/new"
              className="inline-flex items-center gap-2 rounded-md bg-orange px-4 py-2 text-[13px] font-medium text-on-accent transition-colors hover:bg-orange-dark"
            >
              <Plus className="size-4" aria-hidden="true" />
              Extract your first job
            </Link>
          }
        />
      ) : (
        <div className="srf-console overflow-hidden">
          <ul className="divide-y divide-console-line/50">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link href={`/upwork/${job.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-console-raised">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-console-text">{job.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-console-mute">{upworkStageLabel(job.status)}</span>
                      {job.connectsCost > 0 && (
                        <span className="text-[10px] text-console-mute">• {job.connectsCost} Connects</span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="size-3.5 shrink-0 text-console-mute" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
