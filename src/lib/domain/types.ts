export type RepRole = 'rep' | 'sourcer' | 'admin' | 'manager'

export type OrganizationPlan = 'trial' | 'active' | 'past_due' | 'canceled'

export interface Organization {
  id: string
  name: string
  plan: OrganizationPlan
  billingCustomerId: string | null
  timezone: string
  workingDays: number[]
  holidays: Array<{ date: string; label?: string }>
  createdAt: string
}

export interface SignalDefinition {
  id: number
  name: string
  weight: number
  short: string
  description: string
  example: string
}

export interface VerdictThresholds {
  send: { min: number; max: number }
  research_more: { min: number; max: number }
  skip: { min: number; max: number }
}

export interface OrganizationRulebook {
  organizationId: string
  signals: SignalDefinition[]
  verdictThresholds: VerdictThresholds
  maxSignalWeight: number
  maxCompleteness: number
  confidenceSendThreshold: number
}

export interface Rep {
  id: string
  name: string
  role: RepRole
  organizationId: string
  createdAt: string
  timezone: string
}

export type SignalId = number

export type Verdict = 'send' | 'research_more' | 'skip'

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'followed_up'
  | 'replied'
  | 'won'
  | 'lost'
  | 'no'
  | 'dead'

export type LeadDirection = 'inbound' | 'outbound'
export type LeadSource = 'linkedin' | 'upwork' | 'email' | 'referral' | 'other'

export interface Lead {
  id: string
  organizationId: string
  ownerRepId: string | null
  company: string
  companyKey: string
  contactName: string | null
  contactTitle: string | null
  titleRaw?: string | null
  locationRaw?: string | null
  url: string | null
  rawInput: string | null
  roleCategory?: RoleCategory | null
  marketRegion?: MarketRegion | null
  extractionConfidence?: number | null
  extractionProfile?: Record<string, unknown> | null
  signalType: SignalId | null
  signalEvidence: string | null
  verbatimQuote: string | null
  score: number | null
  verdict: Verdict | null
  status: LeadStatus
  playId: string | null
  tags: string[]
  direction?: LeadDirection
  source?: LeadSource | null
  inboundMessage?: string | null
  inboundRaw?: Record<string, unknown> | null
  senderProfileId?: string | null
  revenueIdentityId?: string | null
  canonicalScore?: number | null
  scoreVersion?: string | null
  scoredAt?: string | null
  canonicalIntelligence?: Record<string, unknown> | null
  /**
   * canonicalIntelligence.qualification / .intelligenceVersion, loaded even
   * on list queries (which skip the full blob) so every surface can apply
   * the same display-score policy.
   */
  displayQualification?: string | null
  displayIntelligenceVersion?: string | null
  /** V3 buyer-intent evidence persisted with the lead for deal-panel display. */
  buyerIntent?: Record<string, unknown> | null
  /** Qualification band (STRONG/WORTH_PURSUING/MAYBE/LOW/SKIP) from the analysis. */
  qualification?: string | null
  rawSourceData?: Record<string, unknown> | null
  scoreBreakdown?: Record<string, unknown> | null
  remoteEligibility?: Record<string, unknown> | null
  evidenceLedger?: Record<string, unknown> | null
  extractionCompleteness?: Record<string, unknown> | null
  decisionProvider?: string | null
  decisionModel?: string | null
  decisionRunId?: string | null
  selectedEpisodeId?: string | null
  profileMatchScore?: number | null
  profileMatchVersion?: string | null
  bestProfileId?: string | null
  bestProfileMatchScore?: number | null
  intelligenceInputHash?: string | null
  v3ReuseKey?: string | null
  fallbackReason?: string | null
  referredByRepId?: string | null
  referredToRepId?: string | null
  referredByProfileId?: string | null
  referralReason?: string | null
  referralAt?: string | null
  /** Set by explicit rep action once the LinkedIn connection request is observed accepted. Null means not accepted / not applicable. Never inferred. */
  connectionAcceptedAt?: string | null
  /** Set when a connection note is sent on a good-profile lead. Lead is locked from further outreach until this timestamp. Null = unlocked. */
  lockedUntil?: string | null
  /** Why the lead was locked. Currently only 'connection_note_sent'. */
  lockedReason?: string | null
  /**
   * Soft-archive flag (housekeeping sweep, never a hard delete). true = not
   * shown on the default leads board, but still findable via /archive
   * search. Optional only for backward compatibility with existing object
   * literals built before this field existed (tests, mock fixtures) —
   * real construction sites (mapLead, mock-store demo leads) always set a
   * concrete value.
   */
  archived?: boolean
  /** When this lead was archived; cleared back to null on auto-restore-on-reply. */
  archivedAt?: string | null
  createdAt: string
}

export type MessageType = 'dm' | 'connection' | 'upwork' | 'email' | 'followup' | 'reply'

export interface Message {
  id: string
  organizationId: string
  leadId: string
  repId: string | null
  type: MessageType
  draftText: string | null
  sentText: string | null
  sentAt: string | null
  modelUsed: string | null
  originalDraft?: string | null
  sendDisposition?: SendDisposition | null
  rejectReasons?: SendFeedbackReason[]
  /** Idempotency key for a real send (sent_text populated). Never set on draft-only rows. */
  idempotencyKey?: string | null
  /** 'outbound' = rep sent; 'inbound' = prospect replied. Default outbound for legacy rows. */
  direction?: 'inbound' | 'outbound'
  createdAt: string
}

export type OutcomeStage =
  | 'replied'
  | 'read'
  | 'check'
  | 'slice'
  | 'close'
  | 'standing'

export interface Outcome {
  id: string
  organizationId: string
  leadId: string
  stage: OutcomeStage
  occurredAt: string
}

export type UpworkJobVerdict = 'apply' | 'apply_if_connects' | 'skip'

export type UpworkJobStatus =
  | 'new'
  | 'drafted'
  | 'applied'
  | 'shortlisted'
  | 'interviewing'
  | 'offer_sent'
  | 'awarded'
  | 'rejected'
  | 'replied'
  | 'no'
  | 'dead'

export interface UpworkJob {
  id: string
  organizationId: string
  ownerRepId: string | null
  title: string
  description: string
  budgetMin: number | null
  budgetMax: number | null
  hourlyRateMin: number | null
  hourlyRateMax: number | null
  proposalCount: number | null
  connectsCost: number
  connectsUsed?: number
  requiredSkills: string[]
  urgencySignal: string | null
  score: number | null
  verdict: UpworkJobVerdict | null
  /** Canonical 0-100 job score (upwork_score_v1); `score` is its /10 projection. */
  canonicalScore?: number | null
  scoreVersion?: string | null
  scoreBreakdown?: unknown
  jobFacts?: unknown
  profileMatch?: unknown
  status: UpworkJobStatus
  extractedFields: Record<string, unknown> | null
  rawInput: string | null
  tags: string[]
  screeningQuestions: string[]
  applicationRequirements: string[]
  engagementType: string | null
  weeklyHours: string | null
  duration: string | null
  experienceLevel: string | null
  createdAt: string
  postedAt?: string | null
  remoteStatus?: string | null
  clientName?: string | null
  clientEmail?: string | null
  messages?: UpworkMessage[]
  followupCount?: number
  notes?: string | null
}

export interface UpworkMessage {
  id: string
  organizationId: string
  jobId: string
  repId: string | null
  type: 'cover' | 'followup' | 'reply'
  draftText: string | null
  sentText: string | null
  sentAt: string | null
  modelUsed: string | null
  createdAt: string
}

export interface PushSubscription {
  id: string
  organizationId: string
  repId: string
  endpoint: string
  p256dh: string
  auth: string
  createdAt: string
}

export interface NotificationLogEntry {
  id: string
  organizationId: string
  repId: string
  type: 'reply' | 'followup_eligible'
  payload: Record<string, unknown>
  read: boolean
  createdAt: string
}

export interface CsvImport {
  id: string
  organizationId: string
  repId: string
  fileName: string | null
  totalRows: number
  imported: number
  duplicates: number
  invalid: number
  details: unknown
  createdAt: string
}

export type StyleSampleSource = 'quiz' | 'pasted_samples' | 'both'

export interface StyleCard {
  contractions: 'mostly_no' | 'sometimes' | 'mostly_yes'
  formality: 1 | 2 | 3 | 4 | 5
  sentence_length: 'short' | 'medium' | 'long'
  punctuation: 'relaxed' | 'standard' | 'heavy'
  openers: 'question' | 'statement'
  emoji_use: 'none' | 'light'
  greeting: string
  sign_off: string
  never_words: string[]
  preferred_words: string[]
  summary: string
}

