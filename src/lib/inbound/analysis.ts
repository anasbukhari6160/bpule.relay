import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import type { InboundInput } from '@/lib/domain/types'
import { extractTrailingSignature, profileInfoFromSignature } from '@/lib/inbound/signature'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { V3_CANONICAL } from '@/lib/intelligence-v3/config'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'

export interface InboundServerAnalysis {
  rawText: string
  canonical: CanonicalProspectIntelligence
  canonicalScore: number
  qualification: string
  buyerIntent: Record<string, unknown> | null
  canonicalIntelligence: Record<string, unknown>
  scoreVersion: string
  scoredAt: string
  scoreBreakdown: Record<string, unknown>
}

export function buildInboundAnalysisText(input: InboundInput): string {
  const signature = extractTrailingSignature(input.message)
  const signatureContext = signature ? profileInfoFromSignature(signature) : ''
  return [signatureContext, input.message, input.profileInfo, input.jobInfo, input.context]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n')
}

export function buildInboundSensitiveText(input: InboundInput): string {
  return [
    buildInboundAnalysisText(input),
    input.company,
    input.contactName,
    input.contactTitle,
    input.url,
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n')
}

function packetBuyerIntent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const packet = value as Record<string, unknown>
  const intent = packet.buyerIntent
  return intent && typeof intent === 'object' && !Array.isArray(intent)
    ? intent as Record<string, unknown>
    : null
}

export async function analyzeInboundInput(
  input: InboundInput,
  options: { useV3?: boolean } = {},
): Promise<InboundServerAnalysis> {
  const rawText = buildInboundAnalysisText(input)
  const useV3 = options.useV3 ?? V3_CANONICAL
  let canonical: CanonicalProspectIntelligence
  let buyerIntent: Record<string, unknown> | null = null

  if (useV3) {
    const result = await produceV3Intelligence(rawText, { deterministicOnly: true })
    canonical = result.intelligence
    buyerIntent = packetBuyerIntent(result.v3Packet)
  } else {
    const result = await produceCanonicalIntelligence(rawText, {
      deterministicOnly: true,
      autoRepair: false,
      onStatus: () => {},
    })
    canonical = result.intelligence
    buyerIntent = packetBuyerIntent((canonical as unknown as Record<string, unknown>).v3DecisionPacket)
  }

  const canonicalScore = canonical.canonicalScore
  const qualification = qualifyCanonicalScore(canonicalScore).qualification
  const scoreBreakdown = canonical.scoreBreakdown as unknown as Record<string, unknown>
  const canonicalIntelligence = {
    ...(canonical as unknown as Record<string, unknown>),
    qualification,
    buyerIntent,
  }

  return {
    rawText,
    canonical,
    canonicalScore,
    qualification,
    buyerIntent,
    canonicalIntelligence,
    scoreVersion: canonical.scoreVersion,
    scoredAt: canonical.scoredAt,
    scoreBreakdown,
  }
}
