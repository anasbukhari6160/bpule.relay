export interface DecisionTraceNode {
  step: string
  timestamp: string
  input: string
  decision: string
  evidence: string[]
  confidence: number | null
  version: string | null
  provider: string | null
}

export interface DecisionTrace {
  leadId: string
  company: string
  trace: DecisionTraceNode[]
}

/**
 * Build a decision trace from stored canonical_intelligence.
 * Pure function — reads stored reasoning, does not fabricate.
 */
export function buildDecisionTrace(
  leadId: string,
  company: string,
  intelligence: Record<string, unknown> | null,
): DecisionTrace {
  const trace: DecisionTraceNode[] = []

  if (!intelligence) {
    return { leadId, company, trace: [] }
  }

  // 1. Source ingested
  trace.push({
    step: 'SOURCE_INGESTED',
    timestamp: (intelligence.computedAt as string) ?? '',
    input: ((intelligence.rawSource as Record<string, unknown>)?.text as string ?? '').slice(0, 100),
    decision: 'Raw source ingested for analysis',
    evidence: [],
    confidence: null,
    version: (intelligence.intelligenceVersion as string) ?? null,
    provider: null,
  })

  // 2. Facts extracted
  const normalized = intelligence.intelligence as Record<string, unknown> | null
  if (normalized) {
    trace.push({
      step: 'FACTS_EXTRACTED',
      timestamp: (intelligence.computedAt as string) ?? '',
      input: JSON.stringify(normalized).slice(0, 100),
      decision: `Extracted: ${Object.keys(normalized).filter(k => normalized[k]).join(', ')}`,
      evidence: [],
      confidence: (intelligence.confidence as number) ?? null,
      version: (intelligence.intelligenceVersion as string) ?? null,
      provider: null,
    })
  }

  // 3. Evidence verified
  const evidenceLedger = intelligence.evidenceLedger as Array<{ text: string; verified: boolean; source: string }> | null
  if (evidenceLedger && evidenceLedger.length > 0) {
    const verifiedQuotes = evidenceLedger.filter(e => e.verified)
    trace.push({
      step: 'EVIDENCE_VERIFIED',
      timestamp: (intelligence.computedAt as string) ?? '',
      input: `${evidenceLedger.length} evidence entries`,
      decision: `${verifiedQuotes.length} verbatim quotes confirmed`,
      evidence: verifiedQuotes.slice(0, 3).map(e => e.text.slice(0, 80)),
      confidence: verifiedQuotes.length > 0 ? 80 : 40,
      version: null,
      provider: null,
    })
  }

  // 4. V3 decision packet
  const v3Packet = intelligence.v3DecisionPacket as Record<string, unknown> | null
  if (v3Packet) {
    const score = v3Packet.score as number ?? null
    const action = v3Packet.action as string ?? 'unknown'
    const dimensions = v3Packet.dimensions as Array<{ key: string; label: string; contribution: number; note: string }> ?? []
    const reasons = v3Packet.reasons as string[] ?? []
    const adjustments = v3Packet.decisionAdjustments as string[] ?? []

    trace.push({
      step: 'EPISODES_BUILT',
      timestamp: (intelligence.computedAt as string) ?? '',
      input: `${(v3Packet.episodes as unknown[] ?? []).length} episodes found`,
      decision: `Selected episode with score ${score}`,
      evidence: reasons.slice(0, 2),
      confidence: v3Packet.confidence as number ?? null,
      version: v3Packet.version as string ?? null,
      provider: v3Packet.provider as string ?? null,
    })

    trace.push({
      step: 'SCORE',
      timestamp: (intelligence.computedAt as string) ?? '',
      input: dimensions.map(d => `${d.label}: ${d.contribution}`).join(', '),
      decision: `Final score: ${score}/100`,
      evidence: dimensions.filter(d => d.contribution > 0).slice(0, 3).map(d => `${d.label} (${d.contribution})`),
      confidence: v3Packet.confidence as number ?? null,
      version: v3Packet.scoreVersion as string ?? null,
      provider: null,
    })

    if (adjustments.length > 0) {
      trace.push({
        step: 'GUARDRAILS_APPLIED',
        timestamp: (intelligence.computedAt as string) ?? '',
        input: 'Bounded decision model output',
        decision: adjustments.join('; '),
        evidence: adjustments,
        confidence: null,
        version: null,
        provider: null,
      })
    }

    trace.push({
      step: 'ACTION',
      timestamp: (intelligence.computedAt as string) ?? '',
      input: `Score ${score}/100`,
      decision: `Recommended: ${action}`,
      evidence: reasons,
      confidence: v3Packet.confidence as number ?? null,
      version: null,
      provider: null,
    })
  }

  // 5. Rescore history
  const rescoreEvents = intelligence.rescoreEvents as Array<{ from: number; to: number; at: string; reason: string }> | null
  if (rescoreEvents && rescoreEvents.length > 0) {
    for (const event of rescoreEvents.slice(-3)) {
      trace.push({
        step: 'RESCORE',
        timestamp: event.at,
        input: `Previous score: ${event.from}`,
        decision: `New score: ${event.to} — ${event.reason}`,
        evidence: [event.reason],
        confidence: null,
        version: null,
        provider: null,
      })
    }
  }

  return { leadId, company, trace }
}