export interface VoiceProfile {
  id: string
  repId: string
  organizationId: string
  profileId?: string | null
  styleCard: StyleCard
  sampleSource: StyleSampleSource
  calibratedAt: string
}

export interface Fact {
  id: string
  organizationId: string
  label: string
  value: string
  factType: string | null
  addedBy: string | null
  createdAt: string
}

export interface Profile {
  id: string
  repId: string
  organizationId: string
  platform: 'linkedin' | 'upwork'
  label: string | null
  profileUrl: string | null
  headline: string | null
  cvPath: string | null
  createdAt: string
  fullName?: string | null
  displayName?: string | null
  currentRole?: string | null
  company?: string | null
  location?: string | null
  bio?: string | null
  professionalSummary?: string | null
  seniority?: string | null
  yearsExperience?: number | null
  primarySkills?: string[]
  secondarySkills?: string[]
  technologies?: string[]
  industries?: string[]
  serviceCapabilities?: string[]
  specialties?: string[]
  positioning?: string | null
  differentiators?: string[]
  languages?: string[]
  profileConfidence?: number | null
  readiness?: string
  aiContext?: Record<string, unknown>
  archivedAt?: string | null
  sourceCount?: number
  proofCount?: number
}

export interface ProofItem {
  id: string
  organizationId: string
  profileId: string
  clientNamed: boolean
  clientName: string | null
  permissionOnFile: boolean
  projectSummary: string
  reviewQuote: string | null
  tags: string[]
  createdAt: string
}

export interface Play {
  id: string
  organizationId: string
  name: string
  situation: string
  templateShape: string
}

export interface ScoreBreakdownItem {
  category: string
  label: string
  points: number
  max: number
  note: string
  /** Set when the row's claim was checked against the original research. */
  verification?: 'VERIFIED' | 'UNSUPPORTED' | 'UNVERIFIABLE'
  /** The source line that supports the row, when verified. */
  sourceQuote?: string | null
}

export interface ScoreResult {
  total: number
  verdict: Verdict
  baseVerdict?: Verdict
  breakdown: ScoreBreakdownItem[]
  gates?: string[]
}

export type RoleCategory =
  | 'founder_cofounder'
  | 'ceo'
  | 'technical_leadership'
  | 'product'
  | 'hiring_manager_recruiter'
  | 'other'

export type MarketRegion = 'US' | 'UK' | 'EU' | 'CA' | 'AU' | 'UAE' | 'SG' | 'outside_core' | 'unknown'

export interface RecentPostExtract {
  paraphrase: string
  verbatimQuote: string | null
}

export interface ExtractedLead {
  name: string | null
  title: string | null
  titleRaw?: string | null
  company: string
  url: string | null
  locationRaw?: string | null
  aboutSummary?: string | null
  experienceSummary?: string | null
  recentPosts?: RecentPostExtract[]
  roleCategory?: RoleCategory
  marketRegion?: MarketRegion
  signalType: SignalId
  signalEvidence: string
  extractionConfidence?: number
  confidenceNotes?: string[]
  verbatimQuote: string | null
  /** Stack/domain tags for proof matching; produced once at extraction time. */
  tags: string[]
}


export type ContentPlatform = 'linkedin' | 'x' | 'instagram'

export interface ContentSource {
  type: 'linkedin' | 'resume' | 'website' | 'portfolio' | 'bio' | 'previous_posts' | 'manual'
  label: string
  content: string
  parsedAt: string
  provenance: 'user_confirmed' | 'imported' | 'ai_inference'
}

export interface VoiceSample {
  label: string
  text: string
  style: string
}

export interface ContentJourneyEntry {
  id: string
  organizationId: string
  personaId: string
  eventType: 'joined' | 'shipped' | 'learned' | 'posted' | 'milestone' | 'project' | 'role_change' | 'other'
  title: string
  description: string
  eventDate: string | null
  source: 'user_entry' | 'imported' | 'ai_inferred' | 'confirmed'
  createdAt: string
}

export interface QuickCaptureAngle {
  angle: string
  type: 'technical_lesson' | 'story' | 'opinion' | 'observation' | 'how_to'
  title: string
}

export interface ContentQuickCapture {
  id: string
  organizationId: string
  personaId: string
  rawInput: string
  suggestedAngles: QuickCaptureAngle[]
  status: 'pending' | 'used' | 'dismissed'
  createdAt: string
}

export interface ContentIdeaCard {
  id: string
  title: string
  angle: string
  whyYou: string
  whyAudience: string
  sourceKind: 'expertise' | 'journey' | 'opinion' | 'trend' | 'project' | 'audience_gap' | 'evergreen'
  territory: string
  confidence: number
  territoryColor?: string
}

export type ContentDraftStatus = 'draft' | 'ready' | 'posted' | 'rejected'

export interface ContentPersona {
  id: string
  repId: string
  organizationId: string
  displayName: string
  platforms: ContentPlatform[]
  voiceProfileId: string | null
  humorStyle: string
  valuesAndOpinions: string[]
  admiredExamples: string[]
  contentProfileId: string | null
  personaRole?: string
  personaCompany?: string
  personaLocation?: string
  contentComfort?: string[]
  onboardingStep?: string
  onboardingCompleted?: boolean
  onboardingData?: Record<string, unknown>
  trendInterestProfile?: TrendInterestProfile
  lastBriefAt?: string
  createdAt: string
}

export interface ContentProfileExpertise {
  area: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  evidence: string
  updatedAt: string
}

export interface ContentProfileTechnology {
  name: string
  proficiency: 'learning' | 'using' | 'proficient' | 'expert'
  context: string
}

export interface ContentProfileGoal {
  description: string
  type: 'audience' | 'growth' | 'authority' | 'sales' | 'career' | 'other'
  updatedAt: string
}

export interface ContentProfileTopic {
  topic: string
  intensity: 'casual' | 'interested' | 'passionate'
  source: 'onboarding' | 'answer' | 'inference' | 'research'
}

export interface ContentProfileOpinion {
  belief: string
  strength: 'mild' | 'moderate' | 'strong'
  evidence: string
  source: 'onboarding' | 'answer' | 'inference'
  updatedAt: string
}

export interface ContentProfileProject {
  name: string
  description: string
  role: string
  outcome: string
  lessons: string[]
  updatedAt: string
}

export interface ContentProfileExperience {
  type: 'project' | 'mistake' | 'success' | 'decision' | 'lesson' | 'career'
  description: string
  lesson: string
  date: string | null
  updatedAt: string
}

export interface ContentProfileWritingCharacteristics {
  sentenceRhythm?: string
  vocabularyLevel?: string
  preferredLength?: string
  questionFrequency?: 'rare' | 'occasional' | 'frequent'
  dataUsage?: 'none' | 'light' | 'heavy'
  storyPreference?: 'abstract' | 'concrete' | 'mixed'
}

export interface ContentProfileStorytellingTendency {
  pattern: string
  frequency: 'rare' | 'occasional' | 'common'
  example: string
}

export interface ContentProfile {
  id: string
  organizationId: string
  personaId: string
  role: string
  seniority: string
  industries: string[]
  audience: string
  expertise: ContentProfileExpertise[]
  technologies: ContentProfileTechnology[]
  goals: ContentProfileGoal[]
  topicsCared: ContentProfileTopic[]
  topicsAvoided: ContentProfileTopic[]
  opinions: ContentProfileOpinion[]
  projects: ContentProfileProject[]
  experiences: ContentProfileExperience[]
  writingCharacteristics: ContentProfileWritingCharacteristics
  storytellingTendencies: ContentProfileStorytellingTendency[]
  confidence: number
  lastLearnedAt: string | null
  sources?: ContentSource[]
  audiences?: string[]
  territories?: string[]
  voiceSamples?: VoiceSample[]
  voiceSelection?: string
  contentGoals?: string[]
  createdAt: string
  updatedAt: string
}

export interface ContentPillar {
  id: string
  organizationId: string
  personaId: string
  pillarName: string
  description: string
  createdAt: string
}

