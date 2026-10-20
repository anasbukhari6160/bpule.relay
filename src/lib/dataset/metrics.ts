/**
 * Dataset metrics for the admin dataset page.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DatasetMetrics } from './types'

export async function computeDatasetMetrics(
  client: SupabaseClient,
  orgId: string,
): Promise<DatasetMetrics> {
  const { data: rows } = await client
    .from('intelligence_samples')
    .select('platform, label_status, training_eligible, training_approved, qualification, needs_review, capture_failures')
    .eq('organization_id', orgId)

  if (!rows) {
    return {
      totalSamples: 0, linkedinSamples: 0, upworkSamples: 0,
      humanReviewed: 0, humanCorrected: 0, outcomeVerified: 0,
      trainingEligible: 0, trainingApproved: 0, messagePreferencePairs: 0,
      buyerExamples: 0, sellerExamples: 0, needsReview: 0, captureFailures: 0,
    }
  }

  const total = rows.length
  const linkedin = rows.filter(r => r.platform === 'linkedin').length
  const upwork = rows.filter(r => r.platform === 'upwork').length
  const humanReviewed = rows.filter(r => r.label_status === 'HUMAN_REVIEWED').length
  const humanCorrected = rows.filter(r => r.label_status === 'HUMAN_CORRECTED').length
  const outcomeVerified = rows.filter(r => r.label_status === 'OUTCOME_VERIFIED').length
  const trainingEligible = rows.filter(r => r.training_eligible).length
  const trainingApproved = rows.filter(r => r.training_approved).length
  const buyerExamples = rows.filter(r => r.qualification === 'STRONG').length
  const sellerExamples = rows.filter(r => r.qualification === 'SKIP').length
  const needsReview = rows.filter(r => r.needs_review).length

  // Capture failures: count samples with non-empty capture_failures array
  const captureFailures = rows.filter(r =>
    Array.isArray(r.capture_failures) && r.capture_failures.length > 0
  ).length

  // Message preference pairs: count from events table (MESSAGE_EDITED events)
  const { data: editEvents } = await client
    .from('intelligence_sample_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'MESSAGE_EDITED')

  return {
    totalSamples: total,
    linkedinSamples: linkedin,
    upworkSamples: upwork,
    humanReviewed,
    humanCorrected,
    outcomeVerified,
    trainingEligible,
    trainingApproved,
    messagePreferencePairs: editEvents ? (editEvents as unknown as []).length : 0,
    buyerExamples,
    sellerExamples,
    needsReview,
    captureFailures,
  }
}
