'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { EnrichPanel } from './enrich-panel'
import { MergeTool } from './merge-tool'
import { SendingIdentitiesPanel } from './sending-identities-panel'

interface ProfileData {
  id: string
  fullName: string | null
  displayName: string | null
  headline: string | null
  currentRole: string | null
  company: string | null
  location: string | null
  bio: string | null
  professionalSummary: string | null
  seniority: string | null
  yearsExperience: number | null
  primarySkills: string[]
  secondarySkills: string[]
  technologies: string[]
  industries: string[]
  specialties: string[]
  positioning: string | null
  differentiators: string[]
  languages: string[]
  readiness: string
  profileConfidence: number | null
  sourceCount: number
  proofCount: number
  aiContext: Record<string, unknown>
  assignments: Array<{ id: string; rep: { id: string; name: string } }>
  rep: { name: string } | null
  sources: Array<{ id: string; originalFilename: string; parsingStatus: string; uploadedAt: string }>
  reviews: Array<{ id: string; reviewText: string; reviewerName: string | null; safeForOutreach: boolean }>
  proofCards: Array<{ id: string; capability: string; strength: string; safeClaim: string; verified: boolean }>
  portfolioProjects: Array<{ id: string; projectTitle: string; myRole: string | null; description: string | null; startDate?: string | null; endDate?: string | null }>
  experience: Array<{ id: string; role: string | null; company: string | null; startDate: string | null; endDate: string | null; isCurrent: boolean }>
  archivedAt: string | null
  mergedIntoProfileId: string | null
}

interface ImportRun {
  id: string
  status: string
  created_at: string
  applied_at: string | null
  source_ids: string[]
  summary: { fieldsToAdd: number; fieldsToEnrich: number; conflictsRequiringReview: number; duplicatesIgnored: number } | null
}

