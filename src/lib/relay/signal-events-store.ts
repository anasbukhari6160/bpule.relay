/**
 * Signal Events persistence layer.
 *
 * Stores verified signal changes in a queryable history.
 * Every signal emitted by Signal Watch gets persisted here.
 */

export interface SignalEventRecord {
  id: string
  organizationId: string
  leadId: string
  signalType: string
  severity: 'info' | 'notable' | 'urgent'
  previousValue: string | null
  newValue: string | null
  evidence: string | null
  confidence: number
  source: string
  verified: boolean
  actor: string | null
  organization: string | null
  detectedAt: string
}

/**
 * Persist a signal event. Called from signal-watch route after diffing.
 * Idempotent — same leadId + signalType + detectedAt = no duplicate.
 */
export async function persistSignalEvent(
  supabase: { from: (table: string) => any },
  event: SignalEventRecord,
): Promise<void> {
  const { error } = await supabase
    .from('signal_events')
    .insert({
      id: event.id,
      organization_id: event.organizationId,
      lead_id: event.leadId,
      signal_type: event.signalType,
      severity: event.severity,
      previous_value: event.previousValue,
      new_value: event.newValue,
      evidence: event.evidence,
      confidence: event.confidence,
      source: event.source,
      verified: event.verified,
      actor: event.actor,
      organization: event.organization,
      detected_at: event.detectedAt,
    })

  if (error && error.code !== '23505') {
    // 23505 = unique violation (duplicate) — silently ignore
    console.error('[signal-events] persist failed:', error.message)
  }
}

/**
 * Query signal history for a lead.
 */
export async function getSignalHistory(
  supabase: { from: (table: string) => any },
  leadId: string,
  limit = 20,
): Promise<SignalEventRecord[]> {
  const { data, error } = await supabase
    .from('signal_events')
    .select('*')
    .eq('lead_id', leadId)
    .order('detected_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[signal-events] query failed:', error.message)
    return []
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    organizationId: row.organization_id,
    leadId: row.lead_id,
    signalType: row.signal_type,
    severity: row.severity,
    previousValue: row.previous_value,
    newValue: row.new_value,
    evidence: row.evidence,
    confidence: row.confidence,
    source: row.source,
    verified: row.verified,
    actor: row.actor,
    organization: row.organization,
    detectedAt: row.detected_at,
  }))
}
