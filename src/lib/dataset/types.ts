/**
 * Intelligence Dataset — Training Funnel Types (hardened).
 *
 * intelligence_samples = immutable analysis snapshot.
 * intelligence_sample_events = append-only lifecycle log.
 */

export type Platform = 'linkedin' | 'upwork'

export type FunnelStage =
  | 'RAW_INPUT'
  | 'EXTRACTION'
  | 'VERIFIED_FACTS'
  | 'SCORE'
  | 'ROUTING'
  | 'MESSAGE_GENERATION'
  | 'HUMAN_EDIT'
  | 'SENT'
  | 'CLIENT_REPLY'
  | 'LIFECYCLE_CHANGE'
  | 'OUTCOME'
  | 'HUMAN_FEEDBACK'

export type SampleEventType =
  | 'SCORE_CAPTURED'
  | 'ROUTING_CAPTURED'
  | 'MESSAGE_GENERATED'
  | 'MESSAGE_EDITED'
  | 'MESSAGE_SENT'
  | 'CLIENT_REPLY'
  | 'OUTCOME_CHANGED'
  | 'FEEDBACK_SUBMITTED'
  | 'LABEL_APPROVED'

/**
 * Label states. Only TRAINING_APPROVED is a training label, and only an
 * explicit reviewer action sets it; outcomes and edits never do.
 */
export type LabelStatus =
  | 'UNLABELED'
  | 'AI_ONLY'
  | 'HUMAN_REVIEWED'
  | 'HUMAN_CORRECTED'
  | 'OUTCOME_VERIFIED'
  | 'TRAINING_APPROVED'

export type LabelSource = 'ai' | 'human' | 'outcome' | 'review'

export type FinalOutcome =
  | 'no_reply'
  | 'reply'
  | 'positive_reply'
  | 'negative_reply'
  | 'meeting'
  | 'proposal'
  | 'contract'
  | 'won'
  | 'lost'
  | 'deferred'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface HumanEdit {
  generatedText: string
  editedText: string
  finalSentText: string | null
  editorId: string | null
  timestamp: string
}

export interface HumanFeedback {
  feedbackType: string
  note?: string
  observed?: Record<string, unknown>
  expected?: Record<string, unknown>
  timestamp: string
}

export interface SenderRanking {
  senderId: string
  name: string | null
  profileMatch: number
  reasons: string[]
}

export interface CaptureFailure {
  stage: string
  message: string
  timestamp: string
  sampleId?: string
  leadId?: string
}

export interface SampleEvent {
  id: string
  sampleId: string
  eventType: SampleEventType
  payload: Record<string, unknown>
  actor: string | null
  idempotencyKey: string | null
  createdAt: string
}

export interface IntelligenceSample {
  id: string
  organizationId: string
  leadId: string | null
  upworkJobId: string | null
  decisionRunId: string | null
  platform: Platform
  sourceType?: string
  version: number
  funnelStage: FunnelStage

  rawInput: string | null
  rawInputHash: string | null

  extractedIdentity: Record<string, unknown> | null
  sourceFacts: Record<string, unknown> | null
  rejectedSignals: unknown[]
  evidenceLedger: unknown[]

  modelRawOutput: Record<string, unknown> | null
  resolvedDecision: Record<string, unknown> | null

  canonicalScore: number | null
  displayScore: number | null
  qualification: string | null
  scoreDimensions: unknown[]
  confidence: number | null
  recommendedAction: string | null

  senderRankings: SenderRanking[]
  bestSenderId: string | null
  currentSenderId: string | null

  connectionNote: string | null
  firstDm: string | null
  followupDrafts: string[]
  replyDrafts: string[]
  upworkCoverLetter: string | null
  screeningAnswers: Array<{ question: string; answer: string }>

  humanEditedText: HumanEdit[]
  finalSentText: string | null
  generatedText: string | null
  messageStage: string | null
  senderProfileId: string | null

  clientReplies: string[]
  finalOutcome: string | null

  humanFeedback: HumanFeedback[]

  scoringVersion: string | null
  sourceFactsVersion: string | null
  buyerIntentVersion: string | null
  attributionVersion: string | null
  routingVersion: string | null
  promptVersion: string | null
  modelVersion: string | null

  // Label quality
  labelStatus: LabelStatus
  labelSource: LabelSource | null
  labelerId: string | null
  reviewStatus: ReviewStatus | null
  reviewNotes: string | null
  reviewedAt: string | null
  reviewedBy: string | null

  // Training approval
  trainingEligible: boolean
  trainingApproved: boolean
  approvedBy: string | null
  approvedAt: string | null
  needsReview: boolean

  // Capture health
  captureFailures: CaptureFailure[]
  lastCaptureError: string | null

  createdAt: string
  updatedAt: string
}

export interface CreateSampleInput {
  platform: Platform
  sourceType?: string
  leadId?: string
  upworkJobId?: string
  rawInput?: string
  organizationId: string
  /** Test/E2E/DEMO data is excluded from analytics by default (P0-2). */
  isTest?: boolean
}

export interface DatasetMetrics {
  totalSamples: number
  linkedinSamples: number
  upworkSamples: number
  humanReviewed: number
  humanCorrected: number
  outcomeVerified: number
  trainingEligible: number
  trainingApproved: number
  messagePreferencePairs: number
  buyerExamples: number
  sellerExamples: number
  needsReview: number
  captureFailures: number
}

export type ExportMode = 'FULL_AUDIT' | 'TRAINING' | 'MESSAGE_PREFERENCE' | 'SCORING_EVAL' | 'UPWORK_TRAINING'
export type ExportFormat = 'jsonl' | 'csv' | 'json'
export type PrivacyMode = 'REDACTED' | 'ANONYMIZED'
