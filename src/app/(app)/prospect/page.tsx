'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Handshake,
  RefreshCw,
  Search,
  SkipForward,
  Sparkles,
  User,
  UserPlus,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScoreRing } from '@/components/score-ring'
import { readSse } from '@/lib/sse/client'
import { cn } from 'cn'
import type { ExtractedLead, Profile, MatchedProof } from '@/lib/domain/types'

import type { ProspectQualificationAssessment } from '@/lib/prospect/qualification-gate'
import { describeVerdictForDisplay, type RevenueLoopSnapshot } from '@/lib/relay/revenue-strategy'
import { duplicateNotice } from '@/lib/ui/api-error-toast'
import { scoreExplanation } from '@/lib/scoring/display-score'
import { ScoreBreakdown } from '@/components/score-breakdown'
import { formatRoleLine } from '@/lib/leads/role-line'
import { pasteGuard } from '@/lib/prospect/paste-guard'
import { trackEvent } from '@/lib/analytics/tracker'
import { RejectedSignalInspector, type RejectedSignalView } from '@/components/scoring/rejected-signal-inspector'
import { ScoringFeedback } from '@/components/scoring/scoring-feedback'
import { useActiveIdentity } from '@/components/workspace/active-identity-provider'
import { workspaceIdentityForSender } from '@/lib/workspace/active-identity'
import { ROUTING_MISMATCH_DELTA } from '@/lib/intelligence-v3/action/recommended-action'

/** Canonical decision detail returned by /api/prospect/analyze (Phase 25-31). */
interface DecisionDetail {
  recommendedAction?: { action: string; reason: string; messageEligible: boolean; coldAction: string; conversationOverride: boolean; routing: { recommendation: string; reason: string | null; delta: number | null } } | null
  routingRecommendation?: { action: string; reason: string; routing: { recommendation: string; reason: string | null; delta: number | null } } | null
  confidenceDetail?: { label: 'HIGH' | 'MEDIUM' | 'LOW'; reasons: string[]; researchMore: boolean } | null
  rejectedSignals?: RejectedSignalView[]
  resolved?: { access?: string; activityRecency?: string; buyerTiming?: string; fit?: string; authority?: string; commercialPotential?: string } | null
  versions?: { scoringVersion: string; modelVersion: string; analyzedAt: string } | null
  decisionRunId?: string | null
}

interface SenderRankView {
  senderId: string
  name: string | null
  role: string | null
  profileMatch: number
  reasons: string[]
  accessibleToRep: boolean
  primaryProof: string | null
}

type AnalyzeEvent =
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; draft?: unknown; matchedProof?: unknown; extracted?: undefined; qualification?: undefined; revenue?: undefined }
  | {
      type: 'done'
      extracted: ExtractedLead
      score: {
        total: number
        displayScore: number
        label: string
        qualification: string
        reasons: string[]
        watchOut: string[]
        dimensions: Array<{ label: string; points: number; max: number; note: string }>
        missingInfo: string[]
        calculation?: unknown
        decisionAdjustments?: string[]
      } | null
      inputStatus?: 'not_prospect' | 'insufficient'
      inputHeadline?: string
      extractionCompleteness?: { score?: number; missingFields?: string[] } | null
      canonical: unknown
      bestSender: Profile | null
      bestSenderProof: MatchedProof[]
      connectionNote: string
      charCount: number
      maxChars: number
      quality: { passed: boolean; failures: string[]; wasRepaired: boolean }
      strategy: { whyConnect: string; relevantObservation: string; forbidden: string[]; candidateAngles: string[] }
      draftFailed: boolean
      demoMode: boolean
      alternativeSenders: Array<{ profile: Profile; matchScore: number; topProof: string | null }>
      senderRouting?: { rankings?: SenderRankView[]; currentSenderId?: string | null } | null
  senderSuggestion?: { profileId: string; name: string | null; role: string | null; platform: string | null; score: number; currentBestScore: number; matchedTerms: string[]; topProof: string | null; holders: string[]; reason: string } | null
      qualification: ProspectQualificationAssessment
      revenue?: RevenueLoopSnapshot
    } & DecisionDetail