export interface TopicCluster {
  id: string
  organizationId: string
  personaId: string
  clusterName: string
  description: string
  sourceType: 'profile' | 'answer' | 'research' | 'system'
  mergedIntoId: string | null
  lastInputAt: string | null
  lastResearchAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ContentResearchFinding {
  id: string
  organizationId: string
  personaId: string
  topicClusterId: string
  finding: string
  sourceLabel: string
  sourceUrl: string
  sourcePublishedAt: string | null
  createdAt: string
  used: boolean
}

export type ContentDraftReaction = 'posting' | 'not_for_me' | 'posting_after_edit'

export interface ContentDraftFeedback {
  id: string
  organizationId: string
  personaId: string
  draftId: string
  topicClusterId: string | null
  sourceKind: 'answer' | 'conviction' | 'field_update' | 'idea'
  reaction: ContentDraftReaction
  edited: boolean
  editSignals: string[]
  createdAt: string
}

export interface ContentDraft {
  id: string
  organizationId: string
  personaId: string
  pillarId: string | null
  topicClusterId: string | null
  researchFindingId: string | null
  structureId: string | null
  sourceKind: 'answer' | 'conviction' | 'field_update' | 'idea'
  sourceMaterial: string
  platform: ContentPlatform
  caption: string
  hookScore: number | null
  hookFeedback: string
  selfCheckPassed: boolean
  selfCheckNote: string
  specificityHit: boolean
  status: ContentDraftStatus
  createdAt: string
  updatedAt?: string
}

/** A real, logged performance snapshot — always optional, always manual entry. */
export interface ContentPostMetrics {
  likes: number | null
  reach: number | null
  comments: number | null
  reposts: number | null
  saves: number | null
  profileVisits: number | null
  followerDelta: number | null
  metricsLoggedAt: string | null
}

export interface ContentHistoryEntry extends ContentPostMetrics {
  id: string
  organizationId: string
  personaId: string
  pillarId: string | null
  topicClusterId: string | null
  platform: ContentPlatform
  openingLine: string
  postedAt: string
  ledToRealOutcome: boolean
  outcomeNotedAt: string | null
}

export type PostStructureCategory = 'contrarian_opener' | 'story_opener' | 'question_opener' | 'data_point_opener'

/** A curated, observed post shape used as generation scaffolding — never a performance promise. */
export interface ContentPostStructure {
  id: string
  category: PostStructureCategory
  structureName: string
  shape: string
  example: string
  createdAt: string
}

export interface TrendingAngle {
  id: string
  organizationId: string
  pillarId: string
  topicClusterId: string | null
  angleDescription: string
  sourceNote: string
  sourceUrl: string
  addedBy: string | null
  addedAt: string
  used: boolean
}


export type ContentMemoryType =
  | 'topic_covered' | 'angle_used' | 'hook_used' | 'story_used'
  | 'claim_made' | 'opinion_expressed' | 'example_used' | 'archetype_used'

export interface ContentMemory {
  id: string
  organizationId: string
  personaId: string
  memoryType: ContentMemoryType
  content: string
  sourceDraftId: string | null
  sourceHistoryId: string | null
  createdAt: string
  embedding?: number[] | null
  contentFingerprint?: string | null
}

export type ContentOpportunityType =
  | 'recent_work' | 'production_lesson' | 'mistake_or_failure'
  | 'technical_decision' | 'changed_opinion' | 'useful_explanation'
  | 'industry_development' | 'contrarian_position' | 'behind_the_build'
  | 'customer_lesson' | 'career_lesson' | 'experiment' | 'unexpected_result'
  | 'timely_discussion'

export interface ContentOpportunityQualification {
  novelty?: number
  evidenceStrength?: number
  personalSpecificity?: number
  relevance?: number
  audienceFit?: number
  scrollStopPotential?: number
}

export interface ContentOpportunity {
  id: string
  organizationId: string
  personaId: string
  opportunityType: ContentOpportunityType
  title: string
  description: string
  trigger: string
  qualification: ContentOpportunityQualification
  qualified: boolean
  sourceKind: 'user_input' | 'interview' | 'research' | 'system_inferred' | 'history_pattern' | null
  sourceReference: string | null
  status: 'pending' | 'exploring' | 'interviewing' | 'qualifying' | 'in_forge' | 'completed' | 'dismissed'
  createdAt: string
  dismissedAt: string | null
  completedAt: string | null
}

export type IdeaGenomeSource =
  | 'personal_experience' | 'professional_expertise' | 'opinion'
  | 'industry_observation' | 'contrarian_take' | 'lesson_learned'
  | 'behind_the_build' | 'customer_insight' | 'experiment_result'

export type IdeaGenomeArchetype =
  | 'story_to_lesson' | 'lesson_direct' | 'contrarian_stand'
  | 'how_to' | 'behind_the_scenes' | 'hot_take' | 'data_driven'
  | 'question_engagement' | 'mistake_to_wins' | 'career_lesson'

export interface ContentIdeaGenome {
  id: string
  organizationId: string
  personaId: string
  source: IdeaGenomeSource
  topic: string
  angle: string
  archetype: IdeaGenomeArchetype
  audience: string
  emotion: string | null
  value_type: 'practical' | 'emotional' | 'intellectual' | 'social' | null
  novelty: number
  evidenceStrength: number
  personalSpecificity: number
  relevance: number
  conversationPotential: number
  contentMemoryOverlap: string[]
  differentiationNote: string
  status: 'candidate' | 'qualified' | 'rejected' | 'in_forge' | 'published' | 'archived'
  rejectionReason: string | null
  opportunityId: string | null
  draftId: string | null
  createdAt: string
  updatedAt: string
}

export interface ContentEvaluation {
  id: string
  draftId: string
  originality: number
  personalSpecificity: number
  usefulness: number
  credibility: number
  evidence: number
  clarity: number
  storytelling: number
  voiceMatch: number
  stopPotential: number
  dwellPotential: number
  commentPotential: number
  savePotential: number
  sharePotential: number
  audienceRelevance: number
  slopScore: number
  genericProbability: number
  qualityNotes: Record<string, string>
  distributionNotes: Record<string, string>
  createdAt: string
}

export interface ContentInterviewSession {
  id: string
  organizationId: string
  personaId: string
  opportunityId: string | null
  sessionType: 'onboarding' | 'opportunity_exploration' | 'post_qualification'
  status: 'active' | 'completed' | 'abandoned'
  questionsAsked: number
  informationGain: number
  createdAt: string
  completedAt: string | null
}

export interface ContentInterviewAnswer {
  id: string
  sessionId: string
  question: string
  answer: string
  informationGain: number
  createdAt: string
}


export interface ProfileAssignment {
  id: string
  repId: string
  profileId: string
  createdAt: string
}

export interface ProofCard {
  id: string
  organizationId: string
  profileId: string
  capability: string
  strength: 'strong' | 'moderate' | 'weak'
  safeClaim: string
  sourceType: 'cv' | 'project' | 'portfolio' | 'case_study' | 'certification' | 'client_work' | 'approved_fact'
  sourceReference: string | null
  tags: string[]
  verified: boolean
  forbiddenClaims: string[]
  createdAt: string
  updatedAt: string
}

export type ConversationStage =
  | 'new'
  | 'contacted'
  | 'replied'
  | 'qualifying'
  | 'interested'
  | 'meeting'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost'

export interface ConversationState {
  id: string
  organizationId: string
  leadId: string
  stage: ConversationStage
  lastSentAt: string | null
  lastSentMessageId: string | null
  lastReplyAt: string | null
  senderProfileId: string | null
  lastStrategy: string | null
  lastAngle: string | null
  lastCta: string | null
  followupCount: number
  nextFollowupAt: string | null
  wonAt: string | null
  lostAt: string | null
  lostReason: string | null
  commercialState?: Record<string, unknown> | null
  /** Rolling conversation memory (summary + deal facts). */
  memory?: import('@/lib/conversation/types').ConversationMemory | null
  /** The rep's current unsent draft for this lead. */
  composerDraft?: import('@/lib/conversation/types').ComposerDraft | null
  createdAt: string
  updatedAt: string
}

export type SalesMemoryType =
  | 'angle_used'
  | 'proof_used'
  | 'cta_used'
  | 'objection_seen'
  | 'won_reason'
  | 'lost_reason'
  | 'edit_pattern'
  | 'channel_preference'
  | 'industry_fit'
  | 'lead_type_fit'

export interface SalesMemory {
  id: string
  organizationId: string
  memoryType: SalesMemoryType
  content: string
  leadId: string | null
  profileId: string | null
  industry: string | null
  leadType: string | null
  channel: string | null
  stage: string | null
  outcome: 'positive' | 'negative' | 'neutral' | null
  occurrenceCount: number
  createdAt: string
  updatedAt: string
}

export interface EditLearning {
  id: string
  organizationId: string
  repId: string
  messageId: string | null
  originalText: string
  editedText: string
  editDistance: number | null
  lengthDelta: number | null
  greetingChanged: boolean
  ctaChanged: boolean
  proofRemoved: boolean
  madeShorter: boolean
  madeLonger: boolean
  formalityShift: 'more_formal' | 'less_formal' | 'same' | null
  sendDisposition?: SendDisposition | null
  rejectReasons?: SendFeedbackReason[]
  createdAt: string
}

// Fact safety classification
export type FactSafety = 'VERIFIED_PUBLIC' | 'INFERRED' | 'WEAK_SIGNAL' | 'UNVERIFIED'

export type ClaimSafety = 'VERIFIED_PROFILE_PROOF' | 'APPROVED_CLAIM' | 'INFERRED' | 'UNSUPPORTED'

export interface SafeFact {
  fact: string
  safety: FactSafety
  source: string
  safeToMention: boolean
}

export interface MatchedProof {
  proofCard: ProofCard
  relevanceScore: number
  matchingTags: string[]
  safeClaim: string
}

// Outreach strategy
export type MessageMode =
  | 'observation_opener'
  | 'relevant_question'
  | 'useful_insight'
  | 'proof_led'
  | 'problem_recognition'
  | 'offer_small_win'
  | 'founder_to_founder'
  | 'technical_peer'
  | 'warm_conversational'
  | 'direct_opportunity'
  | 'referral_context'
  | 'followup'
  | 'reply'

export interface OutreachStrategy {
  leadContext: string
  safeTrigger: string
  probableNeed: string
  sender: string
  relevantProof: string[]
  messageGoal: string
  relationshipStage: string
  channel: string
  tone: string
  risk: string
  ctaStrategy: string
  mode: MessageMode
  /** Optional revenue-loop fields. Older callers may omit them. */
  assessment?: {
    fit: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
    intent: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
    confidence: 'HIGH' | 'MEDIUM' | 'LOW'
    fitWhy: string
    intentWhy: string
    confidenceWhy: string
  }
  contact?: {
    reason: import('@/lib/relay/revenue-strategy').ContactReason
    action: import('@/lib/relay/revenue-strategy').ContactAction
    why: string
    messageRecommended: boolean
    noMessageReason: string | null
  }
  messageJob?: string | null
  allowedNow?: string[]
  hold?: string[]
  neverClaim?: string[]
  wordBudget?: { min: number; max: number; label: string }
  uiRationale?: string
}

export type SendDisposition = 'SENT_UNCHANGED' | 'LIGHT_EDIT' | 'HEAVY_EDIT' | 'REJECTED'

export type SendFeedbackReason =
  | 'TOO_LONG'
  | 'GENERIC'
  | 'FAKE_PERSONALIZATION'
  | 'UNSUPPORTED'
  | 'TOO_SALESY'
  | 'WRONG_OBJECTIVE'
  | 'BAD_CTA'
  | 'UNNATURAL'
  | 'WRONG_PROOF'
  | 'WRONG_TIMING'


export type RelayTaskKind =
  | 'reply_needed'
  | 'connection_dm_due'
  | 'followup_due'
  | 'high_fit_lead'
  | 'new_opportunity'
  | 'job_worth_apply'
  | 'proposal_ready'
  | 'lead_going_cold'
  | 'content_opportunity'
  | 'admin_review'
  | 'inbound_opportunity'

export type RelayTaskPriority = 'urgent' | 'high' | 'medium' | 'low'

export interface RelayEvidence {
  source: string
  detail: string
  timestamp: string | null
  verified: boolean
}

export interface RelayRecommendation {
  action: string
  preparedOutput: string | null
  evidence: RelayEvidence[]
  confidence: number
  forbidsImpersonation: boolean
}

export interface RelayTask {
  id: string
  kind: RelayTaskKind
  priority: RelayTaskPriority
  priorityScore: number
  title: string
  subtitle: string
  entityType: 'lead' | 'job' | 'content' | 'admin'
  entityId: string
  whatHappened: string
  whyItMatters: string
  recommendation: RelayRecommendation
  humanAction: string
  stale: boolean
  stalenessNote: string | null
  createdAt: string
}

export type RelayRole = 'admin' | 'bd'

export interface RelayRoleContext {
  role: RelayRole
  rep: Rep
  organization: Organization
}

export interface RelayQueue {
  tasks: RelayTask[]
  roleContext: RelayRoleContext
  generatedAt: string
  stale: boolean
  summary: {
    total: number
    urgent: number
    byKind: Record<RelayTaskKind, number>
  }
}


export interface InboundInput {
  message: string
  source: LeadSource
  company?: string | null
  contactName?: string | null
  contactTitle?: string | null
  url?: string | null
  profileInfo?: string | null
  jobInfo?: string | null
  context?: string | null
}

export interface InboundIntelligence {
  wants: string
  intent: string
  fitScore: number
  fitRelevance: string
  opportunityQuality: 'high' | 'medium' | 'low'
  recommendedIdentity: Profile | null
  identityFitReason: string
  matchingSkills: string[]
  strongestProof: ProofItem[]
  missingInfo: string[]
  recommendedAction: string
  canGenerateResume: boolean
}

export interface InboundLeadInput {
  company: string
  contactName?: string | null
  contactTitle?: string | null
  url?: string | null
  message: string
  source: LeadSource
  direction: 'inbound'
  profileInfo?: string | null
  jobInfo?: string | null
  context?: string | null
  assignedProfileId?: string | null
}


export type RevenueIdentityChannel = 'linkedin' | 'email' | 'upwork' | 'other'
export type RevenueIdentityStatus = 'active' | 'archived'

export interface RevenueIdentity {
  id: string
  organizationId: string
  slug: string
  identityName: string
  title: string | null
  positioning: string | null
  profileUrl: string | null
  skills: string[]
  expertise: string[]
  industries: string[]
  technologies: string[]
  allowedFirstPersonClaims: string[]
  forbiddenClaims: string[]
  channelRules: Record<string, unknown>
  voiceTone: Record<string, unknown>
  preferredOpportunityTypes: string[]
  proposalPositioning: string | null
  profileId: string | null
  channel: RevenueIdentityChannel
  status: RevenueIdentityStatus
  sourceKind: string
  createdAt: string
  updatedAt: string
}

export interface IdentityAssignment {
  id: string
  organizationId: string
  revenueIdentityId: string
  repId: string
  assignedBy: string | null
  createdAt: string
}

export interface RevenueIdentityWithAssignment extends RevenueIdentity {
  assignmentId: string
  assignedBy: string | null
  assignedAt: string
}

export type ActivityType = 'dm' | 'email' | 'connection_request' | 'followup' | 'application' | 'proposal' | 'prospect_extracted' | 'other'

export type ContactPointType = 'email' | 'linkedin' | 'contact_form' | 'phone' | 'other'
export type ContactPointSource =
  | 'USER_PROVIDED'
  | 'PUBLIC_PROFILE'
  | 'COMPANY_WEBSITE'
  | 'PUBLIC_DIRECTORY'
  | 'CONNECTED_PROVIDER'
  | 'INBOUND'
  | 'INFERRED_PATTERN'
export type ContactPointVerificationStatus = 'VERIFIED' | 'LIKELY_VALID' | 'UNVERIFIED' | 'INVALID' | 'BOUNCED' | 'UNKNOWN'

export interface ContactPoint {
  id: string
  organizationId: string
  leadId: string | null
  personId: string | null
  companyId: string | null
  type: ContactPointType
  value: string
  source: ContactPointSource
  sourceUrl: string | null
  sourceType: string | null
  verificationStatus: ContactPointVerificationStatus
  verificationMethod: string | null
  confidence: number | null
  isPrimary: boolean
  isBusinessContact: boolean
  discoveredAt: string
  verifiedAt: string | null
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export type RightToContactReason =
  | 'NONE'
  | 'HIRING'
  | 'ACTIVE_NEED'
  | 'PROJECT_SIGNAL'
  | 'OUTSOURCING_SIGNAL'
  | 'STRONG_FIT'
  | 'RELATIONSHIP'

export type ClaimEvidenceType =
  | 'VERIFIED_SENDER_FACT'
  | 'VERIFIED_PROOF'
  | 'VERIFIED_LEAD_FACT'
  | 'VERIFIED_OPPORTUNITY_FACT'
  | 'USER_APPROVED_FACT'

export interface EmailClaimIssue {
  sentence: string
  reason: string
  requiredEvidence: ClaimEvidenceType[]
}

export interface EmailClaimSafetyResult {
  safe: boolean
  repaired: boolean
  allowedEvidence: string[]
  thingsNotToClaim: string[]
  issues: EmailClaimIssue[]
  repairedBody: string | null
}

export interface ResearchBrief {
  person: string | null
  currentRole: string | null
  company: string
  companyOffering: string | null
  companyStage: string | null
  currentSignals: string[]
  currentOpportunity: string | null
  relationshipType: string
  fit: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  intent: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  rightToContact: RightToContactReason
  recentRelevantEvidence: string[]
  possibleNeed: string | null
  known: string[]
  inferred: string[]
  unknown: string[]
  thingsNotToClaim: string[]
  contactRoute: 'BUSINESS_EMAIL' | 'NO_EMAIL'
  sourceReferences: Array<{
    label: string
    url: string | null | undefined
    sourceType: string | null | undefined
  }>
}

export type EmailGoal = 'GET_REPLY' | 'BOOK_CALL' | 'RECONNECT' | 'QUALIFY_NEED'

export type OutreachArtifactType =
  | 'CV'
  | 'RESUME'
  | 'PORTFOLIO'
  | 'CASE_STUDY'
  | 'PROJECT'
  | 'CAPABILITY_DECK'
  | 'PROPOSAL'
  | 'OTHER'

export interface OutreachArtifact {
  id: string
  organizationId: string
  revenueIdentityId: string
  profileId: string | null
  artifactType: OutreachArtifactType
  name: string
  description: string | null
  sourceUrl: string | null
  tags: string[]
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface EmailStrategy {
  relationshipType: string
  opportunityType: RightToContactReason
  recipient: string
  sender: string
  commercialSituation: string
  strongestEvidence: string | null
  primaryUncertainty: string | null
  whyEmail: string
  emailGoal: EmailGoal
  tone: string
  allowedEvidence: string[]
  proofToUse: string[]
  proofToHold: string[]
  attachmentRecommendation: {
    relevance: 'RELEVANT' | 'OPTIONAL' | 'IRRELEVANT'
    artifactId: string | null
    artifactName: string | null
    reason: string
  }
  thingsNotToClaim: string[]
  ctaType: string
  successCondition: string
}

export interface PreparedEmailDraft {
  id: string
  organizationId: string
  leadId: string
  revenueIdentityId: string
  contactPointId: string | null
  contactEmail: string | null
  /**
   * CAN_PREPARE_EMAIL vs CAN_SEND_EMAIL are separate concerns (Relay
   * hardening sprint — see prepareEmailDraft/sendPreparedEmail in
   * src/lib/email/service.ts). Preparing (subject/body/strategy) only
   * requires a legitimate reason to reach out — it does NOT require a
   * verified recipient. Sending requires a verified/likely-valid contact
   * on top of that.
   *
   * - READY: content generated AND recipient is verified/likely-valid — send-eligible.
   * - NEEDS_VERIFIED_CONTACT: content generated (subject/body/strategy all
   *   present), but no verified/likely-valid recipient exists yet (no
   *   contact at all, or only an unverified/inferred one). NOT send-eligible.
   *   The UI must show the generated draft with a "Recipient not verified"
   *   notice and a path to discover/verify/add a contact — never silently
   *   hide the draft.
   * - CONTACT_NOT_FOUND: retained for backward compatibility with historical
   *   rows written before this distinction existed. New drafts should never
   *   be written with this status — use NEEDS_VERIFIED_CONTACT instead,
   *   which still has content.
   * - RESEARCH_REQUIRED: no legitimate reason to email yet (rightToContact
   *   is NONE) — this is a content-strategy gate, unrelated to contact
   *   verification, and correctly has no subject/body.
   */
  draftStatus: 'DRAFT' | 'RESEARCH_REQUIRED' | 'CONTACT_NOT_FOUND' | 'NEEDS_VERIFIED_CONTACT' | 'SKIP' | 'READY' | 'SENT' | 'FAILED'
  relationshipType: string | null
  opportunityType: string | null
  emailGoal: EmailGoal | null
  subject: string | null
  subjectCandidates: string[]
  body: string | null
  strategy: EmailStrategy | null
  researchBrief: ResearchBrief | null
  claimSafety: EmailClaimSafetyResult | null
  editDisposition: 'UNCHANGED' | 'LIGHT_EDIT' | 'HEAVY_EDIT' | 'REJECTED' | null
  isFollowup: boolean
  followupSequence: number
  evidenceUsed: string[]
  blockedReason: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface EmailMessageMeta {
  id: string
  organizationId: string
  leadId: string
  messageId: string | null
  preparedDraftId: string | null
  revenueIdentityId: string
  mailboxId: string
  contactPointId: string | null
  direction: 'OUTBOUND' | 'INBOUND'
  category: 'FIRST_EMAIL' | 'FOLLOW_UP' | 'REPLY'
  idempotencyKey: string
  subject: string
  body: string
  provider: string
  providerMessageId: string | null
  providerThreadId: string | null
  deliveryStatus: 'DRAFT' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'FAILED' | 'REPLIED' | 'SUPPRESSED'
  sentAt: string | null
  deliveredAt: string | null
  bouncedAt: string | null
  repliedAt: string | null
  lastEventAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DailyTarget {
  id: string
  organizationId: string
  repId: string
  revenueIdentityId: string
  activityType: ActivityType
  targetCount: number
  active: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type AccountabilityStatus = 'on_track' | 'at_risk' | 'completed' | 'missed'

export interface DailyAccountability {
  id: string
  organizationId: string
  repId: string
  revenueIdentityId: string
  activityType: ActivityType
  targetDate: string
  targetCount: number
  completedCount: number
  status: AccountabilityStatus
  closed: boolean
  createdAt: string
  updatedAt: string
}

export interface AccountabilitySummary {
  repId: string
  repName: string
  totalTarget: number
  totalCompleted: number
  remaining: number
  status: AccountabilityStatus
  byIdentity: IdentityAccountabilityDetail[]
}

export interface IdentityAccountabilityDetail {
  identityId: string
  identityName: string
  channel: RevenueIdentityChannel
  activityType: ActivityType
  target: number
  completed: number
  remaining: number
  status: AccountabilityStatus
}

export interface ConsecutiveMisses {
  repId: string
  repName: string
  identityId: string
  identityName: string
  activityType: ActivityType
  streakDays: number
  dates: string[]
}

export type NotificationType =
  | 'target_behind'
  | 'target_missed'
  | 'target_completed'
  | 'consecutive_miss'
  | 'identity_assigned'
  | 'identity_unassigned'
  | 'admin_behind'
  | 'admin_missed'
  | 'admin_consecutive_miss'

export interface AppNotification {
  id: string
  organizationId: string
  recipientId: string
  notificationType: NotificationType
  title: string
  body: string
  link: string | null
  dedupeKey: string
  read: boolean
  createdAt: string
}

export interface AuditLogEntry {
  id: string
  organizationId: string
  repId: string | null
  revenueIdentityId: string | null
  eventType: string
  detail: Record<string, unknown>
  createdAt: string
}

export interface RepTodayView {
  repId: string
  repName: string
  timezone: string
  isWorkingDay: boolean
  totalTarget: number
  totalCompleted: number
  totalRemaining: number
  overallStatus: AccountabilityStatus
  assignedIdentities: RepAssignedIdentityView[]
  notifications: AppNotification[]
}

export interface RepAssignedIdentityView {
  assignmentId: string
  identity: RevenueIdentity
  targets: TargetProgressView[]
}

export interface TargetProgressView {
  targetId: string
  activityType: ActivityType
  targetCount: number
  completedCount: number
  remaining: number
  status: AccountabilityStatus
  accountabilityId: string | null
}

export interface TeamAccountabilityView {
  date: string
  isWorkingDay: boolean
  members?: TeamMemberView[]
  exceptions?: DayClose[]
  needsAttention?: AttentionItem[]
  summaries?: AccountabilitySummary[]
  consecutiveMisses?: ConsecutiveMisses[]
  requiresAttention?: AttentionItem[]
}

export interface AttentionItem {
  repId: string
  repName: string
  identityId: string
  identityName: string
  activityType: ActivityType
  message: string
  severity: 'warning' | 'critical'
  personId?: string
  personName?: string
}

export interface CommandCenterView {
  date: string
  isWorkingDay: boolean
  totalReps: number
  onTrackReps: number
  behindReps: number
  completedReps: number
  missedReps: number
  activeIdentities: number
  totalTargetsToday: number
  totalCompletedToday: number
  consecutiveMisses: ConsecutiveMisses[]
  attentionItems: AttentionItem[]
  identityPerformance: IdentityPerformanceView[]
}

export interface IdentityPerformanceView {
  identityId: string
  identityName: string
  channel: RevenueIdentityChannel
  status: RevenueIdentityStatus
  assignedReps: string[]
  totalTarget: number
  totalCompleted: number
}


export type AccountabilityTemplateName = 'LIGHT' | 'STANDARD' | 'HIGH_OUTPUT' | 'CUSTOM'

export interface AccountabilityTemplate {
  id: string
  organizationId: string
  name: string
  qualifiedProspects: number
  connections: number
  firstDms: number
  emails: number
  followups: number
  dueRepliesPct: number
  meaningfulTouches: number
  loggingCompletenessPct: number
  isDefault: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type ContractStatus = 'active' | 'superseded' | 'archived'

export interface RevenueIdentityContract {
  id: string
  revenueIdentityId: string
  templateId: string | null
  annualRevenueTarget: number
  qualifiedProspects: number
  connections: number
  firstDms: number
  emails: number
  followups: number
  dueRepliesPct: number
  meaningfulTouches: number
  loggingCompletenessPct: number
  effectiveFrom: string
  effectiveTo: string | null
  status: ContractStatus
  version: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ContractAllocation {
  id: string
  contractId: string
  personId: string
  allocationPct: number
  createdAt: string
  updatedAt: string
}

export type DayCloseStatus = 'not_started' | 'in_progress' | 'ready_to_close' | 'completed' | 'completed_with_exception' | 'missed'

export type ExceptionReason = 'no_qualified_inventory' | 'channel_limit' | 'identity_blocked' | 'system_issue' | 'client_priority' | 'manager_approved' | 'other'

export interface DayClose {
  id: string
  organizationId: string
  personId: string
  revenueIdentityId: string
  contractId: string | null
  date: string
  status: DayCloseStatus
  completionSnapshot: Record<string, unknown>
  exceptionReason: ExceptionReason | null
  exceptionNote: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ReviewStatus = 'pending' | 'in_review' | 'completed' | 'adjusted'

export interface MonthlyAccountabilityReview {
  id: string
  organizationId: string
  personId: string
  revenueIdentityId: string
  contractId: string | null
  month: string
  executionSnapshot: Record<string, unknown>
  qualitySnapshot: Record<string, unknown>
  outcomeSnapshot: Record<string, unknown>
  consistencySnapshot: Record<string, unknown>
  reviewStatus: ReviewStatus
  managerNote: string | null
  adminNote: string | null
  createdAt: string
  updatedAt: string
}

export type RewardTier = 'bronze' | 'silver' | 'gold'

export type RewardType = 'custom' | 'bonus_eligibility' | 'commission_review' | 'time_off_review' | 'gift_review' | 'recognition_only'

export interface RewardPolicy {
  id: string
  organizationId: string
  name: string
  tier: RewardTier
  criteria: Record<string, unknown>
  rewardType: RewardType
  description: string | null
  enabled: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type RewardEligibilityStatus = 'pending' | 'approved' | 'rejected' | 'adjusted'

export interface RewardEligibility {
  id: string
  monthlyReviewId: string
  policyId: string
  status: RewardEligibilityStatus
  reasonSnapshot: Record<string, unknown>
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
}

export type AvailabilityStatus = 'working' | 'leave' | 'holiday' | 'approved_unavailable'

export interface OperatorAvailability {
  id: string
  organizationId: string
  personId: string
  date: string
  status: AvailabilityStatus
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface DailyContract {
  revenueIdentityId: string
  identityName: string
  annualRevenueTarget: number
  qualifiedProspects: number
  connections: number
  firstDms: number
  emails: number
  followups: number
  dueRepliesPct: number
  meaningfulTouches: number
  loggingCompletenessPct: number
  allocationPct: number
}

export interface DailyProgress {
  qualifiedProspects: { completed: number; target: number; remaining: number }
  connections: { completed: number; target: number; remaining: number }
  firstDms: { completed: number; target: number; remaining: number }
  emails: { completed: number; target: number; remaining: number }
  followups: { completed: number; target: number; remaining: number }
  dueReplies: { completed: number; target: number; remaining: number }
  meaningfulTouches: { completed: number; target: number; remaining: number }
  logging: { completed: number; target: number; remaining: number }
}

export interface MyDayView {
  personId: string
  personName: string
  date: string
  isWorkingDay: boolean
  availabilityStatus: AvailabilityStatus
  contracts: DailyContract[]
  progress: DailyProgress
  totalCompleted: number
  totalTarget: number
  totalRemaining: number
  overallStatus: AccountabilityStatus
  canCloseDay: boolean
  dayCloseStatus: DayCloseStatus | null
  nextAction: string | null
}

export interface TeamMemberView {
  personId: string
  personName: string
  revenueIdentityId: string
  identityName: string
  totalCompleted: number
  totalTarget: number
  totalRemaining: number
  status: AccountabilityStatus
  dayCloseStatus: DayCloseStatus | null
  exceptionReason: ExceptionReason | null
  allocationPct: number
}

export interface IdentityAccountabilityView {
  identityId: string
  identityName: string
  annualRevenueTarget: number
  contract: RevenueIdentityContract | null
  allocations: ContractAllocation[]
  todayProgress: DailyProgress
  monthProgress: DailyProgress
  qualityStatus: 'healthy' | 'review_required' | 'unknown'
  funnel: Record<string, number>
  revenue: { won: number; pipeline: number; remaining: number }
}

export interface MonthlyReviewView {
  review: MonthlyAccountabilityReview
  personName: string
  identityName: string
  rewardEligibility: RewardEligibility[]
  policies: RewardPolicy[]
}

export interface OwnerCommandCenterView {
  date: string
  isWorkingDay: boolean
  totalOperators: number
  completeOperators: number
  onTrackOperators: number
  needsAttentionOperators: number
  remainingOutboundWork: number
  repliesDue: number
  monthExpectedWorkingDays: number
  monthActualCompletedDays: number
  monthMeaningfulOutbound: number
  monthQualifiedConversations: number
  monthCalls: number
  monthProposals: number
  monthWins: number
  monthWonRevenue: number
  reviewQueue: MonthlyAccountabilityReview[]
  exceptionQueue: DayClose[]
  rewardQueue: RewardEligibility[]
  teamBreakdown: TeamMemberView[]
}

// ============================================================================
// ORCHESTRATION — Event Ledger + Relay Runs (Sprint 1)
// ============================================================================

export interface CapturedProspect {
  id: string
  organizationId: string
  ownerRepId: string
  rawInput: string
  extractedName: string | null
  extractedCompany: string | null
  extractedTitle: string | null
  extractedLocation: string | null
  linkedinUrl: string | null
  companyUrl: string | null
  canonicalScore: number | null
  canonicalIntelligence: Record<string, unknown> | null
  scoreBreakdown: Record<string, unknown> | null
  revenueIdentityId: string | null
  senderProfileId: string | null
  status: 'captured' | 'converted' | 'discarded'
  convertedLeadId: string | null
  /** Stable underlying-opportunity key (sha256 of the normalised source). */
  opportunityKey: string | null
  /** True for E2E/TEST/DEMO data; excluded from analytics by default. */
  isTest: boolean
  /** Explicit source classification (PRODUCTION/E2E/TEST/DEMO/SEED/IMPORT/MANUAL). */
  sourceKind: string
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  /**
   * True when this call to captureProspect() inserted a brand-new row; false
   * when it returned an existing row for the same rep+rawInput (a re-analyze
   * / cache hit). Not persisted — computed fresh on every call. Callers that
   * award once-per-capture accountability credit (prospect_extracted, see
   * ScoutStore.recordProspectExtracted) MUST gate on this flag so re-analyzing
   * the same paste never double-credits. Optional only for backward
   * compatibility with any older callers that don't need the distinction.
   */
  isNewCapture?: boolean
}

export type RelayEventType =
  | 'LEAD_CREATED'
  | 'DATASET_CAPTURE_ERROR'
  | 'LEAD_QUALIFIED'
  | 'WORK_ASSIGNED'
  | 'OUTREACH_PREPARED'
  | 'OUTREACH_RECORDED'
  | 'FOLLOWUP_DUE'
  | 'FOLLOWUP_PREPARED'
  | 'FOLLOWUP_RECORDED'
  | 'CLIENT_REPLIED'
  | 'INTENT_DETECTED'
  | 'PROOF_MATCHED'
  | 'REPLY_PREPARED'
  | 'HUMAN_ACTION_REQUIRED'
  | 'CONVERSATION_ADVANCED'
  | 'OUTCOME_RECORDED'
  | 'RUN_STARTED'
  | 'RUN_TRANSITIONED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'RECONCILIATION_DETECTED'
  | 'RECONCILIATION_APPLIED'
  | 'PROSPECT_CAPTURED'
  | 'PROSPECT_ANALYZED'
  | 'EXTRACTION_STARTED'
  | 'EXTRACTION_COMPLETED'
  | 'ARTIFACT_GENERATED'

export type RelayActorType = 'rep' | 'admin' | 'system' | 'integration'

export type RelayRunType = 'outbound' | 'inbound' | 'job'

export type RelayRunStatus =
  | 'detected'
  | 'qualifying'
  | 'rejected'
  | 'qualified'
  | 'routing'
  | 'preparing'
  | 'awaiting_human'
  | 'action_recorded'
  | 'waiting'
  | 'followup_due'
  | 'followup_preparing'
  | 'response_received'
  | 'conversation'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ExecutionPolicy = 'AUTO' | 'REVIEW_REQUIRED' | 'MANUAL' | 'PROHIBITED'

export interface RelayEvent {
  id: string
  organizationId: string
  eventType: RelayEventType
  entityType: string
  entityId: string | null
  actorType: RelayActorType
  actorId: string | null
  revenueIdentityId: string | null
  source: string
  sourceEventId: string | null
  correlationId: string | null
  causationId: string | null
  relayRunId: string | null
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  occurredAt: string
  createdAt: string
}

export interface RelayRun {
  id: string
  organizationId: string
  runType: RelayRunType
  primaryEntityType: string
  primaryEntityId: string | null
  status: RelayRunStatus
  currentStep: string
  assignedRepId: string | null
  revenueIdentityId: string | null
  correlationId: string
  startedAt: string
  waitingUntil: string | null
  completedAt: string | null
  failedAt: string | null
  failureCategory: string | null
  failureReason: string | null
  context: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface NextAction {
  actionType: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  reason: string
  executionPolicy: ExecutionPolicy
  entityType: string
  entityId: string
  blockedReason: string | null
}


export type TailoredCVStatus = 'generated' | 'applied' | 'archived'

export interface TailoredCV {
  id: string
  organizationId: string
  jobId: string
  revenueIdentityId: string | null
  profileId: string | null
  baseCvPath: string | null
  baseResumeSnapshot: Record<string, unknown>
  tailoredResume: Record<string, unknown>
  tailoredCvPath: string | null
  atsScore: number
  atsDimensions: Array<{ label: string; score: number; max: number; note: string }>
  atsMissingSkills: string[]
  targetTitle: string | null
  targetSkills: string[]
  targetCompany: string | null
  status: TailoredCVStatus
  proposalText: string | null
  generatedAt: string
  appliedAt: string | null
  createdAt: string
  updatedAt: string
}


export type GrowthMemoryType =
  | 'product_fact' | 'product_decision' | 'experiment_result'
  | 'customer_problem' | 'design_decision' | 'engineering_lesson'
  | 'revenue_learning' | 'dogfood_result' | 'market_insight'
  | 'content_insight' | 'audience_insight' | 'competitive_insight'

// ClaimSafety already defined at line 898

export type GrowthEventType =
  | 'product_change' | 'product_decision' | 'bug_discovered' | 'bug_fixed'
  | 'experiment_started' | 'experiment_result' | 'customer_problem'
  | 'design_decision' | 'engineering_lesson' | 'revenue_learning'
  | 'dogfood_result' | 'feature_shipped' | 'feature_rejected'
  | 'assumption_invalidated' | 'build_log_entry'

export type ContentJob =
  | 'teach' | 'challenge' | 'show' | 'prove' | 'build_in_public'
  | 'start_conversation' | 'create_category' | 'explain_product' | 'convert'

export type OpportunitySourceType =
  | 'product_memory' | 'product_event' | 'territory_gap'
  | 'audience_need' | 'market_event' | 'experiment_result'
  | 'dogfood_result' | 'content_gap'

export type EditorialStatus =
  | 'pending' | 'approved' | 'edited' | 'rejected' | 'regenerated' | 'not_today'

export type AdminFeedback =
  | 'approved_unchanged' | 'light_edit' | 'heavy_edit'
  | 'rejected' | 'not_today' | 'wrong_topic' | 'too_generic'
  | 'too_promotional' | 'repetitive' | 'weak_hook' | 'fact_problem'

export interface RelayGrowthMemory {
  id: string
  organizationId: string
  memoryType: GrowthMemoryType
  title: string
  content: string
  source: string | null
  claimSafety: ClaimSafety
  territories: string[]
  audienceSegments: string[]
  active: boolean
  usedInContent: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface RelayGrowthEvent {
  id: string
  organizationId: string
  eventType: GrowthEventType
  title: string
  rawContent: string
  editorialContent: string | null
  processed: boolean
  processedAt: string | null
  sourceKind: string
  sourceId: string | null
  createdBy: string | null
  createdAt: string
}

export interface RelayContentOpportunity {
  id: string
  organizationId: string
  sourceType: OpportunitySourceType
  sourceId: string | null
  title: string
  observation: string
  insight: string
  territory: string
  audienceSegment: string
  contentJob: ContentJob
  evidenceStrength: 'strong' | 'medium' | 'weak'
  claimBoundaries: string[]
  audienceRelevance: number
  novelty: number
  specificity: number
  timeliness: number
  relayDifferentiation: number
  conversationPotential: number
  learningValue: number
  repetitionRisk: number
  commercialRelevance: number
  selected: boolean
  selectionDate: string | null
  rejected: boolean
  rejectionReason: string | null
  generatedAt: string
  generationDate: string
}

export interface RelayEditorialDecision {
  id: string
  organizationId: string
  decisionDate: string
  opportunityId: string | null
  primaryReason: string
  audienceReason: string
  timelinessReason: string
  evidenceReason: string
  takeaway: string
  status: EditorialStatus
  adminFeedback: AdminFeedback | null
  adminEdits: string | null
  createdAt: string
  decidedAt: string | null
}

export interface RelayGrowthDraft {
  id: string
  organizationId: string
  decisionId: string | null
  opportunityId: string | null
  postPlan: Record<string, unknown>
  platform: string
  caption: string
  hook: string | null
  visualType: string | null
  visualConcept: string | null
  visualPrompt: string | null
  status: string
  qualityScore: number | null
  qualityNotes: string[] | null
  createdAt: string
  updatedAt: string
}

export interface RelayContentPublication {
  id: string
  organizationId: string
  draftId: string | null
  platform: string
  publishedAt: string | null
  externalId: string | null
  externalUrl: string | null
  campaign: string | null
  utmSource: string | null
  utmMedium: string | null
  utmContent: string | null
  caption: string
  territory: string
  audienceSegment: string
  contentJob: string
  createdAt: string
}

export interface RelayContentOutcome {
  id: string
  organizationId: string
  publicationId: string
  impressions: number | null
  uniqueReach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  profileVisits: number | null
  newFollowers: number | null
  linkClicks: number | null
  relayVisits: number | null
  signups: number | null
  activatedUsers: number | null
  recordedAt: string
  notes: string | null
}

export interface RelayGrowthExperiment {
  id: string
  organizationId: string
  hypothesis: string
  territory: string
  variable: string
  status: string
  startedAt: string | null
  completedAt: string | null
  results: Record<string, unknown>
  conclusion: string | null
  createdAt: string
}

// PostPlan — structured plan before writing
export interface PostPlan {
  audience: string
  territory: string
  contentJob: ContentJob
  coreInsight: string
  evidence: string[]
  claimBoundaries: string[]
  openingStrategy: string
  structure: string
  takeaway: string
  desiredReaction: string
  productMention: 'none' | 'natural' | 'direct'
  cta: string | null
}

// DailyEditor output
export interface DailyEditorResult {
  primary: RelayContentOpportunity | null
  backup: RelayContentOpportunity | null
  experimental: RelayContentOpportunity | null
  reasoning: string
  whyToday: string
}


export type TrendSourceType = 'hackernews' | 'devto' | 'github' | 'reddit' | 'lobsters' | 'producthunt' | 'stackoverflow' | 'rss' | 'arxiv' | 'newsapi'
export type EvidenceQuality = 'high' | 'medium' | 'low'

export interface TrendSource {
  id: string
  sourceKey: string
  sourceType: TrendSourceType
  displayName: string
  baseUrl: string | null
  enabled: boolean
  fetchIntervalMinutes: number
  lastFetchedAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  consecutiveFailures: number
  rateLimitRemaining: number | null
  rateLimitResetAt: string | null
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface TrendItem {
  id: string
  sourceId: string
  sourceItemId: string
  url: string | null
  title: string
  excerpt: string | null
  author: string | null
  publishedAt: string | null
  fetchedAt: string
  metrics: Record<string, unknown>
  topics: string[]
  contentFingerprint: string
  evidenceQuality: EvidenceQuality
  expiresAt: string
  createdAt: string
}

export type SourceFreshness = 'new_today' | 'recent' | 'active_discussion' | 'growing_attention' | 'fresh_announcement' | 'evergreen'
export type VisualType = 'PRODUCT_SCREENSHOT' | 'EDITORIAL_GRAPHIC' | 'TECHNICAL_DIAGRAM' | 'TYPOGRAPHIC_CONCEPT' | 'DATA_VISUAL' | 'GENERATED_IMAGE' | 'NO_VISUAL' | 'EDITORIAL_PHOTOGRAPH' | 'PRODUCT_ENVIRONMENT' | 'CONCEPTUAL_PHOTOGRAPH' | 'DATA_COMPOSITION' | 'TYPOGRAPHIC_STATEMENT' | 'TECHNICAL_COMPOSITION' | 'UI_COMPOSITION'
export type IdeaType = 'recommended' | 'alternate'
export type BriefStatus = 'generating' | 'ready' | 'failed' | 'stale'

export interface DailyContentBrief {
  id: string
  organizationId: string
  personaId: string
  localDate: string
  generationVersion: number
  status: BriefStatus
  recommendedIdeaId: string | null
  trendSnapshot: Record<string, unknown>
  promptVersion: string
  runtimeVersion: string
  generationStartedAt: string | null
  generationCompletedAt: string | null
  generationCostUsd: number | null
  createdAt: string
  updatedAt: string
}

export interface DailyContentIdea {
  id: string
  briefId: string
  organizationId: string
  personaId: string
  ideaType: IdeaType
  title: string
  angle: string | null
  whyNow: string | null
  sourceIds: string[]
  sourceFreshness: SourceFreshness | null
  formatSuggestion: string | null
  territory: string | null
  noveltyScore: number | null
  relevanceScore: number | null
  credibilityScore: number | null
  insightScore: number | null
  trendGrounded: boolean
  postCaption: string | null
  postPlatform: string
  visualType: VisualType | null
  visualConcept: string | null
  visualPrompt: string | null
  visualCommunicationGoal: string | null
  visualSubject: string | null
  visualScene: string | null
  visualComposition: string | null
  visualLighting: string | null
  visualPalette: string | null
  visualMood: string | null
  visualStyle: string | null
  visualAspectRatio: string
  visualFocalPoint: string | null
  visualAllowedText: string | null
  visualScreenshotTarget: string | null
  visualAvoid: string | null
  visualRealism?: string | null
  visualReason: string | null
  qualityResult: Record<string, unknown> | null
  copiedAt: string | null
  postedAt: string | null
  rejectedAt: string | null
  createdAt: string
}

export interface DailyGrowthBrief {
  id: string
  organizationId: string
  localDate: string
  generationVersion: number
  status: BriefStatus
  recommendedIdeaId: string | null
  trendSnapshot: Record<string, unknown>
  promptVersion: string
  postCaption: string | null
  visualType: VisualType | null
  visualConcept: string | null
  visualPrompt: string | null
  visualReason: string | null
  alternateIdeas: Array<{
    title: string
    angle: string
    whyNow: string
  }>
  contentMemoryHash: string | null
  qualityResult: Record<string, unknown> | null
  generationCostUsd: number | null
  copiedAt: string | null
  createdAt: string
  updatedAt: string
}

// Persona Trend Interest Profile
export interface TrendInterestProfile {
  primaryTerritories: string[]
  secondaryTerritories: string[]
  technologies: string[]
  industries: string[]
  audienceInterests: string[]
  monitoredEntities: string[]
  excludedTerritories: string[]
}

// Persona Intelligence Profile confidence
export interface FieldConfidence {
  [field: string]: 'PROVIDED' | 'STRONG_INFERENCE' | 'WEAK_INFERENCE' | 'UNKNOWN'
}

export interface PersonaIntelligenceProfile {
  identity: string
  currentRole: string
  expertise: string[]
  credibleExperience: string[]
  products: string[]
  audience: string
  audienceProblems: string[]
  knowledgeTerritories: string[]
  opinions: string[]
  likelyContentTerritories: string[]
  technicalDepth: 'shallow' | 'moderate' | 'deep'
  preferredPostDepth: 'short' | 'medium' | 'deep'
  tone: string
  writingCharacteristics: string[]
  vocabulary: string[]
  thingsNeverToClaim: string[]
  proofInventory: string[]
  allowedPersonalContext: string[]
  trendKeywords: string[]
  entitiesToMonitor: string[]
  contentBoundaries: string[]
  confidence: number
  fieldConfidence: FieldConfidence
}


export type ProfileReadiness = 'ready' | 'needs_source' | 'needs_review' | 'incomplete'

export type ImportBatchStatus =
  | 'uploaded' | 'parsing' | 'identifying_people' | 'extracting'
  | 'matching' | 'synthesizing' | 'review_required' | 'ready'
  | 'partial_failure' | 'failed'

export type ParsingStatus = 'pending' | 'parsing' | 'parsed' | 'ocr_required' | 'failed' | 'unsupported'
export type ExtractionStatus = 'pending' | 'extracting' | 'extracted' | 'partial_failure' | 'failed'

export type EvidenceType = 'fact' | 'explicit_claim' | 'strong_inference' | 'weak_inference' | 'unknown'

export type ClaimOwnershipStatus = 'clear' | 'ambiguous' | 'disputed'

export type IdentityResolution = 'match_existing' | 'create_new' | 'possible_duplicate' | 'needs_review'

export interface ProfileIntelligence {
  id: string
  organizationId: string
  repId: string
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
  serviceCapabilities: string[]
  specialties: string[]
  positioning: string | null
  preferredEngagementTypes: string[]
  audienceClientFit: string[]
  differentiators: string[]
  communicationStyle: Record<string, unknown>
  languages: string[]
  profileConfidence: number | null
  readiness: ProfileReadiness
  aiContext: Record<string, unknown>
  archivedAt: string | null
  sourceCount: number
  proofCount: number
  createdAt: string
  updatedAt: string
}

export interface ProfileImportBatch {
  id: string
  organizationId: string
  uploadedBy: string
  status: ImportBatchStatus
  totalFiles: number
  processedFiles: number
  failedFiles: number
  detectedPeople: number
  createdProfiles: number
  mergedProfiles: number
  errorMessage: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ProfileSource {
  id: string
  organizationId: string
  profileId: string | null
  importBatchId: string | null
  storagePath: string
  originalFilename: string
  mimeType: string
  fileSizeBytes: number
  fileHash: string
  parsingStatus: ParsingStatus
  extractionStatus: ExtractionStatus
  parsedContent: string | null
  pageCount: number | null
  detectedPeople: Array<DetectedPerson>
  errorMessage: string | null
  uploadedBy: string
  uploadedAt: string
  parsedAt: string | null
  extractedAt: string | null
}

export interface DetectedPerson {
  name: string
  confidence: number
  sectionStart: number
  sectionEnd: number
  role: string | null
  company: string | null
  aliases: string[]
  clues: string[]
}

export interface ProfileReview {
  id: string
  organizationId: string
  profileId: string
  sourceId: string | null
  reviewText: string
  reviewerName: string | null
  reviewerRole: string | null
  reviewerCompany: string | null
  projectContext: string | null
  relevantSkills: string[]
  evidenceType: EvidenceType
  confidence: number | null
  safeForOutreach: boolean
  ownershipStatus: ClaimOwnershipStatus
  createdAt: string
}

export interface ProfileClaim {
  id: string
  organizationId: string
  profileId: string
  sourceId: string | null
  claimKey: string
  claimValue: string
  evidenceType: EvidenceType
  sourceSection: string | null
  sourcePage: number | null
  confidence: number | null
  isInferred: boolean
  userCorrected: boolean
  userRejected: boolean
  extractionVersion: string
  createdAt: string
  updatedAt: string
}

export interface IdentityCandidate {
  normalizedName: string
  email: string | null
  linkedinUrl: string | null
  company: string | null
  role: string | null
  aliases: string[]
  sourceEvidence: string[]
}

export interface ExtractedProject {
  name: string
  clientCompany: string | null
  role: string | null
  summary: string
  technologies: string[]
  responsibilities: string[]
  problem: string | null
  workPerformed: string | null
  outcome: string | null
  startDate: string | null
  endDate: string | null
  evidenceType: EvidenceType
  confidence: number
  sourceReferences: Array<{ sourceId: string; section: string; page?: number }>
}

export interface ExtractedProof {
  claim: string
  whyItMatters: string
  supportingEvidence: string
  technologyDomain: string | null
  confidence: number
  safeForOutreach: boolean
  evidenceType: EvidenceType
}

export interface ExtractedReview {
  reviewText: string
  assignedPersonName: string | null
  reviewerName: string | null
  reviewerCompany: string | null
  relevantSkills: string[]
  projectContext: string | null
  confidence: number
  evidenceType: EvidenceType
  ownershipStatus: ClaimOwnershipStatus
}

export interface ExtractedFacts {
  fullName: string | null
  displayName: string | null
  currentRole: string | null
  company: string | null
  location: string | null
  headline: string | null
  bio: string | null
  professionalSummary: string | null
  seniority: string | null
  yearsExperience: number | null
  primarySkills: string[]
  secondarySkills: string[]
  technologies: string[]
  industries: string[]
  serviceCapabilities: string[]
  specialties: string[]
  positioning: string | null
  differentiators: string[]
  languages: string[]
  communicationStyle: Record<string, unknown>
  projects: ExtractedProject[]
  proofs: ExtractedProof[]
  reviews: ExtractedReview[]
  people: DetectedPerson[]
}
