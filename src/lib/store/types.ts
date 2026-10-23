import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ContentDraft,
  ContentDraftFeedback,
  ContentDraftStatus,
  ContentHistoryEntry,
  ContentPersona,
  ContentPillar,
  ContentPlatform,
  ContentPostStructure,
  ContentProfile,
  ContentProfileExpertise,
  ContentProfileTechnology,
  ContentProfileGoal,
  ContentProfileTopic,
  ContentProfileOpinion,
  ContentProfileProject,
  ContentProfileExperience,
  ContentProfileWritingCharacteristics,
  ContentProfileStorytellingTendency,
  ContentMemory,
  ContentMemoryType,
  ContentOpportunity,
  ContentOpportunityType,
  ContentOpportunityQualification,
  ContentIdeaGenome,
  IdeaGenomeSource,
  IdeaGenomeArchetype,
  ContentEvaluation,
  ContentInterviewSession,
  ContentInterviewAnswer,
  CapturedProspect,
  ConversationStage,
  ConversationState,
  CsvImport,
  EditLearning,
  Fact,
  Lead,
  MarketRegion,
  Message,
  MessageType,
  NotificationLogEntry,
  OrganizationRulebook,
  Outcome,
  Play,
  Profile,
  ProfileAssignment,
  ProofCard,
  ProofItem,
  PushSubscription,
  Rep,
  RoleCategory,
  SalesMemory,
  SalesMemoryType,
  SignalId,
  StyleCard,
  StyleSampleSource,
  TopicCluster,
  TrendingAngle,
  ContentResearchFinding,
  ContentJourneyEntry,
  ContentQuickCapture,
  TailoredCV,
  UpworkJob,
  UpworkMessage,
  Verdict,
  VoiceProfile,
  TrendSource,
  TrendItem,
  TrendSourceType,
  EvidenceQuality,
  DailyContentBrief,
  DailyContentIdea,
  DailyGrowthBrief,
  BriefStatus,
  IdeaType,
  SourceFreshness,
  VisualType,
  TrendInterestProfile,
  FieldConfidence,
  PersonaIntelligenceProfile,
} from '@/lib/domain/types'

export interface StoreContext {
  /** Current rep resolved from auth/session. Null in demo mode is impossible. */
  rep: Rep
  mode: 'demo' | 'supabase'
}

export interface NewLeadInput {
  company: string
  contactName?: string | null
  contactTitle?: string | null
  titleRaw?: string | null
  locationRaw?: string | null
  url?: string | null
  rawInput?: string | null
  signalType?: SignalId | null
  signalEvidence?: string | null
  verbatimQuote?: string | null
  tags?: string[]
  score?: number | null
  verdict?: Verdict | null
  roleCategory?: RoleCategory
  marketRegion?: MarketRegion
  extractionConfidence?: number
  extractionProfile?: Record<string, unknown>
  direction?: 'inbound' | 'outbound'
  source?: 'linkedin' | 'upwork' | 'email' | 'referral' | 'other' | null
  inboundMessage?: string | null
  inboundRaw?: Record<string, unknown> | null
  assignedProfileId?: string | null
  senderProfileId?: string | null
  revenueIdentityId?: string | null
  allowPotentialDuplicate?: boolean
  canonicalScore?: number | null
  scoreVersion?: string | null
  scoredAt?: string | null
  canonicalIntelligence?: Record<string, unknown> | null
  buyerIntent?: Record<string, unknown> | null
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
}

export interface ExtractionMetrics {
  total: number
  failures: number
  failureRate: number
  avgLatencyMs: number
  p95LatencyMs: number
  /** Estimated USD cost over the same rolling window, split by which tier served the call. */
  costByTier: Record<'tier1' | 'tier2' | 'tier3' | 'tier4', number>
  totalCostUsd: number
  /** Request count by tier over the same window — the number that actually shows whether the free tier (tier1/Groq, $0 cost either way) is absorbing real volume or the paid chain is doing more work than expected. */
  requestsByTier: Record<'tier1' | 'tier2' | 'tier3' | 'tier4', number>
}

export interface ModelCallLogInput {
  task: 'extract' | 'draft'
  success: boolean
  latencyMs: number
  model: string
  costTier?: 'tier1' | 'tier2' | 'tier3' | 'tier4'
  host?: string
  costUsd?: number
  error?: string | null
}

export interface HostCallInput {
  task: 'extract' | 'draft' | 'calibrate' | 'refine'
  host: string
  model?: string
  costTier?: 'tier1' | 'tier2' | 'tier3' | 'tier4'
  success: boolean
  failureReason?: 'rate_limit' | 'insufficient_balance' | 'timeout' | 'auth' | 'other'
  errorMessage?: string
  latencyMs?: number
}

export interface CreateLeadResult {
  blocked: boolean
  reason?: string
  existingOwnerName?: string
  lead?: Lead
  duplicateKind?: 'hard' | 'potential'
}

export interface SaveDraftInput {
  leadId: string
  type: MessageType
  draftText: string
  modelUsed: string
}

export interface RateMetric {
  sent: number
  sentLeads: number
  repliedLeads: number
  replyRate: number | null
  readLeads: number
  checkedLeads: number
  readToCheckRate: number | null
}

export interface LeadDetail extends Lead {
  messages: Message[]
  outcomes: Outcome[]
  /** When the lead was marked won/lost (from conversation_states); null otherwise. */
  wonAt?: string | null
  lostAt?: string | null
  /**
   * ConversationState.followupCount for this lead (0 if no conversation
   * state row exists yet). Callers computing follow-up eligibility (e.g.
   * evaluateFollowupGate) must pass this — without it, eligibility falls
   * back to a status-based check that can only tell "at least one follow-up
   * used", which under-counts once a lead can receive up to 3.
   */
  followupCount: number
}

export interface QueueData {
  /** @deprecated blends two different daily ceilings into one number; use sendBudgets on TodayDashboard instead. Kept only so existing callers of getQueue() don't break. */
  todaySends: number
  /** @deprecated see todaySends. */
  dailyLimit: number
  queue: Lead[]
  /** Owned leads whose prospect has replied and still needs a response. */
  replies: Lead[]
}

export interface TeamStats {
  overall: RateMetric
  perRep: RepRateRow[]
  perPlay: PlayRateRow[]
}

export interface RepRateRow extends RateMetric {
  rep: Rep
}

export interface PlayRateRow extends RateMetric {
  play: Play | null
}

/** One of the two real daily send ceilings (Part 7 rule) — dm/followup and connection/upwork are tracked and limited separately, never blended into one number. */
export interface SendBudget {
  label: string
  types: MessageType[]
  used: number
  limit: number
}

/** A contacted lead 3+ days past its last send with no reply — the same threshold the followup_eligible notification trigger uses, computed here so the homepage can show the whole bucket, not just one notification at a time. */
export interface FollowupDue {
  lead: Lead
  daysSinceContact: number
}

/** This rep's reply rate against the team's, so "where do I stand" doesn't require a trip to /team. */
export interface MyRank {
  mine: RateMetric | null
  teamAverage: RateMetric
  /** 1-based position among reps with at least one send, best reply rate first; null if this rep has no sends yet. */
  position: number | null
  ofTotal: number
}