interface AnalysisState {
  extracted: ExtractedLead | null
  score: {
    total: number
    displayScore: number
    label: string
    qualification: string
    reasons: string[]
    watchOut: string[]
    dimensions: Array<{ label: string; points: number; max: number; note: string }>
    missingInfo: string[]
    calculation?: unknown
    decisionAdjustments?: string[]
  } | null
  /** Set when the paste could not be scored at all (no valid prospect). */
  inputStatus: 'not_prospect' | 'insufficient' | null
  inputHeadline: string | null
  extractionCompleteness: { score?: number; missingFields?: string[] } | null
  canonical: { extractionCompleteness?: { score?: number } } | null
  bestSender: Profile | null
  bestSenderProof: MatchedProof[]
  connectionNote: string
  charCount: number
  maxChars: number
  quality: { passed: boolean; failures: string[]; wasRepaired: boolean }
  strategy: { whyConnect: string; relevantObservation: string; forbidden: string[]; candidateAngles: string[] }
  alternativeSenders: Array<{ profile: Profile; matchScore: number; topProof: string | null }>
  senderRankings: SenderRankView[]
  senderSuggestion?: { profileId: string; name: string | null; role: string | null; platform: string | null; score: number; currentBestScore: number; matchedTerms: string[]; topProof: string | null; holders: string[]; reason: string } | null
  draftFailed: boolean
  demoMode: boolean
  qualification: ProspectQualificationAssessment
  revenue: RevenueLoopSnapshot | null
  decision: DecisionDetail
}

const QUALIFICATION_META: Record<string, { label: string; color: string; bg: string }> = {
  strong: { label: 'Strong opportunity', color: 'text-status-success', bg: 'bg-status-success/10' },
  worth_pursuing: { label: 'Worth pursuing', color: 'text-status-success', bg: 'bg-status-success/10' },
  maybe: { label: 'Maybe — needs more signal', color: 'text-orange', bg: 'bg-orange/10' },
  low: { label: 'Low priority', color: 'text-graphite', bg: 'bg-stone/10' },
  skip: { label: 'Probably skip', color: 'text-graphite', bg: 'bg-stone/10' },
}

function prospectCanBeSaved(
  result: AnalysisState | null,
): result is AnalysisState & { extracted: ExtractedLead } {
  if (!result?.extracted) return false
  if (result.qualification?.inputHardFail) return false
  if (result.qualification?.qualificationEligibility) return true
  // Canonical score is the authority once a real analysis exists. The
  // no-pitch early return used to omit it, so a scored prospect rendered
  // "Lead not eligible" and the button did nothing.
  const qualification = result.score?.qualification
  if (qualification === 'strong' || qualification === 'worth_pursuing' || qualification === 'maybe') return true
  if (result.score?.label?.toLowerCase().includes('connecting')) return true
  return false
}