export function ProfileDetail({ profileId, canImport = false, isAdmin = false }: { profileId: string; canImport?: boolean; isAdmin?: boolean }) {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [runs, setRuns] = useState<ImportRun[]>([])

  const load = useCallback(() => {
    fetch(`/api/profile-intelligence/profiles/${profileId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.profile) setProfile(data.profile)
        else setError(data.error ?? 'Profile not found')
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
    if (canImport) {
      fetch(`/api/profile-intelligence/profiles/${profileId}/enrich`)
        .then((r) => r.json())
        .then((d) => setRuns(d.runs ?? []))
        .catch(() => setRuns([]))
    }
  }, [profileId, canImport])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="space-y-4" aria-busy="true"><div className="h-6 w-40 animate-pulse rounded bg-bone" /><div className="h-40 animate-pulse rounded-xl border border-line bg-bone-raised" /></div>
  if (error) return <div className="p-6 text-[12px] text-danger">{error}</div>
  if (!profile) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[11px] text-graphite">
        <Link href="/profile-intelligence" className="hover:text-orange">Profiles</Link>
        <span>/</span>
        <span className="text-ink">{profile.fullName ?? profile.displayName ?? 'Profile'}</span>
      </div>

      {/* Identity */}
      <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Identity</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[24px] leading-[1.1] tracking-[-0.02em] text-ink">
            {profile.fullName ?? profile.displayName ?? 'Unnamed'}
          </h1>
          {canImport && !profile.archivedAt && (
            <button onClick={() => setShowImport(true)} data-testid="add-import-data"
              className="rounded bg-orange px-3 py-1.5 text-[12px] font-medium text-white hover:bg-orange/90">
              Add / Import Data
            </button>
          )}
        </div>
        {!canImport && (
          <p data-testid="view-only-note" className="mt-2 text-[11px] text-graphite">
            View only · assigned to you for outreach. Ask an admin to add or correct profile data.
          </p>
        )}
        {profile.archivedAt && (
          <p className="mt-2 rounded bg-warning/10 px-2 py-1 text-[11px] text-warning">
            Archived{profile.mergedIntoProfileId ? <> — merged into <Link className="underline" href={`/profile-intelligence/${profile.mergedIntoProfileId}`}>another profile</Link></> : ''}.
          </p>
        )}
        {profile.currentRole && (
          <p className="mt-1 text-[13px] text-graphite">
            {profile.currentRole}{profile.company ? ` · ${profile.company}` : ''}
          </p>
        )}
        {profile.headline && (
          <p className="mt-2 text-[12px] text-graphite">{profile.headline}</p>
        )}
        <div className="mt-3 flex gap-2">
          {profile.readiness === 'ready' && (
            <span className="rounded bg-success/10 px-2 py-0.5 text-[10px] text-success">Ready</span>
          )}
          {profile.seniority && (
            <span className="rounded bg-orange/5 px-2 py-0.5 text-[10px] text-orange/80">{profile.seniority}</span>
          )}
          {profile.yearsExperience != null && (
            <span className="rounded bg-orange/5 px-2 py-0.5 text-[10px] text-orange/80">{profile.yearsExperience}+ yrs exp</span>
          )}
          <span className="rounded bg-orange/5 px-2 py-0.5 text-[10px] text-graphite">
            {profile.sourceCount} sources · {profile.proofCount} proofs
          </span>
        </div>
      </section>

      {showImport && (
        <EnrichPanel profileId={profile.id} onApplied={load} onClose={() => setShowImport(false)} />
      )}

      {isAdmin && !profile.archivedAt && <SendingIdentitiesPanel profileId={profile.id} />}

      {/* Capabilities */}
      {(profile.primarySkills?.length > 0 || profile.technologies?.length > 0) && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Best At</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {profile.primarySkills?.map((s) => (
              <span key={s} className="rounded bg-orange/10 px-2 py-0.5 text-[11px] text-orange">{s}</span>
            ))}
            {profile.technologies?.filter((t) => !profile.primarySkills?.includes(t)).map((t) => (
              <span key={t} className="rounded border border-orange/10 px-2 py-0.5 text-[11px] text-graphite">{t}</span>
            ))}
          </div>
          {profile.specialties?.length > 0 && (
            <p className="mt-2 text-[11px] text-graphite">
              <span className="font-medium">Specialties:</span> {profile.specialties.join(', ')}
            </p>
          )}
        </section>
      )}

      {/* Summary */}
      {(profile.professionalSummary || profile.bio) && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Summary</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink">
            {profile.professionalSummary ?? profile.bio}
          </p>
        </section>
      )}

      {/* Role history */}
      {profile.experience?.length > 0 && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Role History</p>
          <ul className="mt-3 space-y-1.5" data-testid="role-history">
            {profile.experience.map((e) => (
              <li key={e.id} className="text-[12px] text-ink">
                {e.role ?? 'Role'}{e.company ? ` · ${e.company}` : ''}
                <span className="ml-2 text-[11px] text-graphite">
                  {[e.startDate, e.endDate ?? (e.isCurrent ? 'present' : null)].filter(Boolean).join(' – ')}
                </span>
                {e.isCurrent && <span className="ml-2 rounded bg-success/10 px-1 text-[9px] text-success">current</span>}
                {e.isCurrent && e.endDate && (
                  <span className="ml-2 text-[10px] text-warning">a source lists this role as ended {e.endDate} — current per profile; review conflicts to change</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Projects */}
      {profile.portfolioProjects?.length > 0 && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Projects</p>
          <div className="mt-3 space-y-3">
            {profile.portfolioProjects.map((p) => (
              <div key={p.id} className="border-l-2 border-orange/20 pl-3">
                <p className="text-[12px] font-medium text-ink">
                  {p.projectTitle}
                  {p.myRole && <span className="text-graphite"> — {p.myRole}</span>}
                </p>
                {p.description && (
                  <p className="mt-1 text-[11px] text-graphite">{p.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Proof */}
      {profile.proofCards?.length > 0 && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Proof</p>
          <div className="mt-3 space-y-2">
            {profile.proofCards.map((pc) => (
              <div key={pc.id} className="flex items-start gap-2">
                <span className={`mt-0.5 flex-shrink-0 rounded px-1 text-[9px] font-medium ${
                  pc.strength === 'strong' ? 'bg-success text-success' :
                  pc.strength === 'moderate' ? 'bg-warning/10 text-yellow-600' :
                  'bg-stone-light/10 text-stone'
                }`}>
                  {pc.strength}
                </span>
                <p className="text-[12px] text-ink">{pc.safeClaim}</p>
                {pc.verified && (
                  <span className="flex-shrink-0 text-[9px] text-success">verified</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Reviews */}
      {profile.reviews?.length > 0 && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Reviews</p>
          <div className="mt-3 space-y-3">
            {profile.reviews.map((r) => (
              <div key={r.id} className="border-l-2 border-orange/20 pl-3">
                <p className="text-[12px] italic text-ink">&ldquo;{r.reviewText}&rdquo;</p>
                {r.reviewerName && (
                  <p className="mt-1 text-[10px] text-graphite">— {r.reviewerName}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sources */}
      {profile.sources?.length > 0 && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Sources</p>
          <div className="mt-3 space-y-1">
            {profile.sources.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-ink">{s.originalFilename}</span>
                <span className={`rounded px-1 text-[9px] ${
                  s.parsingStatus === 'parsed' ? 'bg-success text-success' : 'bg-stone-light/10 text-stone'
                }`}>{s.parsingStatus}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Assignment */}
      <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Assignment</p>
        <p className="mt-2 text-[12px] text-ink">
          {profile.assignments?.length > 0
            ? `Assigned to: ${profile.assignments.map((a) => a.rep.name).join(', ')}`
            : 'Not assigned'}
        </p>
      </section>

      {/* Import history */}
      {canImport && runs.length > 0 && (
        <section className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Import History</p>
          <ul className="mt-3 space-y-1" data-testid="import-history">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-[11px] text-ink">
                <span>{new Date(r.created_at).toLocaleString()}</span>
                <span className={`rounded px-1 text-[9px] ${r.status === 'applied' ? 'bg-success text-success' : 'bg-stone-light/10 text-stone'}`}>{r.status}</span>
                <span className="text-graphite">
                  {r.source_ids.length} source{r.source_ids.length === 1 ? '' : 's'}
                  {r.summary ? ` · +${r.summary.fieldsToAdd} added · ${r.summary.fieldsToEnrich} enriched · ${r.summary.conflictsRequiringReview} conflicts · ${r.summary.duplicatesIgnored} duplicates` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && !profile.archivedAt && (
        <MergeTool targetProfileId={profile.id} targetName={profile.fullName ?? profile.displayName ?? 'this profile'} onMerged={load} />
      )}
    </div>
  )
}