/** Upwork's own pipeline, summarized for the homepage the same way the lead queue is — Upwork jobs are a fully parallel, equally-scored pipeline that previously had zero homepage visibility. */
export interface UpworkSnapshot {
  queue: UpworkJob[]
  todayApplies: number
}

export interface ContentForToday {
  personaId: string
  personaName: string
  ideaTitle: string
  ideaAngle: string
  ideaReason: string
  draftId?: string
  draftCaption?: string
}

export interface TodayDashboard {
  mine: QueueData
  team: RateMetric
  sendBudgets: SendBudget[]
  notifications: NotificationLogEntry[]
  followupsDue: FollowupDue[]
  myRank: MyRank
  upwork: UpworkSnapshot
  contentForToday?: ContentForToday | null
}

export interface DosageResult {
  allowed: boolean
  todaySends: number
  limit: number
  message?: string
  messageId?: string
  /** True when this call was a duplicate (matched an existing idempotencyKey) and returned the ALREADY-recorded result rather than logging a new send. */
  idempotent?: boolean
}

export interface GoldenCaseRow {
  id: string
  leadId: string
  knownReplied: boolean
  sentText: string
  note: string | null
  active: boolean
  createdAt: string
}

export interface EvalRunRow {
  id: string
  promptVersion: string
  goldenSetSize: number
  replyRateScore: number
  selfCheckPassRate: number
  companyMentionRate: number
  evidenceMentionRate: number
  overallScore: number
  details: unknown
  createdAt: string
}

export interface FewShotWin {
  id: string
  messageId: string
  leadId: string
  playId: string | null
  signalType: number | null
  sentText: string
  company: string
  signalEvidence: string | null
  tags: string[]
  createdAt: string
}

