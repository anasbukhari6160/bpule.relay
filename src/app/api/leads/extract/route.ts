import { supportedSignals } from '@/lib/evidence/provenance'
import { signalById } from '@/lib/score/signals'
import { classifyRoleFromTitle, mapLocationToRegion } from '@/lib/leads/targeting-pure'
import { DISPLAY_SCORE_VERSION } from '@/lib/scoring/display-score'
import { hasProvider } from '@/lib/ai/config'
import { scanForSecrets } from '@/lib/ai/secrets'
import { sseStream } from '@/lib/sse/sse'
import { createScoutStore } from '@/lib/store'
import { produceCanonicalIntelligence, getDisplayScore, deriveSignalEvidenceFallback, type OrchestratorResult } from '@/lib/intelligence-v2/orchestrator'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { V3_CANONICAL } from '@/lib/intelligence-v3/config'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import type { ExtractedLead } from '@/lib/domain/types'

export const maxDuration = 120

export async function POST(request: Request) {
  let body: { rawText?: string; forceReanalyze?: boolean }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rawText = body.rawText?.trim()
  if (!rawText) {
    return new Response(JSON.stringify({ error: 'Paste some raw research first.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (rawText.length > 30_000) {
    return new Response(JSON.stringify({ error: 'Paste is too long. Try a single profile at a time.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return sseStream(async (emit) => {
    const started = Date.now()
    let store = null
    try {
      store = await createScoutStore()
    } catch {
      store = null
    }

    const safeLog = async (input: {
      success: boolean
      latencyMs: number
      model: string
      costTier?: 'tier1' | 'tier2' | 'tier3' | 'tier4'
      host?: string
      costUsd?: number
      error?: string | null
    }) => {
      try {
        await store?.logExtractionRun({ task: 'extract', ...input })
      } catch {
        // Metrics logging must never break extraction.
      }
    }

    emit({ type: 'status', message: 'Scanning the paste' })
    const scanned = scanForSecrets(rawText)
    if (scanned.blocked) {
      void safeLog({
        success: false,
        latencyMs: Date.now() - started,
        model: 'n/a',
        error: scanned.reason,
      })
      emit({ type: 'error', message: scanned.reason })
      return
    }

    emit({ type: 'status', message: 'Extracting prospect intelligence' })

    try {
      let canonicalResult: OrchestratorResult

      if (V3_CANONICAL) {
        // V3 is canonical: V3 bridge runs its own extraction + decision pipeline
        const v3Result = await produceV3Intelligence(rawText, {
          onStatus: (msg) => emit({ type: 'status', message: msg }),
          reuseIfUnchanged: store
            ? async (reuseKey) => {
                const existing = await store!.findLeadByV3ReuseKey(reuseKey)
                const packet = existing?.canonicalIntelligence as Record<string, unknown> | null | undefined
                const v3Packet = packet?.v3DecisionPacket as V3LeadDecisionPacket | null | undefined
                return v3Packet ?? null
              }
            : undefined,
        })
        canonicalResult = {
          intelligence: v3Result.intelligence,
          gatePassed: true,
          gateNotes: v3Result.v2Fallback ? ['V3 failed, V2 fallback'] : [],
          repairAttempted: false,
          repairImproved: false,
          reused: false,
        }
      } else {
        // Legacy V2 path
        canonicalResult = await produceCanonicalIntelligence(rawText, {
          onStatus: (msg) => emit({ type: 'status', message: msg }),
          forceReanalyze: body.forceReanalyze === true,
          reuseIfUnchanged: store
            ? async (hash) => {
                const existing = await store!.findLeadByIntelligenceInputHash(hash)
                const canonical = existing?.canonicalIntelligence as CanonicalProspectIntelligence | null | undefined
                return canonical ?? null
              }
            : undefined,
        })
      }

      const canonical = canonicalResult.intelligence
      const latencyMs = Date.now() - started

      if (canonical.extractionCallLog.length === 0) {
        void safeLog({ success: true, latencyMs, model: 'demo' })
      } else {
        for (const call of canonical.extractionCallLog) {
          void safeLog({
            success: true,
            latencyMs,
            model: call.provider,
          })
        }
      }

      const proposedSignal = supportedSignals(rawText)
        .map((id) => signalById(id))
        .filter((sig): sig is NonNullable<typeof sig> => sig !== null)
        .sort((a, b) => b.weight - a.weight)[0]?.id ?? null
      console.info('[leads/extract]', JSON.stringify({
        companySource: canonical.intelligence.company.name ? 'extracted' : 'none',
        locationSource: canonical.intelligence.person.location ? 'extracted' : 'none',
        proposedSignal,
        supportedSignalCount: supportedSignals(rawText).length,
        scoreVersion: canonical.scoreVersion,
        displayScoreVersion: DISPLAY_SCORE_VERSION,
      }))
      const extracted: ExtractedLead = {
        name: canonical.intelligence.person.fullName,
        title: canonical.intelligence.person.title,
        titleRaw: canonical.intelligence.person.title,
        company: canonical.intelligence.company.name ?? 'Unknown company',
        url: canonical.intelligence.person.linkedinUrl ?? canonical.rawSource.sourceUrl ?? null,
        locationRaw: canonical.intelligence.person.location,
        aboutSummary: null,
        experienceSummary: null,
        recentPosts: canonical.intelligence.content.recentPosts.map((p) => ({
          paraphrase: p.paraphrase,
          verbatimQuote: p.verbatimQuote,
        })),
        roleCategory: classifyRoleFromTitle(canonical.intelligence.person.title),
        marketRegion: mapLocationToRegion(canonical.intelligence.person.location),
        // The strongest signal the research actually supports — not a fixed
        // "Asking for help" (7). Unsupported → still 7 for the form, but it
        // scores 0 until evidence backs it (see computeScore sourceText).
        signalType: proposedSignal ?? 7,
        signalEvidence: deriveSignalEvidenceFallback(canonical, rawText),
        extractionConfidence: canonical.extractionCompleteness.score,
        confidenceNotes: canonical.scoreBreakdown.missingInfo,
        verbatimQuote: canonical.intelligence.content.recentPosts[0]?.verbatimQuote ?? null,
        tags: [
          ...canonical.intelligence.content.topics,
          ...canonical.intelligence.content.technicalSignals,
          ...(canonical.intelligence.company.industry ? [canonical.intelligence.company.industry] : []),
        ],
      }

      emit({
        type: 'done',
        extracted,
        canonical,
        score: {
          total: canonical.canonicalScore,
          displayScore: getDisplayScore(canonical),
          label: canonical.scoreBreakdown.label,
          qualification: canonical.qualification,
          reasons: canonical.scoreBreakdown.reasons,
          watchOut: canonical.scoreBreakdown.watchOut,
          dimensions: canonical.scoreBreakdown.dimensions,
          missingInfo: canonical.scoreBreakdown.missingInfo,
        },
        remoteEligibility: canonical.remoteEligibility,
        evidenceLedger: canonical.evidenceLedger,
        sources: {
          rawSource: canonical.rawSource,
          urls: canonical.extractionCompleteness.urlsPreserved,
          sourceUrlsFound: canonical.extractionCompleteness.sourceUrlsFound,
        },
        extractionCompleteness: canonical.extractionCompleteness,
        demoMode: !hasProvider(),
        gateNotes: canonicalResult.gateNotes,
        repairAttempted: canonicalResult.repairAttempted,
        repairImproved: canonicalResult.repairImproved,
        reused: canonicalResult.reused,
        // V3 telemetry
        decisionVersion: V3_CANONICAL ? 'decision_v3' : 'relay_qualification_v2',
        scoreVersion: V3_CANONICAL ? 'score_v3' : (canonical as CanonicalProspectIntelligence).scoreVersion,
        decisionProvider: V3_CANONICAL ? (canonical as CanonicalProspectIntelligence & { v3DecisionPacket?: { decisionProvider?: string } }).v3DecisionPacket?.decisionProvider : undefined,
        decisionModel: V3_CANONICAL ? (canonical as CanonicalProspectIntelligence & { v3DecisionPacket?: { decisionModel?: string } }).v3DecisionPacket?.decisionModel : undefined,
      })
    } catch (err) {
      void safeLog({
        success: false,
        latencyMs: Date.now() - started,
        model: 'n/a',
        error: 'Extraction failed.',
      })
      throw err
    }
  }, 90_000)
}