export default function ProspectCheckPage() {
  const router = useRouter()
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const errorRef = useRef<HTMLDivElement | null>(null)
  const [rawInput, setRawInput] = useState(() => {
    const paste = searchParams?.get('paste')
    if (!paste) return ''
    try {
      return decodeURIComponent(paste)
    } catch {
      // URI malformed — paste contains raw % chars from LinkedIn data
      return paste
    }
  })
  const [analyzing, setAnalyzing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Field-level problem with the paste itself — shown once, next to the
  // textarea, never as a "Something failed" banner or a toast.
  const [validationError, setValidationError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisState | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showSenders, setShowSenders] = useState(false)
  const [duplicateConflict, setDuplicateConflict] = useState<{
    existingLeadId: string
    existingLeadCompany: string
    duplicateKind: 'hard' | 'potential'
    canCreateSeparate: boolean
    reason?: string
  } | null>(null)
  const rawRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const saveInFlightRef = useRef(false)
  const workspace = useActiveIdentity()
  const seenWorkspaceId = useRef<string | null | undefined>(undefined)

  // Preserve sender preference across re-analyses. The sidebar workspace
  // is the default sender; changing sender here is only for this check.
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // Auto-analyze if paste param provided
  useEffect(() => {
    const paste = searchParams?.get('paste')
    if (paste && !analyzing && !result) {
      void analyze()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Clicking "Create lead" happens near the bottom of a long results panel,
  // but the error banner renders at the top of the page — without this, a
  // failed save looks like the button did nothing (TEAM-002 / relay.bpulse.dev report).
  useEffect(() => {
    if (error || duplicateConflict) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error, duplicateConflict])

  const resetResult = useCallback(() => {
    setResult(null)
    setError(null)
    setStatus(null)
    setCopied(false)
    setShowDetails(false)
    setShowSenders(false)
    setDuplicateConflict(null)
  }, [])

  useEffect(() => {
    const nextId = workspace.active?.id ?? null
    const nextProfileId = workspace.active?.profileId ?? null
    if (seenWorkspaceId.current === undefined) {
      seenWorkspaceId.current = nextId
      setSelectedProfileId(nextProfileId)
      return
    }
    if (seenWorkspaceId.current === nextId) return
    seenWorkspaceId.current = nextId
    setSelectedProfileId(nextProfileId)
    resetResult()
  }, [workspace.active?.id, workspace.active?.profileId, resetResult])

  async function analyze(mode: 'analyze' | 'try-another-angle' | 'generate' = 'analyze', profileIdOverride?: string) {
    const guard = pasteGuard(rawInput)
    if (guard) {
      setValidationError(guard)
      rawRef.current?.focus()
      return
    }
    setValidationError(null)

    // "Try Another Angle" must never re-derive canonical evidence/score/
    // qualification/action — only a new message angle. Capture the
    // ALREADY-HELD canonical result before resetResult() clears it, and
    // valid for this exact input and skip re-extraction/re-scoring
    // entirely. See BUG_LEDGER — TEAM-005.
    const existingCanonical = mode === 'try-another-angle' ? result?.canonical ?? null : null

    const effectiveProfileId = profileIdOverride ?? selectedProfileId ?? workspace.active?.profileId ?? null
    const revenueIdentityId = workspaceIdentityForSender(workspace.active, effectiveProfileId)

    resetResult()
    setAnalyzing(true)
    abortRef.current = new AbortController()
    const analysisTiming = performance.now()
    trackEvent({ event: 'prospect_analysis_started' })

    try {
      const res = await fetch('/api/prospect/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: rawInput,
          profileId: effectiveProfileId,
          revenueIdentityId,
          generateNote: mode === 'generate',
          ...(existingCanonical ? { existingCanonical } : {}),
        }),
        signal: abortRef.current.signal,
      })

      // One presenter for server errors: the banner. readSse stays silent.
      await readSse<AnalyzeEvent>(res, {
        silent: true,
        onEvent(event) {
          if (event.type === 'status') {
            setStatus(event.message)
            return
          }
          if (event.type === 'error') {
            setError(event.message)
            return
          }
          if (event.type === 'done') {
            if (!event.extracted && !event.qualification && !event.revenue) return
            // BUG-17: wrap in try/catch so a malformed done event surfaces as a
            // user-facing error instead of crashing into the route error boundary.
            try {
              setResult({
                extracted: event.extracted,
                score: event.score,
                canonical: event.canonical ?? null,
                bestSender: event.bestSender,
                bestSenderProof: event.bestSenderProof,
                connectionNote: event.connectionNote,
                charCount: event.charCount,
                maxChars: event.maxChars,
                quality: event.quality ?? { passed: true, failures: [], wasRepaired: false },
                strategy: event.strategy,
                alternativeSenders: event.alternativeSenders,
                senderRankings: (() => {
                  const all = Array.isArray(event.senderRouting?.rankings) ? event.senderRouting.rankings : []
                  const currentId = event.senderRouting?.currentSenderId ?? event.bestSender?.id ?? null
                  const top = all.slice(0, 5)
                  const current = currentId ? all.find((ranking) => ranking.senderId === currentId) : undefined
                  if (current && !top.some((ranking) => ranking.senderId === current.senderId)) return [...top, current]
                  return top
                })(),
                senderSuggestion: event.senderSuggestion ?? null,
                draftFailed: event.draftFailed,
                demoMode: event.demoMode,
                qualification: event.qualification,
                revenue: event.revenue ?? null,
                inputStatus: event.inputStatus ?? null,
                inputHeadline: event.inputHeadline ?? null,
                extractionCompleteness: event.extractionCompleteness ?? null,
                decision: {
                  recommendedAction: event.recommendedAction ?? null,
                  routingRecommendation: event.routingRecommendation ?? null,
                  confidenceDetail: event.confidenceDetail ?? null,
                  rejectedSignals: Array.isArray(event.rejectedSignals) ? event.rejectedSignals : [],
                  resolved: event.resolved ?? null,
                  versions: event.versions ?? null,
                  decisionRunId: event.decisionRunId ?? null,
                },
              })
              // Track completed analysis
              const durationMs = Math.round(performance.now() - analysisTiming)
              trackEvent({
                event: 'prospect_analysis_completed',
                durationMs,
                metadata: { qualification: event.score?.qualification ?? '', score: event.score?.total ?? 0 },
              })
            } catch (doneErr) {
              setError(doneErr instanceof Error ? doneErr.message : 'Analysis result could not be rendered.')
            }
          }
        },
        onError(message) {
          setError(message)
        },
      })
    } catch (err) {
      if (!error) {
        setError(err instanceof Error && err.name !== 'AbortError' ? err.message : 'Analysis failed.')
      }
    } finally {
      setAnalyzing(false)
      setStatus(null)
    }
  }

  async function copyNote() {
    if (!result?.connectionNote) return
    try {
      await navigator.clipboard.writeText(result.connectionNote)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be unavailable
    }
  }

  async function saveAsLead(allowPotentialDuplicate = false) {
    if (saving || saveInFlightRef.current) return
    if (!prospectCanBeSaved(result)) {
      const message = 'Lead was not created: not enough context to save a reliable lead.'
      setError(message)
      return
    }
    saveInFlightRef.current = true
    setSaving(true)
    setError(null)
    setDuplicateConflict(null)
    try {
      const res = await fetch('/api/prospect/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: result.extracted.company,
          contactName: result.extracted.name,
          contactTitle: result.extracted.title,
          titleRaw: result.extracted.titleRaw,
          locationRaw: result.extracted.locationRaw,
          aboutSummary: result.extracted.aboutSummary,
          experienceSummary: result.extracted.experienceSummary,
          recentPosts: result.extracted.recentPosts,
          roleCategory: result.extracted.roleCategory,
          marketRegion: result.extracted.marketRegion,
          extractionConfidence: result.extracted.extractionConfidence,
          confidenceNotes: result.extracted.confidenceNotes,
          url: result.extracted.url,
          signalType: result.extracted.signalType,
          signalEvidence: result.extracted.signalEvidence,
          verbatimQuote: result.extracted.verbatimQuote,
          tags: result.extracted.tags,
          senderProfileId: selectedProfileId ?? result.bestSender?.id ?? workspace.active?.profileId ?? null,
          revenueIdentityId: workspaceIdentityForSender(
            workspace.active,
            selectedProfileId ?? result.bestSender?.id ?? workspace.active?.profileId ?? null,
          ),
          connectionNote: result.connectionNote,
          prospectScore: result.score?.total ?? null,
          prospectDimensions: result.score?.dimensions ?? null,
          canonical: result.canonical,
          canonicalScore: result.score?.total ?? null,
          rawInput,
          allowPotentialDuplicate,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setDuplicateConflict({
          existingLeadId:
            typeof data.existingLeadId === 'string' && data.existingLeadId.trim().length > 0
              ? data.existingLeadId
              : '',
          existingLeadCompany:
            typeof data.existingLeadCompany === 'string' && data.existingLeadCompany.trim().length > 0
              ? data.existingLeadCompany
              : 'Existing lead',
          duplicateKind: data.duplicateKind === 'potential' ? 'potential' : 'hard',
          canCreateSeparate: Boolean(data.canCreateSeparate),
          reason: typeof data.reason === 'string' ? data.reason : undefined,
        })
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save lead.')
      trackEvent({ event: 'lead_saved', leadId: data.leadId })
      router.push(`/leads/${data.leadId}?next=generate-connection`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save lead.'
      setError(message)
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }

  function changeSender(profileId: string) {
    setSelectedProfileId(profileId)
    if (rawInput.trim()) {
      setTimeout(() => analyze('analyze', profileId), 50)
    }
  }

  function skip() {
    resetResult()
    setRawInput('')
    rawRef.current?.focus()
  }

  const recMeta = result?.score ? QUALIFICATION_META[result.score.qualification] ?? QUALIFICATION_META.maybe : null
  // Verdict must never contradict action: if qualification is 'skip' but the
  // canonical action is NOT 'SKIP' (e.g. a valid CONNECT_OR_OBSERVE/
  // CONNECT_WITHOUT_NOTE relationship contact), the headline must not read
  // "Probably skip" — see Bug 2 (verdict/action reconciliation).
  const verdictDisplay = result?.score
    ? describeVerdictForDisplay(
        result.score.qualification as 'strong' | 'worth_pursuing' | 'maybe' | 'skip',
        result.revenue?.act ?? 'RESEARCH_MORE',
        result.revenue?.messagingPolicyLabel,
      )
    : null
  const recommendation = result
    ? result.score
      ? verdictDisplay?.headline ?? recMeta?.label ?? 'Awaiting analysis'
      : 'Not enough information'
    : 'Awaiting analysis'
  const canSaveLead = prospectCanBeSaved(result)
  const duplicateCopy = duplicateConflict ? duplicateNotice(duplicateConflict) : null

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Intake</p>
          <span className="size-1 rounded-full bg-line" />
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Prospect Check</p>
        </div>
        <h1 className="text-display text-[28px] font-light tracking-[-0.02em] text-ink sm:text-[32px]">
          Decide if this prospect is worth your next outreach.
        </h1>
          <p className="max-w-2xl text-[13px] text-graphite">
            Check whether a prospect is worth your next outreach.
          </p>
          {workspace.active && (
            <p className="text-[13px] text-ink">
              Prospecting as <span className="font-medium">{workspace.active.identityName}</span>
              {workspace.active.title ? <span className="text-graphite"> · {workspace.active.title}</span> : null}
            </p>
          )}
      </header>

      {error ? (
        <Alert variant="destructive" ref={errorRef}>
          <AlertTitle>Something failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {duplicateConflict && duplicateCopy ? (
        <Alert ref={error ? undefined : errorRef}>
          <AlertTitle>{duplicateCopy.title}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{duplicateCopy.description}</p>
            <div className="flex flex-wrap items-center gap-2">
              {duplicateConflict.existingLeadId ? (
                <Button variant="secondary" size="sm" onClick={() => router.push(`/leads/${duplicateConflict.existingLeadId}`)}>
                  View existing
                </Button>
              ) : null}
              {duplicateConflict.canCreateSeparate ? (
                <Button variant="outline" size="sm" onClick={() => void saveAsLead(true)} disabled={saving}>
                  Create separate
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="srf-console p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-orange" aria-hidden="true" />
          <h2 className="text-sm font-medium text-ink">Paste a LinkedIn profile</h2>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-graphite">
          Name, headline, current role, company, About, experience, posts — whatever you have.
        </p>
        <Textarea
          ref={rawRef}
          value={rawInput}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={validationError ? 'prospect-paste-error' : undefined}
          onChange={(e) => {
            setRawInput(e.target.value)
            if (validationError) setValidationError(null)
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              if (!analyzing) void analyze()
            }
          }}
          placeholder="Paste the LinkedIn profile here..."
          rows={10}
          className={cn(
            'mt-3 max-h-[24rem] overflow-y-auto font-mono text-[13px]',
            validationError && 'border-status-danger focus-visible:ring-status-danger/30',
          )}
        />
        {validationError ? (
          <p id="prospect-paste-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-[12px] text-status-danger">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            {validationError}
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          {/* Keyboard hint is for desktop; touch layouts rely on the Analyze button. */}
          <span className="hidden text-xs text-stone sm:inline">Cmd / Ctrl + Enter</span>
          <span className="sm:hidden" aria-hidden="true" />
          <div className="flex items-center gap-2">
            {result && (
              <Button variant="ghost" size="sm" onClick={skip}>
                <SkipForward className="size-3.5" aria-hidden="true" />
                Check another
              </Button>
            )}
            <Button variant="orange" onClick={() => void analyze()} loading={analyzing}>
              <Sparkles className="size-4" aria-hidden="true" />
              {analyzing ? (status ?? 'Analyzing') : result ? 'Re-analyze' : 'Analyze'}
            </Button>
          </div>
        </div>
      </div>

      {analyzing && !result && (
        <div className="flex min-h-[12rem] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-bone-raised/40 px-6 text-center">
          <RefreshCw className="size-5 animate-spin text-orange" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ink">Analyzing prospect…</p>
          <p className="mt-1 text-xs text-graphite">Usually a few seconds.</p>
        </div>
      )}

      {result && result.extracted && (
        <div className="space-y-4">
          {result.score ? (
            <div>
              <div className="flex items-baseline gap-3">
                <ScoreRing canonicalScore={result.score.total} displayValue={result.score.displayScore} size={64} />
                <div className="min-w-0">
                  <h2 className="text-[15px] font-medium text-ink">
                    {result.extracted.name ?? 'Unnamed prospect'}
                  </h2>
                  <p className="text-[12px] text-graphite">
                    {formatRoleLine(result.extracted.title ?? result.extracted.titleRaw, result.extracted.company)}
                  </p>
                </div>
                {verdictDisplay?.contradicted ? (
                  <span
                    role="status"
                    className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full border border-orange/40 bg-orange/10 px-2.5 py-1 text-[11px] font-semibold text-orange shadow-sm"
                  >
                    <Handshake className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="size-1.5 shrink-0 rounded-full bg-orange gentle-pulse" aria-hidden="true" />
                    {verdictDisplay.headline}
                  </span>
                ) : (
                  <span className={cn('ml-auto text-[11px] font-medium shrink-0', recMeta?.color)}>
                    {recMeta?.label}
                  </span>
                )}
              </div>

              {result.revenue && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SignalChip label="Fit" value={result.revenue.fit} />
                  <SignalChip label="Intent" value={result.revenue.intent} />
                  {/* Decision confidence: how decisive the qualification is. It is
                      not extraction certainty — that caveat is shown below. */}
                  <SignalChip label="Decision confidence" value={result.revenue.confidence} />
                  {/* Channel-explicit: this reflects the connection-note
                      channel specifically. Lead Detail may correctly show a
                      different policy for the DM channel on the same lead —
                      not a contradiction, a different question. */}
                  <SignalChip label="Connection" value={result.revenue.messagingPolicy?.replaceAll('_', ' ') ?? '—'} />
                </div>
              )}
              {result.extractionCompleteness?.score != null && result.extractionCompleteness.score < 75 && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-status-warning">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span>
                    Extraction is {result.extractionCompleteness.score}% complete
                    {result.extractionCompleteness.missingFields?.length
                      ? ` — missing ${result.extractionCompleteness.missingFields.map((f) => f.replaceAll('_', ' ')).join(', ')}`
                      : ''}
                    . Decision confidence does not cover missing identity details.
                  </span>
                </p>
              )}
              <p className="mt-3 text-[12px] text-graphite">
                {scoreExplanation({
                  displayScore: result.score.displayScore,
                  canonicalScore: result.score.total,
                  qualification: result.score.qualification,
                })}
              </p>
              {result.revenue && (
                <div className="mt-2 space-y-1">
                  <p className="text-[12px] text-ink">{result.revenue.why}</p>
                  <p className="text-[11px] text-graphite">Next: {result.revenue.nextAction}</p>
                  {!result.revenue.messageRecommended && (
                    <p className="text-[12px] font-medium text-status-warning">
                      No message recommended. {result.revenue.noMessageReason}
                    </p>
                  )}
                </div>
              )}

              {Array.isArray(result.score.reasons) && result.score.reasons.length > 0 && (
                <div className="mt-3 space-y-0.5">
                  <p className="text-[11px] font-medium text-ink">Strongest evidence</p>
                  {result.score.reasons.map((w, i) => (
                    <p key={i} className="flex items-start gap-2 text-[12px] text-ink">
                      <Check className="mt-0.5 size-3 shrink-0 text-status-success" aria-hidden="true" />
                      {w}
                    </p>
                  ))}
                </div>
              )}

              {((Array.isArray(result.score.watchOut) && result.score.watchOut.length > 0) || (Array.isArray(result.score.missingInfo) && result.score.missingInfo.length > 0)) && (
                <div className="mt-2 space-y-0.5">
                  <p className="text-[11px] font-medium text-ink">Missing evidence</p>
                  {[...(result.score.watchOut ?? []), ...(result.score.missingInfo ?? [])].map((w, i) => (
                    <p key={i} className="flex items-start gap-2 text-[12px] text-graphite">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-status-warning" aria-hidden="true" />
                      {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Why this decision: canonical action + reason, confidence reasons,
                  routing recommendation, and every signal seen but not credited.
                  Opportunity ≠ sender: switching the sender never changes this block. */}
              {result.decision?.recommendedAction && (
                <div className="mt-3 rounded-lg border border-line bg-bone-raised/20 p-3" data-testid="decision-why">
                  <p className="text-[11px] font-medium text-ink">
                    Next step: {result.decision.recommendedAction.action.replaceAll('_', ' ').toLowerCase()}
                    {result.decision.confidenceDetail && (
                      <span className={cn('ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide', result.decision.confidenceDetail.label === 'HIGH' ? 'bg-status-success/10 text-status-success' : result.decision.confidenceDetail.label === 'MEDIUM' ? 'bg-orange/10 text-orange' : 'bg-stone/10 text-graphite')}>
                        {result.decision.confidenceDetail.label} confidence
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[12px] text-graphite">{result.decision.recommendedAction.reason}</p>
                  {result.decision.confidenceDetail?.reasons?.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {result.decision.confidenceDetail.reasons.slice(0, 3).map((r) => <li key={r} className="text-[11px] text-graphite">• {r}</li>)}
                    </ul>
                  ) : null}
                  {result.decision.routingRecommendation && result.decision.routingRecommendation.routing.recommendation !== 'KEEP' && (
                    <p className="mt-2 text-[11px] text-orange" data-testid="routing-recommendation">
                      Routing: {result.decision.routingRecommendation.routing.recommendation.replaceAll('_', ' ').toLowerCase()}. {result.decision.routingRecommendation.routing.reason}
                    </p>
                  )}
                  {result.decision.rejectedSignals && result.decision.rejectedSignals.length > 0 && (
                    <RejectedSignalInspector signals={result.decision.rejectedSignals} compact className="mt-2" />
                  )}
                  {result.decision.decisionRunId && (
                    <ScoringFeedback
                      className="mt-2"
                      decisionRunId={result.decision.decisionRunId}
                      observed={{ score: result.score.total, displayScore: result.score.displayScore, qualification: result.score.qualification, action: result.decision.recommendedAction.action, versions: result.decision.versions }}
                    />
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="mt-2 flex items-center gap-1 text-[11px] text-stone transition-colors hover:text-ink"
              >
                <ChevronDown className={cn('size-3 transition-transform', showDetails && 'rotate-180')} aria-hidden="true" />
                {showDetails ? 'Hide' : 'Show'} scoring details
              </button>

              {showDetails && (
                <div className="mt-2 border-t border-line pt-3">
                  <ScoreBreakdown
                    dimensions={result.score.dimensions}
                    calculation={result.score.calculation}
                    decisionAdjustments={result.score.decisionAdjustments ?? []}
                    canonicalScore={result.score.total}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="border-l-2 border-status-warning/40 pl-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-status-warning">
                {result.inputHeadline ?? 'Insufficient profile information'}
              </p>
              <p className="mt-1 text-[14px] font-medium text-ink">
                {result.inputStatus === 'not_prospect'
                  ? 'This paste can’t be qualified — it doesn’t describe a prospect.'
                  : 'Relay could not verify enough evidence to score this prospect.'}
              </p>
              {result.revenue?.noMessageReason && (
                <p className="mt-1 text-[12px] text-graphite">{result.revenue.noMessageReason}</p>
              )}
              <p className="mt-1 text-[12px] text-graphite">Not scored — there is no valid prospect to score.</p>
              {(result.qualification?.missingCritical.length ?? 0) > 0 && (
                <p className="mt-2 text-[12px] text-graphite">
                  Missing: {result.qualification.missingCritical.join(', ')}.
                </p>
              )}
              <p className="mt-2 text-[12px] text-ink">
                Add identifying and opportunity details to continue: the person’s name and role, their company, and the job, project, or need you are qualifying.
              </p>
            </div>
          )}

          {result.score && (
            <div data-testid="sender-section" className="rounded-lg border border-line bg-bone-raised/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <User className="size-3.5 text-orange" aria-hidden="true" />
                  <h3 className="text-[12px] font-medium text-ink">Sender</h3>
                </div>
                {Array.isArray(result.alternativeSenders) && result.alternativeSenders.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowSenders(!showSenders)}
                    className="flex items-center gap-1 text-[11px] text-stone transition-colors hover:text-ink"
                  >
                    Change sender
                    <ChevronDown className={cn('size-3 transition-transform', showSenders && 'rotate-180')} aria-hidden="true" />
                  </button>
                )}
              </div>
              {(() => {
                const activeId = selectedProfileId ?? result.bestSender?.id ?? null
                const active = result.senderRankings.find((ranking) => ranking.senderId === activeId) ?? null
                const stronger = result.senderRankings.find((ranking) => (
                  ranking.senderId !== activeId
                  && active != null
                  && ranking.profileMatch - active.profileMatch >= ROUTING_MISMATCH_DELTA
                )) ?? null
                const delta = stronger && active ? stronger.profileMatch - active.profileMatch : 0
                return (
                  <>
                    <p className="mt-1.5 text-[13px] font-medium text-ink">
                      Sending as: {active?.name ?? result.bestSender?.label ?? 'No profile selected'}
                      {active ? ` · ${active.profileMatch}% match` : ''}
                    </p>
                    {(active?.reasons[0] ?? result.bestSenderProof[0]?.safeClaim) && (
                      <p className="mt-0.5 text-[11px] text-graphite">
                        {(active?.reasons[0] ?? result.bestSenderProof[0]?.safeClaim ?? '').slice(0, 140)}
                      </p>
                    )}
                    {stronger && (
                      <div data-testid="sender-mismatch" className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2.5">
                        <p className="text-[12px] font-medium text-amber-800">Another sender is a stronger match</p>
                        <p className="mt-1 text-[12px] text-amber-700">
                          <span className="font-medium">{stronger.name ?? 'Another profile'}</span> is +{delta}% stronger for this lead.
                          {' '}Current sender: {active?.name ?? 'Unknown'} ({active?.profileMatch ?? 0}%).
                        </p>
                        {stronger.reasons.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5">
                            {stronger.reasons.slice(0, 3).map((reason) => (
                              <li key={reason} className="text-[11px] text-amber-700">• {reason}</li>
                            ))}
                          </ul>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="mt-2 h-7 text-[11px]"
                          onClick={() => changeSender(stronger.senderId)}
                        >
                          Use {stronger.name ?? 'this sender'}
                        </Button>
                      </div>
                    )}
                  </>
                )
              })()}
              {result.senderRankings.length === 0 && !result.bestSender && (
                <p className="mt-1.5 text-[12px] text-graphite">No LinkedIn profile is available for this check.</p>
              )}
              {result.senderRankings.length > 1 && (
                <ul className="mt-2 space-y-1">
                  {result.senderRankings.slice(0, 5).map((ranking, index) => {
                    const activeId = selectedProfileId ?? result.bestSender?.id ?? null
                    const selected = ranking.senderId === activeId
                    return (
                      <li key={ranking.senderId}>
                        <button
                          type="button"
                          onClick={() => changeSender(ranking.senderId)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-[11px]',
                            selected ? 'bg-bone text-ink' : 'text-graphite hover:text-ink',
                          )}
                        >
                          <span className="w-4 text-stone">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {ranking.name ?? 'Unnamed'}
                            {ranking.role ? <span className="font-normal"> · {ranking.role}</span> : null}
                          </span>
                          <span className="shrink-0">{ranking.profileMatch}%</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {result.senderSuggestion && (
                <div data-testid="sender-suggestion" className="mt-2 rounded-md border border-orange/30 bg-orange/5 p-2.5">
                  <p className="text-[11px] font-medium text-ink">
                    Relay suggests: {result.senderSuggestion.name ?? 'another profile'}
                    {result.senderSuggestion.role ? <span className="font-normal text-graphite"> · {result.senderSuggestion.role}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-graphite">{result.senderSuggestion.reason}</p>
                  {result.senderSuggestion.topProof && (
                    <p className="mt-1 text-[11px] text-graphite">
                      Strongest proof: {result.senderSuggestion.topProof.slice(0, 120)}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-stone">
                    Match {result.senderSuggestion.score} vs your best {result.senderSuggestion.currentBestScore}
                    {result.senderSuggestion.holders.length > 0 ? ` · held by ${result.senderSuggestion.holders.join(', ')}` : ''}
                  </p>
                </div>
              )}

              {showSenders && Array.isArray(result.alternativeSenders) && result.alternativeSenders.length > 0 && (
                <div className="mt-2 space-y-1">
                  {result.alternativeSenders.map((alt) => (
                    <button
                      key={alt.profile.id}
                      type="button"
                      onClick={() => changeSender(alt.profile.id)}
                      className="block w-full text-left text-[11px]"
                    >
                      <span className="font-medium text-ink">{alt.profile.label ?? 'Unnamed'}</span>
                      <span className="ml-2 text-graphite">
                        {alt.topProof ?? 'No match'} · {alt.matchScore}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {result.connectionNote ? (
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-medium text-ink">
                  {result.revenue && !result.revenue.messageRecommended ? 'Message' : 'Connection note'}
                </h3>
                <span className={cn(
                  'font-mono text-[11px]',
                  result.charCount > result.maxChars ? 'text-status-danger' : 'text-stone',
                )}>
                  {result.charCount} / {result.maxChars}
                </span>
              </div>
              <div className="mt-2 rounded-md bg-bone p-3">
                <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
                  {result.connectionNote}
                </p>
              </div>

              {!result.quality.passed && Array.isArray(result.quality.failures) && result.quality.failures.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {result.quality.failures.slice(0, 3).map((f, i) => (
                    <span key={i} className="text-[10px] text-status-warning">{f}</span>
                  ))}
                </div>
              )}
              {result.quality.wasRepaired && (
                <p className="mt-1 text-[10px] text-stone">Auto-repaired to meet quality standards.</p>
              )}
              {result.draftFailed && (
                <p className="mt-1 text-[10px] text-status-warning">Draft generation failed — using fallback.</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="orange" size="sm" onClick={() => void copyNote()} disabled={!result.score || !result.connectionNote}>
                  {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy note'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-line bg-bone-raised/40 p-3">
              <p className="text-[12px] text-graphite">
                {canSaveLead
                  ? 'Analysis complete — qualification and signals are shown above. Create a lead to start outreach from the lead detail page.'
                  : result.score
                    ? 'Add identifying and opportunity details to continue. A lead can’t be created from this paste yet.'
                    : 'A lead can’t be created from this paste yet.'}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {result.score && (
                  <Button variant="secondary" size="sm" onClick={() => void analyze('analyze')} disabled={analyzing}>
                    <RefreshCw className="size-3" aria-hidden="true" />
                    Try another angle
                  </Button>
                )}
                <Button variant="orange" size="sm" onClick={() => void saveAsLead()} disabled={saving || !canSaveLead}>
                  {saving ? 'Creating...' : (
                    <>
                      {canSaveLead ? 'Create lead' : 'Lead not eligible'}
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </>
                  )}
                </Button>
                <Button variant="ghost" size="sm" onClick={skip}>
                  <X className="size-3" aria-hidden="true" />
                  Skip
                </Button>
              </div>
            </div>
          )}

            {!canSaveLead && result.score && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-status-warning" aria-hidden="true" />
                <div className="text-[12px] leading-relaxed text-graphite">
                  <p className="font-medium text-ink">
                    Not enough verified context to create a reliable lead.
                  </p>
                  {(result.qualification?.missingCritical.length ?? 0) > 0 ? (
                    <p className="mt-0.5">
                      Missing: {result.qualification.missingCritical.join(', ')}.
                    </p>
                  ) : null}
                  <p className="mt-0.5">
                    Paste more of the original source (About section, company mentions, job/opportunity details) and try again — Relay will not invent a company or opportunity that isn&apos;t actually in the text.
                  </p>
                </div>
              </div>
            )}

          {result.demoMode && (
            <Alert>
              <AlertTitle>Demo mode</AlertTitle>
              <AlertDescription>
                Using demo extraction. Connect an AI provider in settings for full intelligence.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="h-4 lg:hidden" />
    </div>
  )
}

function SignalChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-bone-raised px-3 py-2">
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-stone">{label}</p>
      <p className="mt-1 text-[14px] font-medium text-ink">{value}</p>
    </div>
  )
}