export interface ScoutStore {
  /** The organization this store is scoped to. */
  readonly organizationId: string
  /** The underlying Supabase client — used for queries not covered by the store API. */
  getSupabaseClient(): SupabaseClient
  /** The scoring rulebook for this organization. Loaded once per request. */
  getRulebook(): Promise<OrganizationRulebook | null>
  // leads
  createLead(lead: NewLeadInput): Promise<CreateLeadResult>
  updateLeadScore(
    id: string,
    score: { total: number; verdict: Verdict },
  ): Promise<void>
  updateLeadTags(id: string, tags: string[]): Promise<void>
  getLead(id: string): Promise<LeadDetail | null>
  /**
   * Looks up a lead in the CURRENT organization whose persisted canonical
   * intelligence was computed from this exact input hash (see
   * src/lib/intelligence-v2/input-hash.ts). Used to reuse a prior canonical
   * intelligence result instead of re-invoking AI extraction for unchanged
   * input (Phase 6 — stable input hashing). Must be organization-scoped like
   * every other lead lookup — never returns a lead from a different org.
   * Returns null if no match, or if the match predates canonical intelligence
   * (no canonicalIntelligence on file).
   */
   findLeadByIntelligenceInputHash(hash: string): Promise<LeadDetail | null>
   findLeadByV3ReuseKey(reuseKey: string): Promise<Lead | null>
   getReferredLeads(repId: string): Promise<Lead[]>
   getRecentLeads(repId: string, limit: number): Promise<Lead[]>
   /** @param includeArchived defaults to false — archived leads are excluded from the default read path. */
   listOwnedLeads(includeArchived?: boolean): Promise<Lead[]>
  /** Sent messages and conversation state for many leads in one round trip (inbox). */
  listConversationSnapshots(leadIds: string[]): Promise<Map<string, { messages: Message[]; followupCount: number; memoryStage: string | null }>>
  /** @param includeArchived defaults to false — archived leads are excluded from the default read path. */
  fetchLeadsAll(scopeToUser?: boolean, includeArchived?: boolean): Promise<Lead[]>
  getQueue(): Promise<QueueData>
  // messages
  saveDraft(input: SaveDraftInput): Promise<Message>
  listMessages(leadId: string): Promise<Message[]>
  /** Marks a lead contacted after a human sends the message externally. */
  /**
   * Logs a real send/contact action. `feedback.idempotencyKey`, when
   * provided, makes a duplicate call (double-click, network retry) for the
   * SAME logical send a no-op that returns the already-recorded result
   * instead of inserting a second messages row and double-incrementing
   * accountability — mirrors the pattern sendPreparedEmail already uses for
   * Email Outreach V1. Callers should mint one key per attempt (e.g. a
   * UUID generated once in the UI when the send starts) and resend the same
   * key on retry, not a fresh one.
   */
  markContacted(leadId: string, sentText: string, messageType?: MessageType, feedback?: {
    originalDraft?: string | null
    sendDisposition?: import('@/lib/domain/types').SendDisposition | null
    rejectReasons?: import('@/lib/domain/types').SendFeedbackReason[]
    idempotencyKey?: string | null
  }): Promise<DosageResult>
  /** Explicit rep confirmation that a LinkedIn connection request was accepted — never inferred. */
  markConnectionAccepted(leadId: string): Promise<void>
  /**
   * Persist a prospect's inbound reply as a message row, flip the lead to
   * 'replied', record the outcome, and emit a CLIENT_REPLIED event. Returns
   * the inserted message. Owner-scoped.
   */
  recordProspectReply(leadId: string, replyText: string, options?: { receivedAt?: string | null }): Promise<Message>
  /**
   * Admin override: clear a lead's connection-pacing lock immediately. No-op
   * if the lead is not locked. Admin/owner-scoped.
   */
  unlockLead(leadId: string): Promise<void>
  // voice profiles
  getVoiceProfile(profileId?: string): Promise<VoiceProfile | null>
  setVoiceProfile(
    styleCard: StyleCard,
    sampleSource: StyleSampleSource,
    profileId?: string,
  ): Promise<VoiceProfile>
  /** Every rep, for the Manage Profiles screen's rep grouping (read is open to any authenticated rep, matching RLS). */
  listAllReps(): Promise<Rep[]>
  // profiles (multi-platform identity)
  listProfiles(): Promise<Profile[]>
  getProfile(id: string): Promise<Profile | null>
  upsertProfile(input: {
    id?: string
    platform: 'linkedin' | 'upwork'
    label?: string | null
    profileUrl?: string | null
    headline?: string | null
    cvPath?: string | null
  }): Promise<Profile>
  deleteProfile(id: string): Promise<void>
  /** Every rep's profiles, for the Manage Profiles screen. Read is open to any authenticated rep, matching RLS; writes are still admin-only. */
  listAllProfiles(): Promise<Profile[]>
  /** Admin only: create/update a profile on behalf of any rep. */
  upsertProfileAdmin(input: {
    id?: string
    repId: string
    platform: 'linkedin' | 'upwork'
    label?: string | null
    profileUrl?: string | null
    headline?: string | null
    cvPath?: string | null
  }): Promise<Profile>
  /** Admin only: delete any rep's profile. */
  deleteProfileAdmin(id: string): Promise<void>
  // proof items
  listProofItems(profileId: string): Promise<ProofItem[]>
  /** Admin only: proof items for a profile with client_name unredacted, for the edit view. */
  listProofItemsAdmin(profileId: string): Promise<ProofItem[]>
  /** All proof items across all profiles in the organization. */
  listAllProofItems(): Promise<ProofItem[]>
  upsertProofItem(input: {
    id?: string
    profileId: string
    clientNamed?: boolean
    clientName?: string | null
    permissionOnFile?: boolean
    projectSummary: string
    reviewQuote?: string | null
    tags?: string[]
    embedding?: number[] | null
  }): Promise<ProofItem>
  deleteProofItem(id: string): Promise<void>
  /** Admin only: create/update a proof item on any profile, unredacted. */
  upsertProofItemAdmin(input: {
    id?: string
    profileId: string
    clientNamed?: boolean
    clientName?: string | null
    permissionOnFile?: boolean
    projectSummary: string
    reviewQuote?: string | null
    tags?: string[]
    embedding?: number[] | null
  }): Promise<ProofItem>
  /** Admin only: delete any proof item. */
  deleteProofItemAdmin(id: string): Promise<void>
  /** Find proof items whose tags overlap with the given tags, ranked by overlap count. */
  matchProofItems(tags: string[], limit?: number, profileId?: string | null): Promise<ProofItem[]>
  /** Semantic proof matching via pgvector embedding search. */
  matchProofItemsByEmbedding(embedding: number[], limit?: number, profileId?: string | null): Promise<Array<{ item: ProofItem; similarity: number }>>
  // facts
  listFacts(): Promise<Fact[]>
  upsertFact(input: {
    id?: string
    label: string
    value: string
    factType?: string | null
  }): Promise<Fact>
  deleteFact(id: string): Promise<void>
  // plays
  listPlays(): Promise<Play[]>
  createPlay(input: { name: string; situation: string; templateShape: string }): Promise<Play>
  deletePlay(id: string): Promise<void>
  // dashboard / team
  getTodayDashboard(): Promise<TodayDashboard>
  getTeamStats(): Promise<TeamStats>
  getExtractionMetrics(): Promise<ExtractionMetrics>
  logExtractionRun(input: ModelCallLogInput): Promise<void>
  logHostCall(input: HostCallInput): Promise<void>
  /** All leads a team lead can see; admin only in Supabase mode. */
  listAllLeadsAdmin(): Promise<Lead[]>
  // eval harness
  listGoldenSet(): Promise<GoldenCaseRow[]>
  addGoldenCase(input: { leadId: string; messageId?: string; knownReplied: boolean; sentText?: string; note?: string }): Promise<GoldenCaseRow>
  removeGoldenCase(id: string): Promise<void>
  listEvalRuns(): Promise<EvalRunRow[]>
  saveEvalRun(run: Omit<EvalRunRow, 'id' | 'createdAt'>): Promise<EvalRunRow>
  // few-shot wins
  listFewShotWins(limit?: number): Promise<FewShotWin[]>
  refreshFewShotWins(): Promise<number>
  // upwork jobs
  createUpworkJob(input: {
    title: string
    description: string
    budgetMin?: number | null
    budgetMax?: number | null
    hourlyRateMin?: number | null
    hourlyRateMax?: number | null
    proposalCount?: number | null
    connectsCost?: number
    requiredSkills?: string[]
    urgencySignal?: string | null
    rawInput?: string | null
    tags?: string[]
    screeningQuestions?: string[]
    applicationRequirements?: string[]
    engagementType?: string | null
    weeklyHours?: string | null
    duration?: string | null
    experienceLevel?: string | null
  }): Promise<UpworkJob>
  getUpworkJob(id: string): Promise<(UpworkJob & { messages: UpworkMessage[] }) | null>
  listUpworkJobs(): Promise<UpworkJob[]>
  /** Update the editable job fields on an existing row (the extract step creates it; Save corrects it). */
  updateUpworkJobFields(id: string, fields: Partial<Parameters<ScoutStore['createUpworkJob']>[0]>): Promise<void>
  updateUpworkJobScore(id: string, score: { total: number; verdict: UpworkJob['verdict']; canonicalScore?: number | null; scoreVersion?: string | null; scoreBreakdown?: unknown; jobFacts?: unknown; profileMatch?: unknown }): Promise<void>
  updateUpworkJob(id: string, updates: { status?: UpworkJob['status']; notes?: string | null; proposedRate?: number | null }): Promise<void>
  saveUpworkDraft(input: { jobId: string; type: UpworkMessage['type']; draftText: string; modelUsed: string }): Promise<UpworkMessage>
  markUpworkApplied(jobId: string, sentText: string, type?: UpworkMessage['type']): Promise<void>
  // csv imports
  logCsvImport(input: Omit<CsvImport, 'id' | 'createdAt' | 'repId'>): Promise<CsvImport>
  listCsvImports(): Promise<CsvImport[]>
  // archive search
  archiveSearch(opts: {
    query: string
    entityFilter?: 'lead' | 'proof' | 'upwork' | 'conversation' | 'identity' | 'studio' | 'all'
    statusFilter?: string[]
    signalFilter?: number[]
    playFilter?: string[]
    repFilter?: string[]
    dateFrom?: string | null
    dateTo?: string | null
    limit?: number
  }): Promise<Array<{
    entityType: 'lead' | 'proof' | 'upwork' | 'conversation' | 'identity' | 'studio'
    id: string
    title: string
    subtitle: string
    status: string | null
    createdAt: string
    href?: string
    rank: number
  }>>
  // push subscriptions
  savePushSubscription(sub: Omit<PushSubscription, 'id' | 'createdAt'>): Promise<PushSubscription>
  getPushSubscription(repId: string): Promise<PushSubscription | null>
  deletePushSubscription(repId: string): Promise<void>
  // notifications
  listNotifications(): Promise<NotificationLogEntry[]>
  markNotificationRead(id: string): Promise<void>
  // content engine
  createContentPersona(input: {
    repId: string
    displayName: string
    platforms: ContentPlatform[]
    voiceProfileId?: string | null
    humorStyle?: string
    valuesAndOpinions?: string[]
    admiredExamples?: string[]
  }): Promise<ContentPersona>
  updateContentPersonaProfile(input: {
    personaId: string
    humorStyle?: string
    valuesAndOpinions?: string[]
    admiredExamples?: string[]
  }): Promise<ContentPersona>
  updateContentPersona(input: {
    personaId: string
    personaRole?: string
    personaCompany?: string
    personaLocation?: string
    contentComfort?: string[]
    onboardingStep?: string
    onboardingCompleted?: boolean
  }): Promise<ContentPersona>
  listContentPersonas(repId: string): Promise<ContentPersona[]>
  getContentPersona(personaId: string): Promise<ContentPersona | null>
  deleteContentPersona(personaId: string): Promise<void>
  createContentPillar(input: {
    personaId: string
    pillarName: string
    description?: string
  }): Promise<ContentPillar>
  listContentPillars(personaId: string): Promise<ContentPillar[]>
  deleteContentPillar(pillarId: string): Promise<void>
  createContentDraft(input: {
    personaId: string
    pillarId?: string | null
    topicClusterId?: string | null
    researchFindingId?: string | null
    structureId?: string | null
    sourceKind?: 'answer' | 'conviction' | 'field_update' | 'idea'
    sourceMaterial: string
    platform: ContentPlatform
    caption: string
    hookScore?: number | null
    hookFeedback?: string
    selfCheckPassed?: boolean
    selfCheckNote?: string
    specificityHit?: boolean
    status?: ContentDraftStatus
  }): Promise<ContentDraft>
  listContentDrafts(personaId: string): Promise<ContentDraft[]>
  getContentDraft(draftId: string): Promise<ContentDraft | null>
  updateContentDraftCaption(draftId: string, caption: string): Promise<ContentDraft>
  updateContentDraftStatus(draftId: string, status: ContentDraftStatus): Promise<ContentDraft>
  tryMarkContentDraftPosted(draftId: string): Promise<boolean>
  updateContentDraft(input: {
    draftId: string
    caption?: string
    status?: ContentDraftStatus
    hookScore?: number | null
    hookFeedback?: string
    selfCheckPassed?: boolean
    selfCheckNote?: string
    specificityHit?: boolean
  }): Promise<ContentDraft>
  listContentHistory(personaId: string, limit?: number): Promise<ContentHistoryEntry[]>
  getContentHistoryEntry(historyId: string): Promise<ContentHistoryEntry | null>
  logContentPosted(input: {
    personaId: string
    pillarId: string | null
    topicClusterId?: string | null
    platform: ContentPlatform
    openingLine: string
  }): Promise<ContentHistoryEntry>
  markContentHistoryOutcome(historyId: string, ledToRealOutcome: boolean): Promise<ContentHistoryEntry>
  logContentMetrics(historyId: string, metrics: {
    likes?: number | null
    reach?: number | null
    comments?: number | null
    reposts?: number | null
    saves?: number | null
    profileVisits?: number | null
    followerDelta?: number | null
  }): Promise<ContentHistoryEntry>
  listPostStructures(): Promise<ContentPostStructure[]>
  createTrendingAngle(input: {
    pillarId: string
    angleDescription: string
    sourceNote?: string
    addedBy?: string | null
  }): Promise<TrendingAngle>
  getTrendingAngle(angleId: string): Promise<TrendingAngle | null>
  listTrendingAnglesByPillarIds(pillarIds: string[], opts?: { unusedOnly?: boolean }): Promise<TrendingAngle[]>
  markTrendingAngleUsed(angleId: string): Promise<TrendingAngle>
  countContentDraftsToday(personaId: string): Promise<number>
  createTopicCluster(input: {
    personaId: string
    clusterName: string
    description?: string
    sourceType?: 'profile' | 'answer' | 'research' | 'system'
    lastInputAt?: string | null
    lastResearchAt?: string | null
  }): Promise<TopicCluster>
  listTopicClusters(personaId: string): Promise<TopicCluster[]>
  touchTopicCluster(input: {
    topicClusterId: string
    lastInputAt?: string | null
    lastResearchAt?: string | null
  }): Promise<TopicCluster>
  createResearchFinding(input: {
    personaId: string
    topicClusterId: string
    finding: string
    sourceLabel: string
    sourceUrl: string
    sourcePublishedAt?: string | null
  }): Promise<ContentResearchFinding>
  listResearchFindings(personaId: string, opts?: { unusedOnly?: boolean; limit?: number }): Promise<ContentResearchFinding[]>
  markResearchFindingUsed(findingId: string): Promise<ContentResearchFinding>
  createContentDraftFeedback(input: {
    personaId: string
    draftId: string
    topicClusterId: string | null
    sourceKind: 'answer' | 'conviction' | 'field_update' | 'idea'
    reaction: 'posting' | 'not_for_me' | 'posting_after_edit'
    edited: boolean
    editSignals: string[]
  }): Promise<ContentDraftFeedback>
  listContentDraftFeedback(personaId: string, limit?: number): Promise<ContentDraftFeedback[]>
  // content profiles (Content DNA)
  createContentProfile(input: {
    personaId: string
    role?: string
    seniority?: string
    industries?: string[]
    audience?: string
  }): Promise<ContentProfile>
  getContentProfile(profileId: string): Promise<ContentProfile | null>
  getContentProfileByPersona(personaId: string): Promise<ContentProfile | null>
  updateContentProfile(profileId: string, patches: {
    role?: string
    seniority?: string
    industries?: string[]
    audience?: string
    expertise?: ContentProfileExpertise[]
    technologies?: ContentProfileTechnology[]
    goals?: ContentProfileGoal[]
    topicsCared?: ContentProfileTopic[]
    topicsAvoided?: ContentProfileTopic[]
    opinions?: ContentProfileOpinion[]
    projects?: ContentProfileProject[]
    experiences?: ContentProfileExperience[]
    writingCharacteristics?: ContentProfileWritingCharacteristics
    storytellingTendencies?: ContentProfileStorytellingTendency[]
    confidence?: number
    audiences?: string[]
    territories?: string[]
    voiceSelection?: string
  }): Promise<ContentProfile>
  deleteContentProfile(profileId: string): Promise<void>
  // content taste profiles
  getTasteProfile(personaId: string): Promise<{
    personaId: string
    preferences: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    territoryAffinity: Record<string, number>
    totalInteractions: number
    lastSignalType: string | null
    lastSignalAt: string | null
    lastSignalKey: string | null
    shortTerm: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    shortTermWeight: number
  } | null>
  saveTasteProfile(personaId: string, profile: {
    preferences: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    territoryAffinity: Record<string, number>
    totalInteractions: number
    lastSignalType?: string | null
    lastSignalKey?: string | null
    shortTerm: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    shortTermWeight: number
  }): Promise<void>
  // content memories
  createContentMemory(input: {
    personaId: string
    memoryType: ContentMemoryType
    content: string
    sourceDraftId?: string | null
    sourceHistoryId?: string | null
    embedding?: number[] | null
  }): Promise<ContentMemory>
  listContentMemories(personaId: string, opts?: { memoryType?: ContentMemoryType; limit?: number }): Promise<ContentMemory[]>
  deleteContentMemory(memoryId: string): Promise<void>
  findSimilarMemories(embedding: number[], personaId: string, threshold?: number, limit?: number): Promise<Array<{ id: string; content: string; memoryType: string; similarity: number; createdAt: string }>>
  pruneContentMemories(personaId: string, retainDays: number): Promise<void>
  // content opportunities
  createContentOpportunity(input: {
    personaId: string
    opportunityType: ContentOpportunityType
    title: string
    description: string
    trigger: string
    sourceKind?: 'user_input' | 'interview' | 'research' | 'system_inferred' | 'history_pattern' | null
    sourceReference?: string | null
  }): Promise<ContentOpportunity>
  listContentOpportunities(personaId: string, opts?: { status?: string; limit?: number }): Promise<ContentOpportunity[]>
  getContentOpportunity(opportunityId: string): Promise<ContentOpportunity | null>
  updateContentOpportunity(opportunityId: string, patches: {
    qualification?: ContentOpportunityQualification
    qualified?: boolean
    status?: string
    dismissedAt?: string | null
    completedAt?: string | null
  }): Promise<ContentOpportunity>
  deleteContentOpportunity(opportunityId: string): Promise<void>
  // idea genomes
  createIdeaGenome(input: {
    personaId: string
    source: IdeaGenomeSource
    topic: string
    angle: string
    archetype: IdeaGenomeArchetype
    audience: string
    emotion?: string | null
    valueType?: 'practical' | 'emotional' | 'intellectual' | 'social' | null
    opportunityId?: string | null
  }): Promise<ContentIdeaGenome>
  getIdeaGenome(genomeId: string): Promise<ContentIdeaGenome | null>
  updateIdeaGenome(genomeId: string, patches: {
    novelty?: number
    evidenceStrength?: number
    personalSpecificity?: number
    relevance?: number
    conversationPotential?: number
    contentMemoryOverlap?: string[]
    differentiationNote?: string
    status?: string
    rejectionReason?: string | null
    draftId?: string | null
  }): Promise<ContentIdeaGenome>
  // evaluations
  createEvaluation(input: {
    draftId: string
    originality?: number
    personalSpecificity?: number
    usefulness?: number
    credibility?: number
    evidence?: number
    clarity?: number
    storytelling?: number
    voiceMatch?: number
    stopPotential?: number
    dwellPotential?: number
    commentPotential?: number
    savePotential?: number
    sharePotential?: number
    audienceRelevance?: number
    slopScore?: number
    genericProbability?: number
    qualityNotes?: Record<string, string>
    distributionNotes?: Record<string, string>
  }): Promise<ContentEvaluation>
  getEvaluation(evaluationId: string): Promise<ContentEvaluation | null>
  // interview sessions
  createInterviewSession(input: {
    personaId: string
    opportunityId?: string | null
    sessionType: 'onboarding' | 'opportunity_exploration' | 'post_qualification'
  }): Promise<ContentInterviewSession>
  getInterviewSession(sessionId: string): Promise<ContentInterviewSession | null>
  listInterviewSessions(personaId: string, opts?: { status?: string; limit?: number }): Promise<ContentInterviewSession[]>
  updateInterviewSession(sessionId: string, patches: {
    status?: string
    questionsAsked?: number
    informationGain?: number
    completedAt?: string | null
  }): Promise<ContentInterviewSession>
  createInterviewAnswer(input: {
    sessionId: string
    question: string
    answer: string
    informationGain?: number
  }): Promise<ContentInterviewAnswer>
  listInterviewAnswers(sessionId: string): Promise<ContentInterviewAnswer[]>
  // relay revenue intelligence
  getAssignedProfiles(): Promise<Profile[]>
  assignProfile(profileId: string): Promise<void>
  unassignProfile(profileId: string): Promise<void>
  listProofCards(profileId: string): Promise<ProofCard[]>
  upsertProofCard(input: {
    id?: string
    profileId: string
    capability: string
    strength: 'strong' | 'moderate' | 'weak'
    safeClaim: string
    sourceType: 'cv' | 'project' | 'portfolio' | 'case_study' | 'certification' | 'client_work' | 'approved_fact'
    sourceReference?: string | null
    tags?: string[]
    verified?: boolean
    forbiddenClaims?: string[]
  }): Promise<ProofCard>
  deleteProofCard(id: string): Promise<void>
  getConversationState(leadId: string): Promise<ConversationState | null>
  upsertConversationState(input: {
    leadId: string
    stage?: ConversationStage
    senderProfileId?: string | null
    lastReplyAt?: string | null
    lastStrategy?: string | null
    lastAngle?: string | null
    lastCta?: string | null
    followupCount?: number
    nextFollowupAt?: string | null
    wonAt?: string | null
    lostAt?: string | null
    lostReason?: string | null
    /** Merged into the existing commercial state, never replaces it. */
    commercialState?: Record<string, unknown> | null
    lastSentAt?: string | null
    lastSentMessageId?: string | null
    memory?: import('@/lib/conversation/types').ConversationMemory | null
    /** undefined keeps the current draft; null clears it. */
    composerDraft?: import('@/lib/conversation/types').ComposerDraft | null
  }): Promise<ConversationState>
  addSalesMemory(input: {
    memoryType: SalesMemoryType
    content: string
    leadId?: string | null
    profileId?: string | null
    industry?: string | null
    leadType?: string | null
    channel?: string | null
    stage?: string | null
    outcome?: 'positive' | 'negative' | 'neutral' | null
  }): Promise<SalesMemory>
  listSalesMemory(opts?: {
    memoryType?: SalesMemoryType
    profileId?: string | null
    industry?: string | null
    limit?: number
  }): Promise<SalesMemory[]>
  logEditLearning(input: {
    messageId: string | null
    originalText: string
    editedText: string
    editDistance: number
    lengthDelta: number
    greetingChanged: boolean
    ctaChanged: boolean
    proofRemoved: boolean
    madeShorter: boolean
    madeLonger: boolean
    formalityShift: 'more_formal' | 'less_formal' | 'same' | null
    sendDisposition?: import('@/lib/domain/types').SendDisposition | null
    rejectReasons?: import('@/lib/domain/types').SendFeedbackReason[]
  }): Promise<void>
  /** The current rep's most recent sends where the AI draft was edited, newest first. */
  listRecentEdits(limit: number): Promise<Array<{ originalText: string; editedText: string; createdAt: string }>>
  updateLeadSenderProfile(leadId: string, senderProfileId: string | null): Promise<void>
  updateLeadStatus(leadId: string, status: 'won' | 'lost'): Promise<void>
  updateLeadRevenueIdentity(leadId: string, revenueIdentityId: string): Promise<void>
  getCurrentRepId(): string
  captureProspect(input: {
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
    /** Test/E2E/DEMO data is excluded from analytics by default (P0-2). */
    isTest?: boolean
  }): Promise<CapturedProspect>
  listCapturedProspects(): Promise<CapturedProspect[]>
  getCapturedProspect(id: string): Promise<CapturedProspect | null>
  updateCapturedProspectStatus(id: string, status: 'captured' | 'converted' | 'discarded', convertedLeadId?: string | null): Promise<void>
  /**
   * Award accountability credit ('prospect_extracted' activity type) for a
   * genuine new capture. Callers must only invoke this when
   * CapturedProspect.isNewCapture is true (see captureProspect) — never on a
   * reuse/cache hit, or a re-analyze of the same paste would double-credit.
   * Non-fatal: implementations must never let this throw into the caller.
   */
  recordProspectExtracted(revenueIdentityId?: string | null): Promise<void>
  // content journey
  createContentJourneyEntry(input: {
    personaId: string
    eventType: string
    title: string
    description?: string
    eventDate?: string | null
    source?: string
  }): Promise<ContentJourneyEntry>
  listContentJourney(personaId: string, limit?: number): Promise<ContentJourneyEntry[]>
  deleteContentJourneyEntry(entryId: string): Promise<void>
  // quick capture
  createContentQuickCapture(input: {
    personaId: string
    rawInput: string
    suggestedAngles: unknown[]
    status?: string
  }): Promise<ContentQuickCapture>
  listContentQuickCaptures(personaId: string, limit?: number): Promise<ContentQuickCapture[]>
  updateQuickCaptureStatus(captureId: string, status: string): Promise<void>
  // relay queue
  getRelayQueueData(): Promise<{
    conversations: Map<string, import('@/lib/domain/types').ConversationState>
    messagesByLead: Map<string, import('@/lib/domain/types').Message[]>
    messagesByJob: Map<string, import('@/lib/domain/types').UpworkMessage[]>
    assignedProfiles: import('@/lib/domain/types').Profile[]
  }>
  // revenue identity OS (Admin-only)
  listRevenueIdentitiesAdmin(): Promise<import('@/lib/domain/types').RevenueIdentity[]>
  getRevenueIdentityAdmin(id: string): Promise<import('@/lib/domain/types').RevenueIdentity | null>
  createRevenueIdentityAdmin(input: {
    slug: string
    identityName: string
    channel: string
    title?: string | null
  }): Promise<import('@/lib/domain/types').RevenueIdentity>
  updateRevenueIdentityAdmin(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').RevenueIdentity>
  archiveRevenueIdentityAdmin(id: string): Promise<void>
  // assignments (Admin-only)
  listIdentityAssignmentsAdmin(): Promise<import('@/lib/domain/types').IdentityAssignment[]>
  assignIdentityAdmin(identityId: string, repId: string): Promise<import('@/lib/domain/types').IdentityAssignment>
  unassignIdentityAdmin(identityId: string, repId: string): Promise<void>
  // targets (Admin-only)
  listDailyTargetsAdmin(): Promise<import('@/lib/domain/types').DailyTarget[]>
  createDailyTargetAdmin(input: {
    repId: string
    revenueIdentityId: string
    activityType: import('@/lib/domain/types').ActivityType
    targetCount: number
  }): Promise<import('@/lib/domain/types').DailyTarget>
  ensureDefaultDailyTargetsAdmin(input: {
    repId: string
    revenueIdentityId: string
  }): Promise<import('@/lib/domain/types').DailyTarget[]>
  backfillDefaultDailyTargetsAdmin(): Promise<{ created: number; assignments: number }>
  updateDailyTargetAdmin(id: string, patches: { targetCount?: number; active?: boolean }): Promise<import('@/lib/domain/types').DailyTarget>
  deleteDailyTargetAdmin(id: string): Promise<void>
  // accountability
  getTeamAccountabilityAdmin(date?: string): Promise<import('@/lib/domain/types').TeamAccountabilityView>
  getCommandCenterAdmin(): Promise<import('@/lib/domain/types').CommandCenterView>
  listMyAssignedIdentities(): Promise<import('@/lib/domain/types').RevenueIdentityWithAssignment[]>
  getMyTodayAccountability(): Promise<import('@/lib/domain/types').RepTodayView>
  getRepTodayAccountability(repId: string): Promise<import('@/lib/domain/types').RepTodayView>
  listAccountabilityNotifications(): Promise<import('@/lib/domain/types').AppNotification[]>
  markAccountabilityNotificationRead(id: string): Promise<void>
  listAuditLogAdmin(limit?: number): Promise<import('@/lib/domain/types').AuditLogEntry[]>

  // accountability OS
  listAccountabilityTemplates(): Promise<import('@/lib/domain/types').AccountabilityTemplate[]>
  getAccountabilityTemplate(id: string): Promise<import('@/lib/domain/types').AccountabilityTemplate | null>
  createAccountabilityTemplate(input: {
    name: string
    qualifiedProspects: number
    connections: number
    firstDms: number
    emails: number
    followups: number
    dueRepliesPct: number
    meaningfulTouches: number
    loggingCompletenessPct: number
    isDefault?: boolean
  }): Promise<import('@/lib/domain/types').AccountabilityTemplate>
  updateAccountabilityTemplate(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').AccountabilityTemplate>
  deleteAccountabilityTemplate(id: string): Promise<void>

  getActiveContract(identityId: string): Promise<import('@/lib/domain/types').RevenueIdentityContract | null>
  getContractById(contractId: string): Promise<import('@/lib/domain/types').RevenueIdentityContract | null>
  createContract(input: {
    revenueIdentityId: string
    templateId?: string | null
    annualRevenueTarget?: number
    qualifiedProspects?: number
    connections?: number
    firstDms?: number
    emails?: number
    followups?: number
    dueRepliesPct?: number
    meaningfulTouches?: number
    loggingCompletenessPct?: number
    effectiveFrom?: string
  }): Promise<import('@/lib/domain/types').RevenueIdentityContract>
  updateContract(contractId: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').RevenueIdentityContract>
  supersedeContract(contractId: string, effectiveTo: string): Promise<void>

  listContractAllocations(contractId: string): Promise<import('@/lib/domain/types').ContractAllocation[]>
  setContractAllocations(contractId: string, allocations: { personId: string; allocationPct: number }[]): Promise<void>
  getPersonAllocations(personId: string): Promise<import('@/lib/domain/types').ContractAllocation[]>

  getDayClose(personId: string, identityId: string, date: string): Promise<import('@/lib/domain/types').DayClose | null>
  getDayCloseById(id: string): Promise<import('@/lib/domain/types').DayClose | null>
  createDayClose(input: {
    personId: string
    revenueIdentityId: string
    contractId?: string | null
    date: string
    status?: import('@/lib/domain/types').DayCloseStatus
    completionSnapshot?: Record<string, unknown>
  }): Promise<import('@/lib/domain/types').DayClose>
  updateDayClose(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').DayClose>
  listDayCloses(personId: string, identityId?: string, startDate?: string, endDate?: string): Promise<import('@/lib/domain/types').DayClose[]>
  listTeamDayCloses(date: string): Promise<import('@/lib/domain/types').DayClose[]>

  getMonthlyReview(personId: string, identityId: string, month: string): Promise<import('@/lib/domain/types').MonthlyAccountabilityReview | null>
  createMonthlyReview(input: {
    personId: string
    revenueIdentityId: string
    contractId?: string | null
    month: string
    executionSnapshot?: Record<string, unknown>
    qualitySnapshot?: Record<string, unknown>
    outcomeSnapshot?: Record<string, unknown>
    consistencySnapshot?: Record<string, unknown>
  }): Promise<import('@/lib/domain/types').MonthlyAccountabilityReview>
  updateMonthlyReview(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').MonthlyAccountabilityReview>
  listMonthlyReviews(month: string): Promise<import('@/lib/domain/types').MonthlyAccountabilityReview[]>

  listRewardPolicies(): Promise<import('@/lib/domain/types').RewardPolicy[]>
  createRewardPolicy(input: {
    name: string
    tier: import('@/lib/domain/types').RewardTier
    criteria: Record<string, unknown>
    rewardType: import('@/lib/domain/types').RewardType
    description?: string | null
  }): Promise<import('@/lib/domain/types').RewardPolicy>
  updateRewardPolicy(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').RewardPolicy>
  deleteRewardPolicy(id: string): Promise<void>

  listRewardEligibility(reviewId: string): Promise<import('@/lib/domain/types').RewardEligibility[]>
  createRewardEligibility(input: {
    monthlyReviewId: string
    policyId: string
    reasonSnapshot?: Record<string, unknown>
  }): Promise<import('@/lib/domain/types').RewardEligibility>
  updateRewardEligibility(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').RewardEligibility>

  getOperatorAvailability(personId: string, date: string): Promise<import('@/lib/domain/types').OperatorAvailability | null>
  setOperatorAvailability(input: {
    personId: string
    date: string
    status: import('@/lib/domain/types').AvailabilityStatus
    note?: string | null
  }): Promise<import('@/lib/domain/types').OperatorAvailability>
  listOperatorAvailability(personId: string, startDate: string, endDate: string): Promise<import('@/lib/domain/types').OperatorAvailability[]>

  getMyDayView(): Promise<import('@/lib/domain/types').MyDayView>
  getTeamAccountabilityView(date?: string): Promise<import('@/lib/domain/types').TeamAccountabilityView>
  getIdentityAccountabilityView(identityId: string): Promise<import('@/lib/domain/types').IdentityAccountabilityView>
  getOwnerCommandCenterView(): Promise<import('@/lib/domain/types').OwnerCommandCenterView>
  getMonthlyReviewView(reviewId: string): Promise<import('@/lib/domain/types').MonthlyReviewView>

  // ============================================================================
  // ORCHESTRATION — Event Ledger + Relay Runs (Sprint 1)
  // ============================================================================

  /**
   * Emit an event to the relay_events ledger.
   * Centralized, idempotent, append-only.
   */
  emitRelayEvent(input: {
    eventType: import('@/lib/domain/types').RelayEventType
    entityType: string
    entityId?: string | null
    actorType?: import('@/lib/domain/types').RelayActorType
    actorId?: string | null
    revenueIdentityId?: string | null
    source?: string
    sourceEventId?: string | null
    correlationId?: string | null
    causationId?: string | null
    relayRunId?: string | null
    payload?: Record<string, unknown>
    metadata?: Record<string, unknown>
    occurredAt?: string
  }): Promise<string | null>

  /**
   * Get the full event history for a relay run.
   */
  getRelayRunEvents(runId: string): Promise<import('@/lib/domain/types').RelayEvent[]>

  /**
   * Create a new Relay Run. Enforces one-active-run-per-entity.
   */
  createRelayRun(input: {
    runType?: import('@/lib/domain/types').RelayRunType
    primaryEntityType?: string
    primaryEntityId?: string | null
    assignedRepId?: string | null
    revenueIdentityId?: string | null
    correlationId?: string | null
    context?: Record<string, unknown>
  }): Promise<string | null>

  /**
   * Transition a Relay Run to a new status. Deterministic validation.
   */
  transitionRelayRun(input: {
    runId: string
    newStatus: import('@/lib/domain/types').RelayRunStatus
    newStep?: string | null
    eventId?: string | null
    metadata?: Record<string, unknown>
  }): Promise<{ previousStatus: string; newStatus: string; step: string } | null>

  /**
   * Get a Relay Run by ID.
   */
  getRelayRun(runId: string): Promise<import('@/lib/domain/types').RelayRun | null>

  /**
   * List active Relay Runs for an entity.
   */
  listActiveRunsForEntity(entityType: string, entityId: string): Promise<import('@/lib/domain/types').RelayRun[]>


  saveTailoredCV(input: {
    jobId: string
    revenueIdentityId?: string | null
    profileId?: string | null
    baseCvPath?: string | null
    baseResumeSnapshot?: Record<string, unknown>
    tailoredResume: Record<string, unknown>
    atsScore: number
    atsDimensions?: Array<{ label: string; score: number; max: number; note: string }>
    atsMissingSkills?: string[]
    targetTitle?: string | null
    targetSkills?: string[]
    targetCompany?: string | null
    proposalText?: string | null
  }): Promise<import('@/lib/domain/types').TailoredCV>

  getTailoredCV(id: string): Promise<import('@/lib/domain/types').TailoredCV | null>

  listTailoredCVsForJob(jobId: string): Promise<import('@/lib/domain/types').TailoredCV[]>

  markTailoredCVApplied(id: string): Promise<void>


  // Product Memory
  createGrowthMemory(input: {
    memoryType: import('@/lib/domain/types').GrowthMemoryType
    title: string
    content: string
    source?: string | null
    claimSafety?: import('@/lib/domain/types').ClaimSafety
    territories?: string[]
    audienceSegments?: string[]
  }): Promise<import('@/lib/domain/types').RelayGrowthMemory>

  listGrowthMemory(activeOnly?: boolean): Promise<import('@/lib/domain/types').RelayGrowthMemory[]>

  // Growth Events (Build Log)
  createGrowthEvent(input: {
    eventType: import('@/lib/domain/types').GrowthEventType
    title: string
    rawContent: string
    sourceKind?: string
  }): Promise<import('@/lib/domain/types').RelayGrowthEvent>

  listGrowthEvents(processedOnly?: boolean): Promise<import('@/lib/domain/types').RelayGrowthEvent[]>

  markGrowthEventProcessed(id: string, editorialContent: string): Promise<void>

  // Content Opportunities
  createOpportunity(input: {
    sourceType: import('@/lib/domain/types').OpportunitySourceType
    sourceId?: string | null
    title: string
    observation: string
    insight: string
    territory: string
    audienceSegment: string
    contentJob: import('@/lib/domain/types').ContentJob
    evidenceStrength?: 'strong' | 'medium' | 'weak'
    claimBoundaries?: string[]
    audienceRelevance?: number
    novelty?: number
    specificity?: number
    timeliness?: number
    relayDifferentiation?: number
    conversationPotential?: number
    learningValue?: number
    repetitionRisk?: number
    commercialRelevance?: number
  }): Promise<import('@/lib/domain/types').RelayContentOpportunity>

  listOpportunities(date?: string): Promise<import('@/lib/domain/types').RelayContentOpportunity[]>

  selectOpportunity(id: string, date: string): Promise<void>

  rejectOpportunity(id: string, reason: string): Promise<void>

  // Editorial Decisions
  createEditorialDecision(input: {
    decisionDate: string
    opportunityId: string | null
    primaryReason: string
    audienceReason: string
    timelinessReason: string
    evidenceReason: string
    takeaway: string
  }): Promise<import('@/lib/domain/types').RelayEditorialDecision>

  listEditorialDecisions(fromDate: string, toDate: string): Promise<import('@/lib/domain/types').RelayEditorialDecision[]>
  getEditorialDecision(date: string): Promise<import('@/lib/domain/types').RelayEditorialDecision | null>

  updateEditorialDecision(id: string, patches: {
    status?: import('@/lib/domain/types').EditorialStatus
    adminFeedback?: import('@/lib/domain/types').AdminFeedback
    adminEdits?: string
  }): Promise<void>

  // Growth Drafts
  createGrowthDraft(input: {
    decisionId?: string | null
    opportunityId?: string | null
    postPlan: Record<string, unknown>
    platform?: string
  }): Promise<import('@/lib/domain/types').RelayGrowthDraft>

  getGrowthDraft(id: string): Promise<import('@/lib/domain/types').RelayGrowthDraft | null>

  getGrowthDraftByDecision(decisionId: string): Promise<import('@/lib/domain/types').RelayGrowthDraft | null>

  updateGrowthDraft(id: string, patches: {
    caption?: string
    hook?: string
    status?: string
    visualType?: string
    visualConcept?: string
    visualPrompt?: string
    qualityScore?: number
    qualityNotes?: string[]
  }): Promise<void>

  // Publications
  createPublication(input: {
    draftId?: string | null
    platform: string
    caption: string
    territory: string
    audienceSegment: string
    contentJob: string
    campaign?: string
  }): Promise<import('@/lib/domain/types').RelayContentPublication>

  listPublications(): Promise<import('@/lib/domain/types').RelayContentPublication[]>

  // Outcomes
  recordOutcome(input: {
    publicationId: string
    impressions?: number
    likes?: number
    comments?: number
    shares?: number
    saves?: number
    profileVisits?: number
    newFollowers?: number
    signups?: number
  }): Promise<void>

  listOutcomes(publicationId: string): Promise<import('@/lib/domain/types').RelayContentOutcome[]>


  getTeamMembers(teamId: string): Promise<Array<{ repId: string; repName: string; role: string }>>

  getTeamTargets(teamId: string, date?: string): Promise<Array<{
    repId: string
    repName: string
    revenueIdentityId: string
    identityName: string
    channel: string
    activityType: string
    targetCount: number
    completedCount: number
    remaining: number
    status: string
  }>>

  getManagedTeamSummary(managerId: string): Promise<Array<{
    teamId: string
    teamName: string
    memberCount: number
    totalTarget: number
    totalCompleted: number
    totalRemaining: number
    needsAttention: number
  }>>

  getTeamInfo(teamId: string): Promise<{ id: string; name: string; description: string | null } | null>

  listTeams(): Promise<Array<{ id: string; name: string; description: string | null }>>

  getOrganizationRoles(): Promise<Array<{ personId: string; role: string }>>

  getActiveTeamMemberships(): Promise<Array<{ teamId: string; personId: string; membershipRole: string }>>

  getRepInfo(repId: string): Promise<{ id: string; name: string; role: string } | null>

  getRepAssignments(repId: string): Promise<Array<{
    assignmentId: string
    revenueIdentityId: string
    identityName: string
    title: string | null
    channel: string
  }>>


  listTrendSources(): Promise<TrendSource[]>
  getTrendSource(sourceKey: string): Promise<TrendSource | null>
  upsertTrendSource(input: {
    sourceKey: string
    sourceType: TrendSourceType
    displayName: string
    baseUrl?: string
    enabled?: boolean
    fetchIntervalMinutes?: number
    config?: Record<string, unknown>
  }): Promise<TrendSource>
  updateTrendSourceHealth(sourceKey: string, success: boolean, error?: string): Promise<void>

  createTrendItem(input: {
    sourceId: string
    sourceItemId: string
    url?: string
    title: string
    excerpt?: string
    author?: string
    publishedAt?: string
    metrics?: Record<string, unknown>
    topics?: string[]
    contentFingerprint: string
    evidenceQuality?: EvidenceQuality
    expiresAt?: string
  }): Promise<TrendItem>
  listTrendItems(opts?: { since?: string; topics?: string[]; limit?: number }): Promise<TrendItem[]>


  createDailyContentBrief(input: {
     organizationId: string
     personaId: string
     localDate: string
     generationVersion?: number
     trendSnapshot?: Record<string, unknown>
     promptVersion?: string
   }): Promise<DailyContentBrief>
   deleteDailyContentBriefByPersonaAndDate(personaId: string, localDate: string): Promise<void>
   getDailyContentBrief(personaId: string, localDate: string): Promise<DailyContentBrief | null>
  getDailyContentBriefWithIdeas(personaId: string, localDate: string): Promise<{
    brief: DailyContentBrief
    ideas: DailyContentIdea[]
  } | null>
  updateDailyContentBriefStatus(briefId: string, status: BriefStatus, cost?: number): Promise<DailyContentBrief>
  updateDailyContentBriefRecommended(briefId: string, ideaId: string): Promise<DailyContentBrief>
  getLatestDailyContentBrief(personaId: string): Promise<DailyContentBrief | null>

  createDailyContentIdea(input: {
    briefId: string
    organizationId: string
    personaId: string
    ideaType: IdeaType
    title: string
    angle?: string
    whyNow?: string
    sourceIds?: string[]
    sourceFreshness?: SourceFreshness
    formatSuggestion?: string
    territory?: string
    noveltyScore?: number
    relevanceScore?: number
    credibilityScore?: number
    insightScore?: number
    trendGrounded?: boolean
    postCaption?: string
    postPlatform?: string
     visualType?: VisualType
     visualConcept?: string
     visualPrompt?: string
     visualCommunicationGoal?: string
     visualSubject?: string
     visualScene?: string
     visualComposition?: string
     visualLighting?: string
     visualPalette?: string
     visualMood?: string
     visualStyle?: string
     visualAspectRatio?: string
     visualFocalPoint?: string
     visualAllowedText?: string
     visualScreenshotTarget?: string
     visualAvoid?: string
     visualRealism?: string
     visualReason?: string
     qualityResult?: Record<string, unknown>
   }): Promise<DailyContentIdea>
  listDailyContentIdeas(briefId: string): Promise<DailyContentIdea[]>
  getDailyContentIdeaById(ideaId: string): Promise<DailyContentIdea | null>
  markDailyContentIdeaCopied(ideaId: string): Promise<void>
  markDailyContentIdeaRejected(ideaId: string): Promise<void>
  markDailyContentIdeaPosted(ideaId: string): Promise<void>


  synthesizePersonaIntelligence(input: {
    personaId: string
    profileInput?: string
    pastPostsInput?: string
    role?: string
    company?: string
    description?: string
  }): Promise<PersonaIntelligenceProfile>
  updatePersonaTrendInterest(personaId: string, profile: TrendInterestProfile): Promise<void>
  updatePersonaFieldConfidence(personaId: string, confidence: FieldConfidence): Promise<void>


  createDailyGrowthBrief(input: {
    organizationId: string
    localDate: string
    generationVersion?: number
    trendSnapshot?: Record<string, unknown>
    promptVersion?: string
    postCaption?: string
    visualType?: VisualType
    visualConcept?: string
    visualPrompt?: string
    visualReason?: string
    alternateIdeas?: Array<{ title: string; angle: string; whyNow: string }>
    contentMemoryHash?: string
    qualityResult?: Record<string, unknown>
    generationCostUsd?: number
  }): Promise<DailyGrowthBrief>
  getDailyGrowthBrief(localDate: string): Promise<DailyGrowthBrief | null>
  markDailyGrowthBriefCopied(briefId: string): Promise<void>
}
